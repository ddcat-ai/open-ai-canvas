const WINDOWS_ENVIRONMENT_KEYS = new Map([
    "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP",
    "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA",
    "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432",
    "LANG", "LC_ALL", "LC_CTYPE", "TERM", "DISPLAY", "WAYLAND_DISPLAY",
    "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
].map((key) => [key, key]));

const POSIX_ENVIRONMENT_KEYS = new Set([
    "PATH", "HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "TMPDIR",
    "LANG", "LC_ALL", "LC_CTYPE", "TERM", "DISPLAY", "WAYLAND_DISPLAY",
    "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
]);

export type CliChildEnvironmentErrorReason = "conflict" | "proxy" | "no_proxy";

export class CliChildEnvironmentError extends Error {
    readonly code = "cli_environment_invalid";

    constructor(readonly reason: CliChildEnvironmentErrorReason) {
        super("CLI child environment is invalid");
        this.name = "CliChildEnvironmentError";
    }
}

// Only pass OS session and explicitly validated proxy settings to local CLI children.
export function buildCliChildEnvironment(source: Record<string, string | undefined>) {
    const result: Record<string, string> = {};
    const seen = new Map<string, string>();
    for (const [rawKey, value] of Object.entries(source)) {
        if (value === undefined) continue;
        const key = process.platform === "win32" ? rawKey.toUpperCase() : rawKey;
        const allowed = process.platform === "win32"
            ? WINDOWS_ENVIRONMENT_KEYS.get(key)
            : POSIX_ENVIRONMENT_KEYS.has(key) ? key : undefined;
        if (!allowed) continue;
        const previous = seen.get(key);
        if (previous !== undefined && previous !== value) {
            throw new CliChildEnvironmentError("conflict");
        }
        validateProxyValue(allowed, value);
        seen.set(key, value);
        result[allowed] = value;
    }
    return result;
}

function validateProxyValue(key: string, value: string) {
    if (key === "HTTP_PROXY" || key === "HTTPS_PROXY") {
        try {
            const url = new URL(value);
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
        } catch {
            throw new CliChildEnvironmentError("proxy");
        }
    }
    if (key === "NO_PROXY" && value) {
        const entries = value.split(",").map((entry) => entry.trim());
        if (entries.some((entry) => !entry
            || !/^(?:\.?[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\[[0-9A-Fa-f:]+\]|[0-9A-Fa-f:.]+)(?::\d{1,5})?$/.test(entry))) {
            throw new CliChildEnvironmentError("no_proxy");
        }
    }
}
