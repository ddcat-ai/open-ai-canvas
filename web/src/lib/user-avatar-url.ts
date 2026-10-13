// Profile responses use a canonical /api path; deployment routing belongs to
// the configured API base, including its origin and reverse-proxy prefix.
export function resolveUserAvatarURL(candidate: string | undefined, apiBaseURL: string): string {
    if (!candidate) return "";
    if (/^https?:\/\//i.test(candidate)) return candidate;
    if (!/^\/api\/auth\/profile\/avatar\/[a-zA-Z0-9_-]+\?v=[a-zA-Z0-9_-]+$/.test(candidate)) return "";
    return `${apiBaseURL.replace(/\/+$/, "")}${candidate.slice("/api".length)}`;
}
