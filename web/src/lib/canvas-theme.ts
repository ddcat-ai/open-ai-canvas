export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasThemes = {
    light: {
        canvas: {
            background: "#ffffff",
            dot: "rgba(15,23,42,.14)",
            line: "rgba(15,23,42,.065)",
            selectionFill: "rgba(79,110,232,.10)",
        },
        node: {
            label: "#4b5563",
            fill: "#ffffff",
            panel: "#ffffff",
            stroke: "#e2e4e8",
            activeStroke: "#111827",
            placeholder: "#9ca3af",
            text: "#111827",
            muted: "#6b7280",
            faint: "#9ca3af",
        },
        frame: {
            fill: "rgba(17,24,39,.025)",
            stroke: "rgba(17,24,39,.18)",
            activeFill: "rgba(79,110,232,.05)",
            activeStroke: "#4f6ee8",
            preview: "rgba(255,255,255,.82)",
        },
        toolbar: {
            panel: "rgba(255,255,255,.94)",
            border: "rgba(17,24,39,.10)",
            item: "#4b5563",
            itemHover: "rgba(17,24,39,.06)",
            activeBg: "rgba(17,24,39,.10)",
            activeText: "#111827",
        },
        spatial: {
            surface: "rgba(255,255,255,.72)",
            elevated: "rgba(255,255,255,.94)",
            dropzone: "rgba(248,250,252,.78)",
            glow: "rgba(79,110,232,.18)",
            glowStrong: "rgba(79,110,232,.52)",
            shadow: "rgba(15,23,42,.18)",
        },
        accent: {
            primary: "#4f6ee8",
            primarySoft: "rgba(79,110,232,.14)",
            danger: "#f87171",
        },
    },
    dark: {
        canvas: {
            background: "#090a0c",
            dot: "rgba(174,184,199,.18)",
            line: "rgba(174,184,199,.06)",
            selectionFill: "rgba(96,126,234,.18)",
        },
        node: {
            label: "#a3a3a3",
            fill: "#181818",
            panel: "#141414",
            stroke: "rgba(255,255,255,.12)",
            activeStroke: "#f1f1f1",
            placeholder: "#737373",
            text: "#ededed",
            muted: "#a3a3a3",
            faint: "#666666",
        },
        frame: {
            fill: "rgba(255,255,255,.025)",
            stroke: "rgba(190,198,210,.15)",
            activeFill: "rgba(96,126,234,.1)",
            activeStroke: "#8f9bd6",
            preview: "rgba(20,20,20,.94)",
        },
        toolbar: {
            panel: "rgba(20,20,20,.97)",
            border: "rgba(255,255,255,.1)",
            item: "#d4d4d4",
            itemHover: "rgba(255,255,255,.07)",
            activeBg: "rgba(143,155,214,.14)",
            activeText: "#f5f6f8",
        },
        spatial: {
            surface: "rgba(22,22,22,.82)",
            elevated: "rgba(15,15,15,.97)",
            dropzone: "rgba(8,8,8,.9)",
            glow: "rgba(107,120,190,.18)",
            glowStrong: "rgba(143,155,214,.48)",
            shadow: "rgba(0,0,0,.6)",
        },
        accent: {
            primary: "#8f9bd6",
            primarySoft: "rgba(107,120,190,.2)",
            danger: "#fb7185",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
