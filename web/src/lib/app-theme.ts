import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

const neutral = {
    light: {
        primary: "#171717",
        primaryHover: "#000000",
        primaryText: "#ffffff",
        menuBg: "#f5f5f5",
        menuText: "#171717",
        selectActiveBg: "#f5f5f5",
        selectSelectedBg: "#f0f0f0",
        selectText: "#171717",
        tableSelectedBg: "rgba(17, 17, 17, 0.05)",
        tableSelectedHoverBg: "rgba(17, 17, 17, 0.08)",
    },
    dark: {
        primary: "#fafafa",
        primaryHover: "#ffffff",
        primaryText: "#171717",
        menuBg: "#262626",
        menuText: "#fafafa",
        selectActiveBg: "#262626",
        selectSelectedBg: "#333333",
        selectText: "#fafafa",
        tableSelectedBg: "rgba(255, 255, 255, 0.08)",
        tableSelectedHoverBg: "rgba(255, 255, 255, 0.12)",
    },
};

export function getAntThemeConfig(dark: boolean): ThemeConfig {
    const color = dark ? neutral.dark : neutral.light;
    const elevatedBackground = dark ? "rgba(31, 31, 32, 0.96)" : "rgba(255, 255, 255, 0.96)";
    const subtleBackground = dark ? "rgba(255, 255, 255, 0.055)" : "rgba(17, 17, 17, 0.035)";
    const interactiveBorder = dark ? "rgba(255, 255, 255, 0.18)" : "rgba(17, 17, 17, 0.18)";
    const focusShadow = dark ? "0 0 0 3px rgba(116, 133, 238, 0.16)" : "0 0 0 3px rgba(17, 17, 17, 0.08)";

    return {
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        cssVar: { key: dark ? "infinite-canvas-dark" : "infinite-canvas-light" },
        token: {
            colorPrimary: color.primary,
            colorInfo: color.primary,
            colorLink: color.primary,
            colorLinkHover: color.primaryHover,
            colorLinkActive: color.primary,
            colorTextLightSolid: color.primaryText,
            colorBgElevated: elevatedBackground,
            colorBorderSecondary: dark ? "rgba(255, 255, 255, 0.1)" : "rgba(17, 17, 17, 0.09)",
            boxShadowSecondary: dark ? "0 24px 72px rgba(0, 0, 0, 0.48)" : "0 22px 64px rgba(15, 23, 42, 0.14)",
            borderRadius: 6,
            borderRadiusLG: 8,
            borderRadiusSM: 5,
            controlHeight: 34,
            controlHeightLG: 40,
            controlHeightSM: 28,
            motionDurationFast: "0.12s",
            motionDurationMid: "0.18s",
            motionDurationSlow: "0.24s",
        },
        components: {
            Button: {
                primaryShadow: "none",
                ...(dark
                    ? {
                          colorPrimary: "#5b6ee1",
                          colorPrimaryHover: "#7485ee",
                          colorPrimaryActive: "#4657c5",
                          primaryColor: "#ffffff",
                          defaultBg: "#262626",
                          defaultColor: "#f5f5f4",
                          defaultBorderColor: "#404040",
                          defaultHoverBg: "#303030",
                          defaultHoverColor: "#ffffff",
                          defaultHoverBorderColor: "#525252",
                          defaultActiveBg: "#1f1f1f",
                          defaultActiveColor: "#ffffff",
                          defaultActiveBorderColor: "#525252",
                      }
                    : {}),
            },
            Input: {
                activeBg: elevatedBackground,
                hoverBg: elevatedBackground,
                activeBorderColor: interactiveBorder,
                hoverBorderColor: interactiveBorder,
                activeShadow: focusShadow,
            },
            InputNumber: {
                activeBg: elevatedBackground,
                hoverBg: elevatedBackground,
                activeBorderColor: interactiveBorder,
                hoverBorderColor: interactiveBorder,
                activeShadow: focusShadow,
            },
            Switch: {
                handleBg: dark ? "#fafafa" : "#ffffff",
                handleShadow: dark ? "0 1px 4px rgba(0, 0, 0, 0.42)" : "0 1px 2px rgba(0, 0, 0, 0.2)",
                ...(dark
                    ? {
                          colorPrimary: "#5b6ee1",
                          colorPrimaryHover: "#7485ee",
                          colorTextQuaternary: "rgba(255, 255, 255, 0.18)",
                          colorTextTertiary: "rgba(255, 255, 255, 0.26)",
                      }
                    : {}),
            },
            Menu: {
                itemActiveBg: color.menuBg,
                itemHoverBg: color.menuBg,
                itemSelectedBg: color.menuBg,
                itemSelectedColor: color.menuText,
                darkItemHoverBg: neutral.dark.menuBg,
                darkItemSelectedBg: neutral.dark.menuBg,
                darkItemSelectedColor: neutral.dark.menuText,
            },
            Select: {
                selectorBg: elevatedBackground,
                activeBorderColor: interactiveBorder,
                hoverBorderColor: interactiveBorder,
                activeOutlineColor: dark ? "rgba(116, 133, 238, 0.16)" : "rgba(17, 17, 17, 0.08)",
                optionActiveBg: color.selectActiveBg,
                optionSelectedBg: color.selectSelectedBg,
                optionSelectedColor: color.selectText,
            },
            Table: {
                headerBg: subtleBackground,
                headerColor: dark ? "rgba(250, 250, 250, 0.62)" : "rgba(23, 23, 23, 0.58)",
                headerBorderRadius: 0,
                rowHoverBg: dark ? "rgba(255, 255, 255, 0.035)" : "rgba(17, 17, 17, 0.025)",
                borderColor: dark ? "rgba(255, 255, 255, 0.08)" : "rgba(17, 17, 17, 0.075)",
                cellPaddingBlockMD: 13,
                cellPaddingInlineMD: 14,
                rowSelectedBg: color.tableSelectedBg,
                rowSelectedHoverBg: color.tableSelectedHoverBg,
            },
            Pagination: {
                itemBg: "transparent",
                itemLinkBg: "transparent",
                itemActiveBg: dark ? "#fafafa" : "#171717",
                itemActiveColor: dark ? "#171717" : "#ffffff",
                itemActiveColorHover: dark ? "#171717" : "#ffffff",
            },
            Segmented: {
                trackBg: subtleBackground,
                trackPadding: 3,
                itemSelectedBg: elevatedBackground,
                itemSelectedColor: dark ? "#fafafa" : "#171717",
                itemHoverBg: dark ? "rgba(255, 255, 255, 0.07)" : "rgba(17, 17, 17, 0.055)",
            },
            Modal: {
                headerBg: "transparent",
                contentBg: elevatedBackground,
                footerBg: "transparent",
                titleFontSize: 16,
            },
            Form: {
                itemMarginBottom: 18,
                labelFontSize: 12,
                verticalLabelPadding: "0 0 6px",
            },
            Dropdown: {
                paddingBlock: 6,
            },
            Card: {
                headerBg: "transparent",
                headerFontSize: 15,
                bodyPadding: 18,
            },
        },
    };
}
