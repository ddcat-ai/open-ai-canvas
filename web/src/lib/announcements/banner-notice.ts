/**
 * 首页常驻通知条的「通知类型」与「标题图标素材」模型。
 *
 * 通知类型决定通知条底色（后台与前台共用同一套 token）。
 * 图标素材是 emoji 字符：它就是普通文本，随 TitleRuns 的文本分段一起存储与渲染，
 * 因此可以插到标题任意位置、跟随分段样式、参与关键字检索，后端不需要单独字段或白名单。
 *
 * 本模块只放纯数据与纯函数，不 import 任何组件。
 */

export type BannerNoticeType = "notice" | "activity" | "update" | "warning";

/** 未指定类型时的兜底：平台公告。 */
export const BANNER_NOTICE_DEFAULT_TYPE: BannerNoticeType = "notice";

export const BANNER_NOTICE_TYPES: {
    key: BannerNoticeType;
    label: string;
    hint: string;
    /** 该类型的语义底色 token；由 globals.css 按明暗主题分别取值。 */
    surfaceVar: string;
}[] = [
    { key: "notice", label: "公告", hint: "平台公告、规则与流程变更", surfaceVar: "--notice-banner-surface-notice" },
    { key: "activity", label: "活动", hint: "运营活动、限时促销与福利", surfaceVar: "--notice-banner-surface-activity" },
    { key: "update", label: "更新", hint: "版本发布、功能上新与改版", surfaceVar: "--notice-banner-surface-update" },
    { key: "warning", label: "警告", hint: "维护窗口、风险与服务异常", surfaceVar: "--notice-banner-surface-warning" },
];

const BANNER_NOTICE_TYPE_KEYS = new Set<string>(BANNER_NOTICE_TYPES.map((item) => item.key));

/** 未知 / 空类型一律回落到默认类型，通知条不会因为脏数据失去底色。 */
export function normalizeBannerNoticeType(value?: string | null): BannerNoticeType {
    const raw = (value || "").trim().toLowerCase();
    return BANNER_NOTICE_TYPE_KEYS.has(raw) ? (raw as BannerNoticeType) : BANNER_NOTICE_DEFAULT_TYPE;
}

export function bannerNoticeTypeMeta(value?: string | null) {
    const key = normalizeBannerNoticeType(value);
    return BANNER_NOTICE_TYPES.find((item) => item.key === key) as (typeof BANNER_NOTICE_TYPES)[number];
}

export function bannerNoticeTypeLabel(value?: string | null) {
    return bannerNoticeTypeMeta(value).label;
}

export function bannerNoticeTypeHint(value?: string | null) {
    return bannerNoticeTypeMeta(value).hint;
}

/** 该类型底色的 CSS 引用（含 var()）；scope 内可被预览容器覆盖成明暗指定档。 */
export function bannerNoticeSurfaceCSS(value?: string | null) {
    return `var(${bannerNoticeTypeMeta(value).surfaceVar})`;
}

/** 合法类型键，供后端白名单与前端一致性测试使用。 */
export const BANNER_NOTICE_TYPE_VALUES = BANNER_NOTICE_TYPES.map((item) => item.key);

/**
 * 标题可插入的 emoji 图标素材，按用途分组。
 * 每项的 char 会作为普通文本插进标题（跟随光标处的字号 / 颜色样式），label 供搜索与 aria 标注。
 */
export const BANNER_NOTICE_EMOJI_GROUPS: { key: string; label: string; emoji: { char: string; label: string }[] }[] = [
    {
        key: "notice",
        label: "通知",
        emoji: [
            { char: "📢", label: "喇叭" },
            { char: "📣", label: "扩音" },
            { char: "🔔", label: "铃铛" },
            { char: "📮", label: "邮筒" },
            { char: "📌", label: "图钉" },
            { char: "📄", label: "文件" },
            { char: "📝", label: "备注" },
            { char: "📰", label: "快讯" },
            { char: "🗓️", label: "日历" },
            { char: "⏰", label: "闹钟" },
            { char: "🕐", label: "时钟" },
            { char: "🎯", label: "目标" },
        ],
    },
    {
        key: "celebrate",
        label: "庆祝",
        emoji: [
            { char: "🎉", label: "撒花" },
            { char: "🎊", label: "礼花" },
            { char: "🎈", label: "气球" },
            { char: "🎁", label: "礼物" },
            { char: "🎂", label: "蛋糕" },
            { char: "🥳", label: "狂欢" },
            { char: "🏆", label: "奖杯" },
            { char: "🥇", label: "金牌" },
            { char: "👑", label: "皇冠" },
            { char: "💎", label: "宝石" },
            { char: "✨", label: "闪光" },
            { char: "⭐", label: "星星" },
        ],
    },
    {
        key: "hot",
        label: "热门",
        emoji: [
            { char: "🔥", label: "热门" },
            { char: "🚀", label: "火箭" },
            { char: "⚡", label: "闪电" },
            { char: "💥", label: "爆炸" },
            { char: "🌟", label: "亮星" },
            { char: "💫", label: "星晕" },
            { char: "🌈", label: "彩虹" },
            { char: "☀️", label: "太阳" },
            { char: "🌙", label: "月亮" },
            { char: "❤️", label: "红心" },
            { char: "💯", label: "满分" },
            { char: "👍", label: "点赞" },
        ],
    },
    {
        key: "commerce",
        label: "商业",
        emoji: [
            { char: "💰", label: "钱袋" },
            { char: "💸", label: "飞钱" },
            { char: "💳", label: "银行卡" },
            { char: "🏦", label: "银行" },
            { char: "🛒", label: "购物车" },
            { char: "🛍️", label: "购物袋" },
            { char: "🏷️", label: "价签" },
            { char: "💼", label: "公文包" },
            { char: "📈", label: "上涨" },
            { char: "📉", label: "下跌" },
            { char: "🎫", label: "票券" },
            { char: "🎟️", label: "门票" },
        ],
    },
    {
        key: "status",
        label: "状态",
        emoji: [
            { char: "✅", label: "完成" },
            { char: "❌", label: "取消" },
            { char: "⚠️", label: "警告" },
            { char: "⛔", label: "禁止" },
            { char: "🚫", label: "禁用" },
            { char: "❓", label: "疑问" },
            { char: "❗", label: "感叹" },
            { char: "⏳", label: "等待" },
            { char: "🔄", label: "刷新" },
            { char: "🔧", label: "扳手" },
            { char: "🔒", label: "上锁" },
            { char: "🐞", label: "缺陷" },
        ],
    },
];

/** 扁平化的 emoji 清单，顺序与分组一致。 */
export const BANNER_NOTICE_EMOJIS = BANNER_NOTICE_EMOJI_GROUPS.flatMap((group) =>
    group.emoji.map((item) => ({ ...item, group: group.key, groupLabel: group.label })),
);

/** 按关键字过滤（匹配中文名、分组名或字符本身），空关键字返回全量。 */
export function searchBannerNoticeEmojis(keyword: string) {
    const query = keyword.trim().toLowerCase();
    if (!query) return BANNER_NOTICE_EMOJIS;
    return BANNER_NOTICE_EMOJIS.filter((item) => item.char.includes(query) || item.label.includes(query) || item.groupLabel.includes(query));
}

/**
 * 读取指定类型在当前主题下的通知条实底色，避免把设计 token 的色值复制到 TS 里。
 * scope 传后台预览容器可在该容器强制指定的明 / 暗档里取值。
 */
export function readBannerNoticeSurface(noticeType?: string | null, scope?: HTMLElement | null) {
    if (typeof window === "undefined") return "";
    const host = scope || window.document.body || window.document.documentElement;
    if (!host) return "";
    const probe = window.document.createElement("span");
    probe.style.cssText = `position:absolute;left:-9999px;top:-9999px;background-color:${bannerNoticeSurfaceCSS(noticeType)}`;
    host.appendChild(probe);
    const resolved = window.getComputedStyle(probe).backgroundColor;
    probe.remove();
    return resolved;
}
