import readmeMarkdown from "../../../../README.md?raw";

const contributorAvatarModules = import.meta.glob("../../../../assets/user-*", {
    eager: true,
    import: "default",
    query: "?url",
}) as Record<string, string>;

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

function parseContributors(markdown: string): WelcomeContributor[] {
    const section = markdown.match(/## 贡献者与团队([\s\S]*?)(?=\n##\s)/)?.[1];
    if (!section) return [];

    return section
        .split("\n")
        .filter((line) => /^\|\s*<img\s/i.test(line))
        .flatMap((line) => {
            const columns = line
                .slice(1, line.lastIndexOf("|"))
                .split("|")
                .map((column) => column.trim());
            const image = columns[0]?.match(/src="([^"]+)"[^>]*alt="([^"]*)"/i);
            const nameColumn = columns[1] ?? "";
            const name = plainText(nameColumn.split(/<br\s*\/?>/i)[0] ?? image?.[2] ?? "");
            const avatarPath = image?.[1];
            if (!avatarPath || !name) return [];

            const avatar = contributorAvatarModules[`../../../../${avatarPath}`];
            if (!avatar) return [];

            const nameDetails = plainText(nameColumn);
            const email = plainText(columns[2] ?? "");
            const wechat = nameDetails.match(/微信\s*[:：]\s*([^·]+)/)?.[1]?.trim();

            return [
                {
                    name,
                    avatar,
                    signature: plainText(columns[3] ?? ""),
                    email: email || undefined,
                    wechat,
                    isFounder: nameDetails.includes("项目发起者"),
                },
            ];
        });
}

export const welcomeContributors = parseContributors(readmeMarkdown);
