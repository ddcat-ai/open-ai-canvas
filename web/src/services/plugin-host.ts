import { requestToolResponse, type ResponseFunctionTool, type ResponseInputMessage, type ToolChoice } from "@/services/api/image";
import { pluginStorageFor } from "@/lib/plugins/plugin-storage";
import type { AiConfig } from "@/stores/use-config-store";
import type { PluginHostContext, PluginInstallation, PluginTextRequest, RegisteredPlugin } from "@/lib/plugins/plugin-types";
import { imageToDataUrl } from "@/services/image-storage";
import { getResourceDisplayURL } from "@/services/api/resources";
import { resolvePluginImageReference } from "@/lib/plugins/plugin-media";

export function createPluginHostContext(plugin: RegisteredPlugin, installation: PluginInstallation, aiConfig: AiConfig): PluginHostContext {
    const permissions = new Set(plugin.manifest.permissions);
    return {
        manifest: plugin.manifest,
        permissions,
        storage: pluginStorageFor(plugin.manifest.id),
        config: installation.config,
        services: {
            ai: {
                text: {
                    requestToolResponse: async (request: PluginTextRequest) => {
                        if (!permissions.has("ai.text")) throw new Error("插件没有调用文本模型的权限");
                        const response = await requestToolResponse(
                            { ...aiConfig, model: request.model?.trim() || aiConfig.textModel },
                            request.messages as ResponseInputMessage[],
                            (request.tools || []) as ResponseFunctionTool[],
                            (request.toolChoice || "auto") as ToolChoice,
                            request.onDelta,
                            { signal: request.signal },
                        );
                        return {
                            content: response.content,
                            toolCalls: response.toolCalls.map((call) => ({ name: call.function.name, arguments: call.function.arguments })),
                        };
                    },
                },
            },
            media: {
                resolve: async (reference, signal) => {
                    if (!permissions.has("media.read")) throw new Error("插件没有读取参考媒体的权限");
                    if (signal?.aborted) throw new DOMException("媒体读取已取消", "AbortError");
                    return resolvePluginImageReference(reference, {
                        resolveDataUrl: imageToDataUrl,
                        resolveDisplayUrl: getResourceDisplayURL,
                    });
                },
            },
        },
    };
}
