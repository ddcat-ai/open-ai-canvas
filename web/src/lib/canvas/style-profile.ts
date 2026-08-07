export type StyleAssetKind = "lora" | "template" | "reference" | "prompt";
export type StyleAssetStatus = "draft" | "validated" | "unavailable";

export type StyleAssetBinding = {
    id: string;
    kind: StyleAssetKind;
    provider: string;
    title: string;
    enabled?: boolean;
    sourceId?: string;
    sourceUrl?: string;
    model?: string;
    version?: string;
    baseModels?: string[];
    triggerWords?: string[];
    promptFragment?: string;
    weight?: number;
    parameters?: {
        sampler?: string;
        steps?: number;
        cfg?: number;
        size?: string;
    };
    referenceUrls?: string[];
    referenceResourceIds?: string[];
    status: StyleAssetStatus;
    license?: {
        commercial?: boolean;
        note?: string;
        source?: string;
        capturedAt?: string;
    };
};

export type StyleProfileSnapshot = {
    schemaVersion: 1;
    presetId: string;
    title: string;
    description: string;
    tags: string[];
    prompt: string;
    negativePrompt?: string;
    coverUrl?: string;
    sourceProfileId?: string;
    selection?: Record<string, string>;
    assets: StyleAssetBinding[];
    executionPolicy?: "compatible-fallback" | "strict-assets";
    source: "builtin" | "user" | "external";
    revision: number;
};

export type StyleProfileSource = Pick<StyleProfileSnapshot, "title" | "description" | "tags" | "prompt"> & {
    // 内置画风使用 id，持久化配置使用 presetId，两种来源在此统一归一化。
    presetId?: string;
    id?: string;
    negativePrompt?: string;
    coverUrl?: string;
    sourceProfileId?: string;
    selection?: Record<string, string>;
    assets?: StyleAssetBinding[];
    executionPolicy?: StyleProfileSnapshot["executionPolicy"];
    source?: StyleProfileSnapshot["source"];
    revision?: number;
};

const MAX_PROFILE_BYTES = 256 * 1024;
export const MAX_STYLE_ASSETS = 20;

export type StyleExecutionContext = {
    mode: "image" | "video";
    model: string;
    interfaceType?: string;
};

export type StyleExecutionAsset = {
    assetId: string;
    title: string;
    kind: StyleAssetKind;
    action: "prompt" | "native" | "reference" | "skip" | "block";
    reason: string;
};

export type StyleExecutionPlan = {
    schemaVersion: 1;
    profilePresetId: string;
    profileRevision: number;
    mode: StyleExecutionContext["mode"];
    model: string;
    interfaceType?: string;
    status: "ready" | "degraded" | "blocked";
    prompt: string;
    assets: StyleExecutionAsset[];
    warnings: string[];
};

export function createStyleProfileSnapshot(source: StyleProfileSource): StyleProfileSnapshot {
    return {
        schemaVersion: 1,
        presetId: (source.presetId || source.id || "").trim(),
        title: source.title.trim(),
        description: source.description.trim(),
        tags: source.tags.map((tag) => tag.trim()).filter(Boolean),
        prompt: source.prompt.trim(),
        negativePrompt: source.negativePrompt?.trim() || undefined,
        coverUrl: source.coverUrl?.trim() || undefined,
        sourceProfileId: source.sourceProfileId?.trim() || undefined,
        selection: source.selection ? { ...source.selection } : undefined,
        assets: source.assets
            ? source.assets.map((asset) => ({
                  ...asset,
                  parameters: asset.parameters ? { ...asset.parameters } : undefined,
                  license: asset.license ? { ...asset.license } : undefined,
                  baseModels: asset.baseModels ? [...asset.baseModels] : undefined,
                  triggerWords: asset.triggerWords ? [...asset.triggerWords] : undefined,
                  referenceUrls: asset.referenceUrls ? [...asset.referenceUrls] : undefined,
                  referenceResourceIds: asset.referenceResourceIds ? [...asset.referenceResourceIds] : undefined,
              }))
            : [],
        executionPolicy: source.executionPolicy || "compatible-fallback",
        source: source.source || "builtin",
        revision: source.revision || 1,
    };
}

export function serializeStyleProfile(profile: StyleProfileSnapshot): string {
    const normalized = createStyleProfileSnapshot(profile);
    const validationMessage = styleProfileValidationMessage(normalized);
    if (validationMessage) throw new Error(validationMessage);
    const serialized = JSON.stringify(normalized);
    if (new TextEncoder().encode(serialized).length > MAX_PROFILE_BYTES) throw new Error("项目画风资产配置过大");
    return serialized;
}

export function parseStyleProfile(value?: string | null): StyleProfileSnapshot | null {
    const raw = String(value || "").trim();
    if (!raw || new TextEncoder().encode(raw).length > MAX_PROFILE_BYTES) return null;
    try {
        const parsed = JSON.parse(raw) as Partial<StyleProfileSnapshot>;
        if (
            parsed.schemaVersion !== 1 ||
            typeof parsed.presetId !== "string" ||
            typeof parsed.title !== "string" ||
            typeof parsed.description !== "string" ||
            typeof parsed.prompt !== "string" ||
            !Array.isArray(parsed.tags) ||
            !Array.isArray(parsed.assets)
        )
            return null;
        if (!parsed.tags.every((tag) => typeof tag === "string")) return null;
        if ([parsed.negativePrompt, parsed.coverUrl, parsed.sourceProfileId].some((value) => value !== undefined && typeof value !== "string")) return null;
        if (parsed.selection !== undefined && (!parsed.selection || typeof parsed.selection !== "object" || Array.isArray(parsed.selection) || !Object.values(parsed.selection).every((value) => typeof value === "string"))) return null;
        if (!parsed.assets.every(isStyleAssetBinding)) return null;
        if (parsed.source !== "builtin" && parsed.source !== "user" && parsed.source !== "external") return null;
        if (parsed.executionPolicy !== undefined && parsed.executionPolicy !== "compatible-fallback" && parsed.executionPolicy !== "strict-assets") return null;
        if (!Number.isInteger(parsed.revision) || Number(parsed.revision) < 1) return null;
        const profile = createStyleProfileSnapshot(parsed as StyleProfileSource);
        return styleProfileValidationMessage(profile) ? null : profile;
    } catch {
        return null;
    }
}

export function resolveStyleProfile(presetId: string | undefined, profileJson?: string | null, fallback?: StyleProfileSource): StyleProfileSnapshot | null {
    return parseStyleProfile(profileJson) || (fallback ? createStyleProfileSnapshot({ ...fallback, presetId: fallback.presetId || String(presetId || "") }) : null);
}

export function resolveStyleExecutionPlan(profile: StyleProfileSnapshot, context: StyleExecutionContext): StyleExecutionPlan {
    const assets = profile.assets.filter((asset) => asset.enabled !== false).map((asset) => resolveAssetExecution(asset, context));
    const blockedAssets = assets.filter((asset) => asset.action === "block");
    const skippedAssets = assets.filter((asset) => asset.action === "skip");
    const promptAssetIds = new Set(assets.filter((asset) => asset.action === "prompt").map((asset) => asset.assetId));
    const promptFragments = profile.assets
        .filter((asset) => promptAssetIds.has(asset.id))
        .flatMap((asset) => [asset.promptFragment, ...(asset.triggerWords || [])])
        .map((value) => String(value || "").trim())
        .filter(Boolean);
    const strictBlocked = profile.executionPolicy === "strict-assets" && (blockedAssets.length > 0 || skippedAssets.length > 0);
    const warnings = [...blockedAssets, ...skippedAssets].map((asset) => `${asset.title}：${asset.reason}`);
    return {
        schemaVersion: 1,
        profilePresetId: profile.presetId,
        profileRevision: profile.revision,
        mode: context.mode,
        model: context.model,
        interfaceType: context.interfaceType,
        status: strictBlocked ? "blocked" : warnings.length ? "degraded" : "ready",
        prompt: [profile.prompt, profile.negativePrompt ? `【全局负面 Prompt】\n${profile.negativePrompt}` : "", ...promptFragments].filter(Boolean).join("\n"),
        assets,
        warnings,
    };
}

export function applyStyleExecutionPlan(prompt: string, plan: StyleExecutionPlan) {
    const content = prompt.trim();
    const stylePrompt = plan.prompt.trim();
    if (!stylePrompt || content.includes(stylePrompt)) return content;
    return [content, "【项目画风执行规范】", stylePrompt].filter(Boolean).join("\n\n");
}

export function styleAssetValidationMessage(asset: StyleAssetBinding) {
    if (!asset.id.trim()) return "资产 ID 不能为空";
    if (!asset.title.trim()) return "请填写资产名称";
    if (!asset.provider.trim()) return "请填写来源平台或适配器";
    if (asset.weight !== undefined && (!Number.isFinite(asset.weight) || asset.weight < 0 || asset.weight > 2)) return "LoRA 权重必须在 0 到 2 之间";
    if ((asset.baseModels?.length || 0) > 20) return "单个资产最多声明 20 个兼容模型";
    if ((asset.triggerWords?.length || 0) > 50) return "单个资产最多声明 50 个触发词";
    if ((asset.referenceUrls?.length || 0) > 20 || (asset.referenceResourceIds?.length || 0) > 20) return "单个参考图组最多绑定 20 个 URL 和 20 个资源";
    if (asset.parameters?.steps !== undefined && (!Number.isInteger(asset.parameters.steps) || asset.parameters.steps < 1 || asset.parameters.steps > 200)) return "Steps 必须在 1 到 200 之间";
    if (asset.parameters?.cfg !== undefined && (!Number.isFinite(asset.parameters.cfg) || asset.parameters.cfg < 0 || asset.parameters.cfg > 50)) return "CFG 必须在 0 到 50 之间";
    if (asset.status !== "validated") return "";
    if (asset.kind === "lora" && !asset.sourceId?.trim() && !asset.sourceUrl?.trim()) return "已验证的 LoRA 必须填写来源资产 ID 或 URL";
    if ((asset.kind === "prompt" || asset.kind === "template") && !asset.promptFragment?.trim() && !asset.triggerWords?.some((word) => word.trim())) return "已验证的模板或提示词模块必须填写提示词内容";
    if (asset.kind === "reference" && !asset.referenceUrls?.some((url) => url.trim()) && !asset.referenceResourceIds?.some((id) => id.trim())) return "已验证的参考图组必须绑定参考图";
    return "";
}

export function styleProfileValidationMessage(profile: StyleProfileSnapshot) {
    if (!profile.presetId.trim() || profile.revision < 1) return "项目画风快照缺少必要字段";
    if (!profile.title.trim()) return "请填写风格名称";
    if (!profile.prompt.trim()) return "请填写完整风格 Prompt";
    if (profile.title.length > 80) return "风格名称最多 80 个字";
    if (profile.description.length > 500) return "风格简介最多 500 个字";
    if (profile.tags.length > 20) return "风格标签最多 20 个";
    if (profile.selection && Object.keys(profile.selection).length > 20) return "项目画风辅助标注最多 20 项";
    if (profile.selection && Object.entries(profile.selection).some(([key, value]) => !key.trim() || key.length > 64 || value.length > 200)) return "项目画风辅助标注格式无效";
    if ((profile.coverUrl?.length || 0) > 4096) return "风格封面地址过长";
    if (profile.coverUrl && !isStyleCoverUrl(profile.coverUrl)) return "风格封面只支持 http(s)、站内路径或图片 Data URL";
    if ((profile.negativePrompt?.length || 0) > 64 * 1024) return "负面 Prompt 过大";
    if (profile.assets.length > MAX_STYLE_ASSETS) return `项目画风最多绑定 ${MAX_STYLE_ASSETS} 个执行资产`;
    const ids = new Set<string>();
    for (const asset of profile.assets) {
        const assetMessage = styleAssetValidationMessage(asset);
        if (assetMessage) return `${asset.title || "未命名资产"}：${assetMessage}`;
        if (ids.has(asset.id)) return "项目画风执行资产 ID 不能重复";
        ids.add(asset.id);
    }
    return "";
}

function isStyleCoverUrl(value: string) {
    const normalized = value.trim().toLowerCase();
    return normalized.startsWith("http://") || normalized.startsWith("https://") || normalized.startsWith("/") || normalized.startsWith("data:image/");
}

function resolveAssetExecution(asset: StyleAssetBinding, context: StyleExecutionContext): StyleExecutionAsset {
    if (asset.status !== "validated") return { assetId: asset.id, title: asset.title, kind: asset.kind, action: "skip", reason: asset.status === "unavailable" ? "资产当前不可用" : "资产尚未验证" };
    if (asset.baseModels?.length && !asset.baseModels.some((model) => model.trim().toLowerCase() === context.model.trim().toLowerCase())) {
        return { assetId: asset.id, title: asset.title, kind: asset.kind, action: "block", reason: `仅兼容 ${asset.baseModels.join("、")}` };
    }
    if (asset.kind === "prompt") return { assetId: asset.id, title: asset.title, kind: asset.kind, action: "prompt", reason: "追加到项目画风提示词" };
    if (asset.kind === "template" && (asset.promptFragment?.trim() || asset.triggerWords?.length)) return { assetId: asset.id, title: asset.title, kind: asset.kind, action: "prompt", reason: "当前以模板触发词执行" };
    if (asset.kind === "reference") return { assetId: asset.id, title: asset.title, kind: asset.kind, action: "block", reason: "项目参考图自动注入适配器尚未启用" };
    if (asset.kind === "lora") return { assetId: asset.id, title: asset.title, kind: asset.kind, action: "block", reason: `当前 ${context.interfaceType || "图片"} 协议未启用 LoRA 适配器` };
    return { assetId: asset.id, title: asset.title, kind: asset.kind, action: "block", reason: "当前协议不支持该执行资产" };
}

function isStyleAssetBinding(value: unknown): value is StyleAssetBinding {
    if (!value || typeof value !== "object") return false;
    const asset = value as Partial<StyleAssetBinding>;
    if (
        typeof asset.id !== "string" ||
        typeof asset.kind !== "string" ||
        !["lora", "template", "reference", "prompt"].includes(asset.kind) ||
        typeof asset.provider !== "string" ||
        typeof asset.title !== "string" ||
        !["draft", "validated", "unavailable"].includes(String(asset.status))
    )
        return false;
    if (asset.enabled !== undefined && typeof asset.enabled !== "boolean") return false;
    if (asset.weight !== undefined && (!Number.isFinite(asset.weight) || asset.weight < 0 || asset.weight > 2)) return false;
    if (![asset.sourceId, asset.sourceUrl, asset.model, asset.version, asset.promptFragment].every(isOptionalString)) return false;
    if (![asset.baseModels, asset.triggerWords, asset.referenceUrls, asset.referenceResourceIds].every((values) => values === undefined || (Array.isArray(values) && values.every((item) => typeof item === "string")))) return false;
    if (
        asset.parameters !== undefined &&
        (!asset.parameters ||
            typeof asset.parameters !== "object" ||
            !isOptionalString(asset.parameters.sampler) ||
            !isOptionalString(asset.parameters.size) ||
            (asset.parameters.steps !== undefined && !Number.isInteger(asset.parameters.steps)) ||
            (asset.parameters.cfg !== undefined && !Number.isFinite(asset.parameters.cfg)))
    )
        return false;
    if (
        asset.license !== undefined &&
        (!asset.license || typeof asset.license !== "object" || (asset.license.commercial !== undefined && typeof asset.license.commercial !== "boolean") || ![asset.license.note, asset.license.source, asset.license.capturedAt].every(isOptionalString))
    )
        return false;
    return !styleAssetValidationMessage(asset as StyleAssetBinding);
}

function isOptionalString(value: unknown) {
    return value === undefined || typeof value === "string";
}
