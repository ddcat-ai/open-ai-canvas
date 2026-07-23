import { App, Button, Form, InputNumber, Tag } from "antd";
import { Gauge, RadioTower, Workflow } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { getAdminRuntimeConcurrencySetting, updateAdminRuntimeConcurrencySetting, type RuntimeConcurrencySetting } from "@/services/api/auth";
import { useAdminContext } from "../admin-context";
import { AdminPageFrame } from "../components/admin-shell";
import { SettingsSectionCard } from "../components/admin-ui";

type ConcurrencyFormValues = Pick<RuntimeConcurrencySetting, "workerConcurrency" | "channelConcurrency">;

export default function ConcurrencySettingsPage() {
    const { message } = App.useApp();
    const { references } = useAdminContext();
    const [setting, setSetting] = useState<RuntimeConcurrencySetting | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [form] = Form.useForm<ConcurrencyFormValues>();
    const userNameById = useMemo(() => new Map(references.users.map((user) => [user.id, user.displayName || user.username])), [references.users]);

    useEffect(() => {
        void getAdminRuntimeConcurrencySetting()
            .then(({ setting: value }) => {
                setSetting(value);
                form.setFieldsValue(value);
            })
            .catch((error) => message.error(error instanceof Error ? error.message : "读取任务并发配置失败"))
            .finally(() => setLoading(false));
    }, [form, message]);

    const save = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            const result = await updateAdminRuntimeConcurrencySetting(values);
            setSetting(result.setting);
            form.setFieldsValue(result.setting);
            message.success("任务并发配置已生效");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存任务并发配置失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <AdminPageFrame title="任务并发" description="Worker 与渠道请求调度">
            <div className="mx-auto max-w-5xl space-y-5">
                <SettingsSectionCard
                    icon={<Gauge className="size-4" />}
                    title="运行时并发"
                    description="控制任务消费速度和未单独配置渠道的默认请求并发。"
                    status={<Tag bordered={false} color="blue">热更新</Tag>}
                    footer={<><div className="text-xs text-foreground/45">{setting?.updatedAt ? `上次更新：${formatTime(setting.updatedAt)}${setting.updatedBy ? ` · ${userNameById.get(setting.updatedBy) || setting.updatedBy}` : ""}` : "当前使用环境变量默认值"}</div><Button type="primary" loading={saving} onClick={() => void save()}>保存并发配置</Button></>}
                >
                    <Form form={form} layout="vertical" requiredMark={false} disabled={loading}>
                        <div className="grid grid-cols-1 gap-x-5 px-5 pt-5 md:grid-cols-2">
                            <Form.Item name="workerConcurrency" label="Worker 并发数" extra="控制集群同时执行的后台任务数。" rules={concurrencyRules("Worker 并发数")}><InputNumber className="w-full" min={1} max={100} precision={0} prefix={<Workflow className="size-3.5 text-foreground/40" />} /></Form.Item>
                            <Form.Item name="channelConcurrency" label="全局渠道并发数" extra="渠道选择“跟随系统”时使用；自定义渠道也使用该值。" rules={concurrencyRules("全局渠道并发数")}><InputNumber className="w-full" min={1} max={100} precision={0} prefix={<RadioTower className="size-3.5 text-foreground/40" />} /></Form.Item>
                        </div>
                    </Form>
                </SettingsSectionCard>
                <div className="rounded-lg border border-border bg-muted/25 px-4 py-3 text-xs leading-6 text-foreground/55">任务可以继续进入队列；达到渠道上限时会等待空闲槽位，不会因暂时满载直接失败。单独配置的渠道上限优先于这里的全局值。</div>
            </div>
        </AdminPageFrame>
    );
}

function concurrencyRules(label: string) {
    return [{ required: true, message: `请填写${label}` }, { type: "number" as const, min: 1, max: 100, message: `${label}必须是 1-100 的整数` }];
}

function formatTime(value?: string) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--"; }
