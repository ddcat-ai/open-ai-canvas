import { App, Button, Form, Input, Skeleton } from "antd";
import { AlertTriangle, BadgeCheck, Cloud, Database, Globe2, HardDrive, KeyRound, LocateFixed, RefreshCw, RotateCcw, Save, Server, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useBlocker } from "react-router";

import { cn } from "@/lib/utils";
import { getAdminOSSSetting, updateAdminOSSSetting, type AdminOSSSetting } from "@/services/api/auth";
import { useAdminContext } from "../admin-context";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminStatTile, AdminStatusBadge, configuredSecretText, SettingsSectionCard } from "../components/admin-ui";

type StorageMode = "local" | AdminOSSSetting["provider"];
type OSSFormValues = {
    mode: StorageMode;
    publicBaseUrl: string;
    region: string;
    endpoint: string;
    cdnBaseUrl: string;
    bucket: string;
    accessKeyId: string;
    accessKeySecret: string;
    pathPrefix: string;
};

type StoragePayload = Pick<AdminOSSSetting, "enabled" | "provider" | "region" | "endpoint" | "cdnBaseUrl" | "bucket" | "accessKeyId" | "accessKeySecret" | "publicBaseUrl" | "pathPrefix">;

const STORAGE_MODES: Array<{ mode: StorageMode; label: string; short: string; description: string }> = [
    { mode: "local", label: "服务器本地", short: "本地磁盘", description: "新增资源写入当前部署的数据目录，通过后端签名链接访问。" },
    { mode: "aliyun", label: "阿里云 OSS", short: "对象存储", description: "新增资源写入阿里云 Bucket，可选 CDN 域名读取。" },
    { mode: "tencent", label: "腾讯云 COS", short: "对象存储", description: "新增资源写入腾讯云 Bucket，可由 Region 生成 Endpoint。" },
    { mode: "qiniu", label: "七牛云 Kodo", short: "对象存储", description: "新增资源上传到 Kodo；无绑定域名时由后端代理读取。" },
];

export default function StorageSettingsPage() {
    const { message, modal } = App.useApp();
    const { references } = useAdminContext();
    const [setting, setSetting] = useState<AdminOSSSetting | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [draftMode, setDraftMode] = useState<StorageMode>("local");
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState("");
    const [form] = Form.useForm<OSSFormValues>();
    const requestVersionRef = useRef(0);
    const navigationConfirmOpenRef = useRef(false);
    const navigationTriggerRef = useRef<HTMLElement | null>(null);
    const userNameById = useMemo(() => new Map(references.users.map((user) => [user.id, user.displayName || user.username])), [references.users]);

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
        setSaveError("");
        return { ...current, ...nextValues } as OSSFormValues;
    };

    const requestModeChange = async (nextMode: StorageMode) => {
        if (!setting || nextMode === draftMode || saving || refreshing) return;
        const values = applyMode(nextMode);
        if (!values) return;
        const validationError = validateStorageDraft(values, setting);
        if (validationError) {
            message.info(`${validationError}；补全后点击保存修改即可生效`);
            return;
        }
        try {
            await save(values);
        } catch {
            // 保存错误已在 save 中就地提示。
        }
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

    if (loading && !setting) {
        return (
            <AdminPageFrame title="存储服务" description="配置新增资源的默认存储位置" scroll>
                <div className="admin-settings-stack admin-storage-settings" aria-label="正在读取平台存储配置" role="status">
                    <div className="admin-storage-command-bar">
                        <Skeleton active title={{ width: 180 }} paragraph={false} />
                    </div>
                    <div className="admin-storage-overview">
                        {Array.from({ length: 4 }).map((_, index) => (
                            <div key={index} className="admin-stat-tile">
                                <Skeleton active title={{ width: 96 }} paragraph={{ rows: 1 }} />
                            </div>
                        ))}
                    </div>
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
    const secretConfigured = draftMode === "local" || Boolean(normalizedDraft.accessKeySecret || hasCurrentProviderSecret);
    const configOperator = setting.updatedBy ? userNameById.get(setting.updatedBy) || setting.updatedBy : "系统默认";

    return (
        <AdminPageFrame title="存储服务" description="配置新增资源的默认存储位置" scroll>
            <div className="admin-settings-stack admin-storage-settings">
                <div className={cn("admin-storage-command-bar", dirty && "is-dirty")}>
                    <div className="admin-storage-command-copy" aria-live="polite">
                        <span className="admin-storage-command-icon">
                            <Database className="size-4" aria-hidden="true" />
                        </span>
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <strong>{dirty ? "平台存储有调整待保存" : "平台存储配置已同步"}</strong>
                                <AdminStatusBadge label={dirty ? "尚未生效" : "服务端当前值"} tone={dirty ? "warning" : "neutral"} />
                            </div>
                            <p>{dirty ? "当前选择和接入信息只在本页暂存；保存后仅影响新增资源。" : "页面显示新增资源的默认去向；已有资源保持原存储位置。"}</p>
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

                <div className="admin-storage-overview" aria-label="平台存储配置概览">
                    <AdminStatTile label="新增资源存储" value={storageProviderLabel(draftMode)} detail={dirty ? "暂存状态预览" : formatSettingTime(setting.updatedAt, "使用系统默认值")} />
                    <AdminStatTile
                        label="读取链路"
                        value={storageDeliveryLabel(draftMode, normalizedDraft.cdnBaseUrl)}
                        detail={draftMode === "local" ? "经当前后端签名访问" : normalizedDraft.cdnBaseUrl ? "浏览器使用绑定或 CDN 域名" : "使用签名地址或后端代理"}
                    />
                    <AdminStatTile
                        label="访问凭据"
                        value={secretConfigured ? (draftMode === "local" ? "无需云密钥" : "已配置") : "未配置"}
                        detail={draftMode === "local" ? "由当前部署管理资源" : hasCurrentProviderSecret && !normalizedDraft.accessKeySecret ? "保留服务端已有密钥" : "密钥仅保存在服务端"}
                    />
                    <AdminStatTile label="配置来源" value={hasValidSettingTime(setting.updatedAt) ? "管理员配置" : "系统默认"} detail={hasValidSettingTime(setting.updatedAt) ? configOperator : "尚未保存平台存储配置"} />
                </div>

                <div id="admin-storage-mode" className="admin-settings-anchor">
                    <SettingsSectionCard
                        className="admin-storage-section admin-storage-mode-section"
                        icon={<HardDrive className="size-4" aria-hidden="true" />}
                        title="新资源存储位置"
                        description="选择之后新增资源的默认写入位置，不迁移、覆盖或删除已有资源。"
                        status={<AdminStatusBadge label={dirty ? `待切换为${storageProviderLabel(draftMode)}` : storageProviderLabel(draftMode)} tone={dirty ? "warning" : "neutral"} />}
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
                                        onClick={() => void requestModeChange(item.mode)}
                                    >
                                        <span className="admin-storage-mode-icon">{item.mode === "local" ? <HardDrive className="size-4" aria-hidden="true" /> : <Cloud className="size-4" aria-hidden="true" />}</span>
                                        <span className="admin-storage-mode-copy">
                                            <strong>{item.label}</strong>
                                            <small>{item.description}</small>
                                        </span>
                                        <AdminStatusBadge label={draftMode === item.mode ? "当前选择" : item.short} tone={draftMode === item.mode ? "info" : "neutral"} />
                                    </button>
                                ))}
                            </div>
                            <div className="admin-storage-history-note">
                                <ShieldCheck className="size-4" aria-hidden="true" />
                                <span>切换后只改变新增资源；历史资源仍按自身记录的 provider、Endpoint 和 Bucket 读取，云厂商切换时服务端会归档上一厂商凭据。</span>
                            </div>
                        </div>
                    </SettingsSectionCard>
                </div>

                <div id="admin-storage-access" className="admin-settings-anchor">
                    <SettingsSectionCard
                        className="admin-storage-section admin-storage-configuration-section"
                        icon={draftMode === "local" ? <Server className="size-4" aria-hidden="true" /> : <Cloud className="size-4" aria-hidden="true" />}
                        title={draftMode === "local" ? "服务器本地访问" : `${storageProviderLabel(draftMode)} 接入配置`}
                        description={draftMode === "local" ? "设置浏览器访问本地资源时使用的服务器根地址。" : "配置新资源写入位置、读取出口和服务端访问密钥。"}
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
                                    <span>{formatSettingTime(setting.updatedAt, "尚未保存平台存储配置")} · 保存不会连接存储服务或上传测试文件</span>
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
                            onValuesChange={() => {
                                const values = form.getFieldsValue(true);
                                setDraftMode(values.mode || "local");
                                setDirty(hasStorageChanges(values, setting));
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
                                        <Form.Item name="publicBaseUrl" label="服务器访问地址" extra="服务端还会按部署安全策略校验协议、主机及私网访问许可。">
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
                                        <div className="admin-storage-form-grid is-location">
                                            <Form.Item name="region" label="Region" extra={draftMode === "tencent" ? "Endpoint 留空时由 Region 自动生成。" : draftMode === "qiniu" ? "无绑定域名时用于兼容 S3 的私有读取。" : "按云厂商控制台显示值填写。"}>
                                                <Input autoComplete="off" placeholder={draftMode === "tencent" ? "ap-guangzhou" : draftMode === "qiniu" ? "z0 / cn-east-1" : "oss-cn-hangzhou"} />
                                            </Form.Item>
                                            <Form.Item name="bucket" label="Bucket">
                                                <Input autoComplete="off" placeholder={draftMode === "qiniu" ? "七牛云存储空间名称" : "对象存储 Bucket"} />
                                            </Form.Item>
                                            <Form.Item name="pathPrefix" label="路径前缀" extra="可留空；保存时自动去除首尾斜杠。">
                                                <Input autoComplete="off" placeholder="例如：canvas" />
                                            </Form.Item>
                                        </div>
                                    </div>

                                    <div className="admin-storage-form-section">
                                        <FormSectionTitle icon={<Globe2 className="size-4" />} title="连接与读取出口" description="Endpoint 用于服务端写入；CDN 或绑定域名只决定浏览器读取出口。" />
                                        <div className="admin-storage-form-grid">
                                            <Form.Item
                                                name="endpoint"
                                                label={draftMode === "qiniu" ? "上传 Endpoint" : "Endpoint"}
                                                extra={draftMode === "tencent" ? "可留空并由 Region 生成，也可填写完整 COS Endpoint。" : "必须填写完整的 http/https 地址，服务端会继续执行出站安全校验。"}
                                            >
                                                <Input
                                                    autoComplete="off"
                                                    inputMode="url"
                                                    placeholder={draftMode === "tencent" ? "https://cos.ap-guangzhou.myqcloud.com" : draftMode === "qiniu" ? "https://up-z0.qiniup.com" : "https://oss-cn-hangzhou.aliyuncs.com"}
                                                />
                                            </Form.Item>
                                            <Form.Item
                                                name="cdnBaseUrl"
                                                label={draftMode === "qiniu" ? "绑定域名（可选）" : "CDN 加速域名（可选）"}
                                                extra={draftMode === "qiniu" ? "留空时浏览器通过当前后端代理读取七牛私有对象。" : "只填写域名根地址，不包含路径、查询参数或认证信息。"}
                                            >
                                                <Input autoComplete="off" inputMode="url" placeholder="https://media.example.com" />
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
                                        </div>
                                    </div>
                                </>
                            )}
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

function formValues(setting: AdminOSSSetting): OSSFormValues {
    return {
        mode: setting.enabled ? setting.provider : "local",
        publicBaseUrl: setting.publicBaseUrl || "",
        region: setting.region || "",
        endpoint: setting.endpoint || "",
        cdnBaseUrl: setting.cdnBaseUrl || "",
        bucket: setting.bucket || "",
        accessKeyId: setting.accessKeyId || "",
        accessKeySecret: "",
        pathPrefix: setting.pathPrefix || "",
    };
}

function providerDraftValues(mode: Exclude<StorageMode, "local">, setting: AdminOSSSetting, pathPrefix: string): Partial<OSSFormValues> {
    if (mode === setting.provider) {
        return {
            region: setting.region || "",
            endpoint: setting.endpoint || "",
            cdnBaseUrl: setting.cdnBaseUrl || "",
            bucket: setting.bucket || "",
            accessKeyId: setting.accessKeyId || "",
            accessKeySecret: "",
            pathPrefix: setting.pathPrefix || pathPrefix || "",
        };
    }
    return { region: "", endpoint: "", cdnBaseUrl: "", bucket: "", accessKeyId: "", accessKeySecret: "", pathPrefix: pathPrefix || "" };
}

function normalizeStoragePayload(values: Partial<OSSFormValues>, setting: AdminOSSSetting): StoragePayload {
    const mode = values.mode || "local";
    const provider = mode === "local" ? setting.provider || "aliyun" : mode;
    const region = values.region?.trim() || "";
    let endpoint = trimTrailingSlash(values.endpoint || "");
    if (provider === "tencent" && !endpoint && region) endpoint = `https://cos.${region}.myqcloud.com`;
    return {
        enabled: mode !== "local",
        provider,
        region,
        endpoint,
        cdnBaseUrl: trimTrailingSlash(values.cdnBaseUrl || ""),
        bucket: values.bucket?.trim() || "",
        accessKeyId: values.accessKeyId?.trim() || "",
        accessKeySecret: values.accessKeySecret?.trim() || "",
        publicBaseUrl: trimTrailingSlash(values.publicBaseUrl || ""),
        pathPrefix: (values.pathPrefix?.trim() || "").replace(/^\/+|\/+$/g, ""),
    };
}

function hasStorageChanges(values: Partial<OSSFormValues>, setting: AdminOSSSetting | null) {
    if (!setting) return false;
    const draft = normalizeStoragePayload(values, setting);
    const saved = normalizeStoragePayload(formValues(setting), setting);
    if (draft.accessKeySecret) return true;
    return (Object.keys(saved) as Array<keyof StoragePayload>).some((key) => key !== "accessKeySecret" && draft[key] !== saved[key]);
}

function validateStorageDraft(values: OSSFormValues, setting: AdminOSSSetting) {
    const draft = normalizeStoragePayload(values, setting);
    if (!draft.enabled) return validatePublicBaseURL(draft.publicBaseUrl);
    if (!draft.bucket) return "请填写对象存储 Bucket";
    if (!draft.endpoint) return draft.provider === "tencent" ? "请填写腾讯云 COS Region 或 Endpoint" : draft.provider === "qiniu" ? "请填写七牛云 Kodo 上传 Endpoint" : "请填写阿里云 OSS Endpoint";
    if (!isHTTPURL(draft.endpoint)) return "Endpoint 必须是完整的 http/https 地址";
    if (draft.cdnBaseUrl && !isValidCDNBaseURL(draft.cdnBaseUrl)) return "CDN 或绑定域名只能填写 http/https 根地址，不能包含认证、路径、查询参数或片段";
    if (!draft.accessKeyId) return `请填写 ${accessKeyIdLabel(draft.provider)}`;
    if (!draft.accessKeySecret && !(setting.provider === draft.provider && setting.hasAccessKeySecret)) return `请填写 ${accessKeySecretLabel(draft.provider)}`;
    return "";
}

function validatePublicBaseURL(value: string) {
    if (!value) return "服务器本地存储需要填写服务器访问地址";
    try {
        const parsed = new URL(value);
        if (!parsed.hostname || !["http:", "https:"].includes(parsed.protocol)) return "服务器访问地址必须是完整的 http/https 地址";
        if (parsed.search || parsed.hash) return "服务器访问地址不能包含查询参数或片段";
        if (parsed.pathname.replace(/\/+$/, "").endsWith("/api")) return "服务器访问地址请填写站点根地址，不要包含 /api";
        return "";
    } catch {
        return "服务器访问地址必须是完整的 http/https 地址";
    }
}

function storageResponseMatches(setting: AdminOSSSetting, expected: StoragePayload) {
    const actual = normalizeStoragePayload(formValues(setting), setting);
    const fields: Array<keyof StoragePayload> = ["enabled", "provider", "region", "endpoint", "cdnBaseUrl", "bucket", "accessKeyId", "publicBaseUrl", "pathPrefix"];
    if (expected.accessKeySecret && !setting.hasAccessKeySecret) return false;
    return fields.every((key) => actual[key] === expected[key]);
}

function isAdminOSSSetting(value: unknown): value is AdminOSSSetting {
    if (!value || typeof value !== "object") return false;
    const setting = value as Partial<AdminOSSSetting>;
    return (
        typeof setting.enabled === "boolean" &&
        ["aliyun", "tencent", "qiniu"].includes(setting.provider || "") &&
        typeof setting.region === "string" &&
        typeof setting.endpoint === "string" &&
        typeof setting.cdnBaseUrl === "string" &&
        typeof setting.bucket === "string" &&
        typeof setting.accessKeyId === "string" &&
        typeof setting.hasAccessKeySecret === "boolean" &&
        typeof setting.publicBaseUrl === "string" &&
        typeof setting.pathPrefix === "string"
    );
}

function storageConfigurationReady(mode: StorageMode, values: StoragePayload, setting: AdminOSSSetting) {
    if (mode === "local") return !validatePublicBaseURL(values.publicBaseUrl);
    return !validateStorageDraft({ ...formValues(setting), ...values, mode }, setting);
}

function storageProviderLabel(provider?: StorageMode) {
    return provider === "tencent" ? "腾讯云 COS" : provider === "qiniu" ? "七牛云 Kodo" : provider === "aliyun" ? "阿里云 OSS" : "服务器本地";
}

function storageDeliveryLabel(mode: StorageMode, cdnBaseUrl: string) {
    if (mode === "local") return "后端签名链接";
    if (cdnBaseUrl) return mode === "qiniu" ? "绑定域名" : "CDN 域名";
    return mode === "qiniu" ? "后端代理" : "对象存储签名";
}

function providerGuidance(mode: Exclude<StorageMode, "local">) {
    if (mode === "tencent") return "腾讯云可只填写 Region，由服务端生成标准 COS Endpoint；也可填写完整 Endpoint 覆盖。";
    if (mode === "qiniu") return "七牛上传必须配置上传 Endpoint；绑定域名可选，留空时资源由当前后端使用 AK/SK 代理读取。";
    return "阿里云需要完整 OSS Endpoint、Bucket 和访问密钥；CDN 域名可选。";
}

function accessKeyIdLabel(mode: Exclude<StorageMode, "local"> | AdminOSSSetting["provider"]) {
    return mode === "tencent" ? "SecretId" : mode === "qiniu" ? "AccessKey" : "AccessKey ID";
}

function accessKeySecretLabel(mode: Exclude<StorageMode, "local"> | AdminOSSSetting["provider"]) {
    return mode === "tencent" || mode === "qiniu" ? "SecretKey" : "AccessKey Secret";
}

function isHTTPURL(value: string) {
    try {
        const parsed = new URL(value);
        return Boolean(parsed.hostname) && ["http:", "https:"].includes(parsed.protocol);
    } catch {
        return false;
    }
}

function isValidCDNBaseURL(value: string) {
    try {
        const parsed = new URL(value);
        return Boolean(parsed.hostname) && ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.search && !parsed.hash && !parsed.pathname.replace(/\/+$/, "");
    } catch {
        return false;
    }
}

function trimTrailingSlash(value: string) {
    return value.trim().replace(/\/+$/, "");
}

function hasValidSettingTime(value?: string) {
    if (!value) return false;
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date.getFullYear() >= 2000;
}

function formatSettingTime(value: string | undefined, fallback: string) {
    if (!hasValidSettingTime(value)) return fallback;
    return `更新于 ${new Date(value as string).toLocaleString("zh-CN", { hour12: false })}`;
}
