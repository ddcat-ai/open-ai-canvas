import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";
import { getSkinAntOverrides } from "@/lib/skin-themes";

/** 后台保留独立密度与表面，主操作颜色继承站点皮肤。 */
export function getIsolatedAdminAntTheme(dark: boolean, skinID: unknown = "classic"): ThemeConfig {
    const skin = getSkinAntOverrides(skinID, dark ? "dark" : "light");
    const text = dark ? "#f5f5f5" : "#111111";
    const textSecondary = dark ? "#c4c4c4" : "#525252";
    const canvas = dark ? "#111317" : "#f7f8fa";
    const surface = dark ? "#191c21" : "#ffffff";
    const surfaceMuted = dark ? "#23272e" : "#f2f4f7";
    const border = dark ? "rgba(245, 245, 245, 0.12)" : "rgba(17, 17, 17, 0.12)";
    const primary = skin.primary || (dark ? "#f5f5f5" : "#171717");
    const primaryFg = skin.primaryForeground || (dark ? "#171717" : "#ffffff");
    const hover = skin.primaryHover || (dark ? "#ffffff" : "#303030");
    const active = skin.primaryActive || (dark ? "#e5e5e5" : "#404040");
    const danger = dark ? "#f87171" : "#dc2626";
    const success = dark ? "#4ade80" : "#15803d";
    const warning = dark ? "#fbbf24" : "#b45309";
    const info = dark ? "#60a5fa" : "#2563eb";
    const switchOn = dark ? "#22c55e" : "#16a34a";
    const switchOff = dark ? "#3f4b5a" : "#cbd5e1";

    return {
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        cssVar: { key: `admin-console-${dark ? "dark" : "light"}` },
        token: {
            fontFamily: 'ui-sans-serif, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", system-ui, sans-serif',
            fontSize: 13,
            fontSizeSM: 12,
            borderRadius: 6,
            borderRadiusLG: 8,
            borderRadiusSM: 4,
            controlHeight: 32,
            controlHeightSM: 28,
            controlHeightLG: 36,
            lineWidth: 1,
            controlOutlineWidth: 0,
            colorPrimary: primary,
            colorPrimaryHover: hover,
            colorPrimaryActive: active,
            colorText: text,
            colorTextSecondary: textSecondary,
            colorTextTertiary: textSecondary,
            colorBgBase: canvas,
            colorBgContainer: surface,
            colorBgElevated: surface,
            colorBgLayout: canvas,
            colorBorder: border,
            colorBorderSecondary: border,
            colorSuccess: success,
            colorWarning: warning,
            colorError: danger,
            colorInfo: info,
            colorLink: text,
            colorLinkHover: hover,
            boxShadow: "none",
            boxShadowSecondary: dark ? "0 22px 56px rgba(0, 0, 0, 0.48)" : "0 16px 40px rgba(15, 23, 42, 0.16)",
            motionDurationFast: "0.12s",
            motionDurationMid: "0.12s",
            motionDurationSlow: "0.18s",
        },
        components: {
            Button: {
                borderRadius: 6,
                fontWeight: 550,
                paddingInline: 12,
                paddingInlineSM: 8,
                primaryShadow: "none",
                defaultShadow: "none",
                dangerShadow: "none",
                colorPrimary: primary,
                colorPrimaryHover: hover,
                colorPrimaryActive: active,
                defaultBg: surface,
                defaultColor: text,
                defaultBorderColor: border,
                defaultHoverBg: surfaceMuted,
                defaultHoverColor: text,
                defaultHoverBorderColor: border,
                primaryColor: primaryFg,
            },
            Input: {
                borderRadius: 6,
                activeShadow: "none",
                paddingInline: 10,
                activeBg: surface,
                hoverBg: surface,
            },
            InputNumber: {
                borderRadius: 6,
                activeShadow: "none",
                activeBg: surface,
                hoverBg: surface,
            },
            Select: {
                borderRadius: 6,
                activeOutlineColor: "transparent",
                optionPadding: "7px 10px",
                optionSelectedBg: surfaceMuted,
                optionActiveBg: surfaceMuted,
            },
            DatePicker: {
                activeShadow: "none",
            },
            Switch: {
                colorPrimary: switchOn,
                colorPrimaryHover: switchOn,
                colorTextQuaternary: switchOff,
                colorTextTertiary: switchOff,
            },
            Table: {
                headerBg: surfaceMuted,
                headerColor: textSecondary,
                headerSplitColor: "transparent",
                borderColor: border,
                rowHoverBg: surfaceMuted,
                cellPaddingBlock: 6,
                cellPaddingBlockMD: 6,
                cellPaddingBlockSM: 4,
                cellPaddingInline: 12,
                cellPaddingInlineSM: 8,
            },
            Tabs: {
                horizontalItemPadding: "8px 0",
                itemColor: textSecondary,
                itemSelectedColor: text,
                inkBarColor: text,
            },
            Drawer: {
                colorBgElevated: surface,
                paddingLG: 16,
            },
            Modal: {
                borderRadiusLG: 8,
                contentBg: surface,
                headerBg: surface,
            },
            Tooltip: {
                borderRadius: 6,
                colorBgSpotlight: dark ? "#f5f5f5" : "#111111",
                colorTextLightSolid: dark ? "#0f0f0f" : "#ffffff",
            },
            Dropdown: {
                borderRadiusLG: 8,
                controlItemBgHover: surfaceMuted,
                paddingBlock: 4,
            },
            Form: {
                itemMarginBottom: 14,
            },
            Segmented: {
                itemSelectedBg: surface,
                trackBg: surfaceMuted,
            },
            Card: {
                boxShadow: "none",
                boxShadowTertiary: "none",
            },
            Message: {
                borderRadiusLG: 8,
                contentPadding: "8px 14px",
            },
        },
    };
}
