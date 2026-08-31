import type { StoryboardRow } from "@/types/canvas";
import { formatShotOrdinal } from "@/lib/shot-label";
import type { ProjectDetail, ShotRevisionInput } from "@/services/api/projects";
import { ensureShotAssetMentionPrompt } from "./workflow-shot-references";

export type ChapterStoryboardAsset = {
    id: string;
    title: string;
    type: "image" | "video" | "audio" | "character";
    category?: string;
    tags: string[];
    prompt: string;
    characterAssetId?: string;
    characterVersionId?: string;
};

export type ChapterStoryboardCharacter = {
    assetId?: string;
    versionId?: string;
    name: string;
    definition: Record<string, unknown>;
};

export type ProjectShotReplacementInput = {
    title: string;
    description: string;
    durationMs: number;
    revision: ShotRevisionInput;
    assetVersionIds: string[];
};

export type ChapterStoryboardReplaceImpact = {
    shotCount: number;
    revisionCount: number;
    referenceCount: number;
    artifactCount: number;
    candidateCount: number;
};

export function chapterStoryboardCharacters(detail: ProjectDetail, unitId?: string): ChapterStoryboardCharacter[] {
    const confirmed = detail.assets.flatMap((asset): ChapterStoryboardCharacter[] => {
        const card = asset.character;
        if (asset.category !== "character" || !card?.versionId) return [];
        return [{ assetId: asset.id, versionId: card.versionId, name: asset.title, definition: card.definition || {} }];
    });
    const seenNames = new Set(confirmed.map((character) => normalizeCharacterName(character.name)));
    const pending = detail.assetCandidates.flatMap((candidate): ChapterStoryboardCharacter[] => {
        if (candidate.category !== "character" || candidate.status !== "pending_confirmation") return [];
        if (unitId && candidate.unitId && candidate.unitId !== unitId) return [];
        const name = candidate.name.trim();
        const normalizedName = normalizeCharacterName(name);
        if (!normalizedName || seenNames.has(normalizedName)) return [];
        seenNames.add(normalizedName);
        return [{ name, definition: candidateDefinition(candidate.detailsJson) }];
    });
    return [...confirmed, ...pending];
}

export function chapterStoryboardAssets(detail: ProjectDetail): ChapterStoryboardAsset[] {
    return detail.assets.flatMap((asset): ChapterStoryboardAsset[] => {
        const type = storyboardAssetType(asset.mediaType, asset.category);
        if (!type || (type !== "character" && !asset.primaryVersionId)) return [];
        const characterVersionId = asset.character?.versionId;
        if (type === "character" && !characterVersionId) return [];
        return [{
            id: asset.id,
            title: asset.title,
            type,
            category: asset.category || undefined,
            tags: [],
            prompt: assetPrompt(asset.previewText, asset.character?.definition, asset.title),
            ...(type === "character" ? { characterAssetId: asset.id, characterVersionId } : {}),
        }];
    }).slice(0, 60);
}

export function storyboardRowsToProjectShots(rows: StoryboardRow[], detail?: ProjectDetail): ProjectShotReplacementInput[] {
    const versionByAssetId = new Map((detail?.assets || []).flatMap((asset) => asset.primaryVersionId ? [[asset.id, asset.primaryVersionId] as const] : []));
    const mentionReferenceByAssetId = new Map((detail?.assets || []).map((asset) => [asset.id, {
        assetId: asset.id,
        kind: asset.category === "character" ? "character" as const : "image" as const,
        label: asset.title,
        title: asset.title,
    }]));
    return rows.map((row, index) => {
        const shotNumber = index + 1;
        const description = row.plotDescription.trim() || `镜头 ${shotNumber}`;
        const durationMs = Math.max(1000, Math.round((Number(row.durationSeconds) || 1) * 1000));
        const mentionReferences = storyboardRowAssetIds(row).flatMap((assetId) => {
            const reference = mentionReferenceByAssetId.get(assetId);
            return reference ? [reference] : [];
        });
        return {
            title: formatShotOrdinal(index),
            description,
            durationMs,
            assetVersionIds: storyboardRowAssetVersionIds(row, versionByAssetId),
            revision: {
                plotDescription: description,
                action: joinStoryboardAction(row),
                dialogue: row.dialogue.trim(),
                shotSize: row.shotSize.trim(),
                cameraAngle: row.camera.trim(),
                cameraMovement: row.motion.trim(),
                durationMs,
                imagePrompt: row.imageGenerationPrompt.trim(),
                videoPrompt: ensureShotAssetMentionPrompt(row.videoMotionPrompt, mentionReferences),
                negativePrompt: row.negativePrompt.trim(),
                continuityNotes: row.continuityOut.trim(),
                actionBeats: row.timeBeats.trim() ? [{ description: row.timeBeats.trim() }] : [],
            },
        };
    });
}

export function chapterStoryboardReplaceImpact(detail: ProjectDetail, unitId: string): ChapterStoryboardReplaceImpact {
    const shots = detail.shots.filter((shot) => shot.unitId === unitId);
    const shotIds = new Set(shots.map((shot) => shot.id));
    return {
        shotCount: shots.length,
        revisionCount: detail.shotRevisions.filter((revision) => shotIds.has(revision.shotId)).length,
        referenceCount: detail.shotReferences.filter((reference) => shotIds.has(reference.shotId)).length,
        artifactCount: detail.shotArtifacts.filter((artifact) => artifact.unitId === unitId).length,
        candidateCount: detail.assetCandidates.filter((candidate) => Boolean(candidate.shotId && shotIds.has(candidate.shotId))).length,
    };
}

function storyboardRowAssetVersionIds(row: StoryboardRow, versionByAssetId: Map<string, string>) {
    return storyboardRowAssetIds(row).flatMap((assetId) => {
        const versionId = versionByAssetId.get(assetId);
        return versionId ? [versionId] : [];
    }).slice(0, 6);
}

function storyboardRowAssetIds(row: StoryboardRow) {
    return Array.from(new Set([
        ...row.assetBindings.map((binding) => binding.nodeId),
        ...row.characters.flatMap((character) => character.characterAssetId ? [character.characterAssetId] : []),
    ])).slice(0, 6);
}

function storyboardAssetType(mediaType: string, category: string): ChapterStoryboardAsset["type"] | null {
    if (category === "character") return "character";
    if (mediaType === "image" || mediaType === "video" || mediaType === "audio") return mediaType;
    return null;
}

function assetPrompt(previewText: string | undefined, definition: Record<string, unknown> | undefined, title: string) {
    const preview = previewText?.replace(/\s+/g, " ").trim();
    if (preview) return preview.slice(0, 600);
    if (definition && Object.keys(definition).length) return JSON.stringify(definition).slice(0, 600);
    return title.trim();
}

function candidateDefinition(value: string): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(value || "{}");
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
        return {};
    }
}

function normalizeCharacterName(value: string) {
    return value.trim().toLocaleLowerCase();
}

function joinStoryboardAction(row: StoryboardRow) {
    return [
        labeledText("叙事意图", row.narrativeIntent),
        labeledText("表演调度", row.performanceBlocking),
        labeledText("时间节拍", row.timeBeats),
        labeledText("情绪", row.emotion),
        labeledText("光线与氛围", row.lightingAndAtmosphere),
        labeledText("声音", row.audioEffects),
    ].filter(Boolean).join("\n");
}

function labeledText(label: string, value: string) {
    const text = value.trim();
    return text ? `${label}：${text}` : "";
}
