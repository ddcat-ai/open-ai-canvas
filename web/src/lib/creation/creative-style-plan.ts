export type CreativeStyleBible = {
    version: 1;
    fingerprint: string;
    summary: string;
    globalPrompt: string;
    negativePrompt: string;
    palette: string[];
    lighting: string;
    camera: string;
    composition: string;
    material: string;
    preserve: string[];
    avoid: string[];
    anchorRef?: string;
};

type StyleBibleInput = Partial<Omit<CreativeStyleBible, "version" | "fingerprint">> & Record<string, unknown>;

const MAX_TEXT = 600;
const MAX_ITEM = 120;

function text(value: unknown, max = MAX_TEXT) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function list(value: unknown) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((item) => text(item, MAX_ITEM)).filter(Boolean))].slice(0, 12);
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

function fingerprint(value: unknown) {
    let hash = 2166136261;
    for (const char of stableJson(value)) {
        hash ^= char.codePointAt(0) || 0;
        hash = Math.imul(hash, 16777619);
    }
    return `style-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function normalizeCreativeStyleBible(raw: unknown): CreativeStyleBible | undefined {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const value = raw as StyleBibleInput;
    const globalPrompt = text(value.globalPrompt);
    if (!globalPrompt) return undefined;
    const normalized = {
        version: 1 as const,
        summary: text(value.summary, 240) || globalPrompt,
        globalPrompt,
        negativePrompt: text(value.negativePrompt),
        palette: list(value.palette),
        lighting: text(value.lighting, 240),
        camera: text(value.camera, 240),
        composition: text(value.composition, 240),
        material: text(value.material, 240),
        preserve: list(value.preserve),
        avoid: list(value.avoid),
        anchorRef: text(value.anchorRef, 96) || undefined,
    };
    return { ...normalized, fingerprint: fingerprint(normalized) };
}

export function compileCreativeStylePrompt(style: CreativeStyleBible, taskPrompt: string) {
    const sections = [
        `风格锁定（${style.fingerprint}）：${style.globalPrompt}`,
        style.palette.length ? `统一色彩：${style.palette.join("、")}` : "",
        style.lighting ? `统一光线：${style.lighting}` : "",
        style.camera ? `统一镜头：${style.camera}` : "",
        style.composition ? `统一构图原则：${style.composition}` : "",
        style.material ? `统一材质表现：${style.material}` : "",
        style.preserve.length ? `必须保留：${style.preserve.join("、")}` : "",
        style.avoid.length ? `避免出现：${style.avoid.join("、")}` : "",
        style.negativePrompt ? `负面约束：${style.negativePrompt}` : "",
        text(taskPrompt),
    ].filter(Boolean);
    return sections.join("\n");
}

export function creativeBatchRefs(style: CreativeStyleBible | undefined, pendingRefs: string[], readyRefs: ReadonlySet<string>) {
    if (!style?.anchorRef || readyRefs.has(style.anchorRef)) return pendingRefs;
    return pendingRefs.filter((ref) => ref === style.anchorRef);
}
