export type WelcomeContributor = {
    name: string;
    avatar: string;
    signature: string;
    email?: string;
    wechat?: string;
    isFounder?: boolean;
};

function plainText(value: string) {
    return value
        .replace(/<br\s*\/?>/gi, " · ")
        .replace(/<[^>]+>/g, "")
        .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
        .replace(/\s+/g, " ")
        .trim();
}

function wechatFrom(details: string) {
    return details.match(/微信\s*[:：]\s*([^·]+)/)?.[1]?.trim();
}

function parsePipeContributor(line: string, resolveAvatar: (path: string) => string | undefined): WelcomeContributor[] {
    const columns = line
        .slice(1, line.lastIndexOf("|"))
        .split("|")
        .map((column) => column.trim());
    const image = columns[0]?.match(/src="([^"]+)"[^>]*alt="([^"]*)"/i);
    const nameColumn = columns[1] ?? "";
    const name = plainText(nameColumn.split(/<br\s*\/?>/i)[0] ?? image?.[2] ?? "");
    const avatarPath = image?.[1];
    if (!avatarPath || !name) return [];

    const avatar = resolveAvatar(avatarPath);
    if (!avatar) return [];

    const nameDetails = plainText(nameColumn);
    const email = plainText(columns[2] ?? "");

    return [
        {
            name,
            avatar,
            signature: plainText(columns[3] ?? ""),
            email: email || undefined,
            wechat: wechatFrom(nameDetails),
            isFounder: nameDetails.includes("项目发起者"),
        },
    ];
}

function parseHtmlContributor(cell: string, resolveAvatar: (path: string) => string | undefined): WelcomeContributor[] {
    const avatarPath = cell.match(/<img\s[^>]*\bsrc="([^"]+)"/i)?.[1];
    const alt = cell.match(/<img\s[^>]*\balt="([^"]*)"/i)?.[1] ?? "";
    const strong = cell.match(/<strong>([\s\S]*?)<\/strong>/i)?.[1] ?? "";
    const name = plainText(strong.split(/<br\s*\/?>/i)[0] ?? "") || plainText(alt);
    if (!avatarPath || !name) return [];

    const avatar = resolveAvatar(avatarPath);
    if (!avatar) return [];

    const nameDetails = plainText(strong) || name;
    const email = decodeURIComponent(cell.match(/mailto:([^"'>\s]+)/i)?.[1] ?? "") || plainText(cell.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "");

    return [
        {
            name,
            avatar,
            signature: plainText(cell.match(/<em>([\s\S]*?)<\/em>/i)?.[1] ?? ""),
            email: email || undefined,
            wechat: wechatFrom(nameDetails),
            isFounder: nameDetails.includes("项目发起者"),
        },
    ];
}

export function parseContributors(markdown: string, resolveAvatar: (path: string) => string | undefined): WelcomeContributor[] {
    const section = markdown.match(/## 贡献者与团队([\s\S]*?)(?=\n##\s|$)/)?.[1];
    if (!section) return [];

    const htmlCells = section.match(/<td\b[\s\S]*?<\/td>/gi) ?? [];
    if (htmlCells.length) {
        return htmlCells.flatMap((cell) => parseHtmlContributor(cell, resolveAvatar));
    }

    return section
        .split("\n")
        .filter((line) => /^\|\s*<img\s/i.test(line))
        .flatMap((line) => parsePipeContributor(line, resolveAvatar));
}
