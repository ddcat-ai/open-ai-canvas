export type DocumentTitleInput = {
    /** 当前页面或对象名称，例如画布名；为空时使用站点 SEO 标题。 */
    pageTitle?: string;
    brandName: string;
    seoTitle?: string;
    /** 标签页在后台期间完成、用户还没看到的生成数量。 */
    attentionCount?: number;
    attentionLabel?: string;
};

/**
 * 浏览器标签页标题：「画布名 - 品牌」；后台有新完成的生成时在最前面加「(2) 生成完成 ·」，
 * 标签页很窄时也能先看到提醒。
 */
export function composeDocumentTitle({ pageTitle, brandName, seoTitle, attentionCount = 0, attentionLabel = "" }: DocumentTitleInput) {
    const page = pageTitle?.trim();
    const base = page ? `${page} - ${brandName}` : seoTitle || brandName;
    if (attentionCount <= 0) return base;
    return `(${attentionCount > 99 ? "99+" : attentionCount}) ${attentionLabel ? `${attentionLabel} · ` : ""}${base}`;
}
