import type { VideoResponseTools } from "./video-response";
import type { VideoTransport } from "./video-transport";

/** Provider 依赖显式注入，避免各协议重新创建客户端或重复解包响应。 */
export type VideoProviderDeps = {
    transport: VideoTransport;
    response: VideoResponseTools;
};
