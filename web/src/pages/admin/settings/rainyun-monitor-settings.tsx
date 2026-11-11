import { App, Button, Form, Input, InputNumber, Skeleton, Switch } from "antd";
import { Activity, RefreshCw, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { getRainyunMonitorSetting, updateRainyunMonitorSetting, type RainyunMonitorInput, type RainyunMonitorSetting } from "@/services/api/system-performance";
import { AdminStatusBadge, configuredSecretText, SettingsSectionCard } from "../components/admin-ui";

export default function RainyunMonitorSettings({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
    const { message } = App.useApp();
    const [form] = Form.useForm<RainyunMonitorInput>();
    const [setting, setSetting] = useState<RainyunMonitorSetting | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [error, setError] = useState("");
    const enabled = Form.useWatch("enabled", form);
    const mounted = useRef(false);
    const savingRef = useRef(false);

    const apply = useCallback(
        (next: RainyunMonitorSetting) => {
            setSetting(next);
            form.setFieldsValue({ enabled: next.enabled, instanceId: next.instanceId, apiKey: "" });
            setDirty(false);
            onDirtyChange(false);
            setError("");
        },
        [form, onDirtyChange],
    );

    const load = useCallback(
        async (signal?: AbortSignal) => {
            setLoading(true);
            setError("");
            try {
                const next = await getRainyunMonitorSetting(signal);
                if (mounted.current) apply(next);
            } catch (cause) {
                if (mounted.current && !signal?.aborted) setError(cause instanceof Error ? cause.message : "读取雨云监控配置失败");
            } finally {
                if (mounted.current) setLoading(false);
            }
        },
        [apply],
    );

    useEffect(() => {
        mounted.current = true;
        const controller = new AbortController();
        void load(controller.signal);
        return () => {
            mounted.current = false;
            controller.abort();
            onDirtyChange(false);
        };
    }, [load, onDirtyChange]);

    const save = async (values: RainyunMonitorInput) => {
        if (!setting || savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        setError("");
        const input = { enabled: values.enabled, instanceId: values.instanceId || 0, apiKey: values.apiKey.trim() };
        try {
            const next = await updateRainyunMonitorSetting(input);
            if (next.enabled !== input.enabled || next.instanceId !== input.instanceId || ((input.apiKey || input.enabled) && !next.hasApiKey)) {
                throw new Error("服务端返回的雨云监控配置与保存内容不一致，请重新读取后核对");
            }
            if (!mounted.current) return;
            apply(next);
            message.success("雨云监控配置已保存，可在系统性能查看");
        } catch (cause) {
            if (!mounted.current) return;
            const text = cause instanceof Error ? cause.message : "保存雨云监控配置失败";
            setError(`${text}。未自动重试，草稿已保留。`);
            message.error(text);
        } finally {
            savingRef.current = false;
            if (mounted.current) setSaving(false);
        }
    };

    return (
        <SettingsSectionCard
            layout="stacked"
            icon={<Activity className="size-4" />}
            title="雨云 OSS 监控"
            description="在系统性能查看实例状态、空间、流量及套餐到期时间；独立保存，不改变资源存储配置。"
            status={<AdminStatusBadge label={loading ? "读取中" : !setting ? "状态未知" : dirty ? "待保存" : setting.enabled ? "已启用" : "未启用"} tone={dirty ? "warning" : setting?.enabled ? "info" : "neutral"} />}
        >
            {error ? (
                <div className="admin-storage-inline-alert" role="alert">
                    <span>{error}</span>
                    {!setting ? (
                        <Button size="small" loading={loading} icon={<RefreshCw className="size-4" />} onClick={() => void load()}>
                            重新读取
                        </Button>
                    ) : null}
                </div>
            ) : null}
            {loading && !setting ? <Skeleton active paragraph={{ rows: 3 }} /> : null}
            <Form
                form={form}
                layout="vertical"
                requiredMark={false}
                disabled={loading || saving || !setting}
                initialValues={{ enabled: false, instanceId: 0, apiKey: "" }}
                onFinish={(values) => void save(values)}
                onValuesChange={(_, values) => {
                    const changed = Boolean(setting && (values.enabled !== setting.enabled || (values.instanceId || 0) !== setting.instanceId || values.apiKey?.trim()));
                    setDirty(changed);
                    onDirtyChange(changed);
                    setError("");
                }}
            >
                <Form.Item name="enabled" label="启用雨云监控" valuePropName="checked">
                    <Switch checkedChildren="启用" unCheckedChildren="停用" />
                </Form.Item>
                <div className="admin-storage-form-grid">
                    <Form.Item
                        name="instanceId"
                        label="ROS 实例 ID"
                        extra="雨云控制台中的数字实例 ID，不是 Bucket 名称；用量统计包含实例下全部存储桶。"
                        rules={[
                            {
                                validator: (_, value: unknown) =>
                                    (!enabled && (value === null || value === undefined || value === 0)) || (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
                                        ? Promise.resolve()
                                        : Promise.reject(new Error("请填写有效的正整数实例 ID")),
                            },
                        ]}
                    >
                        <InputNumber min={1} precision={0} placeholder="数字实例 ID" aria-label="ROS 实例 ID" />
                    </Form.Item>
                    <Form.Item
                        name="apiKey"
                        label={setting?.hasApiKey ? `雨云管理 API Key（${configuredSecretText}）` : "雨云管理 API Key"}
                        extra="在雨云用户中心创建，与 S3 AK/SK 不同；仅后端加密保存，不会回显。"
                        rules={[
                            {
                                validator: (_, value: string = "") => {
                                    if (enabled && !value.trim() && !setting?.hasApiKey) return Promise.reject(new Error("请填写雨云管理 API Key"));
                                    if (value.length > 4096 || /[\r\n]/.test(value)) return Promise.reject(new Error("管理 API Key 格式无效"));
                                    return Promise.resolve();
                                },
                            },
                        ]}
                    >
                        <Input.Password autoComplete="new-password" placeholder={setting?.hasApiKey ? "留空保留原管理密钥" : "雨云用户中心的管理 API Key"} />
                    </Form.Item>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button type="primary" htmlType="submit" icon={<Save className="size-4" />} loading={saving} disabled={!dirty || loading || !setting}>
                        保存监控配置
                    </Button>
                    <Button disabled={!dirty || saving || !setting} onClick={() => setting && apply(setting)}>
                        撤销监控调整
                    </Button>
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} disabled={dirty || saving} onClick={() => void load()}>
                        重新读取监控
                    </Button>
                </div>
            </Form>
        </SettingsSectionCard>
    );
}
