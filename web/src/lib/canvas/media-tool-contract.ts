import { MEDIA_TOOLS, type MediaProcessingOperation, type ProcessingParameters } from "./media-tools.generated";

export { MEDIA_TOOLS };
export type { ProcessingParameters };
export type MediaToolOperation = MediaProcessingOperation;

export type MediaToolParameter = { type: "string" | "number" | "integer"; title?: string; label?: string; enum?: readonly (string | number)[]; minimum?: number; maximum?: number; default?: string | number; capability?: string };
export type MediaToolDefinition = {
    id: string;
    operation: MediaToolOperation;
    label: string;
    description: string;
    parameters: Record<string, MediaToolParameter>;
};

export const videoProcessingTools = MEDIA_TOOLS as readonly MediaToolDefinition[];

export function mediaToolForOperation(operation: unknown): MediaToolDefinition | undefined {
    return videoProcessingTools.find((tool) => tool.operation === operation);
}

/** 这里只校验公开合同；模型专属收窄与实际执行权限始终由服务端准入确认。 */
export function validateProcessingParameters(operation: unknown, value: unknown): ProcessingParameters {
    const tool = mediaToolForOperation(operation);
    if (!tool) throw new Error("不支持的视频处理操作");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("处理参数必须是对象");
    const parameters = value as Record<string, unknown>;
    for (const [key, current] of Object.entries(parameters)) {
        const field = tool.parameters[key];
        if (field?.capability === "video.resolutions") throw new Error("分辨率必须保存在生成规格中");
        if (!field || typeof current !== (field.type === "integer" ? "number" : field.type)) throw new Error(`不支持的处理参数：${key}`);
        if (field.enum && !field.enum.includes(current as string | number)) throw new Error(`处理参数 ${key} 不在允许范围`);
        if (typeof current === "number" && (!Number.isSafeInteger(current) || (field.minimum !== undefined && current < field.minimum) || (field.maximum !== undefined && current > field.maximum))) throw new Error(`处理参数 ${key} 超出允许范围`);
    }
    return { ...parameters } as ProcessingParameters;
}
