import type { EcommerceDraft } from "@/services/api/ecommerce";
import { supportedImageSize } from "./catalog";

export type MarketingMaterial = { id: string; name: string; ratio: string; category: string; keywords: string[] };
export type MarketingSelection = { id: string; count: number; ratio: string };

const group = (category: string, items: Array<[string, string, string, string]>) => items.map(([id, name, ratio, keywords]): MarketingMaterial => ({ id, name, ratio, category, keywords: keywords.split(" ") }));

export const marketingCategories = ["市场营销", "社交媒体", "平面印刷", "小红书", "教育培训", "日常生活", "商务办公", "IP", "明星应援"] as const;
export const marketingMaterials: MarketingMaterial[] = [
    ...group("市场营销", [
        ["market-poster", "海报", "3:4", "活动 推广 促销 海报"],
        ["market-long", "长图", "9:16", "长图 详情 信息"],
        ["market-rollup", "易拉宝", "9:16", "展会 门店 线下"],
        ["market-flyer", "传单", "2:3", "传单 派发"],
        ["market-menu", "菜单", "3:4", "餐饮 菜单"],
        ["market-notice", "公告", "3:4", "公告 通知"],
        ["market-illustration", "插画素材", "1:1", "插画 视觉"],
        ["market-event", "活动海报", "9:16", "活动 报名"],
        ["market-brochure", "产品手册", "9:16", "手册 产品介绍"],
        ["market-page", "彩页", "3:2", "彩页 宣传"],
        ["market-ppt", "PPT", "16:9", "演示 路演 PPT"],
        ["market-kv", "KV 主视觉", "16:9", "品牌 主视觉 KV"],
    ]),
    ...group("社交媒体", [
        ["social-post", "图文帖子", "3:4", "社交 图文 帖子"],
        ["social-moments", "朋友圈海报", "9:16", "朋友圈 微信"],
        ["social-wechat-cover", "公众号双封面", "4:1", "公众号 封面"],
        ["social-wechat", "公众号封面", "21:9", "公众号 封面"],
        ["social-thumbnail", "公众号小图", "1:1", "公众号 配图"],
        ["social-miniapp", "小程序封面", "5:4", "小程序 封面"],
        ["social-story", "口签", "9:16", "故事 竖版"],
    ]),
    ...group("平面印刷", [
        ["print-poster", "海报", "3:4", "印刷 海报"],
        ["print-wide", "海报（横版）", "4:3", "横版 海报"],
        ["print-rollup", "易拉宝", "9:16", "易拉宝 展会"],
        ["print-flyer", "传单", "2:3", "传单 印刷"],
        ["print-menu", "菜单", "3:4", "菜单 餐饮"],
        ["print-notice", "公告", "3:4", "公告 通知"],
        ["print-board", "展板", "2:1", "展板 展示"],
        ["print-certificate", "证书", "3:2", "证书 纪念"],
        ["print-resume", "简历", "2:3", "简历 求职"],
        ["print-card", "贺卡", "4:3", "贺卡 节日"],
        ["print-newspaper", "手抄报", "3:2", "手抄报 学校"],
    ]),
    ...group("小红书", [
        ["red-cover", "小红书封面", "3:4", "小红书 封面 种草"],
        ["red-slide", "小红书配图", "3:4", "小红书 图文 轮播"],
        ["red-video", "小红书视频封面", "3:4", "小红书 视频 封面"],
        ["red-background", "小红书背景图", "5:4", "小红书 背景"],
    ]),
    ...group("教育培训", [
        ["edu-resume", "简历", "2:3", "教育 简历 求职"],
        ["edu-campus", "校园海报", "2:3", "校园 学校 海报"],
        ["edu-admissions", "招生手机海报", "9:16", "招生 招聘"],
        ["edu-wechat", "校园微信公众号封面", "21:9", "校园 公众号"],
        ["edu-long", "教育长图", "9:16", "教育 课程 长图"],
        ["edu-newspaper", "手抄报", "3:2", "学生 手抄报"],
        ["edu-certificate", "证书", "3:2", "证书"],
    ]),
    ...group("日常生活", [
        ["life-card", "贺卡明信片", "3:2", "贺卡 明信片"],
        ["life-invitation", "邀请函", "9:16", "邀请 聚会"],
        ["life-avatar", "头像", "1:1", "头像 社交"],
        ["life-wallpaper", "壁纸", "9:16", "壁纸 手机"],
        ["life-sticker", "表情包", "1:1", "表情包"],
        ["life-envelope", "微信红包封面", "3:4", "红包 微信"],
    ]),
    ...group("商务办公", [
        ["office-slides", "演示文稿", "16:9", "PPT 演示 商务"],
        ["office-card", "名片", "9:16", "名片 商务"],
        ["office-digital-card", "微信电子名片", "9:16", "电子名片 微信"],
        ["office-chart", "图表", "4:3", "数据 图表"],
        ["office-calendar", "日历", "16:9", "日历 办公"],
        ["office-letter", "信纸", "2:3", "信纸 信函"],
    ]),
    ...group("IP", [
        ["ip-poster", "IP 海报", "3:4", "IP 角色 海报"],
        ["ip-mobile", "IP 手机海报", "9:16", "IP 角色 手机"],
        ["ip-wallpaper", "IP 手机壁纸", "9:16", "IP 壁纸"],
        ["ip-wide", "IP 壁纸（横版）", "4:3", "IP 横版"],
    ]),
    ...group("明星应援", [
        ["fan-card", "应援小卡", "2:3", "应援 小卡 明星"],
        ["fan-wristband", "应援手幅", "4:1", "应援 手幅"],
        ["fan-square", "应援方卡", "1:1", "应援 方卡"],
        ["fan-photo", "应援照片", "9:16", "应援 照片"],
        ["fan-film", "应援透扇", "1:1", "应援 透扇"],
        ["fan-poster", "应援海报", "2:3", "应援 海报"],
        ["fan-mobile", "应援手机海报", "9:16", "应援 手机"],
        ["fan-rollup", "应援易拉宝", "9:16", "应援 易拉宝"],
    ]),
];
export const marketingMaterialById = new Map(marketingMaterials.map((item) => [item.id, item]));

export function parseMarketingSelections(draft: EcommerceDraft): MarketingSelection[] {
    try {
        const parsed = JSON.parse(draft.typeOptions?.materialPlan || "[]");
        if (!Array.isArray(parsed)) return [];
        const seen = new Set<string>();
        let total = 0;
        let category = "";
        return parsed.filter((item): item is MarketingSelection => {
            const material = item && marketingMaterialById.get(item.id);
            if (!material || (category && material.category !== category) || seen.has(item.id) || !Number.isInteger(item.count) || item.count < 1 || item.count > 15 || typeof item.ratio !== "string" || !item.ratio.trim() || total + item.count > 15)
                return false;
            category = material.category;
            seen.add(item.id);
            total += item.count;
            return true;
        });
    } catch {
        return [];
    }
}

export function marketingPlanSlots(draft: EcommerceDraft) {
    return parseMarketingSelections(draft).flatMap((selection) => Array.from({ length: selection.count }, () => ({ ...marketingMaterialById.get(selection.id)!, ratio: selection.ratio })));
}

export function automaticMarketingSelections(selections: MarketingSelection[], ratios: string[], current?: string): MarketingSelection[] {
    return selections.map((selection) => {
        const material = marketingMaterialById.get(selection.id);
        return material ? { ...selection, ratio: supportedImageSize(material.ratio, ratios, current) } : selection;
    });
}

export function recommendMarketingSelections(prompt: string, category: string, ratios: string[]): MarketingSelection[] {
    const text = prompt.toLowerCase();
    const candidates = marketingMaterials.filter((item) => item.category === category);
    const scored = candidates.map((item) => ({ item, score: item.keywords.reduce((sum, word) => sum + (text.includes(word.toLowerCase()) ? 3 : 0), 0) + (text.includes(item.name.toLowerCase()) ? 4 : 0) }));
    scored.sort((a, b) => b.score - a.score);
    const count = scored[0]?.score ? Math.min(4, scored.filter((entry) => entry.score > 0).length) : Math.min(3, candidates.length);
    return scored.slice(0, count).map(({ item }) => ({ id: item.id, count: 1, ratio: supportedImageSize(item.ratio, ratios) }));
}
