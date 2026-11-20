export type ReferenceMediaTransportMode = "inherit" | "protocol" | "url" | "base64";
export type ReferenceMediaTransport = Partial<Record<"image" | "audio" | "video", ReferenceMediaTransportMode>>;

export function mediaTransportLabel(value?: ReferenceMediaTransportMode) {
    return value === "url" ? "URL" : value === "base64" ? "Base64" : "协议默认";
}
