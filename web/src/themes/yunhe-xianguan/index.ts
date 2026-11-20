import { registerThemePack } from "../registry";
import type { ThemePack } from "../types";

import { XIANGUAN_CANVAS_PRESETS, XIANGUAN_CANVAS_THEMES } from "./canvas";
import { CloudSignalArt, CraneOrb, GateNotFoundEmblem, GourdCreditMark } from "./marks";
import { YUNHE_XIANGUAN_SKIN, YUNHE_XIANGUAN_SKIN_ID } from "./skin";

import "./theme.css";

/** 云鹤仙观：月白云海 · 玄青落字 · 一点鹤顶红。样式全部在 theme.css，挂在 html[data-skin="yunhe-xianguan"] 下。 */
export const yunheXianguanTheme: ThemePack = {
    id: YUNHE_XIANGUAN_SKIN_ID,
    name: "云鹤仙观",
    skin: YUNHE_XIANGUAN_SKIN,
    agentOrb: CraneOrb,
    signalArt: CloudSignalArt,
    creditMark: GourdCreditMark,
    notFound: {
        emblem: GateNotFoundEmblem,
        title: "鹤飞远了",
        description: "这一页不在观里，可能已经移动或合并到其他入口。回首页看看。",
    },
    canvas: { themes: XIANGUAN_CANVAS_THEMES, presets: XIANGUAN_CANVAS_PRESETS },
    copy: {
        homeHeading: "今天，想让什么入画？",
        loginTitle: "欢迎回观",
        assetsEmptyFrames: [
            { src: "/themes/yunhe-xianguan/assets-empty-1.webp", caption: "ASSET.01 · 云海初开" },
            { src: "/themes/yunhe-xianguan/assets-empty-2.webp", caption: "ASSET.02 · 一鹤入画" },
            { src: "/themes/yunhe-xianguan/assets-empty-3.webp", caption: "ASSET.03 · 观中留影" },
        ],
        sealGlyph: "鹤",
    },
};

registerThemePack(yunheXianguanTheme);

export default yunheXianguanTheme;
