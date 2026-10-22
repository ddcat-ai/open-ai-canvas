const MOVABLE_POPUP_ANCHOR_SELECTOR = "[data-popover-anchor-container], .canvas-prompt-optimizer-popover, .ant-popover, .ant-dropdown";

/** 只观察锚点的可移动祖先，避免浮层定位样式造成观察回路。 */
export function observeMovablePopupAnchor(anchor: HTMLElement, onMove: () => void): () => void {
    let observer: MutationObserver | undefined;
    for (let container: HTMLElement | null = anchor; container; container = container.parentElement) {
        if (container.matches(MOVABLE_POPUP_ANCHOR_SELECTOR)) {
            observer ??= new MutationObserver(onMove);
            observer.observe(container, { attributes: true, attributeFilter: ["style"] });
        }
    }
    return () => observer?.disconnect();
}
