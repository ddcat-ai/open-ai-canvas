import { App, Button, Form, InputNumber, Tag } from "antd";
import { Database, Gauge, Infinity as InfinityIcon, Network, RotateCcw, Save, ShieldCheck, TimerReset } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
    getAdminRuntimePolicySetting,
    getAdminSelfUseRuntimePolicy,
    resetAdminRuntimePolicySetting,
    updateAdminRuntimePolicySetting,
    type RuntimePolicySetting,
} from "@/services/api/auth";
import { useAdminContext } from "../admin-context";
import { AdminPageFrame } from "../components/admin-shell";
import { SettingsSectionCard } from "../components/admin-ui";

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
    { group: "resource", name: "resourceUploadMB", label: "普通资源单文件", extra: "素材上传和远程导入的单文件业务上限。", unit: "MB", max: 999 },
    { group: "resource", name: "sessionUploadMB", label: "Agent 会话附件", extra: "单个会话附件的大小上限。", unit: "MB", max: 999 },
    { group: "resource", name: "generatedFileMB", label: "单个生成资源", extra: "上游生成响应和落库资源的单文件上限。", unit: "MB", max: 999 },
    { group: "resource", name: "dailyUploadMB", label: "每日上传总量", extra: "按 UTC 自然日累计资源与附件上传。", unit: "MB", max: 999_999 },
    { group: "resource", name: "storedFileGB", label: "账号文件总量", extra: "资源文件与 Agent 会话附件合计。", unit: "GB", max: 999 },
    { group: "resource", name: "structuredDataMB", label: "结构化数据总量", extra: "画布、素材和 Agent 会话结构化数据合计。", unit: "MB", max: 999_999 },
    { group: "resource", name: "taskDataGB", label: "任务数据总量", extra: "任务历史、结果和上游请求日志合计。", unit: "GB", max: 999 },
    { group: "resource", name: "assetCount", label: "素材数量", extra: "单账号可保存的素材记录数。", unit: "条", max: 999_999_999 },
    { group: "resource", name: "canvasCount", label: "画布数量", extra: "单账号可保存的画布数量。", unit: "个", max: 999_999_999 },
    { group: "resource", name: "sessionCount", label: "Agent 会话数量", extra: "单账号可保存的 Agent 会话数量。", unit: "个", max: 999_999_999 },
    { group: "resource", name: "taskCount", label: "任务历史数量", extra: "单账号保留的任务历史记录数。", unit: "条", max: 999_999_999 },
    { group: "resource", name: "apiCallLogCount", label: "请求日志数量", extra: "单账号保留的上游请求日志数。", unit: "条", max: 999_999_999 },
];

const concurrencyFields: PolicyField[] = [
    { group: "task", name: "workerConcurrency", label: "Worker 并发", extra: "集群同时执行的后台任务数。", unit: "个", max: 999 },
    { group: "task", name: "channelConcurrency", label: "全局渠道并发", extra: "渠道选择跟随系统时采用的并发上限。", unit: "个", max: 999 },
    { group: "task", name: "activeTaskLimit", label: "账号活动任务", extra: "单账号同时排队或运行的任务数。", unit: "个", max: 999 },
];

const timeoutFields: PolicyField[] = [
    { group: "task", name: "imageTimeoutMinutes", label: "图片任务超时", extra: "图片任务进入失败状态前的最长执行时间。", unit: "分钟", max: 9_999 },
    { group: "task", name: "textTimeoutMinutes", label: "文本任务超时", extra: "文本任务的最长执行时间。", unit: "分钟", max: 9_999 },
    { group: "task", name: "audioTimeoutMinutes", label: "音频任务超时", extra: "音频任务的最长执行时间。", unit: "分钟", max: 9_999 },
    { group: "task", name: "videoTimeoutMinutes", label: "视频任务超时", extra: "视频任务的最长执行时间。", unit: "分钟", max: 9_999 },
    { group: "task", name: "storyboardTimeoutMinutes", label: "分镜任务超时", extra: "Agent 分镜任务的最长执行时间。", unit: "分钟", max: 9_999 },
    { group: "task", name: "defaultTimeoutMinutes", label: "默认任务超时", extra: "未匹配专用类型时使用的最长执行时间。", unit: "分钟", max: 9_999 },
];

const rateFields: PolicyField[] = [
    { group: "request", name: "taskCreatePerMinute", label: "任务创建", extra: "每账号每分钟允许创建的任务数。", unit: "次/分钟", max: 999_999 },
    { group: "request", name: "sessionCreatePerMinute", label: "会话创建", extra: "每账号每分钟允许创建的会话数。", unit: "次/分钟", max: 999_999 },
    { group: "request", name: "resourceUploadPerMinute", label: "资源上传", extra: "每账号每分钟上传资源的次数。", unit: "次/分钟", max: 999_999 },
    { group: "request", name: "resourceImportPerMinute", label: "资源导入", extra: "每账号每分钟导入远程资源的次数。", unit: "次/分钟", max: 999_999 },
    { group: "request", name: "sessionFilePerMinute", label: "会话附件", extra: "每账号每分钟上传会话附件的次数。", unit: "次/分钟", max: 999_999 },
    { group: "request", name: "assetWritePerMinute", label: "素材写入", extra: "每账号每分钟写入素材的次数。", unit: "次/分钟", max: 999_999 },
    { group: "request", name: "canvasWritePerMinute", label: "画布写入", extra: "每账号每分钟写入画布的次数。", unit: "次/分钟", max: 999_999 },
    { group: "request", name: "registerPerHour", label: "账号注册", extra: "每 IP 每小时允许注册的次数。", unit: "次/小时", max: 999_999 },
    { group: "request", name: "emailCodePerHour", label: "邮箱验证码", extra: "每 IP 每小时允许请求验证码的次数。", unit: "次/小时", max: 999_999 },
    { group: "request", name: "loginIPPerTenMinutes", label: "登录 IP", extra: "每 IP 每 10 分钟允许登录的次数。", unit: "次/10分钟", max: 999_999 },
    { group: "request", name: "loginAccountPerTenMinutes", label: "登录账号组合", extra: "同一 IP 与账号组合每 10 分钟的登录次数。", unit: "次/10分钟", max: 999_999 },
    { group: "request", name: "systemRelayPerMinute", label: "系统渠道中转", extra: "每账号每分钟使用系统渠道的请求数。", unit: "次/分钟", max: 999_999 },
    { group: "request", name: "customRelayPerMinute", label: "自定义渠道中转", extra: "每账号每分钟使用自定义渠道的请求数。", unit: "次/分钟", max: 999_999 },
];

const relayFields: PolicyField[] = [
    { group: "request", name: "customRelayConcurrency", label: "自定义渠道并发", extra: "单账号同时进行的自定义渠道请求数。", unit: "个", max: 999 },
    { group: "request", name: "customRelayRequestMB", label: "自定义渠道请求体", extra: "中转到自定义上游的请求体上限。", unit: "MB", max: 999 },
    { group: "request", name: "customRelayResponseMB", label: "自定义渠道响应体", extra: "自定义上游 JSON 与流式响应的读取上限。", unit: "MB", max: 999 },
    { group: "request", name: "customRelayTimeoutMinutes", label: "自定义渠道超时", extra: "自定义渠道连接与响应的最长等待时间。", unit: "分钟", max: 9_999 },
    { group: "request", name: "systemRelayRequestMB", label: "系统渠道请求体", extra: "中转到系统渠道的请求体上限。", unit: "MB", max: 999 },
    { group: "request", name: "systemRelayResponseMB", label: "系统渠道响应体", extra: "系统渠道上游响应的读取上限。", unit: "MB", max: 999 },
    { group: "request", name: "channelCircuitFailureCount", label: "熔断失败次数", extra: "一分钟内连续失败达到该值后打开熔断。", unit: "次", max: 999 },
    { group: "request", name: "channelCircuitOpenSeconds", label: "熔断持续时间", extra: "渠道熔断打开后拒绝请求的时间。", unit: "秒", max: 86_400 },
];

export default function RuntimePolicySettingsPage() {
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
            .catch((error) => message.error(error instanceof Error ? error.message : "读取资源与请求策略失败"))
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
            message.info("已填入自用模式上限，保存后生效");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取自用模式失败");
        }
    };

    const reset = () => {
        modal.confirm({
            title: "重置全部资源与请求策略？",
            content: "将删除已保存的自定义策略并立即恢复系统默认值。",
            okText: "重置默认值",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    const result = await resetAdminRuntimePolicySetting();
                    setSetting(result.setting);
                    form.setFieldsValue(result.setting);
                    setDirty(false);
                    message.success("已恢复系统默认策略");
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "重置资源与请求策略失败");
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
            message.success("资源与请求策略已即时生效");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存资源与请求策略失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <AdminPageFrame
            title="资源与策略"
            description="账号配额、任务调度与请求安全策略"
            actions={<div className="flex items-center gap-2"><Button icon={<RotateCcw className="size-4" />} disabled={loading || saving} onClick={reset}>重置</Button><Button icon={<InfinityIcon className="size-4" />} disabled={loading || saving} onClick={() => void useSelfMode()}>自用模式</Button></div>}
        >
            <Form form={form} layout="vertical" requiredMark={false} disabled={loading} onValuesChange={() => setDirty(true)}>
                <div className="mx-auto max-w-6xl space-y-5">
                    <PolicySection icon={<Database className="size-4" />} title="资源与账号配额" description="上传、文件容量、结构化数据和历史记录上限。" fields={resourceFields} />
                    <PolicySection icon={<Gauge className="size-4" />} title="任务与并发" description="后台任务消费、渠道调度和单账号活动任务上限。" fields={concurrencyFields} status={<Tag bordered={false} color="blue">热更新</Tag>} />
                    <PolicySection icon={<TimerReset className="size-4" />} title="任务超时" description="不同生成类型的最长执行时间。" fields={timeoutFields} />
                    <PolicySection icon={<ShieldCheck className="size-4" />} title="业务频控" description="账号与 IP 维度的固定窗口请求限制。" fields={rateFields} />
                    <PolicySection icon={<Network className="size-4" />} title="渠道中转与熔断" description="请求体、响应体、并发、超时和上游故障保护。" fields={relayFields} />
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-4">
                        <div className="text-xs text-foreground/45">{setting?.updatedAt ? `上次更新：${formatTime(setting.updatedAt)}${setting.updatedBy ? ` · ${userNameById.get(setting.updatedBy) || setting.updatedBy}` : ""}` : "当前使用系统默认策略"}</div>
                        <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={loading || !dirty} onClick={() => void save()}>保存配置</Button>
                    </div>
                </div>
            </Form>
        </AdminPageFrame>
    );
}

function PolicySection({ icon, title, description, fields, status }: { icon: ReactNode; title: string; description: string; fields: PolicyField[]; status?: ReactNode }) {
    return (
        <SettingsSectionCard icon={icon} title={title} description={description} status={status}>
            <div className="grid grid-cols-1 gap-x-5 px-5 pt-5 md:grid-cols-2 xl:grid-cols-3">
                {fields.map((field) => (
                    <Form.Item key={`${field.group}.${field.name}`} name={[field.group, field.name]} label={field.label} extra={field.extra} rules={[{ required: true, message: `请填写${field.label}` }, { type: "number", min: 1, max: field.max, message: `${field.label}必须是 1-${field.max} 的整数` }]}>
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
