import { QueryIds, XWAPaths } from '../Types/index.js';
import { generateProfilePicture } from '../Utils/messages-media.js';
import { getBinaryNodeChild } from '../WABinary/index.js';
import { makeGroupsSocket } from './groups.js';
import { executeWMexQuery as genericExecuteWMexQuery } from './mex.js';
import { makeNewsletterChannelApi, mapNewsletterError } from './newsletter-channel.js';
import { createHash } from 'crypto';

export const makeNewsletterSocket = (config) => {
    const sock = makeGroupsSocket(config);
    const { query, generateMessageTag } = sock;
    
    const executeWMexQuery = (variables, queryId, dataPath) => {
        return genericExecuteWMexQuery(variables, queryId, dataPath, query, generateMessageTag);
    };

    // Channel API (create / update / metadata / react / remove / fetch / canPost) lives in newsletter-channel.js
    const channelApi = makeNewsletterChannelApi({ query, generateMessageTag, executeWMexQuery });
    const { newsletterUpdate } = channelApi;

    const _sendNewsletterNode = async (jid, encodedBytes, msgId, extraAttrs = {}, meta = {}) => {
        // meta.type      -> stanza type ('text' | 'media' | ...), defaults to 'text' (old behaviour)
        // meta.mediatype -> optional <plaintext mediatype="image|video|audio|ptt|document|sticker|gif">
        const stanza = {
            tag: 'message',
            attrs: {
                to: jid,
                id: msgId,
                type: meta.type || 'text',
                ...extraAttrs
            },
            content: [
                {
                    tag: 'plaintext',
                    attrs: meta.mediatype ? { mediatype: meta.mediatype } : {},
                    content: encodedBytes
                }
            ]
        };
        return query(stanza);
    };

    // Low-level publish used by sendChannelStatus (lib/Socket/messages-send.js).
    // Sends an already-built proto.Message to a channel with the correct stanza
    // type / mediatype and returns the server ack info.
    const newsletterPublish = async (jid, message, options = {}) => {
        const { encodeNewsletterMessage, generateMessageIDV2 } = await import('../Utils/index.js');
        const msgId = options.messageId || generateMessageIDV2(sock.user?.id);
        const encoded = encodeNewsletterMessage(message);
        const ack = await _sendNewsletterNode(jid, encoded, msgId, options.additionalAttributes || {}, {
            type: options.type,
            mediatype: options.mediatype
        });
        const serverId =
            ack?.attrs?.server_id ?? getBinaryNodeChild(ack, 'message')?.attrs?.server_id ?? undefined;
        return {
            key: { remoteJid: jid, fromMe: true, id: msgId },
            serverId,
            ack,
            message
        };
    };

    // Unified send function for all newsletter message types
    const newsletterSend = async (jid, content, waUploadToServer, options = {}) => {
        const { encodeNewsletterMessage, generateMessageIDV2, prepareWAMessageMedia } =
            await import('../Utils/index.js');
        
        const msgId = options.messageId || generateMessageIDV2(sock.user?.id);
        
        let encoded;
        let resultMessage;
        
        // Handle different content types
        if (typeof content === 'string') {
            // Simple text message
            const message = { conversation: content };
            encoded = encodeNewsletterMessage(message);
            resultMessage = message;
        } else if (content.text) {
            // Text message with options
            const message = { conversation: content.text };
            encoded = encodeNewsletterMessage(message);
            resultMessage = message;
        } else if (content.image || content.video || content.audio || content.document || content.sticker) {
            // Media message
            const mediaMsg = await prepareWAMessageMedia(content, {
                upload: waUploadToServer,
                logger: config.logger,
                mediaCache: config.mediaCache,
                options: config.options,
                jid 
            });
            encoded = encodeNewsletterMessage(mediaMsg);
            resultMessage = mediaMsg;
        } else if (content.buttons || content.interactiveMessage) {
            // Buttons/interactive message
            const { proto } = await import('../../WAProto/index.js');
            
            const interactiveMessage = proto.Message.InteractiveMessage.create({
                body: proto.Message.InteractiveMessage.Body.create({
                    text: content.text || content.body || ''
                }),
                footer: content.footer
                    ? proto.Message.InteractiveMessage.Footer.create({ text: content.footer })
                    : undefined,
                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                    buttons: (content.buttons || []).map((b) =>
                        proto.Message.InteractiveMessage.NativeFlowMessage.NativeFlowButton.create(b)
                    )
                })
            });
            
            const message = proto.Message.create({ interactiveMessage });
            encoded = encodeNewsletterMessage(message);
            resultMessage = message;
        } else {
            // Any other message type
            encoded = encodeNewsletterMessage(content);
            resultMessage = content;
        }
        
        await _sendNewsletterNode(jid, encoded, msgId, options.additionalAttributes || {});
        
        return { 
            key: { remoteJid: jid, fromMe: true, id: msgId }, 
            message: resultMessage 
        };
    };

    // Direct send for relayMessage
    const newsletterSendDirect = async (jid, message, options = {}) => {
        const { encodeNewsletterMessage } = await import('../Utils/index.js');
        const msgId = options.messageId || generateMessageTag();
        
        const encoded = encodeNewsletterMessage(message);
        await _sendNewsletterNode(jid, encoded, msgId, options.additionalAttributes || {});
        
        return true;
    };

    return {
        ...sock,
        
        // Main unified send function
        newsletterSend,
        newsletterSendDirect,
        newsletterPublish,

        newsletterSubscribers: async (jid) => {
            return executeWMexQuery(
                { newsletter_id: jid },
                QueryIds.SUBSCRIBERS,
                XWAPaths.xwa2_newsletter_subscribers
            );
        },

        newsletterFollow: (jid) => {
            return executeWMexQuery(
                { newsletter_id: jid },
                QueryIds.FOLLOW,
                XWAPaths.xwa2_newsletter_join_v2
            );
        },

        newsletterUnfollow: (jid) => {
            return executeWMexQuery(
                { newsletter_id: jid },
                QueryIds.UNFOLLOW,
                XWAPaths.xwa2_newsletter_leave_v2
            );
        },

        newsletterMute: (jid) => {
            return executeWMexQuery(
                { newsletter_id: jid },
                QueryIds.MUTE,
                XWAPaths.xwa2_newsletter_mute_v2
            );
        },

        newsletterUnmute: (jid) => {
            return executeWMexQuery(
                { newsletter_id: jid },
                QueryIds.UNMUTE,
                XWAPaths.xwa2_newsletter_unmute_v2
            );
        },

        newsletterUpdateName: async (jid, name) => {
            return newsletterUpdate(jid, { name });
        },

        newsletterUpdateDescription: async (jid, description) => {
            return newsletterUpdate(jid, { description });
        },

        newsletterUpdatePicture: async (jid, content) => {
            const { img } = await generateProfilePicture(content);
            return newsletterUpdate(jid, { picture: img.toString('base64') });
        },

        newsletterRemovePicture: async (jid) => {
            return newsletterUpdate(jid, { picture: '' });
        },

        subscribeNewsletterUpdates: async (jid) => {
            const result = await query({
                tag: 'iq',
                attrs: {
                    id: generateMessageTag(),
                    type: 'set',
                    xmlns: 'newsletter',
                    to: jid
                },
                content: [{ tag: 'live_updates', attrs: {}, content: [] }]
            });
            const liveUpdatesNode = getBinaryNodeChild(result, 'live_updates');
            const duration = liveUpdatesNode?.attrs?.duration;
            return duration ? { duration } : null;
        },

        newsletterAdminCount: async (jid) => {
            const response = await executeWMexQuery(
                { newsletter_id: jid },
                QueryIds.ADMIN_COUNT,
                XWAPaths.xwa2_newsletter_admin_count
            );
            return response.admin_count;
        },

        newsletterChangeOwner: async (jid, newOwnerJid) => {
            await executeWMexQuery(
                { newsletter_id: jid, user_id: newOwnerJid },
                QueryIds.CHANGE_OWNER,
                XWAPaths.xwa2_newsletter_change_owner
            );
        },

        newsletterDemote: async (jid, userJid) => {
            await executeWMexQuery(
                { newsletter_id: jid, user_id: userJid },
                QueryIds.DEMOTE,
                XWAPaths.xwa2_newsletter_demote
            );
        },

        newsletterDelete: async (jid) => {
            await executeWMexQuery(
                { newsletter_id: jid },
                QueryIds.DELETE,
                XWAPaths.xwa2_newsletter_delete_v2
            );
        },

        // Keep original for backward compatibility
        newsletterSendMedia: async (jid, content, waUploadToServer, options = {}) => {
            const { encodeNewsletterMessage, generateMessageIDV2, prepareWAMessageMedia } =
                await import('../Utils/index.js');

            const msgId = options.messageId || generateMessageIDV2(sock.user?.id);

            const mediaMsg = await prepareWAMessageMedia(content, {
                upload: waUploadToServer,
                logger: config.logger,
                mediaCache: config.mediaCache,
                options: config.options,
                jid 
            });

            const encoded = encodeNewsletterMessage(mediaMsg);
            await _sendNewsletterNode(jid, encoded, msgId, options.additionalAttributes || {});

            return { key: { remoteJid: jid, fromMe: true, id: msgId }, message: mediaMsg };
        },

        newsletterSendButtons: async (jid, content, options = {}) => {
            const { encodeNewsletterMessage, generateMessageIDV2 } =
                await import('../Utils/index.js');
            const { proto } = await import('../../WAProto/index.js');

            const msgId = options.messageId || generateMessageIDV2(sock.user?.id);

            const interactiveMessage = proto.Message.InteractiveMessage.create({
                body: proto.Message.InteractiveMessage.Body.create({
                    text: content.body || ''
                }),
                footer: content.footer
                    ? proto.Message.InteractiveMessage.Footer.create({ text: content.footer })
                    : undefined,
                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                    buttons: (content.buttons || []).map((b) =>
                        proto.Message.InteractiveMessage.NativeFlowMessage.NativeFlowButton.create(b)
                    )
                })
            });

            const message = proto.Message.create({ interactiveMessage });
            const encoded = encodeNewsletterMessage(message);

            await _sendNewsletterNode(jid, encoded, msgId, options.additionalAttributes || {});

            return { key: { remoteJid: jid, fromMe: true, id: msgId }, message };
        },

        // ... දැනට ඇති කේතයට පහළින් මෙය එක් කරන්න ...

newsletterSendPollVote: async (jid, parentServerId, options) => {
            const names = Array.isArray(options) ? options : [options];
            const votes = names.map(name => ({
                tag: 'vote',
                attrs: {},
                content: createHash('sha256').update(String(name), 'utf-8').digest()
            }));
            const messageId = generateMessageTag();
            const ack = await query({
                tag: 'message',
                attrs: {
                    to: jid,
                    id: messageId,
                    type: 'poll',
                    server_id: String(parentServerId)
                },
                content: [
                    { tag: 'meta', attrs: { polltype: 'vote' } },
                    { tag: 'votes', attrs: {}, content: votes }
                ]
            });
            return { id: messageId, ack };
        },
        // legacy helper (kept for backward compatibility)
        newsletterVotePoll: async (jid, serverId, optionIndex) => {
    return await query({
        tag: 'message',
        attrs: {
            to: jid,
            id: generateMessageTag(),
            type: 'poll',
            server_id: serverId,
            edit: '3'  // 👈 Vote එකට 'edit: 3' අවශ්‍යයි!
        },
        content: [
            {
                tag: 'poll_update',
                attrs: {
                    poll_update_type: 'VOTE',
                    poll_creation_message_key: serverId
                },
                content: [
                    {
                        tag: 'selected_options',
                        content: [
                            { tag: 'option', attrs: { index: optionIndex.toString() } }
                        ]
                    }
                ]
            }
        ]
    });
},
        
        // Convenience methods
        newsletterSendText: async (jid, text, options = {}) => {
            return newsletterSend(jid, { text }, sock.waUploadToServer, options);
        },

        // Channel API from newsletter-channel.js
        ...channelApi,
        mapNewsletterError
    };
};
