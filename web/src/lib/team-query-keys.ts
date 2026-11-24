export const teamKeys = {
    all: (userId: string) => ["teams", userId] as const,
    list: (userId: string) => ["teams", userId, "list"] as const,
    credits: (userId: string) => ["teams", userId, "credits"] as const,
    invitations: (userId: string) => ["teams", userId, "invitations"] as const,
    space: (userId: string, teamId: string) => ["teams", userId, "space", teamId] as const,
};

export function teamIdFromPath(pathname: string): string | undefined {
    const match = /^\/teams\/([^/]+)(?:\/|$)/.exec(pathname);
    return match ? decodeURIComponent(match[1]) : undefined;
}

export function teamCredits(microcredits: number) {
    return (microcredits / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 6 });
}

export function parseTeamCreditAmount(value: string): number | undefined {
    if (!/^\d+(?:\.\d{1,6})?$/.test(value.trim())) return undefined;
    const [whole, fraction = ""] = value.trim().split(".");
    const result = Number(whole) * 1_000_000 + Number(fraction.padEnd(6, "0"));
    return Number.isSafeInteger(result) && result > 0 ? result : undefined;
}
