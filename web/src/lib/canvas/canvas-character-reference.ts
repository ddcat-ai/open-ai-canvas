import { resourceFileUrl } from "@/services/api/resources";
import type { ProjectAsset } from "@/services/api/projects";
import type { CanvasNodeData } from "@/types/canvas";

export type CharacterBreakdown = {
    name: string;
    aliases: string[];
    role: string;
    appearance: string;
    clothing: string;
    physique: string;
    personality: string;
    props: string;
    consistencyPrompt: string;
    multiViewPrompt: string;
    voiceLanguage: string;
    voiceAge: string;
    voiceTimbre: string;
};

export function refreshCanvasCharacterReferenceNodes(nodes: CanvasNodeData[], assets: ProjectAsset[]) {
    const characters = new Map(assets.filter((asset) => asset.category === "character" && asset.character).map((asset) => [asset.id, asset]));
    let changed = false;
    const next = nodes.map((node) => {
        const metadata = node.metadata;
        const assetId = metadata?.workflowKind === "character" ? metadata.characterAssetId : "";
        const asset = assetId ? characters.get(assetId) : undefined;
        if (!metadata || !asset?.character || metadata.characterVersionPolicy === "pinned") return node;
        const card = asset.character;
        const cover = card.representations.find((item) => item.role === "turnaround_sheet") || card.representations.find((item) => item.role === "primary") || card.representations.find((item) => item.role === "front");
        const aliases = Array.isArray(card.definition.aliases) ? card.definition.aliases.filter((value): value is string => typeof value === "string") : [];
        const patch = {
            characterVersionId: card.versionId,
            characterName: asset.title,
            characterPrompt: compileCharacterReferencePrompt(asset.title, card.definition),
            characterAliases: aliases,
            characterDefinition: card.definition,
            characterCoverUrl: cover ? resourceFileUrl(cover.resourceId) : undefined,
            characterVisualStatus: card.visualStatus,
            characterVoiceStatus: card.voiceStatus,
            characterVoiceName: card.voice?.profile.name,
            characterVoiceProfile: card.voice ? {
                name: card.voice.profile.name,
                provider: card.voice.profile.provider,
                language: card.voice.profile.language,
                timbre: card.voice.profile.timbre,
            } : undefined,
            characterVoiceInstructions: card.voice?.instructions,
        };
        if (node.title === asset.title
            && metadata.characterVersionId === patch.characterVersionId
            && metadata.characterPrompt === patch.characterPrompt
            && metadata.characterCoverUrl === patch.characterCoverUrl
            && metadata.characterVisualStatus === patch.characterVisualStatus
            && metadata.characterVoiceStatus === patch.characterVoiceStatus
            && metadata.characterVoiceName === patch.characterVoiceName
            && JSON.stringify(metadata.characterDefinition) === JSON.stringify(patch.characterDefinition)
            && JSON.stringify(metadata.characterVoiceProfile) === JSON.stringify(patch.characterVoiceProfile)
            && metadata.characterVoiceInstructions === patch.characterVoiceInstructions
            && (metadata.characterAliases || []).join("\u0000") === aliases.join("\u0000")) return node;
        changed = true;
        return { ...node, title: asset.title, metadata: { ...metadata, ...patch } };
    });
    return changed ? next : nodes;
}

export function compileCharacterReferencePrompt(name: string, definition: Record<string, unknown>) {
    const parts = [definition.role, definition.appearance, definition.physique, definition.clothing, definition.personality, definition.props, definition.consistencyPrompt]
        .map((value) => typeof value === "string" ? value.trim() : "")
        .filter(Boolean);
    return [`【角色卡：${name}】`, ...parts].join("\n");
}

export function normalizeCharacterName(value?: string) {
    return (value || "").toLocaleLowerCase("zh-CN").replace(/^角色[：:]\s*/, "").replace(/[\s·•・._-]+/g, "").trim();
}

export function parseCharacterBreakdown(raw: string): CharacterBreakdown[] {
    const unfenced = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const starts = [unfenced.indexOf("{"), unfenced.indexOf("[")].filter((index) => index >= 0);
    const start = starts.length ? Math.min(...starts) : -1;
    const end = Math.max(unfenced.lastIndexOf("}"), unfenced.lastIndexOf("]"));
    if (start < 0 || end < start) throw new Error("角色拆解没有返回可识别的 JSON");

    let parsed: unknown;
    try {
        parsed = JSON.parse(unfenced.slice(start, end + 1));
    } catch (error) {
        throw new Error(`角色拆解结果格式不正确：${error instanceof Error ? error.message : "无法解析 JSON"}`);
    }
    const candidates = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? (parsed as { characters?: unknown }).characters : undefined;
    if (!Array.isArray(candidates)) throw new Error("角色拆解结果缺少 characters 数组");

    const seen = new Set<string>();
    const characters: CharacterBreakdown[] = [];
    candidates.forEach((candidate) => {
        if (!candidate || typeof candidate !== "object") return;
        const value = candidate as Record<string, unknown>;
        const name = String(value.name || "").trim();
        const key = normalizeCharacterName(name);
        const aliases = Array.isArray(value.aliases) ? value.aliases.map((alias) => String(alias).trim()).filter(Boolean) : [];
        const identityKeys = [key, ...aliases.map(normalizeCharacterName)].filter(Boolean);
        if (!name || !key || identityKeys.some((identityKey) => seen.has(identityKey))) return;
        const role = String(value.role || "").trim();
        const descriptiveFields = [value.appearance, value.clothing, value.physique, value.personality, value.consistencyPrompt, value.multiViewPrompt]
            .map((field) => String(field || "").trim())
            .filter(Boolean);
        const voiceLanguage = String(value.voiceLanguage || "").trim();
        const voiceAge = String(value.voiceAge || "").trim();
        const voiceTimbre = String(value.voiceTimbre || "").trim();
        // AI 提取属于角色写入路径：只有名称不足以建立角色卡，避免空设定进入项目后再由用户猜测补全。
        if (!role || descriptiveFields.length < 3 || !voiceLanguage || !voiceAge || !voiceTimbre) throw new Error(`角色“${name}”缺少剧情定位、稳定设定或声音画像，请重新提取`);
        identityKeys.forEach((identityKey) => seen.add(identityKey));
        characters.push({
            name,
            aliases: Array.from(new Set(aliases.filter((alias) => normalizeCharacterName(alias) !== key))),
            role,
            appearance: String(value.appearance || "").trim(),
            clothing: String(value.clothing || "").trim(),
            physique: String(value.physique || "").trim(),
            personality: String(value.personality || "").trim(),
            props: String(value.props || "").trim(),
            consistencyPrompt: String(value.consistencyPrompt || "").trim(),
            multiViewPrompt: String(value.multiViewPrompt || "").trim(),
            voiceLanguage,
            voiceAge,
            voiceTimbre,
        });
    });
    if (!characters.length) throw new Error("没有从章节正文中识别到可用角色");
    return characters;
}
