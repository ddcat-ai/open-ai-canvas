import type { ReactNode } from "react";

import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasTheme } from "@/lib/canvas-theme";

/**
 * 第三方插件节点渲染器收到的宿主能力。
 *
 * 当前以 props 直传；未来把插件迁移到 iframe/worker 沙箱执行时，这里应扩展为
 * 消息式 Host API（同构描述，如 { updateMetadata, getUpstreamNodes, generate, resolveMedia }），
 * 渲染器接口本身保持不变——这是为「用户上传插件即用」预留的协议边界。
 */
export type PluginNodeRendererProps = {
    node: CanvasNodeData;
    theme: CanvasTheme;
    schema: Record<string, unknown>;
};

export type PluginNodeRenderer = (props: PluginNodeRendererProps) => ReactNode;

const pluginNodeRenderers = new Map<string, PluginNodeRenderer>();

/**
 * 注册表 key：有 pluginId 时用 `${pluginId}:${nodeType}`，否则用裸 `nodeType`。
 * pluginId 作用域避免第三方插件节点类型互相冲突。
 */
export function pluginNodeRendererKey(nodeType: string, pluginId?: string): string {
    return pluginId ? `${pluginId}:${nodeType}` : nodeType;
}

export function registerPluginNodeRenderer(nodeType: string, renderer: PluginNodeRenderer, pluginId?: string): void {
    pluginNodeRenderers.set(pluginNodeRendererKey(nodeType, pluginId), renderer);
}

export function unregisterPluginNodeRenderer(nodeType: string, pluginId?: string): void {
    pluginNodeRenderers.delete(pluginNodeRendererKey(nodeType, pluginId));
}

export function getPluginNodeRenderer(nodeType: string, pluginId?: string): PluginNodeRenderer | undefined {
    if (pluginId) {
        const scoped = pluginNodeRenderers.get(pluginNodeRendererKey(nodeType, pluginId));
        if (scoped) return scoped;
    }
    // 兼容未声明 pluginId 的简单插件。
    return pluginNodeRenderers.get(nodeType);
}
