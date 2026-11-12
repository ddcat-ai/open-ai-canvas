import { fetchOfficialAssetReference } from "@/services/api/official-assets";
import type { ProjectCharacterDetail } from "@/services/api/projects";

/** Adapt the shared official snapshot to the existing character generation contract. */
export async function loadOfficialCharacterForGeneration(id: string): Promise<ProjectCharacterDetail> {
    const reference = await fetchOfficialAssetReference(id);
    const character = reference.character;
    if (reference.mediaType !== "entity" || !character?.versionId || !character.definition) {
        throw new Error("官方角色资料不完整，请联系管理员检查后再试");
    }
    const representations = (character.representations?.length ? character.representations : (character.images || []).map((image) => ({ ...image, id: undefined, mediaType: undefined })))
        .filter((item) => item.resourceId)
        .map((item, index) => ({ id: item.id || `official-image-${index}`, resourceId: item.resourceId!, role: item.role || "primary", mediaType: item.mediaType || "image/png" }));
    const profile = character.voice?.profile;
    return {
        asset: { id, title: reference.title, category: "character", mediaType: "entity", status: "ready", versionCount: 1, usages: [], position: 0, updatedAt: "" },
        character: {
            versionId: character.versionId,
            version: character.version || 1,
            definition: character.definition,
            representations,
            visualStatus: character.visualStatus || "missing",
            voiceStatus: character.voiceStatus || "missing",
            voice: profile ? { profile: { id: "", name: profile.name || "", provider: profile.provider || "", voiceKey: "", language: profile.language || "", timbre: profile.timbre || "", sampleResourceId: profile.sampleResourceId, compatibleModels: [], status: "ready" }, instructions: character.voice?.instructions || "" } : undefined,
        },
    };
}
