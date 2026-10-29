import type { DramaTakeKind } from "@/services/api/drama";

/** 短剧查询键：制作台与精修画布共用，任一侧写入后失效同一份缓存。 */
export const dramaKeys = {
    summary: (projectId: string) => ["drama", projectId] as const,
    episode: (projectId: string, episodeId: string) => ["drama", projectId, "episode", episodeId] as const,
    cast: (projectId: string) => ["drama", projectId, "cast"] as const,
    castImpact: (projectId: string, castId: string) => ["drama", projectId, "cast-impact", castId] as const,
    jobs: (projectId: string) => ["drama", projectId, "jobs"] as const,
    takes: (projectId: string, kind: DramaTakeKind, ownerId: string) => ["drama", projectId, "takes", kind, ownerId] as const,
    canvas: (projectId: string) => ["drama", projectId, "canvas"] as const,
};
