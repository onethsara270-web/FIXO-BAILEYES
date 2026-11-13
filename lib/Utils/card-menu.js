/**
 * Card-style menu renderer (neon "cyber" look).
 * Builds an SVG and converts it to PNG with `sharp` (already an optional dependency of this lib).
 *
 * renderCardMenu({
 *   botName: 'SULA MD',              // your bot's name (top pill = botName + section)
 *   section: 'GAMES',                // top pill suffix
 *   label: 'CYBER ARCADE',           // small caption
 *   title: 'Select Game 🕹️',         // big heading
 *   badge: 'ARCADE READY',           // pill top-right (optional)
 *   // icon = emoji (colored emoji needs a font like Noto Color Emoji on the server), or iconImage = data: URI (PNG/SVG)
 *   items: [{ icon: '🏎️', title: 'Highway', subtitle: 'RACER 2D', color: '#f59e0b' }, ...],
 *   columns: 3,
 *   footer: 'DEVELOPED BY FIXO DEV ⚡', // default
 *   accent: '#22d3ee'
 * }) => Promise<Buffer>
 */
const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const DEFAULT_FOOTER = 'DEVELOPED BY FIXO DEV ⚡';
const PALETTE = ['#f59e0b', '#22d3ee', '#ec4899', '#22c55e', '#a855f7', '#f43f5e', '#8b5cf6', '#ef4444', '#eab308'];
export const buildCardMenuSvg = (opts = {}) => {
    const { botName = 'FIXO BOT', section = 'MENU', label = '', title = 'Select', badge = '', items = [], columns = 3, footer = DEFAULT_FOOTER, accent = '#22d3ee', width = 720 } = opts;
    // top pill = "<BOT NAME> <SECTION>"  (e.g. "SULA MD GAMES"); `brand` can override it fully
    const brand = opts.brand || `${botName} ${section}`.trim().toUpperCase();
    const pad = 28, outer = 22, gap = 14;
    const cols = Math.max(1, Math.min(columns, 4));
    const rows = Math.max(1, Math.ceil(items.length / cols));
    const innerW = width - outer * 2 - pad * 2;
    const cellW = (innerW - gap * (cols - 1)) / cols;
    const cellH = 150;
    const headerH = 120;
    const gridH = rows * cellH + (rows - 1) * gap + 28;
    const footerH = footer ? 60 : 24;
    const height = outer * 2 + headerH + gridH + footerH + 20;
    let cells = '';
    items.forEach((it, i) => {
        const r = Math.floor(i / cols), c = i % cols;
        const x = outer + pad + 14 + c * (cellW + gap) - 14 + 14;
        const y = outer + headerH + 14 + r * (cellH + gap);
        const col = it.color || PALETTE[i % PALETTE.length];
        cells += `<g transform="translate(${x - 14},${y})">
<rect width="${cellW}" height="${cellH}" rx="20" fill="#05080f" stroke="${col}" stroke-opacity="0.75" stroke-width="2"/>
${it.iconImage ? `<image x="${cellW / 2 - 24}" y="22" width="48" height="48" href="${esc(it.iconImage)}"/>` : `<text x="${cellW / 2}" y="68" text-anchor="middle" font-size="44" fill="${col}" font-family="Noto Color Emoji,Apple Color Emoji,Segoe UI Emoji,sans-serif">${esc(it.icon || '•')}</text>`}
<text x="${cellW / 2}" y="104" text-anchor="middle" font-size="21" font-weight="700" fill="#f1f5f9" font-family="Roboto,Arial,sans-serif">${esc(it.title)}</text>
<text x="${cellW / 2}" y="128" text-anchor="middle" font-size="14" font-weight="600" fill="#94a3b8" font-family="Roboto,Arial,sans-serif">${esc(it.subtitle || '')}</text>
</g>`;
    });
    const badgeSvg = badge ? `<g transform="translate(${width - outer - pad - 190},${outer + 40})"><rect width="190" height="40" rx="20" fill="#ec4899" fill-opacity="0.15" stroke="#ec4899" stroke-opacity="0.5"/><text x="95" y="26" text-anchor="middle" font-size="15" font-weight="700" fill="#ec4899" font-family="Roboto,Arial,sans-serif">${esc(badge)}</text></g>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1220"/><stop offset="1" stop-color="#03060c"/></linearGradient>
<filter id="glow"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
<rect width="100%" height="100%" fill="#000"/>
<rect x="${outer}" y="${outer}" width="${width - outer * 2}" height="${height - outer * 2}" rx="34" fill="url(#bg)" stroke="${accent}" stroke-width="3" filter="url(#glow)"/>
<g transform="translate(${width / 2},${outer})"><rect x="-120" y="-16" width="240" height="32" rx="16" fill="#03060c" stroke="${accent}" stroke-width="2"/>
<text y="6" text-anchor="middle" font-size="14" font-weight="700" letter-spacing="3" fill="#cbd5e1" font-family="Roboto,Arial,sans-serif">${esc(brand)}</text></g>
<text x="${outer + pad}" y="${outer + 62}" font-size="16" font-weight="700" letter-spacing="2" fill="${accent}" font-family="Roboto,Arial,sans-serif">${esc(label)}</text>
<text x="${outer + pad}" y="${outer + 98}" font-size="32" font-weight="800" fill="#ffffff" font-family="Roboto,Arial,sans-serif">${esc(title)}</text>
${badgeSvg}
${cells}
${footer ? `<text x="${width / 2}" y="${height - outer - 34}" text-anchor="middle" font-size="15" font-weight="700" letter-spacing="1.5" fill="#94a3b8" font-family="Roboto,Arial,sans-serif">${esc(footer)}</text>` : ''}
</svg>`;
};
export const renderCardMenu = async (opts = {}) => {
    const sharp = (await import('sharp').catch(() => null))?.default;
    if (!sharp) {
        throw new Error('sendCardMenu needs the "sharp" package: npm i sharp');
    }
    return sharp(Buffer.from(buildCardMenuSvg(opts))).png().toBuffer();
};

/**
 * Music player card (like the ".play" card). Returns SVG string.
 * { botName, artist, title, cover (data: URI, optional), position: '0:33', duration: '3:32', progress: 0.15, playing: true }
 */
export const buildPlayerCardSvg = (opts = {}) => {
    const { botName = 'FIXO BOT', artist = '', title = '', cover = '', position = '0:00', duration = '0:00', progress = 0, playing = true, accent = '#22d3ee', footer = `CYBER PLAYER ⚡ ${botName}`.toUpperCase() } = opts;
    const width = 720, height = 1010, o = 22, pad = 36;
    const barW = width - (o + pad) * 2;
    const p = Math.max(0, Math.min(1, progress));
    const cy = 780;
    const btn = playing
        ? `<rect x="-11" y="-16" width="8" height="32" rx="2" fill="#fff"/><rect x="5" y="-16" width="8" height="32" rx="2" fill="#fff"/>`
        : `<path d="M-9 -17 L17 0 L-9 17 Z" fill="#fff"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1220"/><stop offset="1" stop-color="#03060c"/></linearGradient>
<linearGradient id="pb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#2563eb"/></linearGradient>
<clipPath id="cv"><rect x="${o + pad}" y="110" width="${barW}" height="${barW}" rx="26"/></clipPath></defs>
<rect width="100%" height="100%" fill="#000"/>
<rect x="${o}" y="${o}" width="${width - o * 2}" height="${height - o * 2}" rx="34" fill="url(#bg)" stroke="${accent}" stroke-width="3"/>
<text x="${width / 2}" y="70" text-anchor="middle" font-size="15" font-weight="800" letter-spacing="3" fill="${accent}" font-family="Roboto,Arial,sans-serif">NOW PLAYING</text>
<text x="${width / 2}" y="96" text-anchor="middle" font-size="18" font-weight="700" fill="#e2e8f0" font-family="Roboto,Arial,sans-serif">${esc(artist)}</text>
<rect x="${o + pad}" y="110" width="${barW}" height="${barW}" rx="26" fill="#0f172a"/>
${cover ? `<image x="${o + pad}" y="110" width="${barW}" height="${barW}" preserveAspectRatio="xMidYMid slice" clip-path="url(#cv)" href="${esc(cover)}"/>` : ''}
<text x="${o + pad}" y="${110 + barW + 50}" font-size="28" font-weight="800" fill="#fff" font-family="Roboto,Arial,sans-serif">${esc(`${artist} - ${title}`.slice(0, 34))}</text>
<text x="${o + pad}" y="${110 + barW + 82}" font-size="20" fill="#94a3b8" font-family="Roboto,Arial,sans-serif">${esc(artist)}</text>
<rect x="${o + pad}" y="${cy - 60}" width="${barW}" height="8" rx="4" fill="#1e293b"/>
<rect x="${o + pad}" y="${cy - 60}" width="${barW * p}" height="8" rx="4" fill="${accent}"/>
<circle cx="${o + pad + barW * p}" cy="${cy - 56}" r="10" fill="#fff"/>
<text x="${o + pad}" y="${cy - 20}" font-size="16" fill="#94a3b8" font-family="Roboto,Arial,sans-serif">${esc(position)}</text>
<text x="${o + pad + barW}" y="${cy - 20}" text-anchor="end" font-size="16" fill="#94a3b8" font-family="Roboto,Arial,sans-serif">${esc(duration)}</text>
<g transform="translate(${width / 2},${cy + 50})"><circle r="44" fill="url(#pb)"/>${btn}</g>
<path d="M${width / 2 - 130} ${cy + 36} v28 M${width / 2 - 100} ${cy + 36} l-22 14 22 14z" stroke="#64748b" fill="#64748b" stroke-width="4"/>
<path d="M${width / 2 + 130} ${cy + 36} v28 M${width / 2 + 100} ${cy + 36} l22 14 -22 14z" stroke="#64748b" fill="#64748b" stroke-width="4"/>
<text x="${width / 2}" y="${height - o - 30}" text-anchor="middle" font-size="14" font-weight="700" letter-spacing="1.5" fill="#94a3b8" font-family="Roboto,Arial,sans-serif">${esc(footer)}</text>
</svg>`;
};
export const renderPlayerCard = async (opts = {}) => {
    const sharp = (await import('sharp').catch(() => null))?.default;
    if (!sharp) throw new Error('sendPlayerCard needs the "sharp" package: npm i sharp');
    return sharp(Buffer.from(buildPlayerCardSvg(opts))).png().toBuffer();
};
