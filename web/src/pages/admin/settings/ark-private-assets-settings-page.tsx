import { App, Button, Form, Input, Skeleton, Switch } from "antd";
import { AlertTriangle, CloudUpload, KeyRound, RefreshCw, RotateCcw, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";

import { cn } from "@/lib/utils";
import { getAdminArkPrivateAssetSetting, updateAdminArkPrivateAssetSetting, type AdminArkPrivateAssetSetting } from "@/services/api/auth";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminStatusBadge, configuredSecretText, SettingsSectionCard } from "../components/admin-ui";

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
    const [setting, setSetting] = useState<AdminArkPrivateAssetSetting | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState("");
    const [form] = Form.useForm<ArkPrivateAssetForm>();
    const requestVersionRef = useRef(0);
    const navigationConfirmOpenRef = useRef(false);
    const navigationTriggerRef = useRef<HTMLElement | null>(null);
    const watchedValues = Form.useWatch([], form) as Partial<ArkPrivateAssetForm> | undefined;
    const draftEnabled = watchedValues?.enabled === true;

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
        form.setFieldsValue(toFormValues(setting));
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

    if (loading && !setting) {
        return (
            <AdminPageFrame title="方舟素材库" description="为 Seedance 参考图配置后端可信素材导入" scroll>
                <div className="admin-settings-stack admin-ark-settings" aria-label="正在读取方舟素材库配置" role="status">
                    <div className="admin-ark-command-bar">
                        <Skeleton active title={{ width: 190 }} paragraph={false} />
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

    const currentValues = watchedValues || form.getFieldsValue(true);
    const normalizedDraft = normalizeArkPrivateAssetPayload(currentValues);
    const usableSecret = hasUsableSecret(normalizedDraft, setting);
    const projectReady = Boolean(normalizedDraft.region && normalizedDraft.projectName);
    const credentialsReady = Boolean(normalizedDraft.accessKeyId && usableSecret);
    const prerequisitesReady = projectReady && credentialsReady;

    return (
        <AdminPageFrame title="方舟素材库" description="为 Seedance 参考图配置后端可信素材导入" scroll>
            <div className="admin-settings-stack admin-ark-settings">
                <div className={cn("admin-ark-command-bar", dirty && "is-dirty")}>
                    <div className="admin-ark-command-copy" aria-live="polite">
                        <div className="flex flex-wrap items-center gap-2">
                            <strong>{dirty ? "方舟素材库有调整待保存" : "方舟素材库配置已同步"}</strong>
                            <AdminStatusBadge label={dirty ? "尚未生效" : "服务端配置"} tone={dirty ? "warning" : "neutral"} />
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
                        <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty || loading || refreshing} onClick={() => void submitSave()}>
                            保存修改
                        </Button>
                    </div>
                </div>

                {loadError || saveError ? (
                    <div className="admin-ark-inline-alert" role="alert">
                        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                        <span>{saveError || `${loadError}。页面仍显示上一次成功读取的配置。`}</span>
                    </div>
                ) : null}

                <Form
                    form={form}
                    layout="vertical"
                    requiredMark={false}
                    disabled={loading || refreshing || saving}
                    onValuesChange={(_, values: ArkPrivateAssetForm) => {
                        let nextValues = values;
                        if (values.enabled && !arkPrivateAssetPrerequisitesReady(values, setting)) {
                            form.setFieldValue("enabled", false);
                            nextValues = { ...values, enabled: false };
                        }
                        setDirty(hasArkPrivateAssetChanges(nextValues, setting));
                        setSaveError("");
                    }}
                >
                    <div id="admin-ark-credentials" className="admin-settings-anchor">
                        <SettingsSectionCard
                            className="admin-ark-section admin-ark-configuration-section"
                            icon={<KeyRound className="size-4" aria-hidden="true" />}
                            title="1. 配置方舟项目与 IAM 凭据"
                            description="凭据仅保存在服务端，用于创建素材组、上传图片和查询审核状态。"
                            status={<AdminStatusBadge label={prerequisitesReady ? "已配置" : "待配置"} tone={prerequisitesReady ? "success" : "neutral"} />}
                        >
                            <div className="admin-ark-form-grid">
                                <Form.Item name="region" label="Region">
                                    <Input autoComplete="off" placeholder="例如：cn-beijing" />
                                </Form.Item>
                                <Form.Item name="projectName" label="Ark ProjectName">
                                    <Input autoComplete="off" placeholder="方舟项目名称" />
                                </Form.Item>
                                <Form.Item name="accessKeyId" label="IAM AccessKey">
                                    <Input autoComplete="off" prefix={<KeyRound className="size-4 text-foreground/35" />} placeholder="仅保存在服务端" />
                                </Form.Item>
                                <Form.Item name="accessKeySecret" label={setting.hasAccessKeySecret ? `IAM SecretKey（${configuredSecretText}）` : "IAM SecretKey"} extra={setting.hasAccessKeySecret ? "AccessKey 不变时留空可保留原密钥。" : undefined}>
                                    <Input.Password autoComplete="new-password" placeholder={setting.hasAccessKeySecret ? "留空保留原密钥" : "仅保存在服务端"} />
                                </Form.Item>
                            </div>
                        </SettingsSectionCard>
                    </div>

                    {prerequisitesReady || draftEnabled ? (
                        <div id="admin-ark-policy" className="admin-settings-anchor">
                            <SettingsSectionCard
                                className="admin-ark-section admin-ark-policy-section"
                                icon={<CloudUpload className="size-4" aria-hidden="true" />}
                                title="2. 是否启用可信素材同步"
                                description="启用后，符合条件的 Seedance 参考图会在生成前导入方舟素材库。"
                                status={<AdminStatusBadge label={draftEnabled ? "已启用" : "已停用"} tone={draftEnabled ? "success" : "neutral"} />}
                            >
                                <div className="admin-ark-policy-control">
                                    <div className="admin-ark-policy-copy">
                                        <strong>自动导入可信参考素材</strong>
                                        <p>关闭只停止新素材同步，不删除已有素材和绑定。</p>
                                    </div>
                                    <div className="admin-ark-policy-switch">
                                        <span>{draftEnabled ? "启用" : "停用"}</span>
                                        <Form.Item name="enabled" valuePropName="checked" noStyle>
                                            <Switch aria-label="启用可信素材同步，保存修改后生效" />
                                        </Form.Item>
                                    </div>
                                </div>
                            </SettingsSectionCard>
                        </div>
                    ) : null}
                </Form>
            </div>
        </AdminPageFrame>
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

function arkPrivateAssetPrerequisitesReady(values: Partial<ArkPrivateAssetForm>, setting: AdminArkPrivateAssetSetting) {
    const draft = normalizeArkPrivateAssetPayload(values);
    return Boolean(draft.region && draft.projectName && draft.accessKeyId && hasUsableSecret(draft, setting));
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
