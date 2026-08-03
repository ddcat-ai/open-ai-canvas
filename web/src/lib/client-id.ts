import { nanoid } from "nanoid";

export function createClientId() {
    // randomUUID 在 HTTP 内网地址下不可用；nanoid 依赖仍可用的 getRandomValues。
    return nanoid();
}
