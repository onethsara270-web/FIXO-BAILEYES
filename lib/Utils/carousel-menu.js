/**
 * Carousel (swipeable cards) menu helpers.
 *
 * Builds the WhatsApp `interactiveMessage.carouselMessage` structure used by
 * `sock.sendCarouselMenu()` — a header text on top and a row of swipeable cards,
 * every card having its own image + command list (like a "GROUP MENU" / "SETTINGS MENU" bot menu).
 */
export const DEFAULT_CAROUSEL_FOOTER = 'DEVELOPED BY FIXO DEV ⚡';

/** "• .add\n• .kick 🔒" – turns ['.add', '.kick 🔒'] (or {cmd, locked}) into the list text shown on a card */
export const formatCardCommands = (commands = [], bullet = '•') =>
    commands
        .map(c => (typeof c === 'string' ? c : `${c.cmd}${c.locked ? ' 🔒' : ''}`))
        .map(line => `${bullet} ${line}`)
        .join('\n');

/** Normalises one user card into { title, body, footer, image, buttons } */
export const normaliseCarouselCard = (card = {}) => {
    const body = [card.title, card.text ?? (card.commands ? '\n' + formatCardCommands(card.commands) : '')]
        .filter(v => v !== undefined && v !== '')
        .join('\n');
    return {
        image: card.image,
        body,
        footer: card.footer,
        buttons: card.buttons || []
    };
};
