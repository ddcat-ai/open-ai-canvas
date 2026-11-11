import type { ComponentType } from "react";

import type { CANVAS_APPEARANCE_PRESETS } from "@/lib/canvas/canvas-appearance";
import type { SkinDefinition } from "@/lib/skin-themes";

/**
 * 主题包：后台「皮肤主题」只存颜色、圆角和主按钮；字体、纹理、插图、助手形象、空状态图标、
 * 画布配色和少量界面文案由主题包补齐。主题包的 id 与后台皮肤 id 相同，后台启用该皮肤时生效。
 *
 * 每个主题包是 src/themes/<id>/ 下的一个文件夹：index.ts 调用 registerThemePack 登记自己，
 * 并引入本主题的样式（样式全部写在 html[data-skin="<id>"] 下）。静态文件放 public/themes/<id>/。
 */
export type ThemeAgentOrbState = "idle" | "work" | "done";

export type ThemeAgentOrbProps = { size: number; state: ThemeAgentOrbState; className?: string };

/** 空状态图标的画法：外层尺寸、入场动效由 WorkspaceSignalIcon 负责，这里只画 48×48 画布里的内容。 */
export type ThemeSignalArtProps = { path: string; dot: [number, number]; error: boolean; reducedMotion: boolean };

export type ThemeCanvasPatch = { [key: string]: string | ThemeCanvasPatch };

type CanvasPresetValues = (typeof CANVAS_APPEARANCE_PRESETS)[number]["values"];

export type ThemePack = {
    /** 与后台皮肤 id 一致，例如 longying-ink。 */
    id: string;
    name: string;
    /** 皮肤数据，安装脚本把它写进后台皮肤库。 */
    skin: SkinDefinition;
    /** 助手圆球（画布入口、首页 Agent 页签、后台外观预览）；不提供时用上游流光球。 */
    agentOrb?: ComponentType<ThemeAgentOrbProps>;
    /** 空状态 / 加载 / 错误图标的画法；不提供时用上游方框图标。 */
    signalArt?: ComponentType<ThemeSignalArtProps>;
    /** 顶栏积分图标；不提供时用上游礼盒。 */
    creditMark?: ComponentType<{ className?: string }>;
    notFound?: {
        /** 页面底部的背景装饰。 */
        backdrop?: ComponentType;
        /** 替换标题上方的图标。 */
        emblem?: ComponentType;
        title?: string;
        description?: string;
    };
    /** 画布配色：上游写死在代码里，启用皮肤时就地替换，切走时还原。 */
    canvas?: {
        themes: Record<"light" | "dark", ThemeCanvasPatch>;
        presets?: Partial<Record<"light" | "dark", { label: string; values: CanvasPresetValues }>>;
    };
    copy?: {
        /** 创作首页大标题，替换「和{品牌}聊聊创作想法」。 */
        homeHeading?: string;
        /** 登录面板标题，替换「欢迎来到{品牌}」。 */
        loginTitle?: string;
        /** 素材库为空时的三张示意图。 */
        assetsEmptyFrames?: ReadonlyArray<{ src: string; caption: string }>;
        /** 分享画布页落款印章里的字。 */
        sealGlyph?: string;
    };
};
