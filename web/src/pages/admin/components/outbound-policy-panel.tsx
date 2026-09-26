import { Alert, App, Button, Form, Input, Skeleton } from "antd";
import { Network, Save } from "lucide-react";
import { useEffect, useState } from "react";

import { getOutboundPolicy, updateOutboundPolicy } from "@/services/api/outbound-policy";

import { SettingsSectionCard } from "./admin-ui";

type OutboundPolicyDraft = { allowedModelOrigins: string };

function splitOrigins(value: string) {
    return value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}

export default function OutboundPolicyPanel() {
    const { message } = App.useApp();
    const [form] = Form.useForm<OutboundPolicyDraft>();
    const [loaded, setLoaded] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [reloadVersion, setReloadVersion] = useState(0);

    useEffect(() => {
        let active = true;
        setLoaded(false);
        setError("");
        getOutboundPolicy()
            .then(({ setting }) => {
                if (!active) return;
                form.setFieldsValue({ allowedModelOrigins: setting.allowedModelOrigins.join("\n") });
                setLoaded(true);
            })
            .catch((loadError: unknown) => {
                if (active) setError(loadError instanceof Error ? loadError.message : "读取模型服务地址失败");
            });
        return () => {
            active = false;
        };
    }, [form, reloadVersion]);

    // 已保存的配置无法读取时，允许管理员清空后重新填写，保存即覆盖。
    const startOver = () => {
        form.setFieldsValue({ allowedModelOrigins: "" });
        setError("");
        setLoaded(true);
    };

    const save = async (draft: OutboundPolicyDraft) => {
        setSaving(true);
        setError("");
        try {
            const { setting } = await updateOutboundPolicy({ allowedModelOrigins: splitOrigins(draft.allowedModelOrigins || "") });
            form.setFieldsValue({ allowedModelOrigins: setting.allowedModelOrigins.join("\n") });
            message.success("模型服务地址已保存");
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : "保存模型服务地址失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <SettingsSectionCard
            className="admin-outbound-policy-section"
            icon={<Network className="size-4" />}
            title="模型服务地址"
            description="限制系统渠道只连接这里列出的模型服务地址，保存后对之后的请求生效。"
            footer={
                <>
                    <span className="text-xs text-foreground/55">留空不增加限制；只作用于系统渠道。</span>
                    <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!loaded} onClick={() => form.submit()}>
                        保存模型服务地址
                    </Button>
                </>
            }
        >
            <Form form={form} layout="vertical" requiredMark={false} disabled={!loaded || saving} onFinish={(draft) => void save(draft)}>
                {error ? (
                    <Alert
                        className="mb-4"
                        type="error"
                        showIcon
                        message={error}
                        action={
                            loaded ? undefined : (
                                <div className="flex gap-2">
                                    <Button size="small" onClick={() => setReloadVersion((value) => value + 1)}>
                                        重新读取
                                    </Button>
                                    <Button size="small" onClick={startOver}>
                                        重新填写
                                    </Button>
                                </div>
                            )
                        }
                    />
                ) : null}
                {!loaded && !error ? <Skeleton active paragraph={{ rows: 2 }} /> : null}
                <Form.Item
                    name="allowedModelOrigins"
                    label="允许的模型服务地址"
                    extra="每行一个 origin，例如 https://api.example.com；非默认端口需要写出。只作用于系统渠道，不影响用户自定义渠道。填入后，Base URL 不在列表内的系统渠道会立即无法调用，请先填入所有在用渠道的地址。"
                >
                    <Input.TextArea rows={4} placeholder="https://api.example.com" />
                </Form.Item>
            </Form>
        </SettingsSectionCard>
    );
}
