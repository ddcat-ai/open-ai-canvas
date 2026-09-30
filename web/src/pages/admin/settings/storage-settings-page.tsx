import { AdminPageFrame } from "../components/admin-shell";
import { AlertTriangle, RefreshCw, Database, RotateCcw, HardDrive, Cloud, Check, ShieldCheck, Server, BadgeCheck, Save, Globe2, LocateFixed, KeyRound, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";
import { Select, Switch } from "@/pages/admin/ui/controls";
import { App, Form, Skeleton, Button, Input } from "antd";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useBlocker } from "react-router";

import { type OSSConnectionTestResult, changesRequireOSSRetest, getS3PresetHints, S3_PRESET_OPTIONS, type S3Preset } from "@/lib/oss-settings";
import { getAdminOSSSetting, updateAdminOSSSetting, type AdminOSSSetting, testAdminOSSConnection } from "@/services/api/auth";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { AdminStatusBadge, configuredSecretText, SettingsSectionCard } from "../components/admin-ui";
import { accessKeySecretLabel, formValues, formatSettingTime, hasStorageChanges, isAdminOSSSetting, normalizeStoragePayload, providerDraftValues, storageProviderLabel, storageResponseMatches, type StoragePayload, validateStorageDraft, connectionInput, storageConfigurationReady, providerGuidance, accessKeyIdLabel } from "./storage-settings-model";
import { type OSSFormValues, type StorageMode } from "./storage-settings-model";

export { type OSSFormValues, type StorageMode, type StoragePayload } from "./storage-settings-model";

const STORAGE_MODES: Array<{ mode: StorageMode; label: string; short: string; description: string }> = [
    { mode: "local", label: "服务器本地", short: "本地磁盘", description: "新增资源写入当前部署的数据目录，通过后端签名链接访问。" },
    { mode: "aliyun", label: "阿里云 OSS", short: "对象存储", description: "新增资源写入阿里云 Bucket，可选 CDN 域名读取。" },
    { mode: "tencent", label: "腾讯云 COS", short: "对象存储", description: "新增资源写入腾讯云 Bucket，可由 Region 生成 Endpoint。" },
    { mode: "qiniu", label: "七牛云 Kodo", short: "对象存储", description: "新增资源上传到 Kodo；无绑定域名时由后端代理读取。" },
    { mode: "s3", label: "S3 兼容存储", short: "对象存储", description: "支持 AWS S3、Cloudflare R2、Backblaze B2、RustFS 与自定义 S3 Endpoint。" },
];

export default function StorageSettingsPage() {
    const { message, modal } = App.useApp();
    const brandSlug = useAppearanceStore((state) => state.appearance.brandSlug);
    const [setting, setSetting] = useState<AdminOSSSetting | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<OSSConnectionTestResult | null>(null);
    const [testStale, setTestStale] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [draftMode, setDraftMode] = useState<StorageMode>("local");
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState("");
    const [form] = Form.useForm<OSSFormValues>();
    const requestVersionRef = useRef(0);
    const navigationConfirmOpenRef = useRef(false);
    const navigationTriggerRef = useRef<HTMLElement | null>(null);

    const load = useCallback(
        async (initial = false, announce = false) => {
            const requestVersion = ++requestVersionRef.current;
            if (initial) setLoading(true);
            else setRefreshing(true);
            setLoadError("");
            try {
                const result = await getAdminOSSSetting();
                if (requestVersion !== requestVersionRef.current) return;
                if (!isAdminOSSSetting(result.setting)) throw new Error("服务端返回的存储配置格式无效");
                setSetting(result.setting);
                setTestResult(result.setting.testedAt ? { ok: true, testedAt: result.setting.testedAt, testedDigest: result.setting.testedDigest } : null);
                setTestStale(false);
                setDirty(false);
                setSaveError("");
                if (announce) message.success("已重新读取当前平台存储配置");
            } catch (error) {
                if (requestVersion !== requestVersionRef.current) return;
                const errorMessage = error instanceof Error ? error.message : "读取对象存储配置失败";
                setLoadError(errorMessage);
                if (!initial) message.error(errorMessage);
            } finally {
                if (requestVersion === requestVersionRef.current) {
                    setLoading(false);
                    setRefreshing(false);
                }
            }
        },
        [message],
    );

    useEffect(() => {
        void load(true);
        return () => {
            requestVersionRef.current += 1;
        };
    }, [load]);

    useEffect(() => {
        if (loading || !setting) return;
        const values = formValues(setting);
        form.setFieldsValue(values);
        setDraftMode(values.mode);
    }, [form, loading, setting]);

    const blocker = useBlocker(dirty && !saving);

    useEffect(() => {
        const beforeUnload = (event: BeforeUnloadEvent) => {
            if (!dirty || saving) return;
            event.preventDefault();
        };
        window.addEventListener("beforeunload", beforeUnload);
        return () => window.removeEventListener("beforeunload", beforeUnload);
    }, [dirty, saving]);

    useEffect(() => {
        if (blocker.state !== "blocked" || navigationConfirmOpenRef.current) return;
        navigationConfirmOpenRef.current = true;
        navigationTriggerRef.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
        modal.confirm({
            title: "放弃存储服务调整？",
            content: "当前页面有尚未保存的存储位置或接入配置，离开后这些草稿会丢失。服务端正在使用的存储配置不会改变。",
            okText: "放弃并离开",
            cancelText: "继续编辑",
            okButtonProps: { danger: true },
            onOk: () => {
                navigationConfirmOpenRef.current = false;
                navigationTriggerRef.current = null;
                blocker.proceed();
            },
            onCancel: () => {
                navigationConfirmOpenRef.current = false;
                blocker.reset();
                window.requestAnimationFrame(() => {
                    const fallback = document.querySelector<HTMLButtonElement>(".admin-storage-command-actions button");
                    const target = navigationTriggerRef.current?.isConnected ? navigationTriggerRef.current : fallback;
                    target?.focus();
                    navigationTriggerRef.current = null;
                });
            },
        });
    }, [blocker, modal]);

    const resetDraft = () => {
        if (!setting || saving) return;
        const values = formValues(setting);
        form.setFieldsValue(values);
        form.setFields([]);
        setDraftMode(values.mode);
        setDirty(false);
        setSaveError("");
        setTestResult(setting.testedAt ? { ok: true, testedAt: setting.testedAt, testedDigest: setting.testedDigest } : null);
        setTestStale(false);
        message.info("已撤销存储服务的未保存调整");
    };

    const requestRefresh = () => {
        if (!dirty) {
            void load(false, true);
            return;
        }
        modal.confirm({
            title: "放弃调整并重新读取？",
            content: "重新读取会丢弃当前存储表单中的未保存内容，并以服务端配置为准。",
            okText: "放弃并刷新",
            cancelText: "继续编辑",
            okButtonProps: { danger: true },
            onOk: () => load(false, true),
        });
    };

    const applyMode = (nextMode: StorageMode): OSSFormValues | null => {
        if (!setting) return null;
        const current = form.getFieldsValue(true);
        const nextValues: Partial<OSSFormValues> = { mode: nextMode };
        if (nextMode !== "local") {
            Object.assign(nextValues, providerDraftValues(nextMode, setting, current.pathPrefix));
        }
        form.setFieldsValue(nextValues);
        form.setFields([]);
        setDraftMode(nextMode);
        setDirty(hasStorageChanges({ ...current, ...nextValues }, setting));
        setTestStale(true);
        setSaveError("");
        return { ...current, ...nextValues } as OSSFormValues;
    };

    const requestModeChange = (nextMode: StorageMode) => {
        if (!setting || nextMode === draftMode || saving || refreshing) return;
        applyMode(nextMode);
    };

    const useBrandPathPrefix = () => {
        if (!setting || saving || refreshing) return;
        const current = form.getFieldsValue(true);
        form.setFieldValue("pathPrefix", brandSlug);
        setDirty(hasStorageChanges({ ...current, pathPrefix: brandSlug }, setting));
        setTestStale(true);
        setSaveError("");
    };

    const save = async (values: OSSFormValues) => {
        if (!setting) return;
        const expected = normalizeStoragePayload(values, setting);
        setSaving(true);
        setSaveError("");
        try {
            const result = await updateAdminOSSSetting(expected);
            if (!isAdminOSSSetting(result.setting) || !storageResponseMatches(result.setting, expected)) throw new Error("服务端返回的存储配置与本次保存内容不一致，请重新读取后核对");
            setSetting(result.setting);
            const nextValues = formValues(result.setting);
            form.setFieldsValue(nextValues);
            setDraftMode(nextValues.mode);
            setDirty(false);
            setTestResult(result.setting.testedAt ? { ok: true, testedAt: result.setting.testedAt, testedDigest: result.setting.testedDigest } : null);
            setTestStale(false);
            message.success("平台存储配置已保存");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "保存存储配置失败";
            setSaveError(`${errorMessage}。未自动重试，请重新读取当前配置后再决定是否保存。`);
            message.error(errorMessage);
            throw error;
        } finally {
            setSaving(false);
        }
    };

    const submitSave = async () => {
        if (!setting) return;
        let values: OSSFormValues;
        try {
            values = await form.validateFields();
        } catch {
            return;
        }
        const validationError = validateStorageDraft(values, setting);
        if (validationError) {
            message.error(validationError);
            return;
        }
        try {
            await save(values);
        } catch {
            // 保存错误已在 save 中就地提示。
        }
    };

    const testConnection = async () => {
        if (!setting) return;
        let values: OSSFormValues;
        try {
            values = await form.validateFields();
        } catch {
            return;
        }
        const validationError = validateStorageDraft(values, setting);
        if (validationError) {
            message.error(validationError);
            return;
        }
        if (values.mode === "local") return;
        setTesting(true);
        try {
            const result = await testAdminOSSConnection(connectionInput(values));
            setTestResult(result);
            setTestStale(false);
            result.ok ? message.success(result.message || "连接测试通过") : message.error(result.message || "连接测试失败");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "连接测试失败";
            setTestResult({ ok: false, message: errorMessage });
            setTestStale(false);
            message.error(errorMessage);
        } finally {
            setTesting(false);
        }
    };

    if (loading && !setting) {
        return (
            <AdminPageFrame title="存储服务" description="配置新增资源的默认存储位置" scroll>
                <div className="admin-settings-stack admin-storage-settings" aria-label="正在读取平台存储配置" role="status">
                    <div className="admin-storage-loading-card">
                        <Skeleton active paragraph={{ rows: 7 }} />
                    </div>
                </div>
            </AdminPageFrame>
        );
    }

    if (!setting) {
        return (
            <AdminPageFrame title="存储服务" description="配置新增资源的默认存储位置" scroll>
                <div className="admin-settings-stack admin-storage-settings">
                    <div className="admin-storage-load-error" role="alert">
                        <span className="admin-storage-load-error-icon">
                            <AlertTriangle className="size-5" aria-hidden="true" />
                        </span>
                        <div>
                            <h2>无法读取平台存储配置</h2>
                            <p>{loadError || "当前没有可显示的配置，请稍后重试。"}</p>
                        </div>
                        <Button icon={<RefreshCw className="size-4" />} loading={refreshing} onClick={() => void load(false, true)}>
                            重新读取
                        </Button>
                    </div>
                </div>
            </AdminPageFrame>
        );
    }

    const currentValues = form.getFieldsValue(true);
    const normalizedDraft = normalizeStoragePayload(currentValues, setting);
    const hasCurrentProviderSecret = draftMode !== "local" && setting.provider === draftMode && setting.hasAccessKeySecret;

    return (
        <AdminPageFrame title="存储服务" description="配置新增资源的默认存储位置" scroll>
            <div className="admin-settings-stack admin-storage-settings">
                <div className={cn("admin-storage-command-bar", dirty && "is-dirty")}>
                    <div className="admin-storage-command-copy" aria-live="polite">
                        <span className="admin-storage-command-icon">
                            <Database className="size-4" aria-hidden="true" />
                        </span>
                        <div>
                            <strong>{dirty ? "有未保存的存储调整" : `当前使用：${storageProviderLabel(draftMode)}`}</strong>
                            <p>{dirty ? "保存后仅影响新增资源。" : formatSettingTime(setting.updatedAt, "使用系统默认值")}</p>
                        </div>
                    </div>
                    <div className="admin-storage-command-actions">
                        {dirty ? (
                            <Button icon={<RotateCcw className="size-4" />} disabled={saving} onClick={resetDraft}>
                                撤销调整
                            </Button>
                        ) : null}
                        <Button icon={<RefreshCw className="size-4" />} loading={refreshing} disabled={saving} onClick={requestRefresh}>
                            刷新状态
                        </Button>
                    </div>
                </div>

                {loadError || saveError ? (
                    <div className="admin-storage-inline-alert" role="alert">
                        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                        <span>{saveError || `${loadError}。页面仍显示上一次成功读取的配置。`}</span>
                    </div>
                ) : null}

                <div id="admin-storage-mode" className="admin-settings-anchor">
                    <SettingsSectionCard
                        className="admin-storage-section admin-storage-mode-section"
                        icon={<HardDrive className="size-4" aria-hidden="true" />}
                        title="1. 选择新资源存储位置"
                        description="先选择一种存储方式。选择结果会决定下一步需要填写的接入信息，不会迁移已有资源。"
                        status={<AdminStatusBadge label={dirty ? "待保存" : "当前设置"} tone={dirty ? "warning" : "info"} />}
                    >
                        <div className="admin-storage-mode-content">
                            <div className="admin-storage-mode-grid" role="radiogroup" aria-label="新增资源存储位置">
                                {STORAGE_MODES.map((item) => (
                                    <button
                                        key={item.mode}
                                        type="button"
                                        role="radio"
                                        aria-checked={draftMode === item.mode}
                                        className={cn("admin-storage-mode-choice", draftMode === item.mode && "is-selected")}
                                        disabled={loading || refreshing || saving}
                                        onClick={() => requestModeChange(item.mode)}
                                    >
                                        <span className="admin-storage-mode-icon">{item.mode === "local" ? <HardDrive className="size-4" aria-hidden="true" /> : <Cloud className="size-4" aria-hidden="true" />}</span>
                                        <span className="admin-storage-mode-copy">
                                            <strong>{item.label}</strong>
                                            <small>{item.description}</small>
                                        </span>
                                        <span className="admin-storage-mode-meta">{item.short}</span>
                                        {draftMode === item.mode ? (
                                            <span className="admin-storage-mode-selected">
                                                <Check className="size-3.5" aria-hidden="true" />
                                                已选择
                                            </span>
                                        ) : null}
                                    </button>
                                ))}
                            </div>
                            <div className="admin-storage-history-note">
                                <ShieldCheck className="size-4" aria-hidden="true" />
                                <span>选择后继续完成第 2 步并保存。保存只改变新增资源；历史资源仍按自身记录的 provider、Endpoint 和 Bucket 读取。</span>
                            </div>
                        </div>
                    </SettingsSectionCard>
                </div>

                <div id="admin-storage-access" className="admin-settings-anchor">
                    <SettingsSectionCard
                        className="admin-storage-section admin-storage-configuration-section"
                        icon={draftMode === "local" ? <Server className="size-4" aria-hidden="true" /> : <Cloud className="size-4" aria-hidden="true" />}
                        title={draftMode === "local" ? "2. 配置服务器本地访问" : `2. 配置 ${storageProviderLabel(draftMode)} 接入`}
                        description={draftMode === "local" ? "填写浏览器访问本地资源时使用的服务器根地址，然后保存。" : "按顺序填写存储位置、读取出口和服务端访问密钥，然后测试并保存。"}
                        status={
                            <AdminStatusBadge
                                label={dirty ? "有调整" : storageConfigurationReady(draftMode, normalizedDraft, setting) ? "已配置" : "待配置"}
                                tone={dirty ? "warning" : storageConfigurationReady(draftMode, normalizedDraft, setting) ? "success" : "neutral"}
                            />
                        }
                        footer={
                            <>
                                <div className="admin-storage-footer-note">
                                    <BadgeCheck className="size-4" aria-hidden="true" />
                                    <span>{formatSettingTime(setting.updatedAt, "尚未保存平台存储配置")} · 保存不会自动连接存储服务，建议先执行连接测试</span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    {dirty ? (
                                        <Button icon={<RotateCcw className="size-4" />} disabled={saving} onClick={resetDraft}>
                                            撤销
                                        </Button>
                                    ) : null}
                                    <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty || loading || refreshing} onClick={() => void submitSave()}>
                                        保存修改
                                    </Button>
                                </div>
                            </>
                        }
                    >
                        <Form
                            form={form}
                            layout="vertical"
                            requiredMark={false}
                            disabled={loading || refreshing || saving}
                            onValuesChange={(changedValues) => {
                                const values = form.getFieldsValue(true);
                                setDraftMode(values.mode || "local");
                                setDirty(hasStorageChanges(values, setting));
                                if (changesRequireOSSRetest(changedValues)) setTestStale(true);
                                setSaveError("");
                            }}
                        >
                            <Form.Item name="mode" hidden>
                                <Input />
                            </Form.Item>

                            {draftMode === "local" ? (
                                <div className="admin-storage-form-section">
                                    <FormSectionTitle icon={<Globe2 className="size-4" />} title="公开访问根地址" description="用于生成本地资源的短时签名链接；填写站点根地址，不要附带 /api、查询参数或片段。" />
                                    <div className="admin-storage-local-field">
                                        <Form.Item name="publicBaseUrl" label="服务器访问地址" extra="支持本机、局域网或公网地址，例如 http://192.168.1.10:8080。">
                                            <div className="admin-storage-address-control">
                                                <Input aria-label="服务器访问地址" autoComplete="off" inputMode="url" placeholder="https://canvas.example.com" prefix={<Globe2 className="size-4 text-foreground/35" />} />
                                                <Button
                                                    icon={<LocateFixed className="size-4" />}
                                                    onClick={() => {
                                                        const value = window.location.origin;
                                                        form.setFieldValue("publicBaseUrl", value);
                                                        setDirty(hasStorageChanges({ ...form.getFieldsValue(true), publicBaseUrl: value }, setting));
                                                        setSaveError("");
                                                    }}
                                                >
                                                    使用当前地址
                                                </Button>
                                            </div>
                                        </Form.Item>
                                    </div>
                                    <div className="admin-storage-context-note">
                                        <HardDrive className="size-4" aria-hidden="true" />
                                        <span>本地模式适合单机或共享数据卷部署。该地址只决定资源访问链接，不会移动现有文件或改变数据目录。</span>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="admin-storage-provider-note">
                                        <Cloud className="size-4" aria-hidden="true" />
                                        <span>{providerGuidance(draftMode)}</span>
                                    </div>

                                    <div className="admin-storage-form-section">
                                        <FormSectionTitle icon={<Database className="size-4" />} title="存储位置" description="Bucket 决定容器，路径前缀用于隔离当前应用写入的对象目录。" />
                                        {draftMode === "s3" ? (
                                            <Form.Item name="s3Preset" label="S3 预设" extra={getS3PresetHints(form.getFieldValue("s3Preset") || "custom").help}>
                                                <Select
                                                    options={S3_PRESET_OPTIONS}
                                                    onChange={(preset: S3Preset) => {
                                                        const hints = getS3PresetHints(preset);
                                                        form.setFieldsValue({ region: hints.region, endpoint: hints.endpoint });
                                                        setDirty(hasStorageChanges({ ...form.getFieldsValue(true), region: hints.region, endpoint: hints.endpoint, s3Preset: preset }, setting));
                                                        setTestStale(true);
                                                    }}
                                                />
                                            </Form.Item>
                                        ) : null}
                                        <div className="admin-storage-form-grid is-location">
                                            <Form.Item name="region" label="Region" extra={draftMode === "tencent" ? "Endpoint 留空时由 Region 自动生成。" : draftMode === "qiniu" ? "无绑定域名时用于兼容 S3 的私有读取。" : "按云厂商控制台显示值填写。"}>
                                                <Input
                                                    autoComplete="off"
                                                    placeholder={
                                                        draftMode === "s3" ? getS3PresetHints(form.getFieldValue("s3Preset") || "custom").region : draftMode === "tencent" ? "ap-guangzhou" : draftMode === "qiniu" ? "z0 / cn-east-1" : "oss-cn-hangzhou"
                                                    }
                                                />
                                            </Form.Item>
                                            <Form.Item name="bucket" label="Bucket">
                                                <Input autoComplete="off" placeholder={draftMode === "qiniu" ? "七牛云存储空间名称" : "对象存储 Bucket"} />
                                            </Form.Item>
                                            <Form.Item label="路径前缀" extra={`可自行填写；也可采用外观管理中的英文品牌标识 ${brandSlug}。保存时自动去除首尾斜杠。`}>
                                                <div className="admin-storage-address-control">
                                                    <Form.Item name="pathPrefix" noStyle>
                                                        <Input autoComplete="off" placeholder={`例如：${brandSlug}`} />
                                                    </Form.Item>
                                                    <Button disabled={saving || refreshing || form.getFieldValue("pathPrefix") === brandSlug} onClick={useBrandPathPrefix}>
                                                        使用品牌标识
                                                    </Button>
                                                </div>
                                            </Form.Item>
                                        </div>
                                    </div>

                                    <div className="admin-storage-form-section">
                                        <FormSectionTitle icon={<Globe2 className="size-4" />} title="连接与读取出口" description="Endpoint 用于服务端写入；CDN 或绑定域名只决定浏览器读取出口。" />
                                        <div className="admin-storage-form-grid">
                                            <Form.Item
                                                name="endpoint"
                                                label={draftMode === "qiniu" ? "上传 Endpoint" : "Endpoint"}
                                                extra={
                                                    draftMode === "s3"
                                                        ? getS3PresetHints(form.getFieldValue("s3Preset") || "custom").help
                                                        : draftMode === "tencent"
                                                          ? "可留空并由 Region 生成，也可填写完整 COS Endpoint。"
                                                          : "必须填写完整的 http/https 地址，服务端会继续执行出站安全校验。"
                                                }
                                            >
                                                <Input
                                                    autoComplete="off"
                                                    inputMode="url"
                                                    placeholder={
                                                        draftMode === "s3"
                                                            ? getS3PresetHints(form.getFieldValue("s3Preset") || "custom").endpoint
                                                            : draftMode === "tencent"
                                                              ? "https://cos.ap-guangzhou.myqcloud.com"
                                                              : draftMode === "qiniu"
                                                                ? "https://up-z0.qiniup.com"
                                                                : "https://oss-cn-hangzhou.aliyuncs.com"
                                                    }
                                                />
                                            </Form.Item>
                                            <Form.Item
                                                name="cdnBaseUrl"
                                                label={draftMode === "qiniu" ? "绑定域名（可选）" : "CDN 加速域名（可选）"}
                                                extra={draftMode === "qiniu" ? "留空时按下方分发策略处理；不会由浏览器自行决定是否代理。" : "只填写域名根地址，不包含路径、查询参数或认证信息。"}
                                            >
                                                <Input autoComplete="off" inputMode="url" placeholder="https://media.example.com" />
                                            </Form.Item>
                                            <Form.Item name="cdnAuthMode" label="CDN 访问鉴权" extra="public 适用于 CDN 已公开或由 CDN 自行鉴权；qiniu 仅支持七牛私有下载签名。阿里云/腾讯云私有 CDN 暂不自动签名。">
                                                <Select
                                                    options={[
                                                        { label: "未配置（回源或按兜底策略）", value: "" },
                                                        { label: "公开 CDN", value: "public" },
                                                        { label: "七牛私有下载签名", value: "qiniu" },
                                                    ]}
                                                />
                                            </Form.Item>
                                            <Form.Item name="requireCDN" label="必须走 CDN" valuePropName="checked" extra="开启后 CDN 鉴权配置不完整时直接失败，不会静默回源。">
                                                <Switch checkedChildren="严格" unCheckedChildren="允许回源" />
                                            </Form.Item>
                                            <Form.Item name="allowPrivateProxy" label="允许模型输入代理" valuePropName="checked" extra="仅允许服务端向第三方模型提交参考素材时读取私有源站。浏览器展示、复制、下载和本地处理始终直连 OSS/CDN，不会经平台中转媒体正文。">
                                                <Switch checkedChildren="允许" unCheckedChildren="禁止" />
                                            </Form.Item>
                                        </div>
                                    </div>

                                    <div className="admin-storage-form-section">
                                        <FormSectionTitle icon={<KeyRound className="size-4" />} title="服务端访问凭据" description="密钥仅用于当前后端读写对象；切换厂商时不能复用另一厂商的 Secret。" />
                                        <div className="admin-storage-form-grid">
                                            <Form.Item name="accessKeyId" label={accessKeyIdLabel(draftMode)}>
                                                <Input autoComplete="off" placeholder={accessKeyIdLabel(draftMode)} />
                                            </Form.Item>
                                            <Form.Item name="accessKeySecret" label={hasCurrentProviderSecret ? `${accessKeySecretLabel(draftMode)}（${configuredSecretText}）` : accessKeySecretLabel(draftMode)} extra="只在新增或替换当前厂商密钥时填写。">
                                                <Input.Password autoComplete="new-password" placeholder={hasCurrentProviderSecret ? "留空保留原密钥" : accessKeySecretLabel(draftMode)} />
                                            </Form.Item>
                                            {draftMode === "s3" ? (
                                                <Form.Item
                                                    name="sessionToken"
                                                    label={setting.provider === "s3" && setting.hasSessionToken ? `Session Token（${configuredSecretText}）` : "Session Token（可选）"}
                                                    extra="使用临时凭证时填写；留空会保留当前 S3 提供方已有 Token。"
                                                >
                                                    <Input.Password autoComplete="new-password" placeholder={setting.provider === "s3" && setting.hasSessionToken ? "留空保留原 Token" : "临时凭证 Session Token"} />
                                                </Form.Item>
                                            ) : null}
                                        </div>
                                        {draftMode === "s3" ? (
                                            <Form.Item name="pathStyle" label="Path Style" valuePropName="checked" extra="开启后强制使用 path-style；关闭时由后端按 Endpoint 自动选择。">
                                                <Switch checkedChildren="强制" unCheckedChildren="自动" />
                                            </Form.Item>
                                        ) : null}
                                    </div>
                                    <div className="admin-storage-form-section">
                                        <FormSectionTitle icon={<Wifi className="size-4" />} title="连接验证" description="使用当前草稿执行最小读写测试；测试不会保存配置，也不会迁移已有资源。" />
                                        <div className="flex flex-wrap items-center gap-3">
                                            <Button icon={<Wifi className="size-4" />} loading={testing} disabled={saving || refreshing} onClick={() => void testConnection()}>
                                                测试连接
                                            </Button>
                                            <ConnectionTestStatus result={testResult} stale={testStale} />
                                        </div>
                                    </div>
                                </>
                            )}
                            <div className="admin-storage-form-section">
                                <FormSectionTitle icon={<ShieldCheck className="size-4" />} title="用户自有存储" description="允许用户配置个人 S3 兼容存储；个人配置停用时仍回退到平台存储。" />
                                <Form.Item name="allowUserS3" label="允许个人 S3 兼容存储" valuePropName="checked">
                                    <Switch checkedChildren="允许" unCheckedChildren="不允许" />
                                </Form.Item>
                            </div>
                        </Form>
                    </SettingsSectionCard>
                </div>
            </div>
        </AdminPageFrame>
    );
}

function FormSectionTitle({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
    return (
        <div className="admin-storage-form-section-heading">
            <span>{icon}</span>
            <div>
                <h3>{title}</h3>
                <p>{description}</p>
            </div>
        </div>
    );
}

function ConnectionTestStatus({ result, stale }: { result: OSSConnectionTestResult | null; stale: boolean }) {
    if (stale) return <AdminStatusBadge label="配置已变化，请重新测试" tone="warning" />;
    if (!result) return <AdminStatusBadge label="尚未测试" tone="neutral" />;
    if (result.ok) return <AdminStatusBadge label={result.testedAt ? `测试通过 · ${formatSettingTime(result.testedAt, "刚刚")}` : "测试通过"} tone="success" />;
    return <AdminStatusBadge label={result.message || "测试失败"} tone="error" />;
}
