import { App, Button, Form, Input, InputNumber, Skeleton } from "antd";
import { Select } from "@/components/ui/base/select";
import { AdminSegmented, Switch } from "@/pages/admin/ui/controls";
import { AlertTriangle, CloudUpload, Coins, KeyRound, RefreshCw, RotateCcw, Save, UsersRound } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker, useSearchParams } from "react-router";

import { cn } from "@/lib/utils";
import { getAdminArkPrivateAssetSetting, updateAdminArkPrivateAssetSetting, type AdminArkPrivateAssetSetting } from "@/services/api/auth";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminStatusBadge, configuredSecretText, SettingsSectionCard } from "../components/admin-ui";
import { ArkAdminGroupsTab } from "./ark-assets/ark-admin-groups-tab";
import { ArkAdminReviewsTab } from "./ark-assets/ark-admin-reviews-tab";
import "./ark-assets/ark-admin.css";

type ArkSite = AdminArkPrivateAssetSetting["site"];
type ArkTab = "groups" | "reviews" | "settings";

const MICRO_PER_CREDIT = 1_000_000;
const PAGE_DESCRIPTION = "管理平台方舟账号下的真人、虚拟与版权 IP 素材组，审核用户上传，并配置方舟凭据、开放范围与建组收费";

type ArkPrivateAssetForm = {
    enabled: boolean;
    realEnabled: boolean;
    virtualEnabled: boolean;
    realGroupLimit: number;
    virtualGroupLimit: number;
    billingEnabled: boolean;
    realGroupPrice: number;
    virtualGroupPrice: number;
    realReviewRequired: boolean;
    virtualReviewRequired: boolean;
    realAuthorizationDays: number;
    site: ArkSite;
    callbackBaseUrl: string;
    region: string;
    projectName: string;
    accessKeyId: string;
    accessKeySecret: string;
};

type ArkPrivateAssetPayload = Pick<
    AdminArkPrivateAssetSetting,
    | "enabled"
    | "realEnabled"
    | "virtualEnabled"
    | "realGroupLimit"
    | "virtualGroupLimit"
    | "billingEnabled"
    | "realGroupPriceMicrocredits"
    | "virtualGroupPriceMicrocredits"
    | "realReviewRequired"
    | "virtualReviewRequired"
    | "realAuthorizationDays"
    | "site"
    | "callbackBaseUrl"
    | "region"
    | "projectName"
    | "accessKeyId"
    | "accessKeySecret"
>;

// 站点决定控制面域名与推理 Base URL；Region 由管理员按开通情况手动填写。
const ARK_SITE_META: Record<ArkSite, { label: string; regionPlaceholder: string; controlPlane: (region: string) => string; inference: string }> = {
    volcengine: {
        label: "火山引擎（中国站）",
        regionPlaceholder: "cn-beijing",
        controlPlane: (region) => `https://ark.${region || "<region>"}.volcengineapi.com`,
        inference: "https://ark.cn-beijing.volces.com/api/v3",
    },
    byteplus: {
        label: "BytePlus（海外站）",
        regionPlaceholder: "ap-southeast-1",
        controlPlane: (region) => `https://ark.${region || "<region>"}.byteplusapi.com`,
        inference: "https://ark.ap-southeast.bytepluses.com/api/v3",
    },
};

const ARK_TABS: Array<{ value: ArkTab; label: string }> = [
    { value: "groups", label: "素材组" },
    { value: "reviews", label: "上传审核" },
    { value: "settings", label: "配置" },
];

/** 方舟素材库：素材组 / 上传审核 / 配置三个视图；配置有未保存草稿时切换视图不丢失，离开页面会确认。 */
export default function ArkPrivateAssetsSettingsPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const requestedTab = searchParams.get("tab");
    const tab: ArkTab = requestedTab === "reviews" || requestedTab === "settings" ? requestedTab : "groups";
    const selectTab = (next: ArkTab) => {
        const params = new URLSearchParams(searchParams);
        if (next === "groups") params.delete("tab");
        else params.set("tab", next);
        setSearchParams(params, { replace: true });
    };
    return (
        <AdminPageFrame title="方舟素材库" description={PAGE_DESCRIPTION} actions={<AdminSegmented<ArkTab> ariaLabel="方舟素材库视图" value={tab} onChange={selectTab} options={ARK_TABS} />} scroll>
            <div className="admin-ark-tabs-body">
                {tab === "groups" ? <ArkAdminGroupsTab onOpenReviews={() => selectTab("reviews")} /> : null}
                {tab === "reviews" ? <ArkAdminReviewsTab /> : null}
                {/* 配置表单常驻挂载：切到其他视图时保留草稿。 */}
                <div hidden={tab !== "settings"}>
                    <ArkPrivateAssetsSettingsForm />
                </div>
            </div>
        </AdminPageFrame>
    );
}

function ArkPrivateAssetsSettingsForm() {
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
    const draftRealEnabled = watchedValues?.realEnabled === true;
    const draftVirtualEnabled = watchedValues?.virtualEnabled === true;
    const draftBillingEnabled = watchedValues?.billingEnabled === true;
    const draftSite: ArkSite = watchedValues?.site === "byteplus" ? "byteplus" : "volcengine";
    const siteMeta = ARK_SITE_META[draftSite];

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

    // 同一页面内切换视图只改查询参数，不算离开。
    const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !saving && currentLocation.pathname !== nextLocation.pathname);

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
            content: "当前页面有尚未保存的同步策略、开放范围、收费或 IAM 凭据草稿，离开后这些内容会丢失。服务端正在使用的配置不会改变。",
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
        form.setFieldsValue(toFormValues(setting));
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
            content: "重新读取会丢弃当前配置草稿，并以服务端配置为准。",
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
            form.setFieldsValue(toFormValues(result.setting));
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
            <div className="admin-settings-stack admin-ark-settings" aria-label="正在读取方舟素材库配置" role="status">
                <div className="admin-ark-command-bar">
                    <Skeleton active title={{ width: 190 }} paragraph={false} />
                </div>
                <div className="admin-ark-loading-card">
                    <Skeleton active paragraph={{ rows: 7 }} />
                </div>
            </div>
        );
    }

    if (!setting) {
        return (
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
        );
    }

    const currentValues = watchedValues || form.getFieldsValue(true);
    const normalizedDraft = normalizeArkPrivateAssetPayload(currentValues);
    const usableSecret = hasUsableSecret(normalizedDraft, setting);
    const projectReady = Boolean(normalizedDraft.region && normalizedDraft.projectName);
    const credentialsReady = Boolean(normalizedDraft.accessKeyId && usableSecret);
    const prerequisitesReady = projectReady && credentialsReady;
    const userGroupsOpen = draftRealEnabled || draftVirtualEnabled;

    return (
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
                    if ((values.enabled || values.realEnabled || values.virtualEnabled) && !arkPrivateAssetPrerequisitesReady(values, setting)) {
                        form.setFieldsValue({ enabled: false, realEnabled: false, virtualEnabled: false });
                        nextValues = { ...values, enabled: false, realEnabled: false, virtualEnabled: false };
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
                        description="凭据仅保存在服务端，用于创建素材组、上传图片和查询审核状态。所有素材组都建在这个方舟账号下。"
                        status={<AdminStatusBadge label={prerequisitesReady ? "已配置" : "待配置"} tone={prerequisitesReady ? "success" : "neutral"} />}
                    >
                        <div className="admin-ark-form-grid">
                            <Form.Item name="site" label="方舟站点" extra={`推理渠道 Base URL 参考：${siteMeta.inference}`}>
                                <Select options={(Object.keys(ARK_SITE_META) as ArkSite[]).map((value) => ({ value, label: ARK_SITE_META[value].label }))} aria-label="方舟站点" />
                            </Form.Item>
                            <Form.Item name="region" label="Region" extra={`控制面地址：${siteMeta.controlPlane(normalizedDraft.region)}。请填写已开通素材库的区域。`}>
                                <Input autoComplete="off" placeholder={siteMeta.regionPlaceholder} />
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

                {prerequisitesReady || userGroupsOpen ? (
                    <>
                        <div id="admin-ark-groups" className="admin-settings-anchor">
                            <SettingsSectionCard
                                className="admin-ark-section admin-ark-policy-section"
                                icon={<UsersRound className="size-4" aria-hidden="true" />}
                                title="3. 开放用户素材组"
                                description="用户在「设置 → 方舟素材库」自助建组：真人素材组需本人完成 H5 活体认证，虚拟素材组直接创建。版权 IP 素材组只能由管理员创建并授权。"
                                status={<AdminStatusBadge label={userGroupsOpen ? "已开放" : "未开放"} tone={userGroupsOpen ? "success" : "neutral"} />}
                            >
                                <div className="admin-ark-policy-control">
                                    <div className="admin-ark-policy-copy">
                                        <strong>真人素材组</strong>
                                        <p>认证结果回调到「回调地址」/api/ark-portraits/callback/…，认证成功后建立只属于本人的真人素材组。</p>
                                    </div>
                                    <div className="admin-ark-policy-switch">
                                        <span>{draftRealEnabled ? "开放" : "关闭"}</span>
                                        <Form.Item name="realEnabled" valuePropName="checked" noStyle>
                                            <Switch aria-label="开放真人素材库，保存修改后生效" />
                                        </Form.Item>
                                    </div>
                                </div>
                                <div className="admin-ark-policy-control">
                                    <div className="admin-ark-policy-copy">
                                        <strong>虚拟素材组</strong>
                                        <p>用于 AI 生成或绘制的虚拟形象，组内图片不能含真人肖像。</p>
                                    </div>
                                    <div className="admin-ark-policy-switch">
                                        <span>{draftVirtualEnabled ? "开放" : "关闭"}</span>
                                        <Form.Item name="virtualEnabled" valuePropName="checked" noStyle>
                                            <Switch aria-label="开放虚拟素材组，保存修改后生效" />
                                        </Form.Item>
                                    </div>
                                </div>
                                <Form.Item name="callbackBaseUrl" label="真人认证回调地址" extra="站点公网根地址，如 https://canvas.example.com；留空时使用环境变量 CANVAS_PUBLIC_BASE_URL。" className="mt-4">
                                    <Input autoComplete="off" placeholder="https://canvas.example.com" />
                                </Form.Item>
                                <div className="admin-ark-number-grid">
                                    <Form.Item name="realGroupLimit" label="每人真人素材组上限" extra="包含认证中的会话。" rules={[{ required: true, type: "number", min: 1, max: 200, message: "请填写 1–200" }]}>
                                        <InputNumber min={1} max={200} precision={0} className="w-full" />
                                    </Form.Item>
                                    <Form.Item name="virtualGroupLimit" label="每人虚拟素材组上限" rules={[{ required: true, type: "number", min: 1, max: 200, message: "请填写 1–200" }]}>
                                        <InputNumber min={1} max={200} precision={0} className="w-full" />
                                    </Form.Item>
                                    <Form.Item name="realAuthorizationDays" label="真人授权有效期（天）" extra="从认证完成起计算，到期后不能上传或用于生成。" rules={[{ required: true, type: "number", min: 1, max: 3650, message: "请填写 1–3650" }]}>
                                        <InputNumber min={1} max={3650} precision={0} className="w-full" />
                                    </Form.Item>
                                </div>
                                <div className="admin-ark-policy-control">
                                    <div className="admin-ark-policy-copy">
                                        <strong>上传审核</strong>
                                        <p>开启后，用户向自建素材组上传的图片先进入「上传审核」，管理员通过后才提交方舟。管理员向平台素材组上传不需要审核。</p>
                                    </div>
                                    <div className="admin-ark-policy-switch">
                                        <span>真人</span>
                                        <Form.Item name="realReviewRequired" valuePropName="checked" noStyle>
                                            <Switch aria-label="真人素材组上传需要审核，保存修改后生效" />
                                        </Form.Item>
                                        <span>虚拟</span>
                                        <Form.Item name="virtualReviewRequired" valuePropName="checked" noStyle>
                                            <Switch aria-label="虚拟素材组上传需要审核，保存修改后生效" />
                                        </Form.Item>
                                    </div>
                                </div>
                            </SettingsSectionCard>
                        </div>
                        <div id="admin-ark-billing" className="admin-settings-anchor">
                            <SettingsSectionCard
                                className="admin-ark-section admin-ark-policy-section"
                                icon={<Coins className="size-4" aria-hidden="true" />}
                                title="4. 素材组收费"
                                description="按组一次性扣除平台积分：真人在发起认证时冻结、认证成功后扣除，失败、过期或取消自动退回；虚拟在创建成功后扣除。平台积分功能关闭时不收费，删除素材组不退款。"
                                status={<AdminStatusBadge label={draftBillingEnabled ? "收费" : "免费"} tone={draftBillingEnabled ? "info" : "neutral"} />}
                            >
                                <div className="admin-ark-policy-control">
                                    <div className="admin-ark-policy-copy">
                                        <strong>建组收费</strong>
                                        <p>只对用户自建素材组生效；管理员创建的平台素材组不收费。</p>
                                    </div>
                                    <div className="admin-ark-policy-switch">
                                        <span>{draftBillingEnabled ? "收费" : "免费"}</span>
                                        <Form.Item name="billingEnabled" valuePropName="checked" noStyle>
                                            <Switch aria-label="开启素材组收费，保存修改后生效" />
                                        </Form.Item>
                                    </div>
                                </div>
                                {draftBillingEnabled ? (
                                    <div className="admin-ark-form-grid">
                                        <Form.Item name="realGroupPrice" label="真人素材组（积分 / 组）" rules={[{ required: true, type: "number", min: 0, max: 1_000_000, message: "请填写 0–1000000" }]}>
                                            <InputNumber min={0} max={1_000_000} precision={2} className="w-full" />
                                        </Form.Item>
                                        <Form.Item name="virtualGroupPrice" label="虚拟素材组（积分 / 组）" rules={[{ required: true, type: "number", min: 0, max: 1_000_000, message: "请填写 0–1000000" }]}>
                                            <InputNumber min={0} max={1_000_000} precision={2} className="w-full" />
                                        </Form.Item>
                                    </div>
                                ) : null}
                            </SettingsSectionCard>
                        </div>
                    </>
                ) : null}
            </Form>
        </div>
    );
}

function toFormValues(setting: AdminArkPrivateAssetSetting): ArkPrivateAssetForm {
    return {
        enabled: setting.enabled,
        realEnabled: setting.realEnabled,
        virtualEnabled: setting.virtualEnabled,
        realGroupLimit: setting.realGroupLimit,
        virtualGroupLimit: setting.virtualGroupLimit,
        billingEnabled: setting.billingEnabled,
        realGroupPrice: setting.realGroupPriceMicrocredits / MICRO_PER_CREDIT,
        virtualGroupPrice: setting.virtualGroupPriceMicrocredits / MICRO_PER_CREDIT,
        realReviewRequired: setting.realReviewRequired,
        virtualReviewRequired: setting.virtualReviewRequired,
        realAuthorizationDays: setting.realAuthorizationDays,
        site: setting.site === "byteplus" ? "byteplus" : "volcengine",
        callbackBaseUrl: setting.callbackBaseUrl || "",
        region: setting.region || "",
        projectName: setting.projectName || "",
        accessKeyId: setting.accessKeyId || "",
        accessKeySecret: "",
    };
}

function wholeNumber(value: unknown, fallback: number) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number) : fallback;
}

function normalizeArkPrivateAssetPayload(values: Partial<ArkPrivateAssetForm>): ArkPrivateAssetPayload {
    return {
        enabled: Boolean(values.enabled),
        realEnabled: Boolean(values.realEnabled),
        virtualEnabled: Boolean(values.virtualEnabled),
        realGroupLimit: wholeNumber(values.realGroupLimit, 0),
        virtualGroupLimit: wholeNumber(values.virtualGroupLimit, 0),
        billingEnabled: Boolean(values.billingEnabled),
        realGroupPriceMicrocredits: Math.max(0, Math.round(Number(values.realGroupPrice || 0) * MICRO_PER_CREDIT)),
        virtualGroupPriceMicrocredits: Math.max(0, Math.round(Number(values.virtualGroupPrice || 0) * MICRO_PER_CREDIT)),
        realReviewRequired: Boolean(values.realReviewRequired),
        virtualReviewRequired: Boolean(values.virtualReviewRequired),
        realAuthorizationDays: wholeNumber(values.realAuthorizationDays, 0),
        site: values.site === "byteplus" ? "byteplus" : "volcengine",
        callbackBaseUrl: values.callbackBaseUrl?.trim().replace(/\/+$/, "") || "",
        region: values.region?.trim().toLowerCase() || "",
        projectName: values.projectName?.trim() || "",
        accessKeyId: values.accessKeyId?.trim() || "",
        accessKeySecret: values.accessKeySecret?.trim() || "",
    };
}

const COMPARED_FIELDS = [
    "enabled",
    "realEnabled",
    "virtualEnabled",
    "realGroupLimit",
    "virtualGroupLimit",
    "billingEnabled",
    "realGroupPriceMicrocredits",
    "virtualGroupPriceMicrocredits",
    "realReviewRequired",
    "virtualReviewRequired",
    "realAuthorizationDays",
    "site",
    "callbackBaseUrl",
    "region",
    "projectName",
    "accessKeyId",
] as const;

function hasArkPrivateAssetChanges(values: Partial<ArkPrivateAssetForm>, setting: AdminArkPrivateAssetSetting | null) {
    if (!setting) return false;
    const draft = normalizeArkPrivateAssetPayload(values);
    const saved = normalizeArkPrivateAssetPayload(toFormValues(setting));
    return draft.accessKeySecret !== "" || COMPARED_FIELDS.some((field) => draft[field] !== saved[field]);
}

function validateArkPrivateAssetDraft(values: ArkPrivateAssetForm, setting: AdminArkPrivateAssetSetting) {
    const draft = normalizeArkPrivateAssetPayload(values);
    if (draft.callbackBaseUrl && !/^https?:\/\/[^/?#]+$/i.test(draft.callbackBaseUrl)) return "真人认证回调地址必须是 http(s):// 开头的站点根地址";
    if (draft.realGroupLimit < 1 || draft.realGroupLimit > 200 || draft.virtualGroupLimit < 1 || draft.virtualGroupLimit > 200) return "每人素材组上限需在 1–200 之间";
    if (draft.realAuthorizationDays < 1 || draft.realAuthorizationDays > 3650) return "真人授权有效期需在 1–3650 天之间";
    if (!draft.enabled && !draft.realEnabled && !draft.virtualEnabled) return "";
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
    const saved = normalizeArkPrivateAssetPayload(toFormValues(setting));
    return COMPARED_FIELDS.every((field) => saved[field] === expected[field]) && setting.hasAccessKeySecret === expectedHasSecret;
}

function isAdminArkPrivateAssetSetting(value: unknown): value is AdminArkPrivateAssetSetting {
    if (!value || typeof value !== "object") return false;
    const setting = value as Partial<AdminArkPrivateAssetSetting>;
    return (
        typeof setting.enabled === "boolean" &&
        typeof setting.realEnabled === "boolean" &&
        typeof setting.virtualEnabled === "boolean" &&
        typeof setting.billingEnabled === "boolean" &&
        typeof setting.realGroupLimit === "number" &&
        typeof setting.virtualGroupLimit === "number" &&
        typeof setting.realGroupPriceMicrocredits === "number" &&
        typeof setting.virtualGroupPriceMicrocredits === "number" &&
        typeof setting.realAuthorizationDays === "number" &&
        typeof setting.site === "string" &&
        typeof setting.region === "string" &&
        typeof setting.projectName === "string" &&
        typeof setting.accessKeyId === "string" &&
        typeof setting.hasAccessKeySecret === "boolean"
    );
}
