import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";
import { appearanceLogoURL, useAppearanceStore } from "@/stores/use-appearance-store";
import { useThemeStore, type ThemeName } from "@/stores/use-theme-store";

type BrandLogoProps = {
    className?: string;
    fallback: ReactNode;
    alt?: string;
    theme?: ThemeName | "auto";
};

export function BrandLogo({ className, fallback, alt = "", theme = "auto" }: BrandLogoProps) {
    const appearance = useAppearanceStore((state) => state.appearance);
    const currentTheme = useThemeStore((state) => state.theme);
    if (!appearance.logoConfigured) return <>{fallback}</>;
    return <img src={appearanceLogoURL(appearance, theme === "auto" ? currentTheme : theme)} alt={alt} className={cn("block object-contain", className)} draggable={false} />;
}

export function BrandLogoFrame({ className, logoClassName, fallback, alt = "", theme = "auto" }: BrandLogoProps & { logoClassName?: string }) {
    const frameEnabled = useAppearanceStore((state) => state.appearance.logoFrameEnabled);
    const unframedStyle: CSSProperties | undefined = frameEnabled
        ? undefined
        : {
              background: "transparent",
              borderColor: "transparent",
              borderRadius: 0,
              boxShadow: "none",
              color: "inherit",
          };
    return (
        <span className={cn("brand-logo-frame", className)} data-logo-frame-enabled={frameEnabled} style={unframedStyle}>
            <BrandLogo className={logoClassName} fallback={fallback} alt={alt} theme={theme} />
        </span>
    );
}
