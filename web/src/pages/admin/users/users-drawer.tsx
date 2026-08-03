import { App, Button, Drawer, Form, Input, Select } from "antd";
import { useEffect, useState } from "react";

import { createAdminUser, updateAdminUser, type AdminUser, type LocalUser } from "@/services/api/auth";

type UserFormValues = Pick<LocalUser, "displayName" | "email" | "role" | "status">;

export function AdminUserEditDrawer({
    user,
    actorId,
    onClose,
    onSaved,
}: {
    user: AdminUser | null;
    actorId?: string;
    onClose: () => void;
    onSaved: (user: LocalUser) => void;
}) {
    const { message, modal } = App.useApp();
    const [saving, setSaving] = useState(false);
    const [form] = Form.useForm<UserFormValues>();
    const editingSelf = user?.id === actorId;

    useEffect(() => {
        if (!user) return;
        form.resetFields();
        form.setFieldsValue({
            displayName: user.displayName,
            email: user.email || "",
            role: user.role,
            status: user.status,
        });
    }, [form, user]);

    const close = () => {
        if (saving) return;
        if (!form.isFieldsTouched()) {
            onClose();
            return;
        }
        modal.confirm({
            title: "放弃用户修改？",
            content: "尚未保存的账号、角色或状态修改将丢失。",
            okText: "放弃修改",
            cancelText: "继续编辑",
            okButtonProps: { danger: true },
            onOk: onClose,
        });
    };

    const save = async () => {
        if (!user) return;
        const values = await form.validateFields();
        setSaving(true);
        try {
            const result = await updateAdminUser(user.id, {
                displayName: values.displayName.trim(),
                email: values.email?.trim() || "",
                role: values.role,
                status: values.status,
            });
            onSaved(result.user);
            form.resetFields();
            onClose();
            message.success("用户信息已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存用户失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Drawer
            title={user ? `编辑用户 · ${user.displayName || user.username}` : "编辑用户"}
            open={Boolean(user)}
            width="min(520px, 100vw)"
            onClose={close}
            maskClosable={!saving}
            destroyOnHidden
            extra={<Button type="primary" loading={saving} onClick={() => void save()}>保存</Button>}
        >
            <Form form={form} layout="vertical" requiredMark={false}>
                <Form.Item label="用户名">
                    <Input value={user ? `@${user.username}` : ""} disabled />
                </Form.Item>
                <Form.Item name="displayName" label="显示名称" rules={[{ required: true, whitespace: true, message: "请填写显示名称" }]}>
                    <Input placeholder="用户在产品内显示的名称" />
                </Form.Item>
                <Form.Item name="email" label="邮箱" rules={[{ type: "email", message: "请输入有效邮箱" }]}>
                    <Input placeholder="name@example.com" />
                </Form.Item>
                <Form.Item name="role" label="角色" extra={editingSelf ? "不能在此修改当前管理员自己的角色。" : "角色变更会立即影响后台访问权限。"}>
                    <Select disabled={editingSelf} options={[{ label: "管理员", value: "admin" }, { label: "普通用户", value: "user" }]} />
                </Form.Item>
                <Form.Item name="status" label="账号状态" extra={editingSelf ? "不能停用当前登录账号。" : "停用后会清除登录态，但保留身份、任务和积分流水。"}>
                    <Select disabled={editingSelf} options={[{ label: "已启用", value: "active" }, { label: "已停用", value: "disabled" }]} />
                </Form.Item>
            </Form>
        </Drawer>
    );
}

type CreateUserFormValues = {
    username: string;
    displayName: string;
    email?: string;
    password: string;
    role: LocalUser["role"];
    status: LocalUser["status"];
};

export function AdminUserCreateDrawer({
    open,
    onClose,
    onCreated,
}: {
    open: boolean;
    onClose: () => void;
    onCreated: (user: AdminUser) => void;
}) {
    const { message, modal } = App.useApp();
    const [saving, setSaving] = useState(false);
    const [form] = Form.useForm<CreateUserFormValues>();

    useEffect(() => {
        if (!open) return;
        form.resetFields();
        form.setFieldsValue({ role: "user", status: "active" });
    }, [form, open]);

    const close = () => {
        if (saving) return;
        if (!form.isFieldsTouched()) {
            onClose();
            return;
        }
        modal.confirm({
            title: "\u653e\u5f03\u6dfb\u52a0\u7528\u6237\uff1f",
            content: "\u5c1a\u672a\u4fdd\u5b58\u7684\u7528\u6237\u4fe1\u606f\u5c06\u4e22\u5931\u3002",
            okText: "\u653e\u5f03\u5e76\u5173\u95ed",
            cancelText: "\u7ee7\u7eed\u7f16\u8f91",
            okButtonProps: { danger: true },
            onOk: onClose,
        });
    };

    const save = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            const result = await createAdminUser({
                username: values.username.trim(),
                displayName: values.displayName.trim(),
                email: values.email?.trim() || "",
                password: values.password,
                role: values.role,
                status: values.status,
            });
            onCreated(result.user);
            form.resetFields();
            onClose();
            message.success("\u7528\u6237\u5df2\u521b\u5efa");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "\u521b\u5efa\u7528\u6237\u5931\u8d25");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Drawer
            title={"\u6dfb\u52a0\u7528\u6237"}
            open={open}
            width="min(520px, 100vw)"
            onClose={close}
            maskClosable={!saving}
            destroyOnHidden
            extra={<Button type="primary" loading={saving} onClick={() => void save()}>{"\u4fdd\u5b58"}</Button>}
        >
            <Form form={form} layout="vertical" requiredMark={false}>
                <Form.Item name="username" label={"\u7528\u6237\u540d"} rules={[{ required: true, whitespace: true, message: "\u8bf7\u8f93\u5165\u7528\u6237\u540d" }]}>
                    <Input placeholder={"3-32 \u4f4d\u5b57\u6bcd\u3001\u6570\u5b57\u3001\u4e0b\u5212\u7ebf\u6216\u8fde\u5b57\u7b26"} />
                </Form.Item>
                <Form.Item name="displayName" label={"\u663e\u793a\u540d\u79f0"} rules={[{ required: true, whitespace: true, message: "\u8bf7\u586b\u5199\u663e\u793a\u540d\u79f0" }]}>
                    <Input placeholder={"\u7528\u6237\u5728\u4ea7\u54c1\u5185\u663e\u793a\u7684\u540d\u79f0"} />
                </Form.Item>
                <Form.Item name="email" label={"\u90ae\u7bb1"} rules={[{ type: "email", message: "\u8bf7\u8f93\u5165\u6709\u6548\u90ae\u7bb1" }]}>
                    <Input placeholder="name@example.com" />
                </Form.Item>
                <Form.Item name="password" label={"\u521d\u59cb\u5bc6\u7801"} rules={[{ required: true, message: "\u8bf7\u8bbe\u7f6e\u521d\u59cb\u5bc6\u7801" }]}>
                    <Input.Password placeholder={"\u81f3\u5c11 8 \u4f4d"} />
                </Form.Item>
                <Form.Item name="role" label={"\u89d2\u8272"}>
                    <Select options={[{ label: "\u7ba1\u7406\u5458", value: "admin" }, { label: "\u666e\u901a\u7528\u6237", value: "user" }]} />
                </Form.Item>
                <Form.Item name="status" label={"\u8d26\u53f7\u72b6\u6001"}>
                    <Select options={[{ label: "\u5df2\u542f\u7528", value: "active" }, { label: "\u5df2\u505c\u7528", value: "disabled" }]} />
                </Form.Item>
            </Form>
        </Drawer>
    );
}
