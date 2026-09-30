// 站点外观设置的素材选择、Logo 主题预览、骨架屏与草稿校验。

import { type AdminAppearance, type AppearanceAssetSlot } from "@/services/api/appearance";
import { type ReactNode, type RefObject, useEffect, useMemo } from "react";
import { Image as ImageIcon, MonitorPlay, Upload } from "lucide-react";
import { Button, Skeleton } from "antd";
import { DEFAULT_PUBLIC_APPEARANCE } from "@/stores/use-appearance-store";
import { cn } from "@/lib/utils";
import { isSkinButtonFill, type SkinDefinition } from "@/lib/skin-themes";

export type DraftFiles = Record<AppearanceAssetSlot, File | null>;

export type ResetState = Record<AppearanceAssetSlot, boolean>;

export const FILE_RULES: Record<AppearanceAssetSlot, { accept: string; maxBytes: number; label: string }> = {
    logo: { accept: "image/png,image/jpeg,image/webp", maxBytes: 5 << 20, label: "浅色模式 Logo" },
    "logo-dark": { accept: "image/png,image/jpeg,image/webp", maxBytes: 5 << 20, label: "深色模式 Logo" },
    poster: { accept: "image/png,image/jpeg,image/webp", maxBytes: 10 << 20, label: "视频封面" },
    video: { accept: "video/mp4,video/webm", maxBytes: 256 << 20, label: "品牌视频" },
};

export function AssetPicker({
    slot,
    title,
    description,
    configured,
    file,
    inputRef,
    onSelect,
    onReset,
    disabled,
    emptyLabel,
}: {
    slot: AppearanceAssetSlot;
    title: string;
    description: string;
    configured: boolean;
    file: File | null;
    inputRef: RefObject<HTMLInputElement | null>;
    onSelect: (slot: AppearanceAssetSlot, file?: File) => void;
    onReset: (slot: AppearanceAssetSlot) => void;
    disabled: boolean;
    emptyLabel?: string;
}) {
    const rule = FILE_RULES[slot];
    return (
        <div className="admin-appearance-asset-row">
            <span className="admin-appearance-asset-icon">{slot === "video" ? <MonitorPlay /> : <ImageIcon />}</span>
            <span className="admin-appearance-asset-copy">
                <strong>{title}</strong>
                <small>{description}</small>
                <em>{file ? `${file.name} · ${formatBytes(file.size)}` : configured ? "已配置自定义文件" : emptyLabel || "使用项目原始文件"}</em>
            </span>
            <span className="admin-appearance-asset-actions">
                <input ref={inputRef} type="file" accept={rule.accept} onChange={(event) => onSelect(slot, event.target.files?.[0])} />
                <Button icon={<Upload className="size-3.5" />} disabled={disabled} onClick={() => inputRef.current?.click()}>
                    选择文件
                </Button>
                <Button type="text" danger={configured || Boolean(file)} disabled={disabled || (!configured && !file)} onClick={() => onReset(slot)}>
                    恢复原始
                </Button>
            </span>
        </div>
    );
}

export function useAppearancePreviews(setting: AdminAppearance | null, files: DraftFiles, resets: ResetState) {
    const logoObjectURL = useObjectURL(files.logo);
    const darkLogoObjectURL = useObjectURL(files["logo-dark"]);
    const videoObjectURL = useObjectURL(files.video);
    const posterObjectURL = useObjectURL(files.poster);
    return useMemo(() => {
        if (!setting) return { logoLight: DEFAULT_PUBLIC_APPEARANCE.logoUrl, logoDark: DEFAULT_PUBLIC_APPEARANCE.darkLogoUrl, video: DEFAULT_PUBLIC_APPEARANCE.authVideoUrl, poster: DEFAULT_PUBLIC_APPEARANCE.authVideoPosterUrl };
        const customVideo = Boolean(files.video || (!resets.video && setting.authVideoResourceId));
        const lightLogo = logoObjectURL || (!resets.logo && setting.logoResourceId ? setting.public.logoUrl : "");
        const darkLogo = darkLogoObjectURL || (!resets["logo-dark"] && setting.darkLogoResourceId ? setting.public.darkLogoUrl : "");
        return {
            logoLight: lightLogo || darkLogo || DEFAULT_PUBLIC_APPEARANCE.logoUrl,
            logoDark: darkLogo || lightLogo || DEFAULT_PUBLIC_APPEARANCE.darkLogoUrl,
            video: videoObjectURL || (resets.video ? DEFAULT_PUBLIC_APPEARANCE.authVideoUrl : setting.public.authVideoUrl),
            poster: posterObjectURL || (resets.poster ? (customVideo ? "" : DEFAULT_PUBLIC_APPEARANCE.authVideoPosterUrl) : setting.public.authVideoPosterUrl),
        };
    }, [darkLogoObjectURL, files.video, logoObjectURL, posterObjectURL, resets, setting, videoObjectURL]);
}

export function LogoThemePreview({ label, icon, src, dark, frameEnabled }: { label: string; icon: ReactNode; src: string; dark: boolean; frameEnabled: boolean }) {
    return (
        <div className={cn("admin-appearance-logo-preview", dark ? "is-dark" : "is-light")}>
            <span className={cn("admin-appearance-logo-preview-mark", !frameEnabled && "is-unframed")}>
                <img src={src} alt="" />
            </span>
            <span className="admin-appearance-logo-preview-label">
                {icon}
                {label}
            </span>
        </div>
    );
}

export function useObjectURL(file: File | null) {
    const url = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
    useEffect(
        () => () => {
            if (url) URL.revokeObjectURL(url);
        },
        [url],
    );
    return url;
}

export function AppearanceSkeleton() {
    return (
        <div className="admin-settings-stack admin-appearance-settings" aria-label="正在读取外观配置" role="status">
            <div className="admin-appearance-command-bar">
                <Skeleton active title={{ width: 190 }} paragraph={false} />
            </div>
            <div className="admin-appearance-loading-card">
                <Skeleton active paragraph={{ rows: 8 }} />
            </div>
            <div className="admin-appearance-loading-card">
                <Skeleton active paragraph={{ rows: 10 }} />
            </div>
        </div>
    );
}

export function normalizeDraftCopy(value: string) {
    return value.replace(/\r\n?/g, "\n").trim();
}

export function normalizeSingleLine(value: string) {
    return value.replace(/\r\n?/g, " ").trim();
}

export function hasUnsupportedControlCharacter(value: string) {
    return Array.from(value).some((character) => character !== "\n" && /[\u0000-\u001f\u007f]/.test(character));
}

export function validateSkinDrafts(themes: SkinDefinition[], selectedID: string) {
    if (!themes.length || themes.length > 16) return "皮肤主题数量必须为 1 到 16 套";
    const ids = new Set<string>();
    for (const theme of themes) {
        if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(theme.id) || ids.has(theme.id)) return "皮肤主题 ID 无效或重复";
        ids.add(theme.id);
        if (!theme.name.trim() || Array.from(theme.name.trim()).length > 40) return "皮肤主题名称必须为 1 到 40 个字符";
        if (Array.from(theme.description.trim()).length > 100) return "皮肤主题说明不能超过 100 个字符";
        const invalidColor = [...Object.values(theme.tokens.light), ...Object.values(theme.tokens.dark)].some((color) => !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color));
        if (invalidColor) return `主题“${theme.name}”存在无效颜色，请使用 6 或 8 位十六进制色值`;
        if (!isSkinButtonFill(theme.tokens.buttons.light) || !isSkinButtonFill(theme.tokens.buttons.dark)) return `主题“${theme.name}”的主按钮参数无效，请检查颜色和渐变角度（0–360°）`;
        if (theme.tokens.components.controlHeightSmall > theme.tokens.components.controlHeight || theme.tokens.components.controlHeight > theme.tokens.components.controlHeightLarge) return `主题“${theme.name}”的控件高度顺序无效`;
        if (theme.tokens.components.motionFast > theme.tokens.components.motionNormal) return `主题“${theme.name}”的快速动效不能慢于常规动效`;
    }
    if (!ids.has("classic") || !ids.has(selectedID)) return "默认主题或当前启用主题不存在";
    return "";
}

export function formatBytes(bytes: number) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
