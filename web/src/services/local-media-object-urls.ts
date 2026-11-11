import { getActiveUserScope } from "@/lib/user-scope";

type LocalUrlEntry = { current: string; versions: Set<string> };
type MediaSession = { scope: string; generation: number };
const entries = new Map<string, LocalUrlEntry>();
let generation = 0;

export function localMediaSession(): MediaSession {
    return { scope: getActiveUserScope(), generation };
}

export function assertLocalMediaSession(session: MediaSession) {
    if (session.generation !== generation || session.scope !== getActiveUserScope()) throw new DOMException("媒体所属账号已切换", "AbortError");
}

export function peekLocalMediaObjectUrl(kind: "image" | "media", key: string) {
    return entries.get(`${getActiveUserScope()}:${kind}:${key}`)?.current || "";
}

export function storeLocalMediaObjectUrl(kind: "image" | "media", key: string, blob: Blob, session: MediaSession, options: { replace?: boolean; url?: string } = {}) {
    assertLocalMediaSession(session);
    const id = `${session.scope}:${kind}:${key}`;
    const previous = entries.get(id);
    if (previous && !options.replace) return previous.current;
    const url = options.url || URL.createObjectURL(blob);
    // 旧地址可能仍在节点快照、撤销栈或播放器中。保留所有权，待明确删除/会话退出统一回收。
    const versions = previous?.versions || new Set<string>();
    versions.add(url);
    entries.set(id, { current: url, versions });
    return url;
}

export function releaseLocalMediaObjectUrls(kind: "image" | "media", key: string) {
    const suffix = `:${kind}:${key}`;
    for (const [id, entry] of entries) {
        if (!id.endsWith(suffix)) continue;
        entry.versions.forEach((url) => URL.revokeObjectURL(url));
        entries.delete(id);
    }
}

/** 只回收会话地址，不删除 IndexedDB 中尚未上传的原件。 */
export function clearLocalMediaObjectUrls() {
    generation += 1;
    entries.forEach((entry) => entry.versions.forEach((url) => URL.revokeObjectURL(url)));
    entries.clear();
}

if (typeof window !== "undefined") {
    window.addEventListener("pagehide", (event) => {
        if (!event.persisted) clearLocalMediaObjectUrls();
    });
}
