import { ApiError } from "@/services/api/request";
import { publishTeamAssets, type TeamAssetPublicationResult } from "@/services/api/teams";
import { getRemoteAsset } from "@/services/api/user-data";
import { assertCurrentUserSession, captureUserSession } from "@/lib/user-scope";

type PublicationSource = { sourceAssetId: string; error?: TeamAssetPublicationResult["error"] };

/** 固定每批已核对的源与请求标识，网络重试时不因同步状态变化而改变同一幂等请求。 */
export function createPersonalAssetPublication(teamId: string, assetIds: readonly string[], operationId: string) {
    const session = captureUserSession();
    const ids = [...new Set(assetIds)];
    const batches = new Map<number, { sources: PublicationSource[]; results?: TeamAssetPublicationResult[] }>();
    return async (): Promise<TeamAssetPublicationResult[]> => {
        const results: TeamAssetPublicationResult[] = [];
        for (let offset = 0; offset < ids.length; offset += 20) {
            assertCurrentUserSession(session);
            let batch = batches.get(offset);
            if (!batch) {
                const sources = await Promise.all(
                    ids.slice(offset, offset + 20).map(async (sourceAssetId): Promise<PublicationSource> => {
                        try {
                            const { asset } = await getRemoteAsset(sourceAssetId);
                            if (asset.status === "archived") return { sourceAssetId, error: { code: 409, msg: "素材已归档，请恢复后再共享" } };
                            if (!["text", "image", "video", "audio"].includes(asset.kind)) return { sourceAssetId, error: { code: 400, msg: "当前仅支持文本、图片、视频和音频素材" } };
                            return { sourceAssetId };
                        } catch (error) {
                            if (error instanceof ApiError && error.status === 404) return { sourceAssetId, error: { code: 404, msg: "素材尚未同步到服务器或已删除，请完成同步后重试", reason: "source_not_synced" } };
                            throw error;
                        }
                    }),
                );
                assertCurrentUserSession(session);
                batch = { sources };
                batches.set(offset, batch);
            }
            if (!batch.results) {
                const availableIds = batch.sources.filter((result) => !result.error).map((result) => result.sourceAssetId);
                const published = availableIds.length ? await publishTeamAssets(teamId, availableIds, `${operationId}:${offset / 20}`) : { results: [] };
                assertCurrentUserSession(session);
                batch.results = batch.sources.map((source) => {
                    if (source.error) return source;
                    const result = published.results.find((item) => item.sourceAssetId === source.sourceAssetId);
                    if (!result) throw new Error("团队发布响应缺少选中素材的结果，请使用同一请求重试");
                    return result;
                });
            }
            results.push(...batch.results);
        }
        return results;
    };
}
