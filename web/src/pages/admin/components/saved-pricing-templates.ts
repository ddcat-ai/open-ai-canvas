import { getActiveUserScope, scopedStorageKey } from "@/lib/user-scope";
import { useUserStore } from "@/stores/use-user-store";
import { validateChannelModelPrices, type ChannelModelFormValues } from "./channel-model-editor-form";
import { defaultPriceTier, defaultTokenPriceRule } from "./channel-model-price-tier-form";

export type PricingSnapshot = Pick<ChannelModelFormValues, "priceTiers" | "priceCurrency" | "referenceVideoBilling">;
export type SavedPricingTemplate = { id: string; revision: string; name: string; capability: ChannelModelFormValues["capability"]; pricing: PricingSnapshot };
export const PRICING_TEMPLATES_CHANGED = "yingce:pricing-templates-changed";
export const pricingTemplatesKey = (scope: string) => scopedStorageKey("yingce:pricing-templates", scope);
const MAX_STORAGE = 256_000;

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("模板配置格式无效");
    return value as Record<string, unknown>;
}

// 仅保留价格表单已声明字段，不把模型身份、渠道凭据或独立上游型号带入模板。
function copyFields<T extends object>(value: unknown, defaults: T): T {
    const source = object(value);
    return Object.fromEntries(
        Object.entries(defaults).map(([key, fallback]) => {
            const item = source[key] === undefined ? fallback : source[key];
            if (typeof fallback === "number" && item !== null && (typeof item !== "number" || !Number.isFinite(item))) throw new Error("模板价格必须为有效数值");
            if (typeof fallback === "boolean" && typeof item !== "boolean") throw new Error("模板开关格式无效");
            if (typeof fallback === "string" && (typeof item !== "string" || item.length > 256)) throw new Error("模板字段格式无效");
            return [key, structuredClone(item)];
        }),
    ) as T;
}

export function pricingSnapshot(value: PricingSnapshot): PricingSnapshot {
    const source = object(value);
    if (!["credits", "USD", "CNY"].includes(String(source.priceCurrency)) || typeof source.referenceVideoBilling !== "boolean" || !Array.isArray(source.priceTiers) || !source.priceTiers.length || source.priceTiers.length > 48)
        throw new Error("模板须包含有效币种和 1–48 个价格档");
    const tiers = source.priceTiers.map((raw) => {
        const item = object(raw);
        const tier = copyFields(item, defaultPriceTier());
        tier.providerModelKey = "";
        if (!["default", "advanced"].includes(tier.matchMode) || !["fixed_request", "per_second", "token"].includes(tier.billingMode)) throw new Error("模板价格类型无效");
        if (item.imageSelector !== undefined) {
            const entries = Object.entries(object(item.imageSelector));
            if (entries.length > 64 || entries.some(([key, value]) => key.length > 128 || typeof value !== "string" || value.length > 256)) throw new Error("模板规格条件无效");
            tier.imageSelector = Object.fromEntries(entries) as Record<string, string>;
        }
        if (!Array.isArray(tier.tokenRules) || tier.tokenRules.length > 48) throw new Error("模板分时规则无效");
        tier.tokenRules = tier.tokenRules.map((rawRule) => {
            const rule = copyFields(rawRule, defaultTokenPriceRule());
            if (!Array.isArray(rule.weekdays) || !rule.weekdays.length || rule.weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) throw new Error("模板星期设置无效");
            if (rule.maxInputTokens != null && (typeof rule.maxInputTokens !== "number" || !Number.isFinite(rule.maxInputTokens))) throw new Error("模板上下文上限无效");
            return rule;
        });
        return tier;
    });
    return { priceCurrency: value.priceCurrency, referenceVideoBilling: value.referenceVideoBilling, priceTiers: tiers };
}

export function assertPricingTemplateScope(scope: string) {
    if (scope === "guest" || useUserStore.getState().user?.id !== scope || getActiveUserScope() !== scope) throw new Error("账号已切换，请重新打开积分模板");
}

export function readPricingTemplates(scope: string): SavedPricingTemplate[] {
    const raw = window.localStorage.getItem(pricingTemplatesKey(scope));
    if (raw === null) return [];
    try {
        if (raw.length > MAX_STORAGE) throw new Error();
        const data = object(JSON.parse(raw));
        if (data.version !== 1 || !Array.isArray(data.templates) || data.templates.length > 32) throw new Error();
        const ids = new Set<string>();
        const names = new Set<string>();
        return data.templates.map((rawItem) => {
            const item = object(rawItem);
            if (
                typeof item.id !== "string" ||
                !item.id ||
                item.id.length > 128 ||
                ids.has(item.id) ||
                typeof item.revision !== "string" ||
                !item.revision ||
                item.revision.length > 128 ||
                typeof item.name !== "string" ||
                !item.name.trim() ||
                item.name.length > 48 ||
                !["text", "image", "video", "audio"].includes(String(item.capability))
            )
                throw new Error();
            const nameKey = `${item.capability}:${item.name.trim().toLowerCase()}`;
            if (names.has(nameKey)) throw new Error();
            ids.add(item.id);
            names.add(nameKey);
            return { id: item.id, revision: item.revision, name: item.name.trim(), capability: item.capability as SavedPricingTemplate["capability"], pricing: pricingSnapshot(item.pricing as PricingSnapshot) };
        });
    } catch {
        throw new Error("本机积分模板数据无效，已保留原数据，请检查后重试");
    }
}

export function savePricingTemplate(scope: string, name: string, values: ChannelModelFormValues, previous?: Pick<SavedPricingTemplate, "id" | "revision">) {
    assertPricingTemplateScope(scope);
    name = name.trim();
    if (!name || name.length > 48) throw new Error("模板名称须为 1–48 个字符");
    const templates = readPricingTemplates(scope);
    if (previous && !templates.some((item) => item.id === previous.id && item.revision === previous.revision)) throw new Error("模板已被修改，请关闭后重新编辑");
    if (!previous && templates.length >= 32) throw new Error("最多保存 32 个积分模板");
    if (templates.some((item) => item.id !== previous?.id && item.capability === values.capability && item.name.toLowerCase() === name.toLowerCase())) throw new Error("模板名称已存在，请换一个名称");
    const template: SavedPricingTemplate = { id: previous?.id || crypto.randomUUID(), revision: crypto.randomUUID(), name, capability: values.capability, pricing: pricingSnapshot(values) };
    validateChannelModelPrices({ ...values, ...template.pricing });
    const next = previous ? templates.map((item) => (item.id === previous.id ? template : item)) : [...templates, template];
    const serialized = JSON.stringify({ version: 1, templates: next });
    if (serialized.length > MAX_STORAGE) throw new Error("积分模板存储已满，请减少模板内容");
    try {
        window.localStorage.setItem(pricingTemplatesKey(scope), serialized);
    } catch {
        throw new Error("积分模板未保存：本机存储不可用或空间不足");
    }
    window.dispatchEvent(new CustomEvent(PRICING_TEMPLATES_CHANGED, { detail: scope }));
    return template;
}

export function templatePricingForModel(template: SavedPricingTemplate, values: ChannelModelFormValues): PricingSnapshot {
    if (template.capability !== values.capability) throw new Error("模板与当前模型能力类型不一致");
    return pricingSnapshot(template.pricing);
}
