export type LocalAgentSetupPlatform = "unix" | "windows";

const CANVAS_REPOSITORY_URL = "https://github.com/ddcat-ai/open-ai-canvas.git";

export function detectLocalAgentSetupPlatform(userAgent = defaultUserAgent()): LocalAgentSetupPlatform {
    return /windows/i.test(userAgent) ? "windows" : "unix";
}

export function buildLocalAgentSetupCommands(origin: string, platform: LocalAgentSetupPlatform) {
    const trustedOrigin = exactWebOrigin(origin);
    if (platform === "windows") {
        return {
            install: `git clone ${CANVAS_REPOSITORY_URL}\nSet-Location .\\open-ai-canvas\\canvas-agent\nnpm install\nnpm run build\nSet-Location ..\\..`,
            start: `Set-Location .\\open-ai-canvas\\canvas-agent\n$env:FRAMEFIELD_TRUSTED_WEB_ORIGINS=${powerShellArgument(trustedOrigin)}\nnode .\\dist\\index.js`,
        };
    }
    return {
        install: `git clone ${CANVAS_REPOSITORY_URL}\ncd open-ai-canvas/canvas-agent\nnpm install\nnpm run build\ncd ../..`,
        start: `cd open-ai-canvas/canvas-agent\nFRAMEFIELD_TRUSTED_WEB_ORIGINS=${shellArgument(trustedOrigin)} node dist/index.js`,
    };
}

function exactWebOrigin(value: string) {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.pathname !== "/" || url.search || url.hash || url.origin !== value) {
        throw new Error("Web origin is invalid");
    }
    return url.origin;
}

function defaultUserAgent() {
    if (typeof navigator === "undefined") return "";
    return `${navigator.platform} ${navigator.userAgent}`;
}

function powerShellArgument(value: string) {
    return `'${value.replace(/'/g, "''")}'`;
}

function shellArgument(value: string) {
    return `'${value.replace(/'/g, "'\\''")}'`;
}
