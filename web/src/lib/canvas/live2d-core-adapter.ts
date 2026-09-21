type CoreModel = {
    drawables: { count: number; renderOrders?: Int32Array };
    offscreens?: { count: number };
    getRenderOrders?: () => Int32Array;
};

// Cubism 5.3 moved render orders to Model and added offscreen render objects.
// Adapt only drawable-only models: the Cubism 4 renderer cannot draw offscreens.
export function adaptLive2DRenderOrders(model: { getModel: () => CoreModel; getDrawableRenderOrders: () => Int32Array }) {
    const core = model.getModel();
    if (core.offscreens?.count) throw new Error("此模型使用新版离屏渲染，当前 Live2D 渲染器暂不支持");
    if (core.drawables.renderOrders) return;
    if (!core.getRenderOrders) throw new Error("Live2D Core 缺少绘制顺序接口，请检查运行库版本");
    const getOrders = () => {
        const orders = core.getRenderOrders!();
        if (orders.length !== core.drawables.count) throw new Error("Live2D 模型绘制顺序数量不匹配");
        return orders;
    };
    getOrders();
    model.getDrawableRenderOrders = getOrders;
}
