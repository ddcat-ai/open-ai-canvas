import { resourceFileUrl } from "@/services/api/resources";
import type { CanvasNodeData } from "@/types/canvas";

const RESOURCE_FILE_PATTERN = /\/resources\/([^/?#]+)\/file/;

function extractResourceIdFromUrl(url?: string): string {
    const raw = url ? RESOURCE_FILE_PATTERN.exec(url)?.[1] : undefined;
    return raw ? decodeURIComponent(raw) : "";
}

export type CharacterOutfit = {
    id: string;
    name: string;
    resourceId: string;
    clothing?: string;
};

export function parseCharacterOutfits(definition?: Record<string, unknown>, representations?: Array<{ role: string; resourceId: string }>, fallbackResourceId?: string): CharacterOutfit[] {
    const raw = Array.isArray(definition?.outfits) ? definition.outfits : [];
    const parsed: CharacterOutfit[] = [];
    const seenIds = new Set<string>();
    raw.forEach((item, index) => {
        if (!item || typeof item !== "object") return;
        const record = item as Record<string, unknown>;
        const resourceId = typeof record.resourceId === "string" ? record.resourceId.trim() : "";
        if (!resourceId) return;
        const rawId = typeof record.id === "string" && record.id.trim() ? record.id.trim() : `outfit-${index + 1}`;
        if (seenIds.has(rawId)) return;
        seenIds.add(rawId);
        const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : `造型 ${parsed.length + 1}`;
        const clothing = typeof record.clothing === "string" && record.clothing.trim() ? record.clothing.trim() : undefined;
        parsed.push({ id: rawId, name, resourceId, ...(clothing ? { clothing } : {}) });
    });
    if (parsed.length) return parsed;
    const primaryId =
        (representations?.find((item) => item.role === "turnaround_sheet") || representations?.find((item) => item.role === "primary") || representations?.find((item) => item.role === "front"))?.resourceId?.trim() || fallbackResourceId?.trim() || "";
    if (!primaryId) return [];
    const defaultClothing = typeof definition?.clothing === "string" && definition.clothing.trim() ? definition.clothing.trim() : undefined;
    return [{ id: "default", name: "默认造型", resourceId: primaryId, ...(defaultClothing ? { clothing: defaultClothing } : {}) }];
}

export function resolveActiveCharacterOutfit(definition?: Record<string, unknown>, representations?: Array<{ role: string; resourceId: string }>, selectedOutfitId?: string, fallbackResourceId?: string): CharacterOutfit | undefined {
    const outfits = parseCharacterOutfits(definition, representations, fallbackResourceId);
    if (!outfits.length) return undefined;
    const preferredId = (typeof selectedOutfitId === "string" && selectedOutfitId.trim()) || (typeof definition?.activeOutfitId === "string" && definition.activeOutfitId.trim()) || "";
    return (preferredId ? outfits.find((item) => item.id === preferredId) : undefined) || outfits[0];
}

/**
 * 锁定画布节点自身当前使用的造型 ID：
 * 1. 若节点已有 selectedOutfitId 且仍在造型列表中，保持不变；
 * 2. 若旧节点尚未记录 selectedOutfitId，优先按该节点当前显示的封面图 resourceId 或旧 definition.activeOutfitId 反查并锁定，
 *    防止其他节点新增/切换造型时把旧节点一起带变。
 */
export function resolveLockedNodeOutfitId(
    previousSelectedOutfitId: string | undefined,
    previousCoverUrl: string | undefined,
    previousDefinition: Record<string, unknown> | undefined,
    nextDefinition: Record<string, unknown> | undefined,
    representations?: Array<{ role: string; resourceId: string }>,
): string | undefined {
    const outfits = parseCharacterOutfits(nextDefinition, representations, extractResourceIdFromUrl(previousCoverUrl));
    if (!outfits.length) return undefined;
    if (previousSelectedOutfitId && outfits.some((item) => item.id === previousSelectedOutfitId)) {
        return previousSelectedOutfitId;
    }
    const prevCoverResourceId = extractResourceIdFromUrl(previousCoverUrl);
    if (prevCoverResourceId) {
        const matchedByCover = outfits.find((item) => item.resourceId === prevCoverResourceId);
        if (matchedByCover) return matchedByCover.id;
    }
    const prevActiveId = typeof previousDefinition?.activeOutfitId === "string" ? previousDefinition.activeOutfitId.trim() : "";
    if (prevActiveId && outfits.some((item) => item.id === prevActiveId)) {
        return prevActiveId;
    }
    return resolveActiveCharacterOutfit(nextDefinition, representations)?.id;
}

export function applyCharacterOutfitDefinition(definition: Record<string, unknown>, selectedOutfitId?: string, representations?: Array<{ role: string; resourceId: string }>): Record<string, unknown> {
    const outfit = resolveActiveCharacterOutfit(definition, representations, selectedOutfitId);
    if (!outfit?.clothing?.trim()) return definition;
    return { ...definition, clothing: outfit.clothing.trim() };
}

export function buildCharacterOutfitPersistence(
    definition: Record<string, unknown>,
    outfits: CharacterOutfit[],
    activeOutfitId?: string,
): {
    definition: Record<string, unknown>;
    representations: Array<{ role: string; resourceId: string; metadata?: Record<string, unknown> }>;
    activeOutfit: CharacterOutfit;
} {
    const normalized = outfits.filter((item) => item.resourceId.trim());
    const active = (activeOutfitId ? normalized.find((item) => item.id === activeOutfitId) : undefined) || normalized[0];
    const nextDefinition: Record<string, unknown> = {
        ...definition,
        outfits: normalized.map((item) => ({
            id: item.id,
            name: item.name.trim() || "默认造型",
            resourceId: item.resourceId.trim(),
            ...(item.clothing?.trim() ? { clothing: item.clothing.trim() } : {}),
        })),
        activeOutfitId: active?.id || "",
    };
    if (active?.clothing?.trim()) {
        nextDefinition.clothing = active.clothing.trim();
    }
    const representations: Array<{ role: string; resourceId: string; metadata?: Record<string, unknown> }> = active
        ? [
              { role: "turnaround_sheet", resourceId: active.resourceId, metadata: { outfitId: active.id, outfitName: active.name } },
              { role: "primary", resourceId: active.resourceId, metadata: { outfitId: active.id, outfitName: active.name } },
          ]
        : [];
    normalized.forEach((item, index) => {
        const safeRole = `outfit:${item.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || index + 1}`;
        if (!representations.some((entry) => entry.role === safeRole)) {
            representations.push({
                role: safeRole,
                resourceId: item.resourceId,
                metadata: { outfitId: item.id, outfitName: item.name },
            });
        }
    });
    return { definition: nextDefinition, representations, activeOutfit: active };
}

export function characterOutfitCoverUrl(definition?: Record<string, unknown>, representations?: Array<{ role: string; resourceId: string }>, selectedOutfitId?: string, fallbackCoverUrl?: string): string | undefined {
    const outfit = resolveActiveCharacterOutfit(definition, representations, selectedOutfitId);
    return outfit?.resourceId ? resourceFileUrl(outfit.resourceId) : fallbackCoverUrl;
}

export function applySelectedOutfitToCanvasNode(node: CanvasNodeData, outfit: CharacterOutfit): CanvasNodeData {
    if (!node.metadata) return node;
    const def = node.metadata.characterDefinition || {};
    const nextDef: Record<string, unknown> = {
        ...def,
        activeOutfitId: outfit.id,
        ...(outfit.clothing ? { clothing: outfit.clothing } : {}),
    };
    const parts = [nextDef.role, nextDef.appearance, nextDef.physique, nextDef.clothing, nextDef.personality, nextDef.props, nextDef.consistencyPrompt].map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean);
    const name = node.metadata.characterName || node.title;
    return {
        ...node,
        metadata: {
            ...node.metadata,
            selectedOutfitId: outfit.id,
            characterCoverUrl: resourceFileUrl(outfit.resourceId),
            characterPrompt: [`【角色卡：${name}】`, ...parts].join("\n"),
        },
    };
}
