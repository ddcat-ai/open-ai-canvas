/**
 * 插件节点生成事件总线。
 *
 * 宿主提示词面板（CanvasNodePromptPanel）的「生成」按钮走官方 handleGenerateNode；
 * 对 sandbox 渲染的插件节点，project.tsx 把请求转发到这里，节点组件订阅后用自己的
 * 生成逻辑执行（如插件节点自带操作界面、自己跑生成）。这为未来插件「宿主面板生成 →
 * 插件内部生成」提供通用通道。
 */

export type PluginNodeGenerateRequest = {
    nodeId: string;
    prompt: string;
    mode?: string;
};

/** 插件节点请求把生成结果物化为画布节点（如插件把生成结果落成画布节点）。 */
export type PluginNodeMaterializeRequest = {
    nodeId: string;
    title: string;
    url: string;
    storageKey?: string;
    width?: number;
    height?: number;
    durationMs?: number;
    bytes?: number;
    mimeType?: string;
    /**
     * 画布**绝对**坐标。给了就按它放（图层拆分要按 bounding_box 原位还原）；
     * 不给则宿主把节点排在源节点右侧堆叠（原有行为）。
     */
    x?: number;
    y?: number;
    /** 节点类型，缺省 image。 */
    type?: "image" | "video";
};

type Listener = (request: PluginNodeGenerateRequest) => void;
type MaterializeListener = (request: PluginNodeMaterializeRequest) => void;

const listeners = new Set<Listener>();
const materializeListeners = new Set<MaterializeListener>();

export function emitPluginNodeGenerate(request: PluginNodeGenerateRequest): void {
    for (const listener of listeners) listener(request);
}

/** 订阅某节点的生成请求；返回退订函数。 */
export function onPluginNodeGenerate(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function emitPluginNodeMaterialize(request: PluginNodeMaterializeRequest): void {
    for (const listener of materializeListeners) listener(request);
}

/** 订阅插件节点的「结果放入画布」请求；返回退订函数。 */
export function onPluginNodeMaterialize(listener: MaterializeListener): () => void {
    materializeListeners.add(listener);
    return () => {
        materializeListeners.delete(listener);
    };
}
