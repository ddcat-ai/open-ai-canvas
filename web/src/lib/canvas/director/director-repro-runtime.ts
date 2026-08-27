/**
 * 复现场景的环境快照投影。
 *
 * 只在本地开发复现页面展示，绝不自动发网：本模块不引用任何 API 客户端。
 * 所有字符串都限长并剥掉 URL 的 query/hash 与凭证形态片段；
 * WebGL 不可用时必须稳定降级为 { available: false }，不能抛错。
 */

export type DirectorReproRuntime = {
    appVersion: string;
    buildCommit: string;
    browser: string;
    os: string;
    timezone: string;
    devicePixelRatio: number;
};

export type DirectorReproWebgl =
    | { available: false; reason: "unsupported" | "context-failed" }
    | {
          available: true;
          version: string;
          vendor: string;
          renderer: string;
          maxTextureSize: number;
          maxRenderbufferSize: number;
          maxViewportWidth: number;
          maxViewportHeight: number;
      };

export type DirectorReproSnapshot = {
    runtime: DirectorReproRuntime;
    webgl: DirectorReproWebgl;
};

const MAX_TEXT = 160;

/**
 * 安全文本：遮蔽凭证、整段替换 URL、压缩空白并限长。
 * WebGL 的 UNMASKED_RENDERER 在部分驱动上会带较长标识甚至驱动地址，必须统一收敛。
 *
 * 顺序有意义：先吃掉 `bearer <token>`（token 与关键字之间只有空白，没有 :=），
 * 否则后面的 key[:=]value 规则只会遮住 "bearer" 本身而把 token 留在原地。
 * URL 一律替换为固定 [URL]：域名与路径本身就可能是凭证载体或内网拓扑信息，
 * 只剥 query/hash 不够。
 */
export function safeReproText(value: unknown, maxLength = MAX_TEXT): string {
    if (typeof value !== "string") return "";
    let text = value.trim();
    if (!text) return "";

    text = text.replace(/\bbearer\s+[^\s,;]+/gi, "Bearer [REDACTED]");
    text = text.replace(/(authorization|cookie|set-cookie|api[_-]?key|secret[_-]?key|password|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");
    text = text.replace(/https?:\/\/\S+/gi, "[URL]");
    // 裸 query/hash 片段（不带协议）同样不得保留。
    text = text.replace(/[?#]\S*/g, "");
    text = text.replace(/\s+/g, " ").trim();
    return text.slice(0, maxLength);
}

function boundedNumber(value: unknown, min: number, max: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
}

function boundedInteger(value: unknown, min: number, max: number): number {
    return Math.round(boundedNumber(value, min, max));
}

export function readDirectorReproRuntime(): DirectorReproRuntime {
    const nav = typeof navigator === "undefined" ? null : navigator;
    let timezone = "";
    try {
        timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch {
        timezone = "";
    }

    return {
        appVersion: safeReproText(import.meta.env.VITE_APP_VERSION || "dev", 48),
        buildCommit: safeReproText(import.meta.env.VITE_BUILD_COMMIT || "unknown", 48),
        browser: safeReproText(nav?.userAgent),
        os: safeReproText(nav?.platform, 48),
        timezone: safeReproText(timezone, 64),
        devicePixelRatio: boundedNumber(typeof window === "undefined" ? 1 : window.devicePixelRatio, 0.1, 8),
    };
}

type GlLike = {
    getParameter: (name: number) => unknown;
    getExtension: (name: string) => unknown;
    VERSION: number;
    VENDOR: number;
    RENDERER: number;
    MAX_TEXTURE_SIZE: number;
    MAX_RENDERBUFFER_SIZE: number;
    MAX_VIEWPORT_DIMS: number;
};

/**
 * 从已有上下文投影安全 WebGL 信息。注入 gl 便于测试降级分支。
 * 任何 getParameter/getExtension 抛错都收敛为 context-failed，不外泄异常。
 */
export function projectDirectorWebgl(gl: unknown): DirectorReproWebgl {
    if (!gl || typeof gl !== "object") return { available: false, reason: "unsupported" };
    const context = gl as GlLike;
    if (typeof context.getParameter !== "function") return { available: false, reason: "unsupported" };

    try {
        // UNMASKED_* 需要扩展；拿不到就退回未遮蔽的 VENDOR/RENDERER，两者都可能为空。
        let vendor = context.getParameter(context.VENDOR);
        let renderer = context.getParameter(context.RENDERER);
        try {
            const debugInfo = typeof context.getExtension === "function" ? context.getExtension("WEBGL_debug_renderer_info") : null;
            if (debugInfo && typeof debugInfo === "object") {
                const info = debugInfo as { UNMASKED_VENDOR_WEBGL?: number; UNMASKED_RENDERER_WEBGL?: number };
                if (typeof info.UNMASKED_VENDOR_WEBGL === "number") vendor = context.getParameter(info.UNMASKED_VENDOR_WEBGL) ?? vendor;
                if (typeof info.UNMASKED_RENDERER_WEBGL === "number") renderer = context.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? renderer;
            }
        } catch {
            // 扩展不可用时保留未遮蔽值，不视为失败。
        }

        const viewportDims = context.getParameter(context.MAX_VIEWPORT_DIMS);
        const dims = Array.isArray(viewportDims) || viewportDims instanceof Int32Array ? Array.from(viewportDims as ArrayLike<number>) : [];

        return {
            available: true,
            version: safeReproText(context.getParameter(context.VERSION), 96),
            vendor: safeReproText(vendor, 96),
            renderer: safeReproText(renderer, 96),
            maxTextureSize: boundedInteger(context.getParameter(context.MAX_TEXTURE_SIZE), 0, 1_048_576),
            maxRenderbufferSize: boundedInteger(context.getParameter(context.MAX_RENDERBUFFER_SIZE), 0, 1_048_576),
            maxViewportWidth: boundedInteger(dims[0], 0, 1_048_576),
            maxViewportHeight: boundedInteger(dims[1], 0, 1_048_576),
        };
    } catch {
        return { available: false, reason: "context-failed" };
    }
}

/**
 * 现场探测：创建一次性上下文读取能力，失败稳定降级。
 * 读取完成后 best-effort 归还上下文：浏览器的 WebGL 上下文数量有限，
 * 一次性 canvas 不释放会挤占真实视口的额度。
 * 释放发生在快照取好之后，且异常一律吞掉，绝不影响已读到的结果。
 */
export function probeDirectorWebgl(): DirectorReproWebgl {
    if (typeof document === "undefined") return { available: false, reason: "unsupported" };
    try {
        const canvas = document.createElement("canvas");
        const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
        if (!gl) return { available: false, reason: "unsupported" };
        const snapshot = projectDirectorWebgl(gl);
        releaseProbeContext(gl);
        return snapshot;
    } catch {
        return { available: false, reason: "context-failed" };
    }
}

/** 归还探测用上下文；扩展不可用或调用抛错都视为无操作。导出以便测试释放路径。 */
export function releaseProbeContext(gl: unknown): void {
    try {
        const context = gl as { getExtension?: (name: string) => unknown };
        if (typeof context.getExtension !== "function") return;
        const loseContext = context.getExtension("WEBGL_lose_context");
        if (!loseContext || typeof loseContext !== "object") return;
        const losable = loseContext as { loseContext?: () => void };
        if (typeof losable.loseContext === "function") losable.loseContext();
    } catch {
        // 释放失败不影响已取到的 snapshot。
    }
}

export function readDirectorReproSnapshot(): DirectorReproSnapshot {
    return { runtime: readDirectorReproRuntime(), webgl: probeDirectorWebgl() };
}
