import { App, Button, Form, Input } from "antd";
import { KeyRound, Pencil, Save, ShieldCheck, Sparkles, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { UserAvatar } from "@/components/layout/user-avatar";
import { changePassword, updateProfile } from "@/services/api/auth";
import { resolveAvatarUrl } from "@/lib/avatar-url";
import { resourceFileUrl, uploadResourceFile } from "@/services/api/resources";
import { useUserStore } from "@/stores/use-user-store";

export function ProfilePane() {
    const { message } = App.useApp();
    const user = useUserStore((state) => state.user);
    const setUser = useUserStore((state) => state.setUser);
    const [savingProfile, setSavingProfile] = useState(false);
    const [savingPassword, setSavingPassword] = useState(false);
    const [uploadingAvatar, setUploadingAvatar] = useState(false);
    const [editingName, setEditingName] = useState(false);
    const [nameDraft, setNameDraft] = useState("");
    const [profileForm] = Form.useForm();
    const [passwordForm] = Form.useForm();
    const fileInputRef = useRef<HTMLInputElement>(null);

    if (!user) return null;

    const handleAvatarUpload = async (file: File) => {
        if (!file.type.startsWith("image/")) {
            message.error("请选择图片文件");
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            message.error("头像图片不能超过 5MB");
            return;
        }
        setUploadingAvatar(true);
        try {
            const resource = await uploadResourceFile(file, "image", { fileName: file.name });
            const avatarUrl = resolveAvatarUrl(resource.publicUrl || resourceFileUrl(resource.id));
            const result = await updateProfile({ avatarUrl });
            setUser(result.user);
            message.success("头像已更新");
        } catch (err) {
            message.error(err instanceof Error ? err.message : "头像上传失败");
        } finally {
            setUploadingAvatar(false);
        }
    };

    const handleSaveProfile = async () => {
        const values = await profileForm.validateFields();
        setSavingProfile(true);
        try {
            const result = await updateProfile({
                email: values.email?.trim() || undefined,
            });
            setUser(result.user);
            message.success("个人信息已保存");
        } catch (err) {
            message.error(err instanceof Error ? err.message : "保存失败");
        } finally {
            setSavingProfile(false);
        }
    };

    const startEditName = () => {
        setNameDraft(user.displayName || "");
        setEditingName(true);
    };

    const handleSaveName = async () => {
        const next = nameDraft.trim();
        setEditingName(false);
        if (!next || next === user.displayName || next.length > 80) return;
        try {
            const result = await updateProfile({ displayName: next });
            setUser(result.user);
            message.success("昵称已更新");
        } catch (err) {
            message.error(err instanceof Error ? err.message : "昵称更新失败");
        }
    };

    const handleChangePassword = async () => {
        const values = await passwordForm.validateFields();
        setSavingPassword(true);
        try {
            await changePassword({
                currentPassword: values.currentPassword,
                newPassword: values.newPassword,
            });
            passwordForm.resetFields();
            message.success("密码已修改");
        } catch (err) {
            message.error(err instanceof Error ? err.message : "修改密码失败");
        } finally {
            setSavingPassword(false);
        }
    };

    return (
        <div className="space-y-6">
            <section className="settings-section">
                <div className="settings-pane-header">
                    <div className="min-w-0">
                        <h2>个人信息</h2>
                        <p>头像、昵称和邮箱将展示在账户卡片和创作页面。</p>
                    </div>
                </div>

                <div className="settings-section" style={{ paddingTop: 0 }}>
                    <div className="flex items-center gap-4">
                        <div className="relative shrink-0">
                            <button
                                type="button"
                                className="group relative block size-16 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--workspace-accent)]"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploadingAvatar}
                                aria-label="更换头像"
                            >
                                <UserAvatar user={user} className="size-16 rounded-full" />
                                <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-full bg-black/55 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                                    <Upload className="size-4" aria-hidden />
                                    更换头像
                                </span>
                            </button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) void handleAvatarUpload(file);
                                    e.target.value = "";
                                }}
                            />
                        </div>
                        <div className="min-w-0">
                            {editingName ? (
                                <Input
                                    autoFocus
                                    value={nameDraft}
                                    onChange={(e) => setNameDraft(e.target.value)}
                                    onPressEnter={() => void handleSaveName()}
                                    onBlur={() => void handleSaveName()}
                                    onKeyDown={(e) => {
                                        if (e.key === "Escape") setEditingName(false);
                                    }}
                                    maxLength={80}
                                    className="max-w-[240px]"
                                    aria-label="编辑昵称"
                                />
                            ) : (
                                <div className="flex items-center gap-2">
                                    <span className="truncate text-xl font-semibold">{user.displayName || user.username}</span>
                                    <button
                                        type="button"
                                        className="grid size-7 shrink-0 place-items-center rounded-full text-foreground/45 transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--workspace-accent)]"
                                        onClick={startEditName}
                                        aria-label="编辑昵称"
                                    >
                                        <Pencil className="size-3.5" />
                                    </button>
                                </div>
                            )}
                            {user.role === "admin" ? (
                                <span className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs text-amber-600 dark:text-amber-400">
                                    <ShieldCheck className="size-3" aria-hidden />
                                    管理员
                                </span>
                            ) : (
                                <span className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-border/60 bg-foreground/[.04] px-2.5 py-0.5 text-xs text-foreground/60">
                                    <Sparkles className="size-3" aria-hidden />
                                    创作者
                                </span>
                            )}
                        </div>
                    </div>

                    <Form
                        form={profileForm}
                        layout="vertical"
                        initialValues={{ email: user.email || "" }}
                        className="mt-4 max-w-md"
                    >
                        <Form.Item label="用户名">
                            <Input value={user.username} disabled />
                        </Form.Item>
                        <Form.Item
                            label="邮箱"
                            name="email"
                            rules={[{ type: "email", message: "邮箱格式不正确" }]}
                        >
                            <Input placeholder="user@example.com" />
                        </Form.Item>
                        <Form.Item>
                            <Button
                                type="primary"
                                icon={<Save className="size-4" />}
                                loading={savingProfile}
                                onClick={handleSaveProfile}
                            >
                                保存
                            </Button>
                        </Form.Item>
                    </Form>
                </div>
            </section>

            <section className="settings-section">
                <div className="settings-pane-header">
                    <div className="min-w-0">
                        <h2>安全设置</h2>
                        <p>修改密码后需要重新登录。</p>
                    </div>
                </div>
                <Form
                    form={passwordForm}
                    layout="vertical"
                    className="mt-2 max-w-md"
                >
                    <Form.Item
                        label="当前密码"
                        name="currentPassword"
                        rules={[{ required: true, message: "请输入当前密码" }]}
                    >
                        <Input.Password placeholder="输入当前密码" autoComplete="current-password" />
                    </Form.Item>
                    <Form.Item
                        label="新密码"
                        name="newPassword"
                        rules={[
                            { required: true, message: "请输入新密码" },
                            { min: 8, message: "密码至少 8 个字符" },
                        ]}
                    >
                        <Input.Password placeholder="设置新密码" autoComplete="new-password" />
                    </Form.Item>
                    <Form.Item
                        label="确认新密码"
                        name="confirmPassword"
                        dependencies={["newPassword"]}
                        rules={[
                            { required: true, message: "请确认新密码" },
                            ({ getFieldValue }) => ({
                                validator(_, value) {
                                    if (!value || getFieldValue("newPassword") === value) return Promise.resolve();
                                    return Promise.reject(new Error("两次输入的密码不一致"));
                                },
                            }),
                        ]}
                    >
                        <Input.Password placeholder="再次输入新密码" autoComplete="new-password" />
                    </Form.Item>
                    <Form.Item>
                        <Button
                            icon={<KeyRound className="size-4" />}
                            loading={savingPassword}
                            onClick={handleChangePassword}
                        >
                            修改密码
                        </Button>
                    </Form.Item>
                </Form>
            </section>
        </div>
    );
}
