import { App, Button, Drawer, Form, Input, Select } from "antd";
import { useEffect, useState } from "react";

import { createAdminUser, updateAdminUser, type AdminUser, type LocalUser } from "@/services/api/auth";
import { useTranslation } from "react-i18next";

type UserFormValues = Pick<LocalUser, "displayName" | "email" | "role" | "status">;

export function AdminUserEditDrawer({ user, actorId, onClose, onSaved }: { user: AdminUser | null; actorId?: string; onClose: () => void; onSaved: (user: LocalUser) => void }) {
    const { t } = useTranslation("canvas");
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
            title: t("admin:discard-user-changes"),
            content: t("admin:unsaved-account-role-or-status-changes-will-be-lost"),
            okText: t("admin:discard-changes"),
            cancelText: t("admin:keep-editing-2"),
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
            message.success(t("admin:user-saved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-save-user"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Drawer
            title={user ? `编辑用户 · ${user.displayName || user.username}` : t("admin:edit-user")}
            open={Boolean(user)}
            width="min(520px, 100vw)"
            onClose={close}
            maskClosable={!saving}
            destroyOnHidden
            extra={
                <Button type="primary" loading={saving} onClick={() => void save()}>
                    {t("admin:save-4")}
                </Button>
            }
        >
            <Form form={form} layout="vertical" requiredMark={false}>
                <Form.Item label={t("admin:username")}>
                    <Input value={user ? `@${user.username}` : ""} disabled />
                </Form.Item>
                <Form.Item name="displayName" label={t("admin:display-name")} rules={[{ required: true, whitespace: true, message: t("admin:enter-a-display-name") }]}>
                    <Input placeholder={t("admin:name-shown-in-the-product")} />
                </Form.Item>
                <Form.Item name="email" label={t("admin:email")} rules={[{ type: "email", message: t("admin:enter-a-valid-email") }]}>
                    <Input placeholder="name@example.com" />
                </Form.Item>
                <Form.Item name="role" label={t("admin:role")} extra={editingSelf ? t("admin:you-cannot-change-your-own-admin-role-here") : t("admin:role-changes-take-effect-on-console-access-immediately")}>
                    <Select
                        disabled={editingSelf}
                        options={[
                            { label: t("admin:admin"), value: "admin" },
                            { label: t("admin:user"), value: "user" },
                        ]}
                    />
                </Form.Item>
                <Form.Item name="status" label={t("admin:account-status")} extra={editingSelf ? t("admin:you-cannot-disable-the-currently-signed-in-account") : t("admin:disabling-clears-sessions-but-keeps-identity-tasks-and-credit-transactio")}>
                    <Select
                        disabled={editingSelf}
                        options={[
                            { label: t("admin:enabled"), value: "active" },
                            { label: t("admin:disabled"), value: "disabled" },
                        ]}
                    />
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

export function AdminUserCreateDrawer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (user: AdminUser) => void }) {
    const { t } = useTranslation("canvas");
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
            title: t("admin:discard-adding-this-user"),
            content: t("admin:unsaved-user-info-will-be-lost"),
            okText: t("admin:discard-and-close"),
            cancelText: t("admin:keep-editing-2"),
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
            message.success(t("admin:user-created"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-create-user"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Drawer
            title={t("admin:add-user")}
            open={open}
            width="min(520px, 100vw)"
            onClose={close}
            maskClosable={!saving}
            destroyOnHidden
            extra={
                <Button type="primary" loading={saving} onClick={() => void save()}>
                    {t("admin:save-4")}
                </Button>
            }
        >
            <Form form={form} layout="vertical" requiredMark={false}>
                <Form.Item name="username" label={t("admin:username")} rules={[{ required: true, whitespace: true, message: t("admin:enter-a-username") }]}>
                    <Input placeholder={t("admin:3-32-letters-digits-underscores-or-hyphens")} />
                </Form.Item>
                <Form.Item name="displayName" label={t("admin:display-name")} rules={[{ required: true, whitespace: true, message: t("admin:enter-a-display-name") }]}>
                    <Input placeholder={t("admin:name-shown-in-the-product")} />
                </Form.Item>
                <Form.Item name="email" label={t("admin:email")} rules={[{ type: "email", message: t("admin:enter-a-valid-email") }]}>
                    <Input placeholder="name@example.com" />
                </Form.Item>
                <Form.Item name="password" label={t("admin:initial-password")} rules={[{ required: true, message: t("admin:set-an-initial-password") }]}>
                    <Input.Password placeholder={t("admin:at-least-8-characters")} />
                </Form.Item>
                <Form.Item name="role" label={t("admin:role")}>
                    <Select
                        options={[
                            { label: t("admin:admin"), value: "admin" },
                            { label: t("admin:user"), value: "user" },
                        ]}
                    />
                </Form.Item>
                <Form.Item name="status" label={t("admin:account-status")}>
                    <Select
                        options={[
                            { label: t("admin:enabled"), value: "active" },
                            { label: t("admin:disabled"), value: "disabled" },
                        ]}
                    />
                </Form.Item>
            </Form>
        </Drawer>
    );
}
