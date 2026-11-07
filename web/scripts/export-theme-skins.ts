import { LONGYING_INK_SKIN } from "../src/themes/longying-ink/skin";
import { YUNHE_XIANGUAN_SKIN } from "../src/themes/yunhe-xianguan/skin";

/** 只输出安装脚本，不发请求；管理员在自己的站点控制台执行输出内容。 */
export function buildThemeSkinInstallScript() {
    return `(async () => {
    const skins = ${JSON.stringify([LONGYING_INK_SKIN, YUNHE_XIANGUAN_SKIN])};
    const fields = "brandName canvas updates brandSlug authHeroTitle authHeroDescription logoResourceId darkLogoResourceId logoFrameEnabled authVideoResourceId authVideoPosterResourceId authVideoAutoplay skinId skinThemes seoTitle seoDescription seoKeywords footerCopyright icpFilingEnabled icpFilingNumber redeemPurchaseUrl".split(" ");
    const canonical = (value) => JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
    async function api(method, data) {
        const response = await fetch("/api/admin/settings/appearance", { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...(data ? { body: JSON.stringify(data) } : {}) });
        const result = await response.json();
        if (!response.ok || result.code !== 0 || !result.data?.setting) throw new Error("无法读写外观设置，请确认管理员登录状态和接口版本。");
        return result.data.setting;
    }
    const before = await api("GET");
    if (!Array.isArray(before.skinThemes)) throw new Error("皮肤库格式不兼容，未修改。");
    const themes = [...before.skinThemes];
    for (const skin of skins) {
        const existing = themes.find((item) => item.id === skin.id);
        if (existing && canonical(existing) !== canonical(skin)) throw new Error("同名主题已有不同设置，未覆盖：" + skin.name);
        if (!existing) themes.push(skin);
    }
    if (themes.length === before.skinThemes.length) { console.log("两套主题已在皮肤库中，无需重复安装。"); return; }
    if (themes.length > 16) throw new Error("皮肤库容量不足，未修改。");
    const body = Object.fromEntries(fields.filter((key) => key in before).map((key) => [key, before[key]]));
    body.skinThemes = themes;
    if (canonical(await api("GET")) !== canonical(before)) throw new Error("外观设置已被其他操作修改，请重新读取后再安装。");
    await api("PATCH", body);
    const after = await api("GET");
    for (const key of fields) if (canonical(after[key]) !== canonical(body[key])) throw new Error("保存后的字段不一致，请检查后台：" + key);
    console.log("龙影水墨与云鹤仙观已加入皮肤库，当前皮肤保持不变。请在后台选择主题并保存。");
})().catch((error) => { console.error("主题安装停止：", error.message); });`;
}

if (import.meta.main) console.log(buildThemeSkinInstallScript());
