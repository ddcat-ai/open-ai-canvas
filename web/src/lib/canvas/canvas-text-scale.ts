const DEFAULT_TEXT_NODE_WIDTH = 340;
const DEFAULT_TEXT_NODE_HEIGHT = 240;
const DEFAULT_TEXT_FONT_SIZE = 14;
const MIN_TEXT_FONT_SIZE = 8;
const MAX_TEXT_FONT_SIZE = 72;

/**
 * Keep text readable while a text node is resized.
 *
 * The geometric mean makes the scale respond to both dimensions without making
 * a very wide, short node grow as aggressively as a purely width-based rule.
 */
export function canvasTextFontSize(width: number, height: number, baseFontSize = DEFAULT_TEXT_FONT_SIZE) {
    const safeWidth = Number.isFinite(width) && width > 0 ? width : DEFAULT_TEXT_NODE_WIDTH;
    const safeHeight = Number.isFinite(height) && height > 0 ? height : DEFAULT_TEXT_NODE_HEIGHT;
    const safeBaseFontSize = Number.isFinite(baseFontSize) && baseFontSize > 0 ? baseFontSize : DEFAULT_TEXT_FONT_SIZE;
    const scale = Math.sqrt((safeWidth / DEFAULT_TEXT_NODE_WIDTH) * (safeHeight / DEFAULT_TEXT_NODE_HEIGHT));
    return Math.min(MAX_TEXT_FONT_SIZE, Math.max(MIN_TEXT_FONT_SIZE, safeBaseFontSize * scale));
}
