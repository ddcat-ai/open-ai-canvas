export const CANVAS_MAX_RENDERED_NODES = 720;
export const CANVAS_MAX_RENDERED_CONNECTIONS = 5000;

export function canvasNodeRenderPadding(previouslyRendered: boolean) {
    return previouslyRendered ? 384 : 192;
}

export function canvasNodeRenderBudget(scale: number) {
    if (scale < 0.14) return 280;
    if (scale < 0.28) return 420;
    return CANVAS_MAX_RENDERED_NODES;
}
