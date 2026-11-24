import type { RequestProtocolManifest, RequestProtocolProvider, RequestProtocolRelease } from "@/services/api/request-protocols";

export const protocolCapabilities = [
    { value: "video", label: "视频" },
    { value: "image", label: "图片" },
    { value: "text", label: "文本" },
    { value: "audio", label: "音频" },
];

export const requestSources = [
    { value: "model", label: "模型 ID" },
    { value: "prompt", label: "提示词" },
    { value: "output.duration", label: "时长（秒）" },
    { value: "output.aspectRatio", label: "画幅比例" },
    { value: "output.resolution", label: "分辨率" },
    { value: "output.quality", label: "画质" },
    { value: "output.count", label: "生成数量" },
    { value: "output.generateAudio", label: "生成声音" },
    { value: "output.watermark", label: "水印开关" },
    { value: "images", label: "参考图片地址列表" },
    { value: "videos", label: "参考视频地址列表" },
    { value: "audios", label: "参考音频地址列表" },
    { value: "messages", label: "对话消息" },
    { value: "instructions", label: "指令" },
];

export function isProtocolObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requestSourceExpression(source: string): unknown {
    if (["images", "videos", "audios"].includes(source)) {
        return { $omitEmpty: { $map: { from: { $ref: "request." + source }, as: "media", in: { $ref: "media.value" } } } };
    }
    return { $ref: "request." + source };
}

export function requestExpressionSource(expression: unknown): string {
    return requestSources.find((source) => JSON.stringify(requestSourceExpression(source.value)) === JSON.stringify(expression))?.value || "advanced";
}

export function responsePathExpression(value: string): unknown {
    const paths = value
        .split(/[,，\n]/)
        .map((path) => path.trim())
        .filter(Boolean);
    const refs = paths.map((path) => ({ $ref: path.startsWith("response.") ? path : "response." + path }));
    return refs.length > 1 ? { $coalesce: refs } : refs[0];
}

export function responseExpressionPaths(value: unknown): string | null {
    if (value === undefined || value === null) return "";
    if (!isProtocolObject(value)) return null;
    if (typeof value.$ref === "string" && Object.keys(value).length === 1) return value.$ref.replace(/^response\./, "");
    if (Array.isArray(value.$coalesce)) {
        const paths = value.$coalesce.map(responseExpressionPaths);
        if (paths.some((path) => path === null)) return null;
        return paths.join(", ");
    }
    return null;
}

export function nextProtocolVersion(releases?: Pick<RequestProtocolRelease, "version">[]): string {
    if (!releases?.length) return "1.0.0";
    let maxMajor = 0;
    for (const release of releases) {
        const major = Number.parseInt(release.version.trim().replace(/^v/i, "").split(".")[0] || "", 10);
        if (Number.isFinite(major) && major > maxMajor) maxMajor = major;
    }
    return `${maxMajor + 1}.0.0`;
}

export function shortReleaseDigest(sha256?: string): string {
    const trimmed = sha256?.trim() || "";
    return trimmed ? trimmed.slice(0, 12) : "";
}

export function newRequestProtocol(): RequestProtocolManifest {
    return {
        apiVersion: "yingce.plugin/v2",
        id: "custom-video",
        name: "自定义视频协议",
        version: "1.0.0",
        permissions: ["generation.run", "media.read"],
        runtime: { backend: "declarative" },
        contributes: {
            providers: [
                {
                    id: "custom-video",
                    label: "自定义视频协议",
                    capabilities: ["video"],
                    scopes: ["admin.system-channel", "user.custom-channel", "canvas", "creation", "agent"],
                    auth: { type: "bearer", field: "apiKey" },
                    create: {
                        method: "POST",
                        path: "/v1/tasks",
                        contentType: "application/json",
                        body: {
                            model: requestSourceExpression("model"),
                            prompt: requestSourceExpression("prompt"),
                            duration: requestSourceExpression("output.duration"),
                            reference_images: requestSourceExpression("images"),
                        },
                    },
                    poll: { method: "GET", path: "/v1/tasks/{{taskId}}" },
                    response: {
                        taskId: responsePathExpression("id, task_id"),
                        status: responsePathExpression("status"),
                        message: responsePathExpression("error.message, message"),
                        videos: responsePathExpression("video_url"),
                        resultEphemeral: true,
                    },
                },
            ],
        },
    };
}

export function updateProtocolProvider(manifest: RequestProtocolManifest, patch: Partial<RequestProtocolProvider>): RequestProtocolManifest {
    return { ...manifest, contributes: { ...manifest.contributes, providers: [{ ...manifest.contributes.providers[0], ...patch }] } };
}

export function parseProtocolManifest(text: string): RequestProtocolManifest {
    const value: unknown = JSON.parse(text);
    if (!isProtocolObject(value) || typeof value.id !== "string" || typeof value.name !== "string" || !isProtocolObject(value.contributes) || !Array.isArray(value.contributes.providers) || value.contributes.providers.length !== 1) {
        throw new Error("协议需要名称、标识和一个请求定义");
    }
    const provider: unknown = value.contributes.providers[0];
    if (!isProtocolObject(provider) || !isProtocolObject(provider.create) || !isProtocolObject(provider.response) || !Array.isArray(provider.capabilities) || !provider.capabilities.length) {
        throw new Error("协议缺少创建接口、能力或响应映射");
    }
    // Structural checks protect the form; the backend performs full runtime validation.
    return value as RequestProtocolManifest;
}

export function protocolExampleRequest() {
    return {
        model: "example-model",
        prompt: "人物向镜头走来",
        output: { duration: 10, aspectRatio: "16:9", resolution: "480p" },
        images: [{ url: "https://example.com/reference.png", kind: "image" }],
    };
}

export function protocolExampleResponse(capability: string) {
    return {
        id: "example-task",
        status: "succeeded",
        ...(capability === "text" ? { text: "示例文本" } : { [capability + "_url"]: "https://example.com/result." + (capability === "image" ? "png" : capability === "audio" ? "mp3" : "mp4") }),
    };
}
