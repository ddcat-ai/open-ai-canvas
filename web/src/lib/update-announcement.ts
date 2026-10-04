export type UpdateBlock = {
    id: string;
    type: "text" | "image" | "video";
    text: string;
    resourceId: string;
    caption: string;
    layout: "full" | "half";
    mediaUrl?: string;
};
export type UpdateRelease = { id: string; version: string; title: string; date: string; blocks: UpdateBlock[] };
export type UpdateAnnouncement = { enabled: boolean; currentVersion: string; releases: UpdateRelease[] };
export const DEFAULT_UPDATE_ANNOUNCEMENT: UpdateAnnouncement = { enabled: false, currentVersion: "", releases: [] };

export function normalizeUpdateAnnouncement(value?: UpdateAnnouncement | null): UpdateAnnouncement {
    return { ...DEFAULT_UPDATE_ANNOUNCEMENT, ...value, releases: Array.isArray(value?.releases) ? value.releases : [] };
}

export function updateAnnouncementVersion(value: UpdateAnnouncement | undefined, builtInVersion: string) {
    return value?.enabled ? value.currentVersion : `v${builtInVersion.replace(/^v/, "")}`;
}

export function moveUpdateItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
    const destination = index + direction;
    if (index < 0 || index >= items.length || destination < 0 || destination >= items.length) return items;
    const result = [...items];
    [result[index], result[destination]] = [result[destination], result[index]];
    return result;
}

export function validateUpdateAnnouncement(value: UpdateAnnouncement): string | undefined {
    if (value.enabled && (!value.currentVersion.trim() || !value.releases.length)) return "开启自定义公告前请填写当前版本并添加公告内容";
    if (value.enabled && !value.releases.some((release) => release.version.trim() === value.currentVersion.trim())) return "当前版本须对应已添加的公告版本";
    if (value.releases.length > 30) return "最多添加 30 个公告版本";
    const versions = new Set<string>();
    let totalBytes = 0;
    for (const release of value.releases) {
        const version = release.version.trim();
        if (!version || Array.from(version).length > 40) return "每个公告版本号须为 1 至 40 个字符";
        if (versions.has(version)) return "公告版本号不能重复";
        versions.add(version);
        if (!release.blocks.length || release.blocks.length > 50) return "每个版本须添加 1 至 50 个内容块";
        for (const block of release.blocks) {
            if (block.type === "text" && !block.text.trim()) return "请填写文字内容，或删除空白内容块";
            if (block.type !== "text" && !block.resourceId) return "请上传图片或视频，或删除空白内容块";
            totalBytes += new TextEncoder().encode(block.text.trim() + block.caption.trim()).length;
        }
    }
    if (totalBytes > 200000) return "公告内容总大小不能超过 200KB";
}
