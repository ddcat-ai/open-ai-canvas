import { App, Button, Form, Input, Skeleton, Switch } from "antd";
import { AlertTriangle, BadgeCheck, CircleCheck, CloudUpload, Database, FolderOpen, ImageIcon, KeyRound, RefreshCw, RotateCcw, Save, Server, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useBlocker } from "react-router";

import { cn } from "@/lib/utils";
import { getAdminArkPrivateAssetSetting, updateAdminArkPrivateAssetSetting, type AdminArkPrivateAssetSetting } from "@/services/api/auth";
import { useAdminContext } from "../admin-context";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminStatTile, AdminStatusBadge, configuredSecretText, SettingsSectionCard } from "../components/admin-ui";

type ArkPrivateAssetForm = {
    enabled: boolean;
    region: string;
    projectName: string;
    accessKeyId: string;
    accessKeySecret: string;
};

type ArkPrivateAssetPayload = Pick<AdminArkPrivateAssetSetting, "enabled" | "region" | "projectName" | "accessKeyId" | "accessKeySecret">;

export default function ArkPrivateAssetsSettingsPage() {
    const { message, modal } = App.useApp();
    const { references } = useAdminContext();
    const [setting, setSetting] = useState<AdminArkPrivateAssetSetting | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [draftEnabled, setDraftEnabled] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState("");
    const [form] = Form.useForm<ArkPrivateAssetForm>();
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
                const result = await getAdminArkPrivateAssetSetting();
                if (requestVersion !== requestVersionRef.current) return;
                if (!isAdminArkPrivateAssetSetting(result.setting)) throw new Error("服务端返回的方舟素材库配置格式无效");
                setSetting(result.setting);
                setDirty(false);
                setSaveError("");
                if (announce) message.success("已重新读取方舟素材库配置");
            } catch (error) {
                if (requestVersion !== requestVersionRef.current) return;
                const errorMessage = error instanceof Error ? error.message : "读取方舟素材库配置失败";
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
        const values = toFormValues(setting);
        form.setFieldsValue(values);
        setDraftEnabled(values.enabled);
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
            title: "放弃方舟素材库调整？",
            content: "当前页面有尚未保存的同步策略、项目或 IAM 凭据草稿，离开后这些内容会丢失。服务端正在使用的配置不会改变。",
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
                    const fallback = document.querySelector<HTMLButtonElement>(".admin-ark-command-actions button");
                    const target = navigationTriggerRef.current?.isConnected ? navigationTriggerRef.current : fallback;
                    target?.focus();
                    navigationTriggerRef.current = null;
                });
            },
        });
    }, [blocker, modal]);

    const resetDraft = () => {
        if (!setting || saving) return;
        const values = toFormValues(setting);
        form.setFieldsValue(values);
        form.setFields([]);
        setDraftEnabled(values.enabled);
        setDirty(false);
        setSaveError("");
        message.info("已撤销方舟素材库的未保存调整");
    };

    const requestRefresh = () => {
        if (!dirty) {
            void load(false, true);
            return;
        }
        modal.confirm({
            title: "放弃调整并重新读取？",
            content: "重新读取会丢弃当前同步策略、项目和 IAM 凭据草稿，并以服务端配置为准。",
            okText: "放弃并刷新",
            cancelText: "继续编辑",
            okButtonProps: { danger: true },
            onOk: () => load(false, true),
        });
    };

    const save = async (values: ArkPrivateAssetForm) => {
        if (!setting) return;
        const expected = normalizeArkPrivateAssetPayload(values);
        const expectedHasSecret = nextSecretPresence(expected, setting);
        setSaving(true);
        setSaveError("");
        try {
            const result = await updateAdminArkPrivateAssetSetting(expected);
            if (!isAdminArkPrivateAssetSetting(result.setting) || !arkPrivateAssetResponseMatches(result.setting, expected, expectedHasSecret)) {
                throw new Error("服务端返回的方舟素材库配置与本次保存内容不一致，请重新读取后核对");
            }
            setSetting(result.setting);
            const nextValues = toFormValues(result.setting);
            form.setFieldsValue(nextValues);
            setDraftEnabled(nextValues.enabled);
            setDirty(false);
            message.success("方舟素材库配置已保存");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "保存方舟素材库配置失败";
            setSaveError(`${errorMessage}。未自动重试，请重新读取当前配置后再决定是否保存。`);
            message.error(errorMessage);
            throw error;
        } finally {
            setSaving(false);
        }
    };

    const submitSave = async () => {
        if (!setting) return;
        let values: ArkPrivateAssetForm;
        try {
            values = await form.validateFields();
        } catch {
            return;
        }
        const validationError = validateArkPrivateAssetDraft(values, setting);
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

    const toggleEnabled = async (enabled: boolean) => {
        if (!setting || saving || enabled === setting.enabled) return;
        const values = (enabled ? { ...form.getFieldsValue(true), enabled } : { ...toFormValues(setting), enabled, accessKeySecret: "" }) as ArkPrivateAssetForm;
        const validationError = validateArkPrivateAssetDraft(values, setting);
        if (validationError) {
            form.setFieldValue("enabled", setting.enabled);
            setDraftEnabled(setting.enabled);
            message.error(validationError);
            return;
        }
        form.setFieldValue("enabled", enabled);
        setDraftEnabled(enabled);
        try {
            await save(values);
        } catch {
            form.setFieldValue("enabled", setting.enabled);
            setDraftEnabled(setting.enabled);
        }
    };

    if (loading && !setting) {
        return (
            <AdminPageFrame title="方舟素材库" description="为 Seedance 参考图配置后端可信素材导入" scroll>
                <div className="admin-settings-stack admin-ark-settings" aria-label="正在读取方舟素材库配置" role="status">
                    <div className="admin-ark-command-bar">
                        <Skeleton active title={{ width: 190 }} paragraph={false} />
                    </div>
                    <div className="admin-ark-overview">
                        {Array.from({ length: 4 }).map((_, index) => (
                            <div key={index} className="admin-stat-tile">
                                <Skeleton active title={{ width: 96 }} paragraph={{ rows: 1 }} />
                            </div>
                        ))}
                    </div>
                    <div className="admin-ark-loading-card">
                        <Skeleton active paragraph={{ rows: 7 }} />
                    </div>
                </div>
            </AdminPageFrame>
        );
    }

    if (!setting) {
        return (
            <AdminPageFrame title="方舟素材库" description="为 Seedance 参考图配置后端可信素材导入" scroll>
                <div className="admin-settings-stack admin-ark-settings">
                    <div className="admin-ark-load-error" role="alert">
                        <span className="admin-ark-load-error-icon">
                            <AlertTriangle className="size-5" aria-hidden="true" />
                        </span>
                        <div>
                            <h2>无法读取方舟素材库配置</h2>
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
    const normalizedDraft = normalizeArkPrivateAssetPayload(currentValues);
    const usableSecret = hasUsableSecret(normalizedDraft, setting);
    const configOperator = setting.updatedBy ? userNameById.get(setting.updatedBy) || setting.updatedBy : "系统默认";
    const projectReady = Boolean(normalizedDraft.region && normalizedDraft.projectName);
    const credentialsReady = Boolean(normalizedDraft.accessKeyId && usableSecret);

    return (
        <AdminPageFrame title="方舟素材库" description="为 Seedance 参考图配置后端可信素材导入" scroll>
            <div className="admin-settings-stack admin-ark-settings">
                <div className={cn("admin-ark-command-bar", dirty && "is-dirty")}>
                    <div className="admin-ark-command-copy" aria-live="polite">
                        <span className="admin-ark-command-icon">
                            <CloudUpload className="size-4" aria-hidden="true" />
                        </span>
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <strong>{dirty ? "方舟素材库有调整待保存" : "方舟素材库配置已同步"}</strong>
                                <AdminStatusBadge label={dirty ? "尚未生效" : "服务端当前值"} tone={dirty ? "warning" : "neutral"} />
                            </div>
                            <p>{dirty ? "当前同步策略与 IAM 信息只在本页暂存；不会提前上传或创建素材。" : "页面显示可信参考素材的自动同步策略；已有方舟素材不受开关变更影响。"}</p>
                        </div>
                    </div>
                    <div className="admin-ark-command-actions">
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
                    <div className="admin-ark-inline-alert" role="alert">
                        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                        <span>{saveError || `${loadError}。页面仍显示上一次成功读取的配置。`}</span>
                    </div>
                ) : null}

                <div className="admin-ark-overview" aria-label="方舟素材库配置概览">
                    <AdminStatTile label="可信素材同步" value={draftEnabled ? "已启用" : "已停用"} detail={dirty ? "暂存状态预览" : formatSettingTime(setting.updatedAt, "使用系统默认值")} />
                    <AdminStatTile label="方舟项目" value={normalizedDraft.projectName || "未配置"} detail={normalizedDraft.region ? `Region · ${normalizedDraft.region}` : "尚未填写 Region"} />
                    <AdminStatTile label="IAM 凭据" value={credentialsReady ? "已配置" : "待配置"} detail={normalizedDraft.accessKeyId ? (usableSecret ? "AccessKey 与 SecretKey 可用" : "当前 AccessKey 缺少 SecretKey") : "尚未填写 AccessKey"} />
                    <AdminStatTile label="配置来源" value={hasValidSettingTime(setting.updatedAt) ? "管理员配置" : "系统默认"} detail={hasValidSettingTime(setting.updatedAt) ? configOperator : "尚未保存方舟素材库配置"} />
                </div>

                <div id="admin-ark-policy" className="admin-settings-anchor">
                    <SettingsSectionCard
                        className="admin-ark-section admin-ark-policy-section"
                        icon={<ImageIcon className="size-4" aria-hidden="true" />}
                        title="可信参考素材同步"
                        description="控制符合条件的 Seedance 图片参考素材是否由后端导入方舟并等待审核。"
                        status={<AdminStatusBadge label={dirty ? (draftEnabled ? "待启用" : "待停用") : draftEnabled ? "已启用" : "已停用"} tone={dirty ? "warning" : draftEnabled ? "success" : "neutral"} />}
                    >
                        <div className="admin-ark-policy-control">
                            <span className="admin-ark-policy-icon">
                                <CloudUpload className="size-4" aria-hidden="true" />
                            </span>
                            <div className="admin-ark-policy-copy">
                                <strong>自动导入可信素材</strong>
                                <p>只有 Seedance / 方舟视频请求、用户允许自动同步、参考图属于当前用户且资源已就绪时才会触发。</p>
                                <span>{draftEnabled ? "符合条件的图片将在调用生成模型前上传并等待方舟审核。" : "新请求保持原参考地址，不再自动创建方舟可信素材。"}</span>
                            </div>
                            <div className="admin-ark-policy-switch">
                                <span>{draftEnabled ? "启用" : "停用"}</span>
                                <Switch checked={draftEnabled} disabled={loading || refreshing || saving} aria-label="启用可信素材同步，切换后立即保存" onChange={(checked) => void toggleEnabled(checked)} />
                            </div>
                        </div>

                        <div className="admin-ark-flow" aria-label="可信素材同步条件">
                            <FlowStep icon={<Server className="size-4" />} eyebrow="生成入口" title="方舟视频任务" description="仅处理 Seedance 或兼容方舟方案的视频请求。" />
                            <FlowStep icon={<ImageIcon className="size-4" />} eyebrow="资源边界" title="当前用户图片" description="必须是用户有权访问且上传完成的图片素材。" />
                            <FlowStep icon={<CircleCheck className="size-4" />} eyebrow="服务端处理" title="导入并等待审核" description="创建或复用绑定，审核通过后再传入 asset ID。" />
                        </div>

                        <div className="admin-ark-context-note">
                            <ShieldCheck className="size-4" aria-hidden="true" />
                            <span>停用只停止新的自动同步，不会删除已有方舟素材、审核结果或本地资源绑定；普通参考图仍按原地址继续生成。</span>
                        </div>
                    </SettingsSectionCard>
                </div>

                <div id="admin-ark-credentials" className="admin-settings-anchor">
                    <SettingsSectionCard
                        className="admin-ark-section admin-ark-configuration-section"
                        icon={<KeyRound className="size-4" aria-hidden="true" />}
                        title="方舟项目与 IAM 凭据"
                        description="配置控制面 Region、Ark ProjectName，以及后端创建素材组和上传素材所用的 IAM AK/SK。"
                        status={<AdminStatusBadge label={dirty ? "有调整" : projectReady && credentialsReady ? "已配置" : "待配置"} tone={dirty ? "warning" : projectReady && credentialsReady ? "success" : "neutral"} />}
                        footer={
                            <>
                                <div className="admin-ark-footer-note">
                                    <BadgeCheck className="size-4" aria-hidden="true" />
                                    <span>{formatSettingTime(setting.updatedAt, "尚未保存方舟素材库配置")} · 保存不会连接方舟或上传测试素材</span>
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
                                setDraftEnabled(Boolean(values.enabled));
                                setDirty(hasArkPrivateAssetChanges(values, setting));
                                setSaveError("");
                            }}
                        >
                            <Form.Item name="enabled" valuePropName="checked" hidden>
                                <Switch />
                            </Form.Item>

                            <div className="admin-ark-form-section">
                                <FormSectionTitle icon={<FolderOpen className="size-4" />} title="项目范围" description="Region 决定方舟控制面地址，ProjectName 决定素材组和资源所属项目。" />
                                <div className="admin-ark-form-grid">
                                    <Form.Item name="region" label="Region" extra="按火山方舟控制台显示值填写；启用同步时必填。">
                                        <Input autoComplete="off" placeholder="例如：cn-beijing" />
                                    </Form.Item>
                                    <Form.Item name="projectName" label="Ark ProjectName" extra="必须与 IAM 凭据可访问的方舟项目一致。">
                                        <Input autoComplete="off" placeholder="部署方的 Ark ProjectName" />
                                    </Form.Item>
                                </div>
                            </div>

                            <div className="admin-ark-form-section">
                                <FormSectionTitle icon={<KeyRound className="size-4" />} title="服务端 IAM 凭据" description="仅供当前后端创建素材组、上传图片和查询审核状态，不会下发到浏览器。" />
                                <div className="admin-ark-form-grid">
                                    <Form.Item name="accessKeyId" label="IAM AccessKey" extra="更换 AccessKey 时必须同时提供匹配的 SecretKey 才能启用同步。">
                                        <Input autoComplete="off" prefix={<KeyRound className="size-4 text-foreground/35" />} placeholder="仅保存在服务端" />
                                    </Form.Item>
                                    <Form.Item name="accessKeySecret" label={setting.hasAccessKeySecret ? `IAM SecretKey（${configuredSecretText}）` : "IAM SecretKey"} extra="AccessKey 未变化时留空可保留原密钥；更换 AccessKey 后留空会清除原密钥。">
                                        <Input.Password autoComplete="new-password" placeholder={setting.hasAccessKeySecret ? "留空保留原密钥" : "仅保存在服务端"} />
                                    </Form.Item>
                                </div>
                                <div className="admin-ark-scope-note">
                                    <Database className="size-4" aria-hidden="true" />
                                    <span>Region、ProjectName 或 AccessKey 改变后，服务端会清除缓存的默认素材组 ID，并在下一次真实同步时按新范围创建；已有素材绑定不会在保存时删除。</span>
                                </div>
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
        <div className="admin-ark-form-section-heading">
            <span>{icon}</span>
            <div>
                <h3>{title}</h3>
                <p>{description}</p>
            </div>
        </div>
    );
}

function FlowStep({ icon, eyebrow, title, description }: { icon: ReactNode; eyebrow: string; title: string; description: string }) {
    return (
        <div className="admin-ark-flow-step">
            <span className="admin-ark-flow-icon">{icon}</span>
            <div>
                <small>{eyebrow}</small>
                <strong>{title}</strong>
                <p>{description}</p>
            </div>
        </div>
    );
}

function toFormValues(setting: AdminArkPrivateAssetSetting): ArkPrivateAssetForm {
    return {
        enabled: setting.enabled,
        region: setting.region || "",
        projectName: setting.projectName || "",
        accessKeyId: setting.accessKeyId || "",
        accessKeySecret: "",
    };
}

function normalizeArkPrivateAssetPayload(values: Partial<ArkPrivateAssetForm>): ArkPrivateAssetPayload {
    return {
        enabled: Boolean(values.enabled),
        region: values.region?.trim() || "",
        projectName: values.projectName?.trim() || "",
        accessKeyId: values.accessKeyId?.trim() || "",
        accessKeySecret: values.accessKeySecret?.trim() || "",
    };
}

function hasArkPrivateAssetChanges(values: Partial<ArkPrivateAssetForm>, setting: AdminArkPrivateAssetSetting | null) {
    if (!setting) return false;
    const draft = normalizeArkPrivateAssetPayload(values);
    const saved = normalizeArkPrivateAssetPayload(toFormValues(setting));
    return draft.accessKeySecret !== "" || draft.enabled !== saved.enabled || draft.region !== saved.region || draft.projectName !== saved.projectName || draft.accessKeyId !== saved.accessKeyId;
}

function validateArkPrivateAssetDraft(values: ArkPrivateAssetForm, setting: AdminArkPrivateAssetSetting) {
    const draft = normalizeArkPrivateAssetPayload(values);
    if (!draft.enabled) return "";
    if (!draft.region) return "请填写方舟 Region";
    if (!draft.projectName) return "请填写方舟 ProjectName";
    if (!draft.accessKeyId) return "请填写方舟素材库 IAM AccessKey";
    if (!hasUsableSecret(draft, setting)) return draft.accessKeyId !== setting.accessKeyId ? "更换 IAM AccessKey 时请同时填写匹配的 SecretKey" : "请填写方舟素材库 IAM SecretKey";
    return "";
}

function hasUsableSecret(values: ArkPrivateAssetPayload, setting: AdminArkPrivateAssetSetting) {
    return Boolean(values.accessKeySecret || (values.accessKeyId === setting.accessKeyId && setting.hasAccessKeySecret));
}

function nextSecretPresence(values: ArkPrivateAssetPayload, setting: AdminArkPrivateAssetSetting) {
    if (values.accessKeySecret) return true;
    return values.accessKeyId === setting.accessKeyId && setting.hasAccessKeySecret;
}

function arkPrivateAssetResponseMatches(setting: AdminArkPrivateAssetSetting, expected: ArkPrivateAssetPayload, expectedHasSecret: boolean) {
    return setting.enabled === expected.enabled && setting.region === expected.region && setting.projectName === expected.projectName && setting.accessKeyId === expected.accessKeyId && setting.hasAccessKeySecret === expectedHasSecret;
}

function isAdminArkPrivateAssetSetting(value: unknown): value is AdminArkPrivateAssetSetting {
    if (!value || typeof value !== "object") return false;
    const setting = value as Partial<AdminArkPrivateAssetSetting>;
    return typeof setting.enabled === "boolean" && typeof setting.region === "string" && typeof setting.projectName === "string" && typeof setting.accessKeyId === "string" && typeof setting.hasAccessKeySecret === "boolean";
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
