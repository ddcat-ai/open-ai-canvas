import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

import { getSkinAntOverrides, normalizeSkinID } from "@/lib/skin-themes";

// 主操作、普通选择和开关是不同交互语义，必须各自维护成对的背景/前景色。
const controlTheme = {
    light: {
        solidBg: "#171717",
        solidHoverBg: "#303030",
        solidActiveBg: "#404040",
        solidFg: "#ffffff",
        checkBg: "#171717",
        checkHoverBg: "#303030",
        checkActiveBg: "#404040",
        checkFg: "#ffffff",
        switchCheckedBg: "#16a34a",
        switchCheckedHoverBg: "#15803d",
        switchCheckedHandle: "#ffffff",
        selectedBg: "rgba(17, 17, 17, 0.09)",
        selectedHoverBg: "rgba(17, 17, 17, 0.13)",
        selectedActiveBg: "rgba(17, 17, 17, 0.16)",
        selectedFg: "#171717",
        controlSurface: "#ffffff",
        controlBorder: "rgba(17, 17, 17, 0.18)",
        controlDisabledBg: "rgba(17, 17, 17, 0.05)",
        controlDisabledFg: "rgba(17, 17, 17, 0.36)",
        controlFocus: "rgba(17, 17, 17, 0.24)",
        switchOffBg: "#b8b8b8",
        switchOffHoverBg: "#9f9f9f",
        switchOffHandle: "#ffffff",
        success: "#16a34a",
        warning: "#d97706",
        danger: "#dc2626",
        dangerHover: "#b91c1c",
        dangerActive: "#991b1b",
        dangerForeground: "#ffffff",
        info: "#2563eb",
        menuBg: "#f5f5f5",
        menuText: "#171717",
        selectActiveBg: "rgba(17, 17, 17, 0.035)",
        selectSelectedBg: "rgba(17, 17, 17, 0.065)",
        selectText: "#171717",
        tableSelectedBg: "rgba(17, 17, 17, 0.05)",
        tableSelectedHoverBg: "rgba(17, 17, 17, 0.08)",
    },
    dark: {
        solidBg: "#f5f5f5",
        solidHoverBg: "#ffffff",
        solidActiveBg: "#e5e5e5",
        solidFg: "#171717",
        checkBg: "#f5f5f5",
        checkHoverBg: "#ffffff",
        checkActiveBg: "#e5e5e5",
        checkFg: "#131313",
        switchCheckedBg: "#22c55e",
        switchCheckedHoverBg: "#4ade80",
        switchCheckedHandle: "#071a0f",
        selectedBg: "rgba(255, 255, 255, 0.12)",
        selectedHoverBg: "rgba(255, 255, 255, 0.16)",
        selectedActiveBg: "rgba(255, 255, 255, 0.2)",
        selectedFg: "#f5f5f5",
        controlSurface: "rgba(255, 255, 255, 0.035)",
        controlBorder: "rgba(255, 255, 255, 0.24)",
        controlDisabledBg: "rgba(255, 255, 255, 0.06)",
        controlDisabledFg: "rgba(255, 255, 255, 0.38)",
        controlFocus: "rgba(255, 255, 255, 0.24)",
        switchOffBg: "#525252",
        switchOffHoverBg: "#686868",
        switchOffHandle: "#f5f5f5",
        success: "#4ade80",
        warning: "#fbbf24",
        danger: "#f87171",
        dangerHover: "#fca5a5",
        dangerActive: "#ef4444",
        dangerForeground: "#2b0808",
        info: "#60a5fa",
        menuBg: "#262626",
        menuText: "#fafafa",
        selectActiveBg: "rgba(255, 255, 255, 0.055)",
        selectSelectedBg: "rgba(255, 255, 255, 0.09)",
        selectText: "#fafafa",
        tableSelectedBg: "rgba(255, 255, 255, 0.08)",
        tableSelectedHoverBg: "rgba(255, 255, 255, 0.12)",
    },
};

export function getAntThemeConfig(dark: boolean, skinID: unknown = "classic"): ThemeConfig {
    const baseColor = dark ? controlTheme.dark : controlTheme.light;
    const skin = getSkinAntOverrides(skinID, dark ? "dark" : "light");
    const color = {
        ...baseColor,
        solidBg: skin.primary || baseColor.solidBg,
        solidHoverBg: skin.primaryHover || baseColor.solidHoverBg,
        solidActiveBg: skin.primaryActive || baseColor.solidActiveBg,
        solidFg: skin.primaryForeground || baseColor.solidFg,
        checkBg: skin.primary || baseColor.checkBg,
        checkHoverBg: skin.primaryHover || baseColor.checkHoverBg,
        checkActiveBg: skin.primaryActive || baseColor.checkActiveBg,
        checkFg: skin.primaryForeground || baseColor.checkFg,
        switchCheckedBg: skin.switchChecked || baseColor.switchCheckedBg,
        switchCheckedHoverBg: skin.switchCheckedHover || baseColor.switchCheckedHoverBg,
        switchCheckedHandle: skin.switchCheckedHandle || baseColor.switchCheckedHandle,
        selectedBg: skin.selected || baseColor.selectedBg,
        selectedHoverBg: skin.selectedHover || baseColor.selectedHoverBg,
        selectedActiveBg: skin.selectedActive || baseColor.selectedActiveBg,
        selectedFg: skin.selectedForeground || baseColor.selectedFg,
        controlBorder: skin.controlBorder || baseColor.controlBorder,
        controlFocus: skin.controlFocus || baseColor.controlFocus,
        menuBg: skin.menuBackground || baseColor.menuBg,
        menuText: skin.menuForeground || baseColor.menuText,
        selectActiveBg: skin.selected || baseColor.selectActiveBg,
        selectSelectedBg: skin.selectedHover || baseColor.selectSelectedBg,
        selectText: skin.selectedForeground || baseColor.selectText,
        tableSelectedBg: skin.selected || baseColor.tableSelectedBg,
        tableSelectedHoverBg: skin.selectedHover || baseColor.tableSelectedHoverBg,
        controlSurface: skin.controlSurface || baseColor.controlSurface,
        controlDisabledBg: skin.controlDisabledBackground || baseColor.controlDisabledBg,
        controlDisabledFg: skin.controlDisabledForeground || baseColor.controlDisabledFg,
        switchOffBg: skin.switchUnchecked || baseColor.switchOffBg,
        switchOffHoverBg: skin.switchUncheckedHover || baseColor.switchOffHoverBg,
        switchOffHandle: skin.switchUncheckedHandle || baseColor.switchOffHandle,
        success: skin.success || baseColor.success,
        warning: skin.warning || baseColor.warning,
        danger: skin.danger || baseColor.danger,
        dangerHover: skin.dangerHover || baseColor.dangerHover,
        dangerActive: skin.dangerActive || baseColor.dangerActive,
        dangerForeground: skin.dangerForeground || baseColor.dangerForeground,
        info: skin.info || baseColor.info,
    };
    // 浮层背景必须不透明（0.96 会透出下层内容）；与侧栏切换器等自定义浮层的实底背景保持一致
    const elevatedBackground = skin.elevatedBackground || (dark ? "rgba(31, 31, 32, 1)" : "rgba(255, 255, 255, 1)");
    const subtleBackground = skin.subtleBackground || (dark ? "rgba(255, 255, 255, 0.055)" : "rgba(17, 17, 17, 0.035)");
    const interactiveBorder = skin.controlBorder || (dark ? "rgba(255, 255, 255, 0.18)" : "rgba(17, 17, 17, 0.18)");
    // 信息提示使用独立的浅色/深色表面，不能复用主操作的纯黑/纯白色；
    // 否则 Ant Design 会根据 colorInfo 生成近似纯黑的浅色主题背景，造成文字对比度失效。
    const infoBackground = dark ? "rgba(255, 255, 255, 0.08)" : "rgba(17, 17, 17, 0.045)";
    const infoBackgroundHover = dark ? "rgba(255, 255, 255, 0.11)" : "rgba(17, 17, 17, 0.07)";
    const infoBorder = dark ? "rgba(255, 255, 255, 0.2)" : "rgba(17, 17, 17, 0.14)";
    const infoAccent = color.info;
    // 黑白主题使用边框表达焦点，避免输入控件周围出现蓝紫色光圈。
    const focusShadow = "none";

    return {
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        cssVar: { key: `yingce-${normalizeSkinID(skinID)}-${dark ? "dark" : "light"}` },
        token: {
            colorPrimary: color.solidBg,
            colorPrimaryHover: color.solidHoverBg,
            colorPrimaryActive: color.solidActiveBg,
            colorPrimaryBg: color.selectedBg,
            colorPrimaryBgHover: color.selectedHoverBg,
            colorInfoBg: skin.selected || infoBackground,
            colorInfoBgHover: skin.selectedHover || infoBackgroundHover,
            colorInfoBorder: infoBorder,
            colorInfoBorderHover: infoBorder,
            colorInfo: infoAccent,
            colorInfoHover: dark ? "#ffffff" : "#27272a",
            colorInfoActive: dark ? "#d4d4d8" : "#52525b",
            colorInfoTextHover: dark ? "#fafafa" : "#27272a",
            colorInfoText: dark ? "#f4f4f5" : "#27272a",
            colorInfoTextActive: dark ? "#e4e4e7" : "#3f3f46",
            colorLink: color.solidBg,
            colorLinkHover: color.solidHoverBg,
            colorLinkActive: color.solidActiveBg,
            colorTextLightSolid: color.solidFg,
            controlOutlineWidth: 0,
            colorText: skin.text || undefined,
            colorTextSecondary: skin.textMuted || undefined,
            colorIcon: skin.icon || undefined,
            colorIconHover: skin.iconHover || undefined,
            colorSuccess: color.success,
            colorWarning: color.warning,
            colorError: color.danger,
            colorErrorHover: color.dangerHover,
            colorErrorActive: color.dangerActive,
            colorErrorText: color.danger,
            colorErrorTextHover: color.dangerHover,
            colorErrorTextActive: color.dangerActive,
            colorBgElevated: elevatedBackground,
            colorBgContainer: skin.controlSurface || undefined,
            colorBorderSecondary: dark ? "rgba(255, 255, 255, 0.1)" : "rgba(17, 17, 17, 0.09)",
            // 浮层阴影两层：贴边的小阴影交代边缘，大而淡的阴影交代悬浮高度。
            boxShadowSecondary:
                skin.shadowStyle === "none"
                    ? "none"
                    : skin.shadowStyle === "strong"
                      ? dark ? "0 1px 3px rgba(0, 0, 0, 0.5), 0 28px 84px rgba(0, 0, 0, 0.6)" : "0 1px 3px rgba(15, 23, 42, 0.12), 0 26px 72px rgba(15, 23, 42, 0.2)"
                      : dark ? "0 1px 2px rgba(0, 0, 0, 0.4), 0 24px 64px rgba(0, 0, 0, 0.44)" : "0 1px 2px rgba(15, 23, 42, 0.08), 0 20px 56px rgba(15, 23, 42, 0.12)",
            // 圆角四档 4/8/12/16：控件 8、卡片与浮层 12、弹窗 16、小元素 4。
            borderRadius: skin.borderRadius || 8,
            borderRadiusLG: skin.borderRadiusLG || 12,
            borderRadiusSM: skin.borderRadiusSM || 4,
            lineWidth: skin.borderWidth || 1,
            controlHeight: skin.controlHeight || 36,
            controlHeightLG: skin.controlHeightLarge || 42,
            controlHeightSM: skin.controlHeightSmall || 30,
            fontSize: 13,
            fontSizeSM: 12,
            motionDurationFast: `${Math.max(skin.motionFast ?? 150, 150)}ms`,
            motionDurationMid: `${skin.motionNormal ?? 180}ms`,
            motionDurationSlow: `${Math.min(Math.max(skin.motionNormal ?? 180, 240), 250)}ms`,
        },
        components: {
            // 按钮统一规范见 docs/ui-design-system.md §3.0：三套主题（根 / 用户工作台 / 后台）只在高度上
            // 区分密度，圆角、字号字重、内边距、图标间距和默认配色同值。颜色取 globals.css 的 --button-*，
            // 主按钮与危险实心按钮的实底和质感阴影由 primary-buttons.css 接管，这里的阴影 token 保持 none。
            Button: {
                defaultShadow: "none",
                primaryShadow: "none",
                dangerShadow: "none",
                dangerColor: "var(--button-danger-fg)",
                fontWeight: skin.buttonFontWeight || 500,
                borderRadius: skin.buttonRadius || skin.borderRadius || 8,
                borderRadiusSM: skin.buttonRadius || skin.borderRadius || 8,
                borderRadiusLG: skin.buttonRadius || skin.borderRadius || 8,
                contentFontSize: 13,
                contentFontSizeSM: 12,
                contentFontSizeLG: 14,
                paddingInline: 12,
                paddingInlineLG: 16,
                paddingInlineSM: 8,
                iconGap: 6,
                onlyIconSize: 16,
                onlyIconSizeSM: 14,
                onlyIconSizeLG: 16,
                colorPrimary: color.solidBg,
                colorPrimaryHover: color.solidHoverBg,
                colorPrimaryActive: color.solidActiveBg,
                primaryColor: color.solidFg,
                defaultBg: skin.controlSurface || "var(--button-secondary-bg)",
                defaultColor: skin.selectedForeground || "var(--button-secondary-fg)",
                defaultBorderColor: skin.controlBorder || "var(--button-secondary-border)",
                defaultHoverBg: skin.controlHover || "var(--button-secondary-hover-bg)",
                defaultHoverColor: skin.selectedForeground || "var(--button-secondary-fg)",
                defaultHoverBorderColor: skin.controlBorder || "var(--button-secondary-hover-border)",
                defaultActiveBg: skin.controlActive || "var(--button-secondary-active-bg)",
                defaultActiveColor: skin.selectedForeground || "var(--button-secondary-fg)",
                defaultActiveBorderColor: skin.controlBorder || "var(--button-secondary-hover-border)",
                defaultBgDisabled: "var(--button-secondary-bg)",
                textTextColor: "var(--button-ghost-fg)",
                textTextHoverColor: "var(--button-ghost-hover-fg)",
                textTextActiveColor: "var(--button-ghost-hover-fg)",
                textHoverBg: "var(--button-ghost-hover-bg)",
                // antd 6 文字按钮按下态取 colorFill（color-light-active）。
                colorFill: "var(--button-ghost-active-bg)",
            },
            Input: {
                borderRadius: skin.inputRadius || 8,
                paddingInline: 12,
                activeBg: skin.controlSurface || elevatedBackground,
                hoverBg: skin.controlHover || elevatedBackground,
                activeBorderColor: "transparent",
                hoverBorderColor: "transparent",
                activeShadow: "none",
            },
            InputNumber: {
                borderRadius: skin.inputRadius || 8,
                activeBg: skin.controlSurface || elevatedBackground,
                hoverBg: skin.controlHover || elevatedBackground,
                activeBorderColor: "transparent",
                hoverBorderColor: "transparent",
                activeShadow: "none",
            },
            DatePicker: {
                activeShadow: focusShadow,
                activeBorderColor: interactiveBorder,
                hoverBorderColor: interactiveBorder,
            },
            Switch: {
                handleBg: color.switchOffHandle,
                handleShadow: dark ? "0 1px 4px rgba(0, 0, 0, 0.42)" : "0 1px 2px rgba(0, 0, 0, 0.2)",
                colorPrimary: color.switchCheckedBg,
                colorPrimaryActive: color.switchCheckedBg,
                colorPrimaryHover: color.switchCheckedHoverBg,
                colorTextQuaternary: color.switchOffBg,
                colorTextTertiary: color.switchOffHoverBg,
                controlOutline: color.controlFocus,
            },
            Checkbox: {
                borderRadiusSM: skin.checkboxRadius || 4,
                colorBgContainer: color.controlSurface,
                colorBgContainerDisabled: color.controlDisabledBg,
                colorBorder: color.controlBorder,
                colorPrimary: color.checkBg,
                colorPrimaryActive: color.checkActiveBg,
                colorPrimaryHover: color.checkHoverBg,
                // antd 用 colorWhite 画勾；暗色主题勾选底接近白色，必须跟随前景色，否则白勾压白底看不见。
                colorWhite: color.checkFg,
                controlOutline: color.controlFocus,
            },
            Radio: {
                radioSize: 16,
                dotSize: 6,
                buttonBg: color.controlSurface,
                buttonCheckedBg: color.selectedBg,
                buttonCheckedBgDisabled: color.controlDisabledBg,
                buttonCheckedColorDisabled: color.controlDisabledFg,
                buttonSolidCheckedColor: color.checkFg,
                buttonSolidCheckedActiveBg: color.checkActiveBg,
                buttonSolidCheckedBg: color.checkBg,
                buttonSolidCheckedHoverBg: color.checkHoverBg,
                colorBgContainer: color.controlSurface,
                colorBgContainerDisabled: color.controlDisabledBg,
                colorBorder: color.controlBorder,
                colorPrimary: color.checkBg,
                colorPrimaryActive: color.checkActiveBg,
                colorPrimaryHover: color.checkHoverBg,
                controlOutline: color.controlFocus,
            },
            Menu: {
                itemBorderRadius: skin.menuRadius || skin.borderRadius || 8,
                subMenuItemBorderRadius: skin.menuRadius || skin.borderRadius || 8,
                itemHeight: 40,
                itemMarginBlock: 2,
                itemActiveBg: color.menuBg,
                itemHoverBg: color.menuBg,
                itemSelectedBg: color.menuBg,
                itemSelectedColor: color.menuText,
                darkItemHoverBg: controlTheme.dark.menuBg,
                darkItemSelectedBg: controlTheme.dark.menuBg,
                darkItemSelectedColor: controlTheme.dark.menuText,
            },
            Select: {
                borderRadius: skin.inputRadius || 8,
                selectorBg: elevatedBackground,
                optionHeight: 40,
                optionPadding: "8px 12px",
                multipleItemHeight: 24,
                activeBorderColor: interactiveBorder,
                hoverBorderColor: interactiveBorder,
                activeOutlineColor: "transparent",
                optionActiveBg: color.selectActiveBg,
                optionSelectedBg: color.selectSelectedBg,
                optionSelectedColor: color.selectText,
            },
            Table: {
                headerBg: subtleBackground,
                headerColor: skin.textMuted || (dark ? "rgba(250, 250, 250, 0.62)" : "rgba(23, 23, 23, 0.58)"),
                headerBorderRadius: 0,
                rowHoverBg: skin.controlHover || (dark ? "rgba(255, 255, 255, 0.035)" : "rgba(17, 17, 17, 0.025)"),
                borderColor: skin.controlBorder || (dark ? "rgba(255, 255, 255, 0.08)" : "rgba(17, 17, 17, 0.075)"),
                cellPaddingBlockMD: 12,
                cellPaddingInlineMD: 16,
                rowSelectedBg: color.tableSelectedBg,
                rowSelectedHoverBg: color.tableSelectedHoverBg,
            },
            Pagination: {
                itemBg: "transparent",
                itemLinkBg: "transparent",
                itemActiveBg: color.solidBg,
                itemActiveColor: color.solidFg,
                itemActiveColorHover: color.solidFg,
            },
            Segmented: {
                borderRadius: skin.inputRadius || 8,
                trackBg: subtleBackground,
                trackPadding: 2,
                itemColor: color.controlDisabledFg,
                itemHoverColor: color.selectedFg,
                itemHoverBg: color.selectedBg,
                itemActiveBg: color.selectedActiveBg,
                itemSelectedBg: color.selectedBg,
                itemSelectedColor: color.selectedFg,
            },
            Modal: {
                borderRadiusLG: skin.overlayRadius || 16,
                headerBg: "transparent",
                contentBg: elevatedBackground,
                footerBg: "transparent",
                titleFontSize: 16,
            },
            Form: {
                // 24px 正好容纳一行报错（12px × 1.57 ≈ 19px + 间距），出现报错时不推动下方输入框。
                itemMarginBottom: 24,
                labelFontSize: 12,
                verticalLabelPadding: "0 0 8px",
            },
            Dropdown: {
                paddingBlock: 8,
            },
            Skeleton: {
                gradientFromColor: dark ? "rgba(255, 255, 255, 0.055)" : "rgba(15, 23, 42, 0.055)",
                gradientToColor: dark ? "rgba(255, 255, 255, 0.11)" : "rgba(15, 23, 42, 0.1)",
            },
            Card: {
                borderRadiusLG: skin.borderRadiusLG || 12,
                headerBg: "transparent",
                headerFontSize: 16,
                bodyPadding: 16,
            },
            Message: {
                contentBg: elevatedBackground,
                contentPadding: "8px 16px",
            },
            Notification: {
                colorBgElevated: elevatedBackground,
            },
            Tooltip: {
                colorBgSpotlight: elevatedBackground,
                colorTextLightSolid: color.selectedFg,
            },
            Popover: {
                colorBgElevated: elevatedBackground,
            },
        },
    };
}

/**
 * 管理后台使用更高密度的控件节奏；只在 AdminShell 内挂载，避免改变创作端的视觉契约。
 */
/** 用户端与后台共享业务控件，但使用独立的产品尺寸和柔和表面。 */
export function getWorkspaceAntThemeConfig(): ThemeConfig {
    return {
        // 控件尺度与 globals.css 的 --user-control-height / --user-radius-button 保持同值：
        // 34px 常规、28px 紧凑、8px 圆角；按钮、输入框、选择器在同一工具栏里等高对齐。
        token: {
            borderRadius: 8, borderRadiusLG: 12, borderRadiusSM: 4,
            controlHeight: 34, controlHeightSM: 28, controlHeightLG: 40,
            // 进入 150–250ms；antd 的 Slow 用于浮层进出，不超过 250ms。
            motionDurationFast: "0.15s", motionDurationMid: "0.2s", motionDurationSlow: "0.25s",
            motionEaseInOut: "cubic-bezier(0.16, 1, 0.3, 1)",
            motionEaseOut: "cubic-bezier(0.16, 1, 0.3, 1)",
            // antd 默认 Back 曲线会越界（Checkbox 勾选、Badge 弹出像回弹），工作台统一不越界。
            motionEaseOutBack: "cubic-bezier(0.16, 1, 0.3, 1)",
            motionEaseInBack: "cubic-bezier(0.7, 0, 0.84, 0)",
        },
        components: {
            // 用户工作台与根主题、后台共用同一套按钮规范（docs/ui-design-system.md §3.0），这里只收紧高度。
            // 主按钮实底由 primary-buttons.css 接管；次要按钮是带 1px 边缘的实体键，文字按钮悬停才出现底色。
            Button: {
                borderRadius: 8, borderRadiusSM: 8, borderRadiusLG: 8,
                fontWeight: 500, contentFontSize: 13, contentFontSizeSM: 12, contentFontSizeLG: 14,
                paddingInline: 12, paddingInlineSM: 8, paddingInlineLG: 16,
                iconGap: 6, onlyIconSize: 16, onlyIconSizeSM: 14, onlyIconSizeLG: 16,
                defaultBg: "var(--button-secondary-bg)", defaultColor: "var(--button-secondary-fg)", defaultBorderColor: "var(--button-secondary-border)",
                defaultHoverBg: "var(--button-secondary-hover-bg)", defaultHoverColor: "var(--button-secondary-fg)", defaultHoverBorderColor: "var(--button-secondary-hover-border)",
                defaultActiveBg: "var(--button-secondary-active-bg)", defaultActiveColor: "var(--button-secondary-fg)", defaultActiveBorderColor: "var(--button-secondary-hover-border)",
                textTextColor: "var(--button-ghost-fg)", textTextHoverColor: "var(--button-ghost-hover-fg)", textTextActiveColor: "var(--button-ghost-hover-fg)",
                // antd 6 文字按钮按下态取 colorFill（color-light-active）。
                textHoverBg: "var(--button-ghost-hover-bg)", colorFill: "var(--button-ghost-active-bg)",
                defaultBgDisabled: "var(--button-secondary-bg)",
                defaultShadow: "none", primaryShadow: "none", dangerShadow: "none",
            },
            Input: {
                borderRadius: 8,
                paddingInline: 12,
                activeBorderColor: "transparent",
                hoverBorderColor: "transparent",
                activeShadow: "none",
            },
            InputNumber: {
                borderRadius: 8,
                activeBorderColor: "transparent",
                hoverBorderColor: "transparent",
                activeShadow: "none",
            },
            Select: {
                borderRadius: 8,
                colorBgElevated: "var(--user-surface-raised)", boxShadowSecondary: "none",
                colorFillTertiary: "var(--user-surface-muted)", colorFillSecondary: "var(--user-surface-hover)",
                activeOutlineColor: "transparent",
                optionSelectedBg: "var(--user-surface-hover)", optionSelectedColor: "var(--user-ink)",
                optionActiveBg: "var(--user-surface-muted)", optionPadding: "8px 12px",
            },
            Dropdown: { borderRadiusLG: 12, colorBgElevated: "var(--user-surface-raised)", boxShadowSecondary: "none", controlItemBgHover: "var(--user-surface-muted)", paddingBlock: 8 },
            Popover: { borderRadiusLG: 12, colorBgElevated: "var(--user-surface-raised)", boxShadowSecondary: "none" },
            Modal: { borderRadiusLG: 16 },
            Popconfirm: { borderRadiusLG: 12 },
            Message: { borderRadiusLG: 12, contentPadding: "8px 16px" },
            Notification: { borderRadiusLG: 12 },
            Tooltip: { borderRadius: 8 },
        },
    };
}

export function getAdminAntThemeConfig(dark: boolean, skinID: unknown = "classic"): ThemeConfig {
    const base = getAntThemeConfig(dark, skinID);
    const skin = getSkinAntOverrides(skinID, dark ? "dark" : "light");
    const mutedForeground = dark ? "rgba(250, 250, 250, 0.58)" : "rgba(23, 23, 23, 0.58)";

    return {
        ...base,
        token: {
            ...base.token,
            borderRadius: skin.borderRadius || 8,
            borderRadiusLG: skin.borderRadiusLG || 12,
            colorBgContainer: "var(--color-surface)",
            colorBorder: "var(--color-border)",
            fontFamily: "var(--font-sans)",
            padding: 12,
            paddingSM: 8,
            fontSize: 13,
        },
        components: {
            ...base.components,
            Card: {
                ...base.components?.Card,
                boxShadow: "none",
                boxShadowTertiary: "none",
            },
            Drawer: {
                ...base.components?.Drawer,
                colorBgElevated: "var(--color-surface)",
            },
            Form: {
                ...base.components?.Form,
                // 一行报错约 20px，留足位置，出现报错时不推动下方字段。
                itemMarginBottom: 20,
            },
            Menu: {
                ...base.components?.Menu,
                itemHeight: 34,
                itemSelectedBg: "transparent",
            },
            Table: {
                ...base.components?.Table,
                cellPaddingBlock: 8,
                cellPaddingBlockMD: 8,
                cellPaddingBlockSM: 6,
                cellPaddingInline: 12,
                cellPaddingInlineMD: 12,
                cellPaddingInlineSM: 8,
                headerBg: "transparent",
                headerColor: mutedForeground,
                headerSplitColor: "transparent",
                borderColor: "var(--color-border)",
            },
        },
    };
}
