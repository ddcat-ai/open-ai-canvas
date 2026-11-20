import knowledge from "../../../../backend/internal/ecommerceagent/platform_knowledge.json";

export const commercePlatformKnowledge = knowledge;
export function commerceKnowledgeFor(platform: string) {
    return knowledge.profiles.find((item) => item.id === platform);
}

export function commercePlatformNoText(platform: string, imageType: string, purpose = ""): boolean {
    const profile = commerceKnowledgeFor(platform);
    if (!profile) return false;
    const listing = !["marketing", "social", "poster", "amazon-a-plus"].includes(imageType) && !(imageType === "single" && /banner|海报|社媒/i.test(purpose));
    return (profile.allListingNoText && listing) || (profile.mainNoText && (["main", "sku"].includes(imageType) || (imageType === "single" && purpose.includes("主图"))));
}

export function commerceKnowledgePrompt(platform: string, imageType: string, purpose = ""): string {
    const p = commerceKnowledgeFor(platform);
    return [
        "【平台知识与发布边界】" + knowledge.version,
        knowledge.boundary,
        p ? `目标平台：${p.label}；资料范围：${p.scope}；设计建议（非官方强制）：${p.style}；风险：${p.risk}` : "",
        p?.reviewStatus === "pending" ? "详细平台规则待官方后台核实，不得宣称已通过平台审核。" : "",
        ...(p?.officialRules || []),
        ...(p?.sources || []).map((url) => "官方来源：" + url),
        ...knowledge.commonRules,
        "高风险词示例（非完整官方禁词表）：" + knowledge.restrictedPhrases.join("、"),
        commercePlatformNoText(platform, imageType, purpose) ? "本张不添加文字、水印、边框、徽章或营销图形，copy为空，仅保留实物自带的真实Logo和印刷。" : "",
    ]
        .filter(Boolean)
        .join("\n");
}

export function commerceRestrictedPhrase(copy: string): string | undefined {
    const normalize = (value: string) =>
        value
            .normalize("NFKC")
            .toLowerCase()
            .replace(/[\s\p{P}\p{Cf}]/gu, "");
    const text = normalize(copy);
    return knowledge.restrictedPhrases.find((phrase) => {
        const needle = normalize(phrase);
        let offset = 0;
        while (offset < text.length) {
            const at = text.indexOf(needle, offset);
            if (at < 0) break;
            const end = at + needle.length;
            if (end === text.length || !/[0-9]/.test(text[end])) return true;
            offset = end;
        }
        return false;
    });
}
