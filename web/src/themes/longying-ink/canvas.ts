import type { ThemeCanvasPatch, ThemePack } from "../types";

// 龙影水墨的画布配色：宣纸 / 夜墨。由主题支持（themes/apply.ts）在启用皮肤时套用、切走时还原。
export const INK_CANVAS_THEMES: Record<"light" | "dark", ThemeCanvasPatch> = {
    light: {
        connection: { stroke: "#a89e8d", beam: "#3d3832" },
        canvas: { background: "#efe9dd", dot: "rgba(70,55,35,.62)", line: "rgba(70,55,35,.55)", selectionFill: "rgba(31,28,24,.08)" },
        node: {
            label: "#5d564c",
            agentUserMessage: "#f1e6d8",
            fill: "#fbf8f2",
            panel: "#fbf8f2",
            stroke: "#ded4c2",
            edge: "rgba(62,46,24,.18)",
            shadow: "0 6px 18px rgba(62,46,24,.09)",
            hoverShadow: "0 10px 26px rgba(62,46,24,.14)",
            activeStroke: "#1f1c18",
            placeholder: "#a39b8d",
            text: "#1f1c18",
            muted: "#6b645a",
            faint: "#a39b8d",
        },
        frame: { fill: "rgba(62,46,24,.03)", stroke: "rgba(62,46,24,.2)", activeFill: "rgba(31,28,24,.05)", activeStroke: "#1f1c18", preview: "rgba(251,248,242,.86)" },
        toolbar: { panel: "rgba(251,248,242,.95)", border: "rgba(62,46,24,.12)", item: "#4e4840", itemHover: "rgba(62,46,24,.07)", activeBg: "rgba(62,46,24,.11)", activeText: "#1f1c18" },
        spatial: { surface: "rgba(251,248,242,.78)", elevated: "rgba(251,248,242,.96)", dropzone: "rgba(245,241,232,.82)", glow: "rgba(31,28,24,.14)", glowStrong: "rgba(31,28,24,.4)", shadow: "rgba(62,46,24,.18)" },
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
        accent: { primary: "#1f1c18", primarySoft: "rgba(31,28,24,.09)", onPrimary: "#f7f3ea", danger: "#b0392b" },
    },
    dark: {
        connection: { stroke: "#6f685c", beam: "#ece5d6" },
        canvas: { background: "#0e0d0b", dot: "rgba(236,229,214,.3)", line: "rgba(236,229,214,.28)", selectionFill: "rgba(236,229,214,.1)" },
        node: {
            label: "#a59d8e",
            agentUserMessage: "#2b2119",
            fill: "#1b1915",
            panel: "#171511",
            stroke: "rgba(236,229,214,.12)",
            edge: "rgba(236,229,214,.18)",
            activeStroke: "#ece5d6",
            placeholder: "#7c7466",
            text: "#ece5d6",
            muted: "#a59d8e",
            faint: "#6f685c",
        },
        frame: { fill: "rgba(236,229,214,.025)", stroke: "rgba(236,229,214,.15)", activeFill: "rgba(236,229,214,.07)", activeStroke: "#ece5d6", preview: "rgba(23,21,17,.94)" },
        toolbar: { panel: "rgba(23,21,17,.97)", border: "rgba(236,229,214,.1)", item: "#d2cabb", itemHover: "rgba(236,229,214,.07)", activeBg: "rgba(236,229,214,.1)", activeText: "#f7f1e4" },
        spatial: { surface: "rgba(27,25,21,.84)", elevated: "rgba(20,18,15,.97)", dropzone: "rgba(14,13,11,.9)" },
        timeline: {
            trackFill: "#141210",
            clipVideo: "rgba(208,99,108,.2)",
            clipAudio: "rgba(107,176,187,.2)",
            clipSubtitle: "rgba(217,166,80,.2)",
            clipSelectedBorder: "#ece5d6",
            playhead: "#e2765b",
            rulerLabel: "#a59d8e",
        },
        accent: { primary: "#ece5d6", primarySoft: "rgba(236,229,214,.1)", onPrimary: "#16140f", danger: "#e2735c" },
    },
};

// 新建画布会把预设值快照进画布数据，所以改预设只影响之后新建的画布；老画布在画布外观里手动换。
export const INK_CANVAS_PRESETS = {
    light: { label: "宣纸", values: { baseTheme: "light", backgroundColor: "#EFE9DD", backgroundBrightness: 0, gridColor: "#463723", gridOpacity: 30 } },
    dark: { label: "夜墨", values: { baseTheme: "dark", backgroundColor: "#0E0D0B", backgroundBrightness: 0, gridColor: "#ECE5D6", gridOpacity: 26 } },
} satisfies NonNullable<NonNullable<ThemePack["canvas"]>["presets"]>;
