import { App, Button, Form, InputNumber } from "antd";
import { Database, Gauge, Infinity as InfinityIcon, Network, RotateCcw, Save, ShieldCheck, TimerReset } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { getAdminRuntimePolicySetting, getAdminSelfUseRuntimePolicy, resetAdminRuntimePolicySetting, updateAdminRuntimePolicySetting, type RuntimePolicySetting } from "@/services/api/auth";
import { useAdminContext } from "../admin-context";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminStatusBadge, SettingsSectionCard } from "../components/admin-ui";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";

type PolicyGroup = "resource" | "task" | "request";
type PolicyField = {
    group: PolicyGroup;
    name: string;
    label: string;
    extra: string;
    unit: string;
    max: number;
};

const resourceFields: PolicyField[] = [
    { group: "resource", name: "resourceUploadMB", label: t("admin:single-regular-asset-file"), extra: t("admin:per-file-business-limit-for-uploads-and-remote-imports"), unit: "MB", max: 999 },
    { group: "resource", name: "sessionUploadMB", label: t("admin:agent-session-attachment"), extra: t("admin:size-limit-for-a-single-session-attachment"), unit: "MB", max: 999 },
    { group: "resource", name: "generatedFileMB", label: t("admin:single-generated-resource"), extra: t("admin:per-file-limit-for-upstream-generation-responses-and-stored-resources"), unit: "MB", max: 999 },
    { group: "resource", name: "dailyUploadMB", label: t("admin:daily-upload-total"), extra: t("admin:resource-and-attachment-uploads-per-utc-calendar-day"), unit: "MB", max: 999_999 },
    { group: "resource", name: "storedFileGB", label: t("admin:account-file-total"), extra: t("admin:asset-files-plus-agent-session-attachments-combined"), unit: "GB", max: 999 },
    { group: "resource", name: "structuredDataMB", label: t("admin:structured-data-total"), extra: t("admin:canvas-assets-and-agent-session-structured-data-combined"), unit: "MB", max: 999_999 },
    { group: "resource", name: "taskDataGB", label: t("admin:task-data-total"), extra: t("admin:task-history-results-and-upstream-request-logs-combined"), unit: "GB", max: 999 },
    { group: "resource", name: "assetCount", label: t("admin:asset-count"), extra: t("admin:asset-records-an-account-can-keep"), unit: t("admin:item-5"), max: 999_999_999 },
    { group: "resource", name: "canvasCount", label: t("admin:canvas-count"), extra: t("admin:canvases-an-account-can-keep"), unit: t("admin:item-3"), max: 999_999_999 },
    { group: "resource", name: "sessionCount", label: t("admin:agent-session-count"), extra: t("admin:agent-sessions-an-account-can-keep"), unit: t("admin:item-3"), max: 999_999_999 },
    { group: "resource", name: "taskCount", label: t("admin:task-history-count"), extra: t("admin:task-history-records-kept-per-account"), unit: t("admin:item-5"), max: 999_999_999 },
    { group: "resource", name: "apiCallLogCount", label: t("admin:request-log-count"), extra: t("admin:upstream-request-logs-kept-per-account"), unit: t("admin:item-5"), max: 999_999_999 },
];

const concurrencyFields: PolicyField[] = [
    { group: "task", name: "workerConcurrency", label: t("admin:worker-concurrency"), extra: t("admin:background-tasks-executed-concurrently-across-the-cluster"), unit: t("admin:item-3"), max: 999 },
    { group: "task", name: "channelConcurrency", label: t("admin:global-channel-concurrency"), extra: t("admin:concurrency-cap-used-when-channel-selection-follows-the-system"), unit: t("admin:item-3"), max: 999 },
    { group: "task", name: "activeTaskLimit", label: t("admin:active-tasks-per-account"), extra: t("admin:total-queued-or-running-tasks-per-account-across-projects"), unit: t("admin:item-3"), max: 999 },
];

const timeoutFields: PolicyField[] = [
    { group: "task", name: "imageTimeoutMinutes", label: t("admin:image-task-timeout"), extra: t("admin:max-execution-time-before-an-image-task-fails"), unit: t("admin:minutes"), max: 9_999 },
    { group: "task", name: "textTimeoutMinutes", label: t("admin:text-task-timeout"), extra: t("admin:max-execution-time-for-text-tasks"), unit: t("admin:minutes"), max: 9_999 },
    { group: "task", name: "audioTimeoutMinutes", label: t("admin:audio-task-timeout"), extra: t("admin:max-execution-time-for-audio-tasks"), unit: t("admin:minutes"), max: 9_999 },
    { group: "task", name: "videoTimeoutMinutes", label: t("admin:video-task-timeout"), extra: t("admin:max-execution-time-for-video-tasks"), unit: t("admin:minutes"), max: 9_999 },
    { group: "task", name: "storyboardTimeoutMinutes", label: t("admin:storyboard-task-timeout"), extra: t("admin:max-execution-time-for-agent-storyboard-tasks"), unit: t("admin:minutes"), max: 9_999 },
    { group: "task", name: "defaultTimeoutMinutes", label: t("admin:default-task-timeout"), extra: t("admin:max-execution-time-when-no-dedicated-type-matches"), unit: t("admin:minutes"), max: 9_999 },
];

const rateFields: PolicyField[] = [
    { group: "request", name: "taskCreatePerMinute", label: t("admin:task-creation"), extra: t("admin:tasks-creatable-per-account-per-minute"), unit: t("admin:min-2"), max: 999_999 },
    { group: "request", name: "sessionCreatePerMinute", label: t("admin:session-creation"), extra: t("admin:sessions-creatable-per-account-per-minute"), unit: t("admin:min-2"), max: 999_999 },
    { group: "request", name: "resourceUploadPerMinute", label: t("admin:resource-upload"), extra: t("admin:resource-uploads-per-account-per-minute"), unit: t("admin:min-2"), max: 999_999 },
    { group: "request", name: "resourceImportPerMinute", label: t("admin:resource-import"), extra: t("admin:remote-resource-imports-per-account-per-minute"), unit: t("admin:min-2"), max: 999_999 },
    { group: "request", name: "sessionFilePerMinute", label: t("admin:session-attachments"), extra: t("admin:session-attachment-uploads-per-account-per-minute"), unit: t("admin:min-2"), max: 999_999 },
    { group: "request", name: "assetWritePerMinute", label: t("admin:asset-writes"), extra: t("admin:asset-writes-per-account-per-minute"), unit: t("admin:min-2"), max: 999_999 },
    { group: "request", name: "canvasWritePerMinute", label: t("admin:canvas-writes"), extra: t("admin:canvas-writes-per-account-per-minute"), unit: t("admin:min-2"), max: 999_999 },
    { group: "request", name: "registerPerHour", label: t("admin:sign-up"), extra: t("admin:registrations-allowed-per-ip-per-hour"), unit: t("admin:hour"), max: 999_999 },
    { group: "request", name: "emailCodePerHour", label: t("admin:email-verification-code"), extra: t("admin:verification-code-requests-per-ip-per-hour"), unit: t("admin:hour"), max: 999_999 },
    { group: "request", name: "loginIPPerTenMinutes", label: t("admin:login-ip"), extra: t("admin:logins-allowed-per-ip-per-10-minutes"), unit: t("admin:10-min"), max: 999_999 },
    { group: "request", name: "loginAccountPerTenMinutes", label: t("admin:login-ip-account"), extra: t("admin:logins-per-ip-account-pair-per-10-minutes"), unit: t("admin:10-min"), max: 999_999 },
    { group: "request", name: "systemRelayPerMinute", label: t("admin:system-channel-relay"), extra: t("admin:system-channel-requests-per-account-per-minute"), unit: t("admin:min-2"), max: 999_999 },
    { group: "request", name: "customRelayPerMinute", label: t("admin:custom-channel-relay"), extra: t("admin:custom-channel-requests-per-account-per-minute"), unit: t("admin:min-2"), max: 999_999 },
];

const relayFields: PolicyField[] = [
    { group: "request", name: "customRelayConcurrency", label: t("admin:custom-channel-concurrency"), extra: t("admin:concurrent-custom-channel-requests-per-account"), unit: t("admin:item-3"), max: 999 },
    { group: "request", name: "customRelayRequestMB", label: t("admin:custom-channel-request-body"), extra: t("admin:request-body-cap-for-custom-upstream-relay"), unit: "MB", max: 999 },
    { group: "request", name: "customRelayResponseMB", label: t("admin:custom-channel-response-body"), extra: t("admin:read-cap-for-custom-upstream-json-and-streaming-responses"), unit: "MB", max: 999 },
    { group: "request", name: "customRelayTimeoutMinutes", label: t("admin:custom-channel-timeout"), extra: t("admin:max-wait-time-for-custom-channel-connect-and-response"), unit: t("admin:minutes"), max: 9_999 },
    { group: "request", name: "systemRelayRequestMB", label: t("admin:system-channel-request-body"), extra: t("admin:request-body-cap-for-system-channel-relay"), unit: "MB", max: 999 },
    { group: "request", name: "systemRelayResponseMB", label: t("admin:system-channel-response-body"), extra: t("admin:read-cap-for-system-channel-upstream-responses"), unit: "MB", max: 999 },
    { group: "request", name: "channelCircuitFailureCount", label: t("admin:circuit-breaker-failures"), extra: t("admin:the-breaker-opens-after-this-many-consecutive-failures-within-one-minute"), unit: t("admin:requests-2"), max: 999 },
    { group: "request", name: "channelCircuitOpenSeconds", label: t("admin:circuit-breaker-duration"), extra: t("admin:how-long-the-breaker-rejects-requests-after-opening"), unit: t("admin:s"), max: 86_400 },
];

export default function RuntimePolicySettingsPage() {
    const { t } = useTranslation("canvas");
    const { message, modal } = App.useApp();
    const { references } = useAdminContext();
    const [setting, setSetting] = useState<RuntimePolicySetting | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [form] = Form.useForm<RuntimePolicySetting>();
    const userNameById = useMemo(() => new Map(references.users.map((user) => [user.id, user.displayName || user.username])), [references.users]);

    useEffect(() => {
        void getAdminRuntimePolicySetting()
            .then(({ setting: value }) => {
                setSetting(value);
                form.setFieldsValue(value);
            })
            .catch((error) => message.error(error instanceof Error ? error.message : t("admin:failed-to-read-resource-and-request-policies")))
            .finally(() => setLoading(false));
    }, [form, message]);

    useEffect(() => {
        const beforeUnload = (event: BeforeUnloadEvent) => {
            if (!dirty) return;
            event.preventDefault();
        };
        window.addEventListener("beforeunload", beforeUnload);
        return () => window.removeEventListener("beforeunload", beforeUnload);
    }, [dirty]);

    const useSelfMode = async () => {
        try {
            const result = await getAdminSelfUseRuntimePolicy();
            form.setFieldsValue(result.setting);
            setDirty(true);
            message.info(t("admin:personal-mode-caps-filled-in-effective-after-save"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-read-personal-mode"));
        }
    };

    const reset = () => {
        modal.confirm({
            title: t("admin:reset-all-resource-and-request-policies"),
            content: t("admin:this-deletes-saved-custom-policies-and-restores-system-defaults-immediat"),
            okText: t("admin:reset-to-defaults"),
            cancelText: t("admin:cancel-4"),
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    const result = await resetAdminRuntimePolicySetting();
                    setSetting(result.setting);
                    form.setFieldsValue(result.setting);
                    setDirty(false);
                    message.success(t("admin:system-default-policies-restored"));
                } catch (error) {
                    message.error(error instanceof Error ? error.message : t("admin:failed-to-reset-resource-and-request-policies"));
                    throw error;
                }
            },
        });
    };

    const save = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            const result = await updateAdminRuntimePolicySetting({ resource: values.resource, task: values.task, request: values.request });
            setSetting(result.setting);
            form.setFieldsValue(result.setting);
            setDirty(false);
            message.success(t("admin:resource-and-request-policies-took-effect-immediately"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-save-resource-and-request-policies"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <AdminPageFrame
            title={t("admin:resources-and-policies")}
            description={t("admin:account-quotas-task-scheduling-and-request-security-policies")}
            scroll
            actions={
                <div className="flex items-center gap-2">
                    <Button icon={<RotateCcw className="size-4" />} disabled={loading || saving} onClick={reset}>
                        {t("admin:reset")}
                    </Button>
                    <Button icon={<InfinityIcon className="size-4" />} disabled={loading || saving} onClick={() => void useSelfMode()}>
                        {t("admin:personal-mode")}
                    </Button>
                </div>
            }
        >
            <Form form={form} layout="vertical" requiredMark={false} disabled={loading} onValuesChange={() => setDirty(true)}>
                <div className="space-y-3 pt-4">
                    <PolicySection icon={<Database className="size-4" />} title={t("admin:resources-and-quotas")} description={t("admin:uploads-storage-capacity-structured-data-and-history-limits")} fields={resourceFields} />
                    <PolicySection
                        icon={<Gauge className="size-4" />}
                        title={t("admin:tasks-and-concurrency")}
                        description={t("admin:background-task-consumption-channel-scheduling-and-per-account-active-li")}
                        fields={concurrencyFields}
                        status={<AdminStatusBadge label={t("admin:hot-reload")} tone="info" />}
                    />
                    <PolicySection icon={<TimerReset className="size-4" />} title={t("admin:task-timeouts")} description={t("admin:max-execution-times-per-generation-type")} fields={timeoutFields} />
                    <PolicySection icon={<ShieldCheck className="size-4" />} title={t("admin:business-rate-limiting")} description={t("admin:fixed-window-request-limits-by-account-and-ip")} fields={rateFields} />
                    <PolicySection icon={<Network className="size-4" />} title={t("admin:channel-relaying-and-circuit-breakers")} description={t("admin:request-response-bodies-concurrency-timeouts-and-upstream-failure-protec")} fields={relayFields} />
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-4">
                        <div className="text-xs text-foreground/45">
                            {setting?.updatedAt ? `上次更新：${formatTime(setting.updatedAt)}${setting.updatedBy ? ` · ${userNameById.get(setting.updatedBy) || setting.updatedBy}` : ""}` : t("admin:using-system-default-policies")}
                        </div>
                        <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={loading || !dirty} onClick={() => void save()}>
                            {t("admin:save-config-5")}
                        </Button>
                    </div>
                </div>
            </Form>
        </AdminPageFrame>
    );
}

function PolicySection({ icon, title, description, fields, status }: { icon: ReactNode; title: string; description: string; fields: PolicyField[]; status?: ReactNode }) {
    const { t } = useTranslation("canvas");
    return (
        <SettingsSectionCard icon={icon} title={title} description={description} status={status}>
            <div className="grid grid-cols-1 gap-x-4 px-4 pt-4 md:grid-cols-2 xl:grid-cols-3">
                {fields.map((field) => (
                    <Form.Item
                        key={`${field.group}.${field.name}`}
                        name={[field.group, field.name]}
                        label={field.label}
                        extra={field.extra}
                        rules={[
                            { required: true, message: t("admin:enter-param", { label: field.label }) },
                            { type: "number", min: 1, max: field.max, message: t("admin:param-must-be-an-integer-between-1-and-param", { label: field.label, max: field.max }) },
                        ]}
                    >
                        <InputNumber className="w-full" min={1} max={field.max} precision={0} addonAfter={field.unit} />
                    </Form.Item>
                ))}
            </div>
        </SettingsSectionCard>
    );
}

function formatTime(value?: string) {
    return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--";
}
