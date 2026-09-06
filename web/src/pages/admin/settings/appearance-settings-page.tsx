import { App, Button, Form, Input, Skeleton } from "antd";
import { Switch } from "@/components/ui/base/switch";
import { Copyright, Globe2, Image as ImageIcon, MonitorPlay, Moon, Palette, RefreshCw, RotateCcw, Save, Search, Sun, Type, Undo2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useBlocker } from "react-router";

import { AdminPageFrame } from "@/pages/admin/components/admin-shell";
import { AdminStatusBadge, SettingsSectionCard } from "@/pages/admin/components/admin-ui";
import { cn } from "@/lib/utils";
import { cloneSkinDefinition, DEFAULT_CLASSIC_SKIN, duplicateSkinDefinition, normalizeSkinDefinition, type SkinDefinition } from "@/lib/skin-themes";
import { SkinThemeEditor } from "@/pages/admin/settings/components/skin-theme-editor";
import { deleteAdminResources } from "@/services/api/admin-storage";
import { getAdminAppearance, resetAdminAppearance, updateAdminAppearance, uploadAppearanceAsset, type AdminAppearance, type AppearanceAssetSlot } from "@/services/api/appearance";
import { commitPublicAppearance, DEFAULT_PUBLIC_APPEARANCE } from "@/stores/use-appearance-store";

type DraftFiles = Record<AppearanceAssetSlot, File | null>;
type ResetState = Record<AppearanceAssetSlot, boolean>;

const EMPTY_FILES: DraftFiles = { logo: null, "logo-dark": null, video: null, poster: null };
const EMPTY_RESETS: ResetState = { logo: false, "logo-dark": false, video: false, poster: false };
const FILE_RULES: Record<AppearanceAssetSlot, { accept: string; maxBytes: number; label: string }> = {
    logo: { accept: "image/png,image/jpeg,image/webp", maxBytes: 5 << 20, label: "浅色模式 Logo" },
    "logo-dark": { accept: "image/png,image/jpeg,image/webp", maxBytes: 5 << 20, label: "深色模式 Logo" },
    poster: { accept: "image/png,image/jpeg,image/webp", maxBytes: 10 << 20, label: "视频封面" },
    video: { accept: "video/mp4,video/webm", maxBytes: 256 << 20, label: "品牌视频" },
};

export default function AppearanceSettingsPage() {
    const { message, modal } = App.useApp();
    const [setting, setSetting] = useState<AdminAppearance | null>(null);
    const [brandName, setBrandName] = useState("");
    const [brandSlug, setBrandSlug] = useState("");
    const [authHeroTitle, setAuthHeroTitle] = useState("");
    const [authHeroDescription, setAuthHeroDescription] = useState("");
    const [logoFrameEnabled, setLogoFrameEnabled] = useState(true);
    const [skinId, setSkinId] = useState("classic");
    const [skinThemes, setSkinThemes] = useState<SkinDefinition[]>([DEFAULT_CLASSIC_SKIN]);
    const [seoTitle, setSeoTitle] = useState("");
    const [seoDescription, setSeoDescription] = useState("");
    const [seoKeywords, setSeoKeywords] = useState("");
    const [footerCopyright, setFooterCopyright] = useState("");
    const [icpFilingEnabled, setIcpFilingEnabled] = useState(false);
    const [icpFilingNumber, setIcpFilingNumber] = useState("");
    const [files, setFiles] = useState<DraftFiles>(EMPTY_FILES);
    const [resets, setResets] = useState<ResetState>(EMPTY_RESETS);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [restoring, setRestoring] = useState(false);
    const [loadError, setLoadError] = useState("");
    const requestVersionRef = useRef(0);
    const inputRefs = {
        logo: useRef<HTMLInputElement>(null),
        "logo-dark": useRef<HTMLInputElement>(null),
        video: useRef<HTMLInputElement>(null),
        poster: useRef<HTMLInputElement>(null),
    };

    const dirty =
        Boolean(setting) &&
        (brandName.trim() !== setting?.brandName ||
            brandSlug.trim().toLocaleLowerCase() !== setting?.brandSlug ||
            normalizeDraftCopy(authHeroTitle) !== setting?.authHeroTitle ||
            normalizeDraftCopy(authHeroDescription) !== setting?.authHeroDescription ||
            logoFrameEnabled !== setting?.logoFrameEnabled ||
            skinId !== setting?.skinId ||
            JSON.stringify(skinThemes) !== JSON.stringify(setting?.skinThemes) ||
            normalizeSingleLine(seoTitle) !== setting?.seoTitle ||
            normalizeDraftCopy(seoDescription) !== setting?.seoDescription ||
            normalizeSingleLine(seoKeywords) !== setting?.seoKeywords ||
            normalizeSingleLine(footerCopyright) !== setting?.footerCopyright ||
            icpFilingEnabled !== setting?.icpFilingEnabled ||
            normalizeSingleLine(icpFilingNumber) !== setting?.icpFilingNumber ||
            Object.values(files).some(Boolean) ||
            Object.values(resets).some(Boolean));
    const blocker = useBlocker(dirty && !saving && !restoring);

    const applySetting = useCallback((value: AdminAppearance) => {
        setSetting(value);
        setBrandName(value.brandName);
        setBrandSlug(value.brandSlug);
        setAuthHeroTitle(value.authHeroTitle);
        setAuthHeroDescription(value.authHeroDescription);
        setLogoFrameEnabled(value.logoFrameEnabled);
        const themes = value.skinThemes.map((theme) => normalizeSkinDefinition(theme));
        setSkinThemes(themes.length ? themes : [cloneSkinDefinition(DEFAULT_CLASSIC_SKIN)]);
        setSkinId(themes.some((theme) => theme.id === value.skinId) ? value.skinId : "classic");
        setSeoTitle(value.seoTitle);
        setSeoDescription(value.seoDescription);
        setSeoKeywords(value.seoKeywords);
        setFooterCopyright(value.footerCopyright);
        setIcpFilingEnabled(value.icpFilingEnabled);
        setIcpFilingNumber(value.icpFilingNumber);
        setFiles(EMPTY_FILES);
        setResets(EMPTY_RESETS);
        setLoadError("");
    }, []);

    const load = useCallback(
        async (initial = false) => {
            const requestVersion = ++requestVersionRef.current;
            if (initial) setLoading(true);
            else setRefreshing(true);
            try {
                const value = await getAdminAppearance();
                if (requestVersion === requestVersionRef.current) applySetting(value);
            } catch (error) {
                if (requestVersion !== requestVersionRef.current) return;
                const detail = error instanceof Error ? error.message : "读取外观配置失败";
                setLoadError(detail);
                if (!initial) message.error(detail);
            } finally {
                if (requestVersion === requestVersionRef.current) {
                    setLoading(false);
                    setRefreshing(false);
                }
            }
        },
        [applySetting, message],
    );

    useEffect(() => {
        void load(true);
        return () => {
            requestVersionRef.current += 1;
        };
    }, [load]);

    useEffect(() => {
        if (blocker.state !== "blocked") return;
        modal.confirm({
            title: "放弃站点及外观调整？",
            content: "当前品牌、SEO、备案、皮肤或媒体配置尚未保存，离开后草稿会丢失。线上站点不会改变。",
            okText: "放弃并离开",
            cancelText: "继续编辑",
            okButtonProps: { danger: true },
            onOk: () => blocker.proceed(),
            onCancel: () => blocker.reset(),
        });
    }, [blocker, modal]);

    useEffect(() => {
        const beforeUnload = (event: BeforeUnloadEvent) => {
            if (!dirty || saving || restoring) return;
            event.preventDefault();
        };
        window.addEventListener("beforeunload", beforeUnload);
        return () => window.removeEventListener("beforeunload", beforeUnload);
    }, [dirty, restoring, saving]);

    const selectFile = (slot: AppearanceAssetSlot, file?: File) => {
        if (!file) return;
        const rule = FILE_RULES[slot];
        if (!rule.accept.split(",").includes(file.type) || file.size <= 0 || file.size > rule.maxBytes) {
            message.error(`${rule.label}须使用支持的格式，且不超过 ${rule.maxBytes >> 20}MB`);
            if (inputRefs[slot].current) inputRefs[slot].current.value = "";
            return;
        }
        setFiles((current) => ({
            ...current,
            [slot]: file,
            ...(slot === "video" ? { poster: null } : {}),
        }));
        setResets((current) => ({
            ...current,
            [slot]: false,
            ...(slot === "video" ? { poster: true } : {}),
        }));
        if (slot === "video" && inputRefs.poster.current) inputRefs.poster.current.value = "";
    };

    const resetAsset = (slot: AppearanceAssetSlot) => {
        setFiles((current) => ({
            ...current,
            [slot]: null,
            ...(slot === "video" ? { poster: null } : {}),
        }));
        setResets((current) => ({
            ...current,
            [slot]: true,
            ...(slot === "video" ? { poster: true } : {}),
        }));
        if (inputRefs[slot].current) inputRefs[slot].current.value = "";
        if (slot === "video" && inputRefs.poster.current) inputRefs.poster.current.value = "";
    };

    const discardDraft = () => {
        if (!setting || saving || restoring) return;
        setBrandName(setting.brandName);
        setBrandSlug(setting.brandSlug);
        setAuthHeroTitle(setting.authHeroTitle);
        setAuthHeroDescription(setting.authHeroDescription);
        setLogoFrameEnabled(setting.logoFrameEnabled);
        setSkinId(setting.skinId);
        setSkinThemes(setting.skinThemes.map((theme) => cloneSkinDefinition(theme)));
        setSeoTitle(setting.seoTitle);
        setSeoDescription(setting.seoDescription);
        setSeoKeywords(setting.seoKeywords);
        setFooterCopyright(setting.footerCopyright);
        setIcpFilingEnabled(setting.icpFilingEnabled);
        setIcpFilingNumber(setting.icpFilingNumber);
        setFiles(EMPTY_FILES);
        setResets(EMPTY_RESETS);
        Object.values(inputRefs).forEach((ref) => {
            if (ref.current) ref.current.value = "";
        });
        message.info("已撤销未保存的外观调整");
    };

    const requestRefresh = () => {
        if (!dirty) {
            void load(false);
            return;
        }
        modal.confirm({
            title: "放弃调整并重新读取？",
            content: "重新读取会丢弃当前品牌、SEO、备案、皮肤和待上传文件。",
            okText: "放弃并刷新",
            cancelText: "继续编辑",
            okButtonProps: { danger: true },
            onOk: () => load(false),
        });
    };

    const restoreBuiltInAppearance = () => {
        if (!setting?.configured || saving || refreshing || restoring) return;
        modal.confirm({
            title: "恢复影策默认品牌标识？",
            content: "品牌名称、英文标识、Logo、登录页文案、视频、封面、SEO、备案和皮肤主题会立即恢复为项目内置值。已上传文件仍保留在存储资源中，不会被删除。",
            okText: "恢复默认",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                setRestoring(true);
                requestVersionRef.current += 1;
                try {
                    const restored = await resetAdminAppearance();
                    applySetting(restored);
                    commitPublicAppearance(restored.public);
                    Object.values(inputRefs).forEach((ref) => {
                        if (ref.current) ref.current.value = "";
                    });
                    message.success("已恢复影策默认品牌标识");
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "恢复默认外观失败");
                    throw error;
                } finally {
                    setRestoring(false);
                }
            },
        });
    };

    const save = async () => {
        if (!setting || saving || restoring) return;
        const nextBrandName = brandName.trim();
        const nextBrandSlug = brandSlug.trim().toLocaleLowerCase();
        const nextAuthHeroTitle = normalizeDraftCopy(authHeroTitle);
        const nextAuthHeroDescription = normalizeDraftCopy(authHeroDescription);
        const nextSeoTitle = normalizeSingleLine(seoTitle);
        const nextSeoDescription = normalizeDraftCopy(seoDescription);
        const nextSeoKeywords = normalizeSingleLine(seoKeywords);
        const nextFooterCopyright = normalizeSingleLine(footerCopyright);
        const nextIcpFilingNumber = normalizeSingleLine(icpFilingNumber);
        if (!nextBrandName || Array.from(nextBrandName).length > 40) {
            message.error("品牌名称必须为 1 到 40 个字符");
            return;
        }
        if (!/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(nextBrandSlug)) {
            message.error("英文品牌标识须为 1 到 48 位小写字母、数字或连字符");
            return;
        }
        if (!nextAuthHeroTitle || Array.from(nextAuthHeroTitle).length > 80 || hasUnsupportedControlCharacter(nextAuthHeroTitle)) {
            message.error("登录页主标题必须为 1 到 80 个字符，可使用换行");
            return;
        }
        if (Array.from(nextAuthHeroDescription).length > 160 || hasUnsupportedControlCharacter(nextAuthHeroDescription)) {
            message.error("登录页说明文案不能超过 160 个字符，可使用换行");
            return;
        }
        for (const [value, label, max] of [
            [nextSeoTitle, "SEO 标题", 70],
            [nextSeoDescription, "SEO 描述", 200],
            [nextSeoKeywords, "SEO 关键词", 300],
            [nextFooterCopyright, "版权信息", 160],
            [nextIcpFilingNumber, "备案号", 64],
        ] as const) {
            if (Array.from(value).length > max || hasUnsupportedControlCharacter(value)) {
                message.error(`${label}不能超过 ${max} 个字符，且不能包含控制字符`);
                return;
            }
        }
        if (icpFilingEnabled && !nextIcpFilingNumber) {
            message.error("显示备案号前请先填写备案号");
            return;
        }
        const skinError = validateSkinDrafts(skinThemes, skinId);
        if (skinError) {
            message.error(skinError);
            return;
        }
        setSaving(true);
        const uploadedIDs: string[] = [];
        try {
            const ids: Record<AppearanceAssetSlot, string> = {
                logo: resets.logo ? "" : setting.logoResourceId,
                "logo-dark": resets["logo-dark"] ? "" : setting.darkLogoResourceId,
                video: resets.video ? "" : setting.authVideoResourceId,
                poster: resets.poster ? "" : setting.authVideoPosterResourceId,
            };
            for (const slot of ["logo", "logo-dark", "video", "poster"] as AppearanceAssetSlot[]) {
                const file = files[slot];
                if (!file) continue;
                const resource = await uploadAppearanceAsset(slot, file);
                uploadedIDs.push(resource.id);
                ids[slot] = resource.id;
            }
            const updated = await updateAdminAppearance({
                brandName: nextBrandName,
                brandSlug: nextBrandSlug,
                authHeroTitle: nextAuthHeroTitle,
                authHeroDescription: nextAuthHeroDescription,
                logoResourceId: ids.logo,
                darkLogoResourceId: ids["logo-dark"],
                logoFrameEnabled,
                authVideoResourceId: ids.video,
                authVideoPosterResourceId: ids.poster,
                skinId,
                skinThemes,
                seoTitle: nextSeoTitle,
                seoDescription: nextSeoDescription,
                seoKeywords: nextSeoKeywords,
                footerCopyright: nextFooterCopyright,
                icpFilingEnabled,
                icpFilingNumber: nextIcpFilingNumber,
            });
            applySetting(updated);
            commitPublicAppearance(updated.public);
            Object.values(inputRefs).forEach((ref) => {
                if (ref.current) ref.current.value = "";
            });
            message.success("站点及外观配置已保存并立即生效");
        } catch (error) {
            const detail = error instanceof Error ? error.message : "保存外观配置失败";
            if (uploadedIDs.length) {
                try {
                    await deleteAdminResources(uploadedIDs);
                } catch {
                    message.warning("保存失败，且临时上传文件未能自动清理；可在存储资源中检查");
                }
            }
            message.error(detail);
        } finally {
            setSaving(false);
        }
    };

    const previews = useAppearancePreviews(setting, files, resets);
    const lightLogoSelected = Boolean(files.logo || (!resets.logo && setting?.logoResourceId));
    const darkLogoSelected = Boolean(files["logo-dark"] || (!resets["logo-dark"] && setting?.darkLogoResourceId));
    const status = setting?.configured ? <AdminStatusBadge label="已自定义" tone="success" /> : <AdminStatusBadge label="使用原始外观" tone="neutral" />;
    const copyCustomized = normalizeDraftCopy(authHeroTitle) !== DEFAULT_PUBLIC_APPEARANCE.authHeroTitle || normalizeDraftCopy(authHeroDescription) !== DEFAULT_PUBLIC_APPEARANCE.authHeroDescription;
    const draftBrandName = brandName.trim() || "站点名称";
    const selectedSkin = skinThemes.find((skin) => skin.id === skinId) || skinThemes[0] || DEFAULT_CLASSIC_SKIN;

    const changeSkin = (next: SkinDefinition) => {
        if (next.locked) return;
        setSkinThemes((current) => current.map((theme) => (theme.id === next.id ? next : theme)));
    };

    const duplicateSkin = (sourceID: string) => {
        if (skinThemes.length >= 16) return;
        const source = skinThemes.find((theme) => theme.id === sourceID) || DEFAULT_CLASSIC_SKIN;
        const copy = duplicateSkinDefinition(
            source,
            skinThemes.map((theme) => theme.id),
        );
        setSkinThemes((current) => [...current, copy]);
        setSkinId(copy.id);
    };

    const deleteSkin = (targetID: string) => {
        const target = skinThemes.find((theme) => theme.id === targetID);
        if (!target || target.locked) return;
        modal.confirm({
            title: `删除主题“${target.name}”？`,
            content: "删除会随本页其他调整一起保存；保存前仍可点击“撤销调整”恢复。若它当前启用，将自动切回经典黑白。",
            okText: "删除主题",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: () => {
                setSkinThemes((current) => current.filter((theme) => theme.id !== targetID));
                if (skinId === targetID) setSkinId("classic");
            },
        });
    };

    return (
        <AdminPageFrame title="站点及外观" description="统一管理品牌身份、登录页、搜索信息、备案展示与全站皮肤主题" scroll>
            {loading ? (
                <AppearanceSkeleton />
            ) : loadError || !setting ? (
                <div className="admin-settings-stack admin-appearance-settings">
                    <div className="admin-appearance-load-error" role="alert">
                        <span className="admin-appearance-load-error-icon">
                            <Palette className="size-5" aria-hidden="true" />
                        </span>
                        <div>
                            <h2>无法读取外观配置</h2>
                            <p>{loadError || "当前没有可显示的配置，请稍后重试。"}</p>
                        </div>
                        <Button icon={<RefreshCw className="size-4" />} onClick={() => void load(true)}>
                            重新读取
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="admin-settings-stack admin-appearance-settings">
                    <div className={cn("admin-appearance-command-bar", dirty && "is-dirty")}>
                        <div className="admin-appearance-command-copy" aria-live="polite">
                            <div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <strong>{dirty ? "站点配置有调整待保存" : "站点及外观已与服务端同步"}</strong>
                                    <AdminStatusBadge label={dirty ? "尚未生效" : "服务端当前值"} tone={dirty ? "warning" : "neutral"} />
                                </div>
                                <p>{dirty ? "品牌、SEO、备案、皮肤和媒体只在本页预览；保存后才会应用。" : "公开页面会在应用渲染前读取品牌与皮肤，不会先闪现旧站点身份。"}</p>
                            </div>
                        </div>
                        <div className="admin-appearance-command-actions">
                            {dirty ? (
                                <Button icon={<Undo2 className="size-4" />} disabled={saving || restoring} onClick={discardDraft}>
                                    撤销调整
                                </Button>
                            ) : null}
                            <Button icon={<RotateCcw className="size-4" />} loading={restoring} disabled={!setting.configured || saving || refreshing} onClick={restoreBuiltInAppearance}>
                                恢复影策默认
                            </Button>
                            <Button icon={<RefreshCw className="size-4" />} loading={refreshing} disabled={saving || restoring} onClick={requestRefresh}>
                                刷新状态
                            </Button>
                            <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty || refreshing || restoring} onClick={() => void save()}>
                                保存修改
                            </Button>
                        </div>
                    </div>

                    <SettingsSectionCard
                        className="admin-appearance-section admin-appearance-brand-section"
                        icon={<Palette className="size-4" aria-hidden="true" />}
                        title="1. 设置品牌识别"
                        description="中文品牌名用于主要界面，英文品牌标识用于英文角标和可安全品牌化的路径建议；不会改动代码包、数据库或部署标识。"
                        status={status}
                    >
                        <div className="admin-appearance-brand-layout">
                            <Form className="admin-appearance-form" layout="vertical" requiredMark={false} disabled={saving || refreshing || restoring}>
                                <Form.Item label="品牌名称" extra="1–40 个字符。保存后同步到登录页、工作台、管理后台与浏览器标题。">
                                    <Input value={brandName} maxLength={40} showCount placeholder="输入品牌名称" onChange={(event) => setBrandName(event.target.value)} />
                                </Form.Item>
                                <Form.Item label="英文品牌标识" extra="1–48 位小写字母、数字或连字符，例如 hima-studio。对象存储可一键采用该值作为路径前缀。">
                                    <Input
                                        value={brandSlug}
                                        maxLength={48}
                                        showCount
                                        autoCapitalize="none"
                                        autoCorrect="off"
                                        spellCheck={false}
                                        placeholder="例如：hima-studio"
                                        onChange={(event) => setBrandSlug(event.target.value.toLocaleLowerCase().replace(/[^a-z0-9-]/g, ""))}
                                    />
                                </Form.Item>
                            </Form>
                            <div className="admin-appearance-brand-logo admin-appearance-logo-stack">
                                <AssetPicker
                                    slot="logo"
                                    title="浅色模式 Logo"
                                    description="用于浅色界面；建议透明背景 PNG 或 WebP。"
                                    configured={Boolean(setting.logoResourceId) && !resets.logo}
                                    file={files.logo}
                                    inputRef={inputRefs.logo}
                                    onSelect={selectFile}
                                    onReset={resetAsset}
                                    disabled={saving || refreshing || restoring}
                                    emptyLabel={darkLogoSelected ? "将自动复用深色模式 Logo" : "未上传时使用项目原始 Logo"}
                                />
                                <AssetPicker
                                    slot="logo-dark"
                                    title="深色模式 Logo（可选）"
                                    description="用于深色界面；不上传时自动复用浅色模式 Logo。"
                                    configured={Boolean(setting.darkLogoResourceId) && !resets["logo-dark"]}
                                    file={files["logo-dark"]}
                                    inputRef={inputRefs["logo-dark"]}
                                    onSelect={selectFile}
                                    onReset={resetAsset}
                                    disabled={saving || refreshing || restoring}
                                    emptyLabel={lightLogoSelected ? "将自动复用浅色模式 Logo" : "未上传时使用项目原始 Logo"}
                                />
                                <div className="admin-appearance-logo-frame-option">
                                    <div className="admin-appearance-logo-frame-copy">
                                        <strong>禁用 Logo 后面的圆角矩形外框</strong>
                                        <p id="appearance-logo-frame-help">开启后，工作台和管理后台导航只显示 Logo 本身；Logo 会等比放大到原外框的可用区域，导航占位保持不变。</p>
                                    </div>
                                    <div className="admin-appearance-logo-frame-control">
                                        <span>{logoFrameEnabled ? "保留外框" : "已禁用外框"}</span>
                                        <Switch
                                            checked={!logoFrameEnabled}
                                            disabled={saving || refreshing || restoring}
                                            aria-label="禁用 Logo 后面的圆角矩形外框"
                                            aria-describedby="appearance-logo-frame-help"
                                            onChange={(checked) => setLogoFrameEnabled(!checked)}
                                        />
                                    </div>
                                </div>
                                <div className="admin-appearance-logo-preview-grid" aria-label="深浅模式 Logo 预览">
                                    <LogoThemePreview label="浅色界面" icon={<Sun />} src={previews.logoLight} dark={false} frameEnabled={logoFrameEnabled} />
                                    <LogoThemePreview label="深色界面" icon={<Moon />} src={previews.logoDark} dark frameEnabled={logoFrameEnabled} />
                                </div>
                            </div>
                        </div>
                    </SettingsSectionCard>

                    <SettingsSectionCard
                        className="admin-appearance-section admin-appearance-auth-section"
                        icon={<MonitorPlay className="size-4" aria-hidden="true" />}
                        title="2. 设置登录页内容与媒体"
                        description="登录、注册与找回密码共享左侧品牌文案和影片；更换视频会同时取消旧封面，避免品牌串帧。"
                        status={
                            <AdminStatusBadge
                                label={copyCustomized || setting.authVideoResourceId || setting.authVideoPosterResourceId ? "已配置" : "使用原始内容"}
                                tone={copyCustomized || setting.authVideoResourceId || setting.authVideoPosterResourceId ? "success" : "neutral"}
                            />
                        }
                    >
                        <div className="admin-appearance-auth-layout">
                            <div className="admin-appearance-auth-controls">
                                <Form className="admin-appearance-form" layout="vertical" requiredMark={false} disabled={saving || refreshing || restoring}>
                                    <Form.Item label="登录页主标题" extra="1–80 个字符，可换行；登录、注册和找回密码页面共用。">
                                        <Input.TextArea value={authHeroTitle} maxLength={80} showCount autoSize={{ minRows: 2, maxRows: 4 }} placeholder="输入登录页主标题" onChange={(event) => setAuthHeroTitle(event.target.value)} />
                                    </Form.Item>
                                    <Form.Item label="登录页说明文案（可选）" extra="最多 160 个字符，可换行；留空时不显示说明。">
                                        <Input.TextArea
                                            value={authHeroDescription}
                                            maxLength={160}
                                            showCount
                                            autoSize={{ minRows: 2, maxRows: 5 }}
                                            placeholder="补充一句品牌介绍或产品定位"
                                            onChange={(event) => setAuthHeroDescription(event.target.value)}
                                        />
                                    </Form.Item>
                                </Form>
                                <div className="admin-appearance-media-list">
                                    <AssetPicker
                                        slot="video"
                                        title="品牌视频"
                                        description="支持 MP4 或 WebM，最多 256MB；服务器运行时上传配额仍会同时生效。"
                                        configured={Boolean(setting.authVideoResourceId) && !resets.video}
                                        file={files.video}
                                        inputRef={inputRefs.video}
                                        onSelect={selectFile}
                                        onReset={resetAsset}
                                        disabled={saving || refreshing || restoring}
                                    />
                                    <AssetPicker
                                        slot="poster"
                                        title="视频封面（可选）"
                                        description="自定义视频未设置封面时保持中性背景，不显示原品牌封面。"
                                        configured={Boolean(setting.authVideoPosterResourceId) && !resets.poster}
                                        file={files.poster}
                                        inputRef={inputRefs.poster}
                                        onSelect={selectFile}
                                        onReset={resetAsset}
                                        disabled={saving || refreshing || restoring}
                                    />
                                </div>
                            </div>
                            <div className="admin-appearance-preview" aria-label="登录页实时预览">
                                <div className="admin-appearance-preview-heading">
                                    <div>
                                        <span>登录页实时预览</span>
                                        <strong>{brandName.trim() || "未命名品牌"}</strong>
                                    </div>
                                    <AdminStatusBadge label={dirty ? "未保存" : "线上版本"} tone={dirty ? "warning" : "success"} />
                                </div>
                                <div className="admin-appearance-preview-stage">
                                    <video key={previews.video} src={previews.video} poster={previews.poster || undefined} muted loop playsInline autoPlay preload="metadata" />
                                    <span className="admin-appearance-preview-shade" />
                                    <span className="admin-appearance-preview-brand">
                                        <img src={previews.logoDark} alt="" />
                                        <strong>{brandName.trim() || "未命名品牌"}</strong>
                                    </span>
                                    <span className="admin-appearance-preview-copy">
                                        <small>{(brandSlug.trim() || "brand-studio").replace(/-+/g, " ").toLocaleUpperCase()}</small>
                                        <strong>{normalizeDraftCopy(authHeroTitle) || "请输入登录页主标题"}</strong>
                                        {normalizeDraftCopy(authHeroDescription) ? <span>{normalizeDraftCopy(authHeroDescription)}</span> : null}
                                    </span>
                                </div>
                                <p>预览与正式登录页使用同一文案和媒体。正式页面会先解析公开配置，再渲染品牌内容。</p>
                            </div>
                        </div>
                    </SettingsSectionCard>

                    <SettingsSectionCard
                        className="admin-appearance-section"
                        icon={<Search className="size-4" aria-hidden="true" />}
                        title="3. SEO 信息"
                        description="配置浏览器标题、搜索摘要和关键词；留空时标题与描述会自动跟随当前站点名称。"
                        status={<AdminStatusBadge label={seoTitle || seoDescription || seoKeywords ? "已自定义" : "自动跟随品牌"} tone={seoTitle || seoDescription || seoKeywords ? "success" : "neutral"} />}
                    >
                        <Form className="admin-appearance-form admin-appearance-section-form" layout="vertical" requiredMark={false} disabled={saving || refreshing || restoring}>
                            <div className="admin-appearance-form-grid">
                                <Form.Item label="SEO 标题" extra="建议简洁描述站点用途；留空时使用站点名称。">
                                    <Input value={seoTitle} maxLength={70} showCount placeholder={draftBrandName} onChange={(event) => setSeoTitle(event.target.value)} />
                                </Form.Item>
                                <Form.Item label="SEO 关键词" extra="以逗号分隔；Google 不使用该标签排名，仍可供其他工具读取。">
                                    <Input value={seoKeywords} maxLength={300} showCount placeholder="AI 影视, AI 短剧, 创作工作台" onChange={(event) => setSeoKeywords(event.target.value)} />
                                </Form.Item>
                            </div>
                            <Form.Item label="SEO 描述" extra="建议用一到两句话准确概括站点，避免重复堆砌关键词；留空时自动生成品牌描述。">
                                <Input.TextArea
                                    value={seoDescription}
                                    maxLength={200}
                                    showCount
                                    autoSize={{ minRows: 3, maxRows: 5 }}
                                    placeholder={`${draftBrandName}，面向 AI 影视与短剧创作的工作台。`}
                                    onChange={(event) => setSeoDescription(event.target.value)}
                                />
                            </Form.Item>
                        </Form>
                    </SettingsSectionCard>

                    <SettingsSectionCard
                        className="admin-appearance-section"
                        icon={<Globe2 className="size-4" aria-hidden="true" />}
                        title="4. 首页页尾与备案"
                        description="配置公开登录首页底部的版权和备案信息；备案号启用后固定链接工信部备案管理系统。"
                        status={<AdminStatusBadge label={icpFilingEnabled ? "展示备案号" : "未展示备案号"} tone={icpFilingEnabled ? "success" : "neutral"} />}
                    >
                        <div className="admin-appearance-section-form admin-appearance-footer-settings">
                            <Form className="admin-appearance-form" layout="vertical" requiredMark={false} disabled={saving || refreshing || restoring}>
                                <Form.Item label="版权信息" extra="留空时自动使用当前年份和站点名称。">
                                    <Input
                                        prefix={<Copyright className="size-3.5" aria-hidden="true" />}
                                        value={footerCopyright}
                                        maxLength={160}
                                        showCount
                                        placeholder={`© ${new Date().getFullYear()} ${draftBrandName}. All rights reserved.`}
                                        onChange={(event) => setFooterCopyright(event.target.value)}
                                    />
                                </Form.Item>
                                <Form.Item label="备案号" extra="请填写真实备案号，例如“蜀ICP备XXXXXXXX号”；系统不会替你申请或核验备案。">
                                    <Input value={icpFilingNumber} maxLength={64} showCount placeholder="例如：蜀ICP备XXXXXXXX号" onChange={(event) => setIcpFilingNumber(event.target.value)} />
                                </Form.Item>
                            </Form>
                            <div className="admin-appearance-logo-frame-option">
                                <div className="admin-appearance-logo-frame-copy">
                                    <strong>在首页底部显示备案号</strong>
                                    <p id="appearance-icp-help">启用后，备案号会显示在登录、注册和找回密码页底部，并链接至 https://beian.miit.gov.cn/ 供公众查询。</p>
                                </div>
                                <div className="admin-appearance-logo-frame-control">
                                    <span>{icpFilingEnabled ? "已显示" : "未显示"}</span>
                                    <Switch checked={icpFilingEnabled} disabled={saving || refreshing || restoring} aria-label="在首页底部显示备案号" aria-describedby="appearance-icp-help" onChange={setIcpFilingEnabled} />
                                </div>
                            </div>
                        </div>
                    </SettingsSectionCard>

                    <SettingsSectionCard
                        className="admin-appearance-section"
                        icon={<Type className="size-4" aria-hidden="true" />}
                        title="5. 皮肤主题"
                        description="默认主题保持项目原始样式且不可更改；其他主题可新建、复制、改名、删除，并分别定义浅色、深色、控件样式与交互反馈。"
                        status={<AdminStatusBadge label={selectedSkin.name} tone="info" />}
                    >
                        <SkinThemeEditor
                            themes={skinThemes}
                            selectedID={skinId}
                            disabled={saving || refreshing || restoring}
                            onSelect={setSkinId}
                            onCreate={() => duplicateSkin("classic")}
                            onDuplicate={duplicateSkin}
                            onDelete={deleteSkin}
                            onChange={changeSkin}
                        />
                    </SettingsSectionCard>
                </div>
            )}
        </AdminPageFrame>
    );
}

function AssetPicker({
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

function useAppearancePreviews(setting: AdminAppearance | null, files: DraftFiles, resets: ResetState) {
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

function LogoThemePreview({ label, icon, src, dark, frameEnabled }: { label: string; icon: ReactNode; src: string; dark: boolean; frameEnabled: boolean }) {
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

function useObjectURL(file: File | null) {
    const url = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
    useEffect(
        () => () => {
            if (url) URL.revokeObjectURL(url);
        },
        [url],
    );
    return url;
}

function AppearanceSkeleton() {
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

function normalizeDraftCopy(value: string) {
    return value.replace(/\r\n?/g, "\n").trim();
}

function normalizeSingleLine(value: string) {
    return value.replace(/\r\n?/g, " ").trim();
}

function hasUnsupportedControlCharacter(value: string) {
    return Array.from(value).some((character) => character !== "\n" && /[\u0000-\u001f\u007f]/.test(character));
}

function validateSkinDrafts(themes: SkinDefinition[], selectedID: string) {
    if (!themes.length || themes.length > 16) return "皮肤主题数量必须为 1 到 16 套";
    const ids = new Set<string>();
    for (const theme of themes) {
        if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(theme.id) || ids.has(theme.id)) return "皮肤主题 ID 无效或重复";
        ids.add(theme.id);
        if (!theme.name.trim() || Array.from(theme.name.trim()).length > 40) return "皮肤主题名称必须为 1 到 40 个字符";
        if (Array.from(theme.description.trim()).length > 100) return "皮肤主题说明不能超过 100 个字符";
        const invalidColor = [...Object.values(theme.tokens.light), ...Object.values(theme.tokens.dark)].some((color) => !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color));
        if (invalidColor) return `主题“${theme.name}”存在无效颜色，请使用 6 或 8 位十六进制色值`;
        if (theme.tokens.components.controlHeightSmall > theme.tokens.components.controlHeight || theme.tokens.components.controlHeight > theme.tokens.components.controlHeightLarge) return `主题“${theme.name}”的控件高度顺序无效`;
        if (theme.tokens.components.motionFast > theme.tokens.components.motionNormal) return `主题“${theme.name}”的快速动效不能慢于常规动效`;
    }
    if (!ids.has("classic") || !ids.has(selectedID)) return "默认主题或当前启用主题不存在";
    return "";
}

function formatBytes(bytes: number) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
