// Channel (Newsletter) API layer.
//
// All node construction + response parsing for the channel helpers lives in this file.
// It is mixed into the socket from `newsletter.js`, so every function below is exposed on `sock`:
//
//   sock.newsletterCanPostStatus(jid)
//   sock.newsletterCreate(name, description)
//   sock.newsletterUpdate(jid, { name, description, pictureBuffer })
//   sock.newsletterReactMessage(jid, serverId, reaction)
//   sock.newsletterRemoveMessage(jid, serverId)
//   sock.newsletterMetadata(type, key)
//   sock.newsletterFetchMessages(jid, count, since, after)
//   (+ sock.sendChannelStatus in messages-send.js, which uses `mapNewsletterError` & `newsletterPublish`)
//
// Namespaces: metadata / create / update / admin-count go through `xmlns="w:mex"` (GraphQL over IQ,
// see mex.js); message level actions (react / remove / history) use `xmlns="newsletter"` + <message> stanzas.
import { Boom } from '@hapi/boom';
import { proto } from '../../WAProto/index.js';
import { QueryIds, XWAPaths } from '../Types/index.js';
import { generateProfilePicture } from '../Utils/messages-media.js';
import { getBinaryNodeChild, getBinaryNodeChildren, isJidNewsletter } from '../WABinary/index.js';

export const NEWSLETTER_ADMIN_ROLES = ['OWNER', 'ADMIN'];
// WhatsApp rejects text statuses without a background colour, so we always send one.
export const DEFAULT_STATUS_BACKGROUND = '#FFC107';

// ─────────────────────────── errors ───────────────────────────

const extractCode = (err) => {
    const candidates = [
        err?.output?.statusCode,
        err?.data?.attrs?.code,
        err?.data?.extensions?.error_code,
        err?.data?.content?.[0]?.attrs?.code,
        err?.statusCode,
        typeof err?.data === 'number' ? err.data : undefined
    ];
    for (const c of candidates) {
        const n = parseInt(c, 10);
        if (!Number.isNaN(n)) return n;
    }
    return undefined;
};

const extractText = (err) => {
    const node = err?.data?.content?.[0]?.attrs?.text || err?.data?.attrs?.text;
    return `${err?.message || ''} ${node || ''} ${err?.data?.message || ''}`.toLowerCase();
};

/**
 * Normalises server / GraphQL errors into a Boom with a stable statusCode:
 *  403 -> not an admin/owner · 429 -> rate limited (data.retryAfter if known) · 404 -> channel not found
 * The original error is kept in `error.data.original`.
 */
export const mapNewsletterError = (err, action = 'newsletter request') => {
    if (!err) return err;
    const code = extractCode(err);
    const text = extractText(err);

    if (code === 429 || /rate[-_ ]?(limit|overlimit)|too many|overlimit/.test(text)) {
        const retryAfter = parseInt(err?.data?.attrs?.retry_after ?? err?.data?.extensions?.retry_after, 10);
        return new Boom(`Rate limit hit while trying to ${action} — slow down and retry later`, {
            statusCode: 429,
            data: { original: err, retryAfter: Number.isNaN(retryAfter) ? undefined : retryAfter }
        });
    }
    if (
        code === 401 ||
        code === 403 ||
        /not[-_ ]?authori[sz]ed|forbidden|not an admin|permission|admin_required|role/.test(text)
    ) {
        return new Boom(`Not an admin: the connected account is not allowed to ${action} on this channel`, {
            statusCode: 403,
            data: { original: err }
        });
    }
    if (code === 404 || /not[-_ ]?found|item-not-found/.test(text)) {
        return new Boom(`Channel or message not found while trying to ${action}`, {
            statusCode: 404,
            data: { original: err }
        });
    }
    return err;
};

const guarded = async (action, fn) => {
    try {
        return await fn();
    } catch (err) {
        throw mapNewsletterError(err, action);
    }
};

const assertChannelJid = (jid, fn) => {
    if (!isJidNewsletter(jid)) {
        throw new Boom(`${fn}: expected a channel JID (xxxx@newsletter), got "${jid}"`, { statusCode: 400 });
    }
};

const assertServerId = (serverId, fn) => {
    if (serverId === undefined || serverId === null || String(serverId).trim() === '') {
        throw new Boom(`${fn}: serverId is required (the channel server id of the message)`, { statusCode: 400 });
    }
    return String(serverId);
};

// ─────────────────────────── parsers ───────────────────────────

const text = (v) => (v && typeof v === 'object' ? v.text ?? null : v ?? null);

const toInt = (v) => {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? undefined : n;
};

/** Accepts the raw mex payload ({ id, ... } or { result: { id, ... } }) */
export const unwrapNewsletterResult = (result) => {
    if (typeof result !== 'object' || result === null) return null;
    if (typeof result.id === 'string') return result;
    if (result.result && typeof result.result === 'object' && 'id' in result.result) return result.result;
    return null;
};

/**
 * Flat, friendly view of a channel. All raw mex fields (`thread_metadata`, `viewer_metadata`, ...) are kept,
 * so older code that reads them keeps working.
 */
export const normalizeNewsletterMetadata = (raw, extra = {}) => {
    const r = unwrapNewsletterResult(raw);
    if (!r) return null;
    const thread = r.thread_metadata || {};
    const viewer = r.viewer_metadata || {};
    const verification = thread.verification ?? null;
    return {
        ...r,
        jid: r.id,
        name: text(thread.name),
        description: text(thread.description),
        invite: thread.invite ?? null,
        subscribers: toInt(thread.subscribers_count) ?? 0,
        verification,
        verified: verification === 'VERIFIED',
        creationTime: toInt(thread.creation_time),
        picture: thread.picture ? { id: thread.picture.id, directPath: thread.picture.direct_path } : null,
        state: r.state?.type ?? r.state ?? null,
        muted: viewer.mute === 'ON',
        role: viewer.role ?? null,
        isAdmin: NEWSLETTER_ADMIN_ROLES.includes(viewer.role),
        isOwner: viewer.role === 'OWNER',
        admins: {
            count: extra.adminCount ?? null,
            viewerRole: viewer.role ?? null
        }
    };
};

const findNodes = (node, tag, out = []) => {
    if (!node || !Array.isArray(node.content)) return out;
    for (const child of node.content) {
        if (child?.tag === tag) out.push(child);
        findNodes(child, tag, out);
    }
    return out;
};

const decodePlaintext = (node) => {
    const plain = getBinaryNodeChild(node, 'plaintext');
    if (!plain?.content) return null;
    try {
        const buf = typeof plain.content === 'string' ? Buffer.from(plain.content, 'binary') : Buffer.from(plain.content);
        return proto.Message.decode(buf);
    } catch {
        return null;
    }
};

/** <message_updates><messages><message server_id t>…</message></messages></message_updates> -> array */
export const parseNewsletterMessages = (result) => {
    return findNodes(result, 'message').map((node) => {
        const reactions = getBinaryNodeChildren(getBinaryNodeChild(node, 'reactions'), 'reaction').map((r) => ({
            code: r.attrs.code,
            count: toInt(r.attrs.count) ?? 0
        }));
        const views = getBinaryNodeChild(node, 'views_count')?.attrs?.count;
        return {
            serverId: node.attrs.server_id,
            id: node.attrs.message_id || node.attrs.id,
            timestamp: toInt(node.attrs.t),
            type: node.attrs.type,
            message: decodePlaintext(node),
            views: toInt(views),
            reactions
        };
    });
};

// ─────────────────────────── factory ───────────────────────────

export const makeNewsletterChannelApi = ({ query, generateMessageTag, executeWMexQuery }) => {
    const newsletterMetadata = async (type, key, options = {}) => {
        const t = String(type || '').toLowerCase();
        if (t !== 'invite' && t !== 'jid') {
            throw new Boom("newsletterMetadata: type must be 'invite' or 'jid'", { statusCode: 400 });
        }
        if (!key) throw new Boom('newsletterMetadata: key is required', { statusCode: 400 });
        // accept a full invite link too
        const cleanKey = t === 'invite' ? String(key).replace(/^.*\/channel\//, '').split(/[?#]/)[0] : key;

        const raw = await guarded('fetch metadata', () =>
            executeWMexQuery(
                {
                    fetch_creation_time: true,
                    fetch_full_image: true,
                    fetch_viewer_metadata: true,
                    input: { key: cleanKey, type: t.toUpperCase() }
                },
                QueryIds.METADATA,
                XWAPaths.xwa2_newsletter_metadata
            )
        );
        const base = unwrapNewsletterResult(raw);
        if (!base) return null;

        let adminCount;
        const isAdmin = NEWSLETTER_ADMIN_ROLES.includes(base.viewer_metadata?.role);
        if (options.withAdmins !== false && isAdmin) {
            try {
                const res = await executeWMexQuery(
                    { newsletter_id: base.id },
                    QueryIds.ADMIN_COUNT,
                    XWAPaths.xwa2_newsletter_admin_count
                );
                adminCount = toInt(res?.admin_count);
            } catch {
                adminCount = undefined; // admin count is best-effort
            }
        }
        return normalizeNewsletterMetadata(base, { adminCount });
    };

    const newsletterCanPostStatus = async (jid) => {
        assertChannelJid(jid, 'newsletterCanPostStatus');
        try {
            const meta = await newsletterMetadata('jid', jid, { withAdmins: false });
            const role = meta?.role ?? null;
            return { canPost: NEWSLETTER_ADMIN_ROLES.includes(role), role };
        } catch (err) {
            // "not an admin" / not found style failures simply mean the bot cannot post
            if (err?.output?.statusCode === 403 || err?.output?.statusCode === 404) {
                return { canPost: false, role: null };
            }
            throw err;
        }
    };

    const newsletterCreate = async (name, description) => {
        if (typeof name !== 'string' || !name.trim()) {
            throw new Boom('newsletterCreate: name is required', { statusCode: 400 });
        }
        const raw = await guarded('create a channel', () =>
            executeWMexQuery(
                { input: { name: name.trim(), description: description ?? null } },
                QueryIds.CREATE,
                XWAPaths.xwa2_newsletter_create
            )
        );
        const meta = normalizeNewsletterMetadata(raw);
        if (!meta) {
            throw new Boom('newsletterCreate: unexpected response from server', { statusCode: 500, data: raw });
        }
        // `jid` + legacy fields (`creation_time`, `mute_state`) so older callers keep working
        return { ...meta, creation_time: meta.creationTime, mute_state: raw.viewer_metadata?.mute };
    };

    /**
     * updates: { name?, description?, pictureBuffer? }
     *  - pictureBuffer: Buffer | { url } | stream  (resized to a channel DP and uploaded as base64)
     *  - pictureBuffer: null | '' removes the picture
     */
    const newsletterUpdate = async (jid, updates = {}) => {
        assertChannelJid(jid, 'newsletterUpdate');
        const { name, description, pictureBuffer, picture, ...rest } = updates;
        const payload = { ...rest };
        if (name !== undefined) payload.name = name;
        if (description !== undefined) payload.description = description;

        if (pictureBuffer === null || pictureBuffer === '') {
            payload.picture = '';
        } else if (pictureBuffer !== undefined) {
            const { img } = await generateProfilePicture(pictureBuffer);
            payload.picture = img.toString('base64');
        } else if (picture !== undefined) {
            payload.picture = picture; // already base64 (backward compatibility)
        }
        if (!Object.keys(payload).length) {
            throw new Boom('newsletterUpdate: nothing to update (pass name, description or pictureBuffer)', {
                statusCode: 400
            });
        }
        return guarded('update the channel', () =>
            executeWMexQuery(
                { newsletter_id: jid, updates: { ...payload, settings: null } },
                QueryIds.UPDATE_METADATA,
                'xwa2_newsletter_update'
            )
        );
    };

    /** reactionCode = emoji to react, '' (or null) removes your reaction */
    const newsletterReactMessage = async (jid, serverId, reactionCode) => {
        assertChannelJid(jid, 'newsletterReactMessage');
        const sid = assertServerId(serverId, 'newsletterReactMessage');
        const code = reactionCode || '';
        const id = generateMessageTag();
        await guarded('react to a message', () =>
            query({
                tag: 'message',
                attrs: { to: jid, id, type: 'reaction', server_id: sid, ...(code ? {} : { edit: '7' }) },
                content: [{ tag: 'reaction', attrs: code ? { code } : {} }]
            })
        );
        return { id, serverId: sid, reaction: code, removed: !code };
    };

    /** Revoke a message that was posted in the channel */
    const newsletterRemoveMessage = async (jid, serverId) => {
        assertChannelJid(jid, 'newsletterRemoveMessage');
        const sid = assertServerId(serverId, 'newsletterRemoveMessage');
        const id = generateMessageTag();
        const ack = await guarded('remove a message', () =>
            query({
                tag: 'message',
                attrs: { to: jid, id, type: 'text', edit: '8', server_id: sid },
                content: []
            })
        );
        return { id, serverId: sid, removed: true, ack };
    };

    /** Channel history -> [{ serverId, id, message, timestamp, views, reactions }] (`{ raw: true }` returns the node) */
    const newsletterFetchMessages = async (jid, count = 20, since, after, options = {}) => {
        assertChannelJid(jid, 'newsletterFetchMessages');
        const attrs = { count: String(Math.max(1, parseInt(count, 10) || 20)) };
        if (typeof since === 'number') attrs.since = String(since);
        if (after) attrs.after = String(after);

        const result = await guarded('fetch messages', () =>
            query({
                tag: 'iq',
                attrs: { id: generateMessageTag(), type: 'get', xmlns: 'newsletter', to: jid },
                content: [{ tag: 'message_updates', attrs }]
            })
        );
        return options.raw ? result : parseNewsletterMessages(result);
    };

    return {
        newsletterMetadata,
        newsletterCanPostStatus,
        newsletterCreate,
        newsletterUpdate,
        newsletterReactMessage,
        newsletterRemoveMessage,
        newsletterFetchMessages
    };
};
