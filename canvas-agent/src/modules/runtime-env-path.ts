import path from "node:path";

/**
 * Resolve env-configured filesystem paths without mangling Windows absolutes on POSIX hosts.
 * `path.resolve("C:\\foo")` on macOS/Linux incorrectly joins cwd, which breaks overrides and tests.
 */
export function resolveEnvPath(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return trimmed;
    if (/^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith("\\\\")) return trimmed;
    return path.resolve(trimmed);
}
