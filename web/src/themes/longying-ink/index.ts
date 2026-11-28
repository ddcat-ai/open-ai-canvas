import { registerThemePack } from "../registry";
import type { ThemePack } from "../types";

import { INK_CANVAS_PRESETS, INK_CANVAS_THEMES } from "./canvas";
import { InkOrb } from "./ink-orb";
import { InkCreditMark, InkNotFoundHills, InkSignalArt } from "./marks";
import { LONGYING_INK_SKIN, LONGYING_INK_SKIN_ID } from "./skin";

import "./theme.css";
import "./tokens.css";
import "./type.css";
import "./shell.css";
import "./create.css";
import "./library.css";
import "./canvas.css";
import "./drama.css";
import "./agent.css";
import "./overlays.css";
import "./media.css";

/** 龙影水墨：宣纸焦墨 · 朱砂点睛 · 黛青辅色。主题样式挂在 html[data-skin="longying-ink"] 下。 */
export const longyingInkTheme: ThemePack = {
    id: LONGYING_INK_SKIN_ID,
    name: "龙影水墨",
    skin: LONGYING_INK_SKIN,
    agentOrb: InkOrb,
    launcher: { defaultForm: "capsule" },
    signalArt: InkSignalArt,
    creditMark: InkCreditMark,
    notFound: { backdrop: InkNotFoundHills },
    canvas: { themes: INK_CANVAS_THEMES, presets: INK_CANVAS_PRESETS },
    copy: {
        assetsEmptyFrames: [
            { src: "/themes/longying-ink/assets-empty-1.webp", caption: "ASSET.01 · 墨龙出云" },
            { src: "/themes/longying-ink/assets-empty-2.webp", caption: "ASSET.02 · 一笔成龙" },
            { src: "/themes/longying-ink/assets-empty-3.webp", caption: "ASSET.03 · 胶片云海" },
        ],
        sealGlyph: "影",
    },
};

registerThemePack(longyingInkTheme);

export default longyingInkTheme;
