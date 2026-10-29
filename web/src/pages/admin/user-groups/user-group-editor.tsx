import { App, Button, Drawer, Form, Input, InputNumber, Select } from "antd";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { UserGroupBadge } from "@/components/layout/user-group-badge";
import { createAdminUserGroup, updateAdminUserGroup, type UserGroup } from "@/services/api/user-groups";
import { useAdminContext } from "../admin-context";
import { Callout, Switch } from "../ui/controls";
import { emptyUserGroupForm, userGroupFormValues, userGroupInput, type UserGroupFormValues } from "./user-group-form";

const badgeStyleOptions = [
    { value: "none", label: "不展示徽章" },
    { value: "vip", label: "VIP · 金色" },
    { value: "svip", label: "SVIP · 紫粉流光" },
];

/** 分组编辑抽屉：基本信息与徽章、统一倍率与货币兑换比例、可用渠道、模型级倍率。 */
export function UserGroupEditor({ open, group, onClose, onSaved }: { open: boolean; group: UserGroup | null; onClose: () => void; onSaved: (group: UserGroup) => void }) {
    const { message, modal } = App.useApp();
    const { references } = useAdminContext();
    const [form] = Form.useForm<UserGroupFormValues>();
    const [saving, setSaving] = useState(false);
    const creating = !group;
    const allChannels = Form.useWatch("allChannels", form);
    const channelIds = Form.useWatch("channelIds", form) as string[] | undefined;
    const badgeStyle = Form.useWatch("badgeStyle", form);
    const badgeLabel = Form.useWatch("badgeLabel", form);
    const name = Form.useWatch("name", form);

    useEffect(() => {
        if (!open) return;
        form.resetFields();
        form.setFieldsValue(group ? userGroupFormValues(group) : emptyUserGroupForm());
    }, [form, group, open]);

    const channelOptions = useMemo(
        () =>
            references.channels.map((channel) => ({
                value: channel.id,
                label: `${channel.name}${channel.enabled ? "" : "（已停用）"}`,
            })),
        [references.channels],
    );

    // 模型倍率候选来自当前可用渠道；全部渠道时列出所有系统渠道模型。
    const modelOptions = useMemo(() => {
        const selected = new Set(channelIds || []);
        const keys = new Set<string>();
        for (const channel of references.channels) {
            if (!allChannels && !selected.has(channel.id)) continue;
            channel.models.forEach((key) => keys.add(key));
        }
        return [...keys].sort().map((key) => ({ value: key, label: key }));
    }, [allChannels, channelIds, references.channels]);

    const close = () => {
        if (saving) return;
        if (!form.isFieldsTouched()) {
            onClose();
            return;
        }
        modal.confirm({
            title: "放弃分组修改？",
            content: "尚未保存的分组倍率、渠道或徽章修改将丢失。",
            okText: "放弃修改",
            cancelText: "继续编辑",
            okButtonProps: { danger: true },
            onOk: onClose,
        });
    };

    const save = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            const input = userGroupInput(values);
            const result = group ? await updateAdminUserGroup(group.id, input) : await createAdminUserGroup(input);
            onSaved(result.group);
            message.success(group ? "分组已保存" : "分组已创建");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存分组失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Drawer
            title={group ? `编辑分组 · ${group.name}` : "新建分组"}
            open={open}
            size="min(640px, 100vw)"
            onClose={close}
            mask={{ closable: !saving }}
            destroyOnHidden
            extra={
                <Button type="primary" loading={saving} onClick={() => void save()}>
                    保存
                </Button>
            }
        >
            <Form form={form} layout="vertical" requiredMark={false}>
                <div className="grid gap-x-4 sm:grid-cols-2">
                    <Form.Item
                        name="code"
                        label="分组编码"
                        extra={creating ? "创建后不可修改，例如 vip、svip、enterprise。" : "分组编码创建后不可修改。"}
                        rules={[{ required: true, pattern: /^[a-z0-9][a-z0-9_-]{0,39}$/, message: "小写字母、数字、下划线或连字符，最多 40 位" }]}
                    >
                        <Input disabled={!creating} placeholder="vip" />
                    </Form.Item>
                    <Form.Item name="name" label="分组名称" rules={[{ required: true, whitespace: true, message: "请填写分组名称" }]}>
                        <Input maxLength={80} placeholder="VIP 会员" />
                    </Form.Item>
                </div>
                <Form.Item name="description" label="说明">
                    <Input.TextArea rows={2} maxLength={500} placeholder="面向哪类客户、有哪些权益" />
                </Form.Item>
                <div className="grid gap-x-4 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
                    <Form.Item name="badgeStyle" label="用户端徽章">
                        <Select options={badgeStyleOptions} />
                    </Form.Item>
                    <Form.Item name="badgeLabel" label="徽章文字" extra="留空时显示 VIP / SVIP。">
                        <Input maxLength={16} placeholder="VIP" />
                    </Form.Item>
                    <Form.Item label="预览">
                        <div className="flex h-8 items-center">{badgeStyle === "none" ? <span className="text-xs text-foreground/45">不展示</span> : <UserGroupBadge group={{ name, badgeLabel, badgeStyle }} />}</div>
                    </Form.Item>
                </div>

                <div className="mb-2 mt-2 text-sm font-medium">计费倍率与货币兑换</div>
                <Callout tone="info" className="mb-4">
                    实际扣费 = 模型售价 ×（USD/CNY 计价时乘以兑换比例）× 全局积分倍率 × 分组倍率 × 模型倍率。倍率 1 表示不打折，0.8 表示 8 折。
                </Callout>
                <div className="grid gap-x-4 sm:grid-cols-3">
                    <Form.Item name="ratio" label="分组倍率" rules={[{ required: true, type: "number", min: 0.0001, max: 100, message: "0.0001 至 100" }]}>
                        <InputNumber className="w-full" min={0.0001} max={100} step={0.05} />
                    </Form.Item>
                    <Form.Item name="pointsPerUsd" label="1 USD = 积分" rules={[{ type: "number", min: 0, max: 1_000_000 }]} extra="0 表示该分组不能使用 USD 计价模型。">
                        <InputNumber className="w-full" min={0} max={1_000_000} step={0.1} />
                    </Form.Item>
                    <Form.Item name="pointsPerCny" label="1 CNY = 积分" rules={[{ type: "number", min: 0, max: 1_000_000 }]} extra="0 表示该分组不能使用 CNY 计价模型。">
                        <InputNumber className="w-full" min={0} max={1_000_000} step={0.1} />
                    </Form.Item>
                </div>

                <div className="mb-2 mt-2 text-sm font-medium">可用渠道</div>
                <Form.Item name="allChannels" valuePropName="checked" extra="开启后可使用全部系统渠道（含以后新增的渠道）；关闭后只能使用下方勾选的渠道。管理员始终可见全部渠道。">
                    <Switch aria-label="开放全部系统渠道" />
                </Form.Item>
                {!allChannels ? (
                    <Form.Item name="channelIds" label="绑定渠道" extra={channelIds?.length ? undefined : "未绑定任何渠道时，该分组用户看不到任何系统模型。"}>
                        <Select mode="multiple" allowClear showSearch optionFilterProp="label" options={channelOptions} placeholder="选择该分组可使用的系统渠道" />
                    </Form.Item>
                ) : null}

                <div className="mb-2 mt-2 text-sm font-medium">模型单独倍率</div>
                <p className="mb-3 text-xs text-foreground/55">按渠道模型标识（前台统一价模型按模型编码）匹配；留空表示沿用分组默认值。</p>
                <Form.List name="modelOverrides">
                    {(fields, { add, remove }) => (
                        <div className="grid gap-2">
                            {fields.map((field) => (
                                <div key={field.key} className="grid items-start gap-2 sm:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))_auto]">
                                    <Form.Item name={[field.name, "modelKey"]} className="mb-0" rules={[{ required: true, whitespace: true, message: "请选择模型" }]}>
                                        <Select showSearch allowClear options={modelOptions} placeholder="模型标识" aria-label="模型标识" />
                                    </Form.Item>
                                    <Form.Item name={[field.name, "ratio"]} className="mb-0">
                                        <InputNumber className="w-full" min={0.0001} max={100} step={0.05} placeholder="倍率" aria-label="模型倍率" />
                                    </Form.Item>
                                    <Form.Item name={[field.name, "pointsPerUsd"]} className="mb-0">
                                        <InputNumber className="w-full" min={0} max={1_000_000} placeholder="1 USD=" aria-label="1 USD 兑换积分" />
                                    </Form.Item>
                                    <Form.Item name={[field.name, "pointsPerCny"]} className="mb-0">
                                        <InputNumber className="w-full" min={0} max={1_000_000} placeholder="1 CNY=" aria-label="1 CNY 兑换积分" />
                                    </Form.Item>
                                    <Button type="text" danger icon={<Trash2 className="size-4" />} aria-label="删除这条模型倍率" onClick={() => remove(field.name)} />
                                </div>
                            ))}
                            <Button icon={<Plus className="size-4" />} onClick={() => add({ modelKey: "", ratio: null, pointsPerUsd: null, pointsPerCny: null })}>
                                添加模型倍率
                            </Button>
                        </div>
                    )}
                </Form.List>

                <Form.Item name="sortOrder" label="排序" className="mt-4" extra="数字越小越靠前。">
                    <InputNumber className="w-40" min={-100000} max={100000} />
                </Form.Item>
            </Form>
        </Drawer>
    );
}
