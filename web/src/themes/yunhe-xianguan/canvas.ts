import type { ThemeCanvasPatch, ThemePack } from "../types";

// 云鹤仙观的画布配色：月白 / 夜观。由主题支持（themes/apply.ts）在启用皮肤时套用、切走时还原。
export const XIANGUAN_CANVAS_THEMES: Record<"light" | "dark", ThemeCanvasPatch> = {
    light: {
        connection: { stroke: "#9fb2b5", beam: "#2f4a54" },
        canvas: { background: "#eaf0ee", dot: "rgba(26,52,60,.5)", line: "rgba(26,52,60,.42)", selectionFill: "rgba(59,116,132,.08)" },
        node: {
            label: "#56656b",
            agentUserMessage: "#e1ebe9",
            fill: "#f8faf9",
            panel: "#f8faf9",
            stroke: "#d3dddb",
            edge: "rgba(26,52,60,.16)",
            shadow: "0 6px 18px rgba(26,52,60,.08)",
            hoverShadow: "0 10px 26px rgba(26,52,60,.13)",
            activeStroke: "#1a242c",
            placeholder: "#94a3a6",
            text: "#1a242c",
            muted: "#5e6c71",
            faint: "#94a3a6",
        },
        frame: { fill: "rgba(59,116,132,.03)", stroke: "rgba(26,52,60,.2)", activeFill: "rgba(59,116,132,.06)", activeStroke: "#1a242c", preview: "rgba(248,250,249,.88)" },
        toolbar: { panel: "rgba(248,250,249,.95)", border: "rgba(26,52,60,.12)", item: "#3d4d55", itemHover: "rgba(59,116,132,.08)", activeBg: "rgba(59,116,132,.13)", activeText: "#1a242c" },
        spatial: { surface: "rgba(248,250,249,.8)", elevated: "rgba(248,250,249,.96)", dropzone: "rgba(237,241,239,.84)", glow: "rgba(59,116,132,.16)", glowStrong: "rgba(59,116,132,.42)", shadow: "rgba(26,52,60,.16)" },
        timeline: {
            trackFill: "#e7eeec",
            trackBorder: "rgba(26,52,60,.1)",
            clipVideo: "rgba(195,70,58,.13)",
            clipAudio: "rgba(59,116,132,.15)",
            clipSubtitle: "rgba(184,149,90,.17)",
            clipSelectedBorder: "#1a242c",
            playhead: "#c3352a",
            rulerLabel: "#5e6c71",
        },
        accent: { primary: "#1a242c", primarySoft: "rgba(26,36,44,.08)", onPrimary: "#f4f8f7", danger: "#c3352a" },
    },
    dark: {
        connection: { stroke: "#4f646b", beam: "#d7e3e1" },
        canvas: { background: "#0a1014", dot: "rgba(207,224,228,.28)", line: "rgba(207,224,228,.24)", selectionFill: "rgba(125,178,191,.12)" },
        node: {
            label: "#93a3a6",
            agentUserMessage: "#1b2b31",
            fill: "#131c21",
            panel: "#111a1f",
            stroke: "rgba(226,233,230,.11)",
            edge: "rgba(226,233,230,.16)",
            activeStroke: "#e2e9e6",
            placeholder: "#6f8085",
            text: "#e2e9e6",
            muted: "#93a3a6",
            faint: "#5d6c71",
        },
        frame: { fill: "rgba(125,178,191,.03)", stroke: "rgba(226,233,230,.14)", activeFill: "rgba(125,178,191,.08)", activeStroke: "#e2e9e6", preview: "rgba(17,26,31,.94)" },
        toolbar: { panel: "rgba(17,26,31,.97)", border: "rgba(226,233,230,.1)", item: "#c6d2d0", itemHover: "rgba(125,178,191,.09)", activeBg: "rgba(125,178,191,.14)", activeText: "#f2f7f5" },
        spatial: { surface: "rgba(19,28,33,.86)", elevated: "rgba(15,24,29,.97)", dropzone: "rgba(10,16,20,.9)" },
        timeline: {
            trackFill: "#10181d",
            clipVideo: "rgba(226,118,106,.2)",
            clipAudio: "rgba(125,178,191,.2)",
            clipSubtitle: "rgba(217,184,120,.2)",
            clipSelectedBorder: "#e2e9e6",
            playhead: "#e2594b",
            rulerLabel: "#93a3a6",
        },
        accent: { primary: "#e2e9e6", primarySoft: "rgba(226,233,230,.1)", onPrimary: "#0e161b", danger: "#e2594b" },
    },
};

// 新建画布会把预设值快照进画布数据，所以改预设只影响之后新建的画布；老画布在画布外观里手动换。
export const XIANGUAN_CANVAS_PRESETS = {
    light: { label: "月白", values: { baseTheme: "light", backgroundColor: "#EAF0EE", backgroundBrightness: 0, gridColor: "#1A343C", gridOpacity: 26 } },
    dark: { label: "夜观", values: { baseTheme: "dark", backgroundColor: "#0A1014", backgroundBrightness: 0, gridColor: "#CFE0E4", gridOpacity: 24 } },
} satisfies NonNullable<NonNullable<ThemePack["canvas"]>["presets"]>;
