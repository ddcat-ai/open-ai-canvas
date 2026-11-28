import type { ThemeCanvasPatch, ThemePack } from "../types";

// 龙影水墨的画布配色：宣纸 / 夜墨。由主题支持（themes/apply.ts）在启用皮肤时套用、切走时还原。
// 画布渲染器使用颜色快照，DOM 工作区通过同一主题包加载样式。
export const INK_CANVAS_THEMES: Record<"light" | "dark", ThemeCanvasPatch> = {
    light: {
        connection: { stroke: "#a89e8d", beam: "#3d3832" },
        canvas: { background: "#ece6da", dot: "rgba(70,55,35,.34)", line: "rgba(70,55,35,.55)", selectionFill: "rgba(31,28,24,.08)" },
        node: {
            label: "#5d564c",
            agentUserMessage: "#f1e6d8",
            fill: "#fbf8f2",
            panel: "#fbf8f2",
            stroke: "#ded4c2",
            edge: "rgba(62,46,24,.18)",
            // 轻纸影：贴边一层近影交代边缘，远影很淡；选中 / 聚焦时多一圈 3px 墨晕（选中环本身由 canvas.css 的 outline 画）。
            shadow: "0 1px 2px rgba(62,46,24,.06), 0 8px 24px -12px rgba(62,46,24,.16)",
            hoverShadow: "0 0 0 3px rgba(31,28,24,.08), 0 10px 28px -12px rgba(62,46,24,.22)",
            activeStroke: "#1f1c18",
            placeholder: "#a39b8d",
            text: "#1f1c18",
            muted: "#686158",
            faint: "#a39b8d",
        },
        frame: { fill: "rgba(62,46,24,.03)", stroke: "rgba(62,46,24,.2)", activeFill: "rgba(31,28,24,.05)", activeStroke: "#1f1c18", preview: "rgba(251,248,242,.86)" },
        toolbar: { panel: "rgba(251,248,242,.9)", border: "rgba(62,46,24,.12)", item: "#4e4840", itemHover: "rgba(62,46,24,.07)", activeBg: "rgba(62,46,24,.11)", activeText: "#1f1c18" },
        // 常驻浮岛 90% 纸笺 + 轻模糊；一次性弹出的菜单 / 快选用不透明浮起纸（elevated），不再发糊。
        spatial: { surface: "rgba(251,248,242,.78)", elevated: "#fffdf8", dropzone: "rgba(245,241,232,.82)", glow: "rgba(31,28,24,.14)", glowStrong: "rgba(31,28,24,.4)", shadow: "rgba(62,46,24,.18)" },
        timeline: {
            trackFill: "#f3eee4",
            trackBorder: "rgba(62,46,24,.1)",
            clipVideo: "rgba(162,59,69,.14)",
            clipAudio: "rgba(44,111,124,.14)",
            clipSubtitle: "rgba(181,131,47,.16)",
            clipSelectedBorder: "#1f1c18",
            playhead: "#b0402d",
            rulerLabel: "#6b645a",
        },
        accent: { primary: "#1f1c18", primarySoft: "rgba(31,28,24,.09)", onPrimary: "#f7f3ea", danger: "#8f2a2a" },
    },
    dark: {
        connection: { stroke: "#6f685c", beam: "#ece5d6" },
        canvas: { background: "#0e0d0b", dot: "rgba(236,229,214,.2)", line: "rgba(236,229,214,.28)", selectionFill: "rgba(236,229,214,.1)" },
        node: {
            label: "#a59d8e",
            agentUserMessage: "#2b2119",
            fill: "#1b1915",
            panel: "#171511",
            stroke: "rgba(236,229,214,.12)",
            edge: "rgba(236,229,214,.18)",
            shadow: "0 1px 2px rgba(0,0,0,.4), 0 12px 30px -14px rgba(0,0,0,.6)",
            // 夜墨选中环放进影子：Blink 会把 1.5px 的 outline 取整成 1px，box-shadow 保留小数宽度。
            hoverShadow: "0 0 0 1.5px #ece6da, 0 0 0 4.5px rgba(236,229,214,.06), 0 14px 34px -14px rgba(0,0,0,.7)",
            activeStroke: "#ece5d6",
            placeholder: "#7c7466",
            text: "#ece5d6",
            muted: "#a59d8e",
            faint: "#6f685c",
        },
        frame: { fill: "rgba(236,229,214,.025)", stroke: "rgba(236,229,214,.15)", activeFill: "rgba(236,229,214,.07)", activeStroke: "#ece5d6", preview: "rgba(23,21,17,.94)" },
        toolbar: { panel: "rgba(27,25,21,.9)", border: "rgba(236,229,214,.1)", item: "#d2cabb", itemHover: "rgba(236,229,214,.07)", activeBg: "rgba(236,229,214,.1)", activeText: "#f7f1e4" },
        spatial: { surface: "rgba(27,25,21,.84)", elevated: "#23201b", dropzone: "rgba(14,13,11,.9)" },
        timeline: {
            trackFill: "#141210",
            clipVideo: "rgba(208,99,108,.2)",
            clipAudio: "rgba(107,176,187,.2)",
            clipSubtitle: "rgba(217,166,80,.2)",
            clipSelectedBorder: "#ece5d6",
            playhead: "#e2765b",
            rulerLabel: "#a59d8e",
        },
        accent: { primary: "#ece5d6", primarySoft: "rgba(236,229,214,.1)", onPrimary: "#16140f", danger: "#ff928d" },
    },
};

// 新建画布会把预设值快照进画布数据，所以改预设只影响之后新建的画布；老画布在画布外观里手动换。
export const INK_CANVAS_PRESETS = {
    light: { label: "宣纸", values: { baseTheme: "light", backgroundColor: "#ECE6DA", backgroundBrightness: 0, gridColor: "#463723", gridOpacity: 14 } },
    dark: { label: "夜墨", values: { baseTheme: "dark", backgroundColor: "#0E0D0B", backgroundBrightness: 0, gridColor: "#ECE5D6", gridOpacity: 12 } },
} satisfies NonNullable<NonNullable<ThemePack["canvas"]>["presets"]>;
