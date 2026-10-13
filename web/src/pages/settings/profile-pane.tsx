import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Avatar, Button, Form, Input, Skeleton } from "antd";
import { BadgeCheck, Crop, ImagePlus, KeyRound, Mail, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { UserAvatar } from "@/components/layout/user-avatar";
import { ImageCropDialog, type ImageCropRect } from "@/components/image-crop-dialog";
import { AppModal } from "@/components/ui/product/app-modal";
import { Callout } from "@/components/ui/product/callout";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { DEFAULT_USER_AVATARS } from "@/lib/default-user-avatars";
import { cropProfileAvatar } from "@/services/profile-avatar";
import { loadProfileSession } from "@/services/profile-session";
import { applyUserSession } from "@/lib/user-session";
import { invalidateAuthSessionCache, type LocalUser } from "@/services/api/auth";
import { changeProfileEmail, changeProfilePassword, profileLinuxDOReauthURL, requestProfileEmailCode, selectDefaultProfileAvatar, uploadProfileAvatar, type UserProfile } from "@/services/api/profile";
import { ApiError } from "@/services/api/request";
import { useUserStore } from "@/stores/use-user-store";
import { profileAvatarError, profilePasswordError, profileReauthReady, profileSecondsRemaining } from "./profile-validation";
import "./profile-pane.css";

type PasswordFields = { currentPassword: string; newPassword: string; confirmPassword: string };
type EmailFields = { currentPassword: string; email: string; emailCode: string };
type PendingAction = "crop-avatar" | "avatar" | "reset-avatar" | "password" | "email-code" | "email";
type AvatarTab = "upload" | "preset";
type EmailTicket = { value: string; expiresAt: number };

const errorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

export function ProfilePane() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const queryClient = useQueryClient();
    const userId = useUserStore((state) => state.user?.id);
    const queryKey = ["user-profile", userId];
    const profileQuery = useQuery({ queryKey, queryFn: ({ signal }) => loadProfileSession(userId, signal), enabled: !!userId, retry: false, refetchOnWindowFocus: false, staleTime: 0 });
    const profile = profileQuery.data;
    const [passwordForm] = Form.useForm<PasswordFields>();
    const [emailForm] = Form.useForm<EmailFields>();
    const [pending, setPending] = useState<PendingAction | null>(null);
    const pendingRef = useRef(false);
    const [errors, setErrors] = useState({ avatar: "", password: "", email: "" });
    const [draftAvatar, setDraftAvatar] = useState<{ file: File; url: string; sourceFile: File } | null>(null);
    const [cropSource, setCropSource] = useState<{ file: File; url: string } | null>(null);
    const [avatarDialogOpen, setAvatarDialogOpen] = useState(false);
    const [avatarTab, setAvatarTab] = useState<AvatarTab>("upload");
    const [defaultAvatarDraft, setDefaultAvatarDraft] = useState("person");
    const cropGeneration = useRef(0);
    const fileInput = useRef<HTMLInputElement>(null);
    const [emailTicket, setEmailTicket] = useState<EmailTicket | null>(null);
    const [retryAt, setRetryAt] = useState(0);
    const [now, setNow] = useState(Date.now());
    const oauthResult = searchParams.get("reauth");
    const [reauthResult] = useState(oauthResult);
    const reauthReady = profileReauthReady(profile?.reauthenticatedUntil, now);
    const identityReady = !!profile?.hasPassword || reauthReady;
    const retrySeconds = profileSecondsRemaining(retryAt, now);
    const ticketSeconds = emailTicket ? profileSecondsRemaining(emailTicket.expiresAt, now) : 0;

    useEffect(() => {
        if (!oauthResult) return;
        const next = new URLSearchParams(searchParams);
        next.delete("reauth");
        setSearchParams(next, { replace: true });
    }, [oauthResult, searchParams, setSearchParams]);

    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(
        () => () => {
            if (draftAvatar) URL.revokeObjectURL(draftAvatar.url);
        },
        [draftAvatar],
    );

    useEffect(
        () => () => {
            if (cropSource) URL.revokeObjectURL(cropSource.url);
        },
        [cropSource],
    );

    useEffect(
        () => () => {
            cropGeneration.current += 1;
        },
        [],
    );

    const setError = (section: keyof typeof errors, value: string) => setErrors((current) => ({ ...current, [section]: value }));
    const begin = (action: PendingAction) => {
        if (pendingRef.current) return false;
        pendingRef.current = true;
        setPending(action);
        return true;
    };
    const end = () => {
        pendingRef.current = false;
        setPending(null);
    };

    const updateAvatarUser = (user: LocalUser) => {
        if (useUserStore.getState().user?.id !== userId || user.id !== userId) return;
        invalidateAuthSessionCache();
        useUserStore.getState().setUser(user);
        queryClient.setQueryData<UserProfile>(queryKey, (current) => (current ? { ...current, user } : current));
        setDraftAvatar(null);
        setCropSource(null);
        setAvatarDialogOpen(false);
    };

    const openAvatarDialog = () => {
        if (!profile) return;
        setAvatarTab(profile.user.avatarMode === "default" ? "preset" : "upload");
        setDefaultAvatarDraft(profile.user.avatarPreset || "person");
        setError("avatar", "");
        setAvatarDialogOpen(true);
    };

    const closeAvatarDialog = () => {
        if (pendingRef.current) return;
        cropGeneration.current += 1;
        setCropSource(null);
        setDraftAvatar(null);
        setAvatarDialogOpen(false);
        setError("avatar", "");
    };

    const selectAvatar = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        const error = profileAvatarError(file);
        setError("avatar", error || "");
        if (error) return;
        setCropSource({ file, url: URL.createObjectURL(file) });
    };

    const confirmAvatarCrop = async (crop: ImageCropRect) => {
        if (!cropSource || !begin("crop-avatar")) return;
        const source = cropSource;
        const generation = cropGeneration.current;
        setError("avatar", "");
        try {
            const file = await cropProfileAvatar(source.url, crop, source.file.name);
            if (cropGeneration.current !== generation || useUserStore.getState().user?.id !== userId) return;
            setDraftAvatar({ file, url: URL.createObjectURL(file), sourceFile: source.file });
            setCropSource(null);
        } catch (error) {
            if (cropGeneration.current !== generation) return;
            const msg = errorMessage(error, "裁剪头像失败，请重试");
            setError("avatar", msg);
            message.error(msg);
        } finally {
            end();
        }
    };

    const saveAvatar = async () => {
        if (!draftAvatar || !begin("avatar")) return;
        setError("avatar", "");
        try {
            // 取消仍在加载的旧资料，避免写入成功后被旧头像响应覆盖。
            await queryClient.cancelQueries({ queryKey });
            const { user } = await uploadProfileAvatar(draftAvatar.file);
            await queryClient.cancelQueries({ queryKey });
            updateAvatarUser(user);
            message.success("头像已保存");
        } catch (error) {
            setError("avatar", errorMessage(error, "保存头像失败，请重试"));
        } finally {
            end();
        }
    };

    const saveDefaultAvatar = async () => {
        if (!begin("reset-avatar")) return;
        setError("avatar", "");
        try {
            await queryClient.cancelQueries({ queryKey });
            const { user } = await selectDefaultProfileAvatar(defaultAvatarDraft);
            await queryClient.cancelQueries({ queryKey });
            updateAvatarUser(user);
            message.success("已使用选择的系统头像");
        } catch (error) {
            setError("avatar", errorMessage(error, "保存头像失败，请重试"));
        } finally {
            end();
        }
    };

    const finishSecurityChange = async (notice: string, notificationFailed = false) => {
        if (useUserStore.getState().user?.id !== userId) return;
        invalidateAuthSessionCache();
        passwordForm.resetFields();
        emailForm.resetFields();
        setEmailTicket(null);
        try {
            await applyUserSession({ user: null });
            if (notificationFailed) message.warning({ content: notice, duration: 8 });
            else message.success({ content: notice, duration: 6 });
        } catch (error) {
            useUserStore.getState().clearSession();
            useUserStore.getState().setHydrated(true);
            message.error({ content: `${notice} 清理本地会话失败：${errorMessage(error, "请重新登录")}`, duration: 8 });
        } finally {
            navigate("/login", { replace: true });
        }
    };

    const savePassword = async (values: PasswordFields) => {
        if (!(profile?.hasPassword || profileReauthReady(profile?.reauthenticatedUntil, Date.now())) || !begin("password")) return;
        setError("password", "");
        try {
            await changeProfilePassword({ currentPassword: profile?.hasPassword ? values.currentPassword : "", newPassword: values.newPassword });
            await finishSecurityChange("密码已更新，所有登录会话已退出，请重新登录");
        } catch (error) {
            setError("password", errorMessage(error, "修改密码失败，请重试"));
        } finally {
            end();
        }
    };

    const sendEmailCode = async () => {
        if (!profile?.emailEnabled || !(profile.hasPassword || profileReauthReady(profile.reauthenticatedUntil, Date.now())) || profileSecondsRemaining(retryAt, Date.now()) || pendingRef.current) return;
        let values: EmailFields;
        try {
            values = await emailForm.validateFields(profile.hasPassword ? ["email", "currentPassword"] : ["email"]);
        } catch {
            return;
        }
        if (!begin("email-code")) return;
        setError("email", "");
        setEmailTicket(null);
        emailForm.setFieldValue("emailCode", "");
        try {
            const result = await requestProfileEmailCode({ email: values.email.trim(), currentPassword: profile.hasPassword ? values.currentPassword : "" });
            const receivedAt = Date.now();
            setEmailTicket({ value: result.ticket, expiresAt: receivedAt + result.expiresIn * 1000 });
            setRetryAt(receivedAt + result.retryAfter * 1000);
            setNow(receivedAt);
            message.success("验证码已发送到新邮箱");
        } catch (error) {
            if (error instanceof ApiError && error.retryAfterMs) setRetryAt(Date.now() + error.retryAfterMs);
            setError("email", errorMessage(error, "发送验证码失败，请重试"));
        } finally {
            end();
        }
    };

    const saveEmail = async (values: EmailFields) => {
        if (!profile?.emailEnabled || !(profile.hasPassword || profileReauthReady(profile.reauthenticatedUntil, Date.now())) || !emailTicket || !profileSecondsRemaining(emailTicket.expiresAt, Date.now()) || !begin("email")) return;
        setError("email", "");
        try {
            const result = await changeProfileEmail({ ticket: emailTicket.value, emailCode: values.emailCode, currentPassword: profile.hasPassword ? values.currentPassword : "" });
            await finishSecurityChange(result.notificationStatus === "failed" ? "邮箱已更新，但旧邮箱通知发送失败。所有登录会话已退出，请重新登录" : "邮箱已更新，所有登录会话已退出，请重新登录", result.notificationStatus === "failed");
        } catch (error) {
            setError("email", errorMessage(error, "修改邮箱失败，请重试"));
        } finally {
            end();
        }
    };

    const resetEmailTicket = (changed: Partial<EmailFields>) => {
        setError("email", "");
        if ("email" in changed || "currentPassword" in changed) {
            setEmailTicket(null);
            emailForm.setFieldValue("emailCode", "");
        }
    };

    return (
        <div className="profile-pane">
            <div className="settings-pane-header">
                <div className="min-w-0">
                    <h2>个人信息</h2>
                    <p>管理你的头像、登录密码与邮箱。</p>
                </div>
                <Button icon={<RefreshCw className="size-4" />} loading={profileQuery.isFetching} disabled={!!pending} onClick={() => void profileQuery.refetch()}>
                    刷新资料
                </Button>
            </div>
            {profileQuery.isPending ? (
                <Skeleton active paragraph={{ rows: 7 }} />
            ) : profileQuery.isError ? (
                <Callout
                    tone="error"
                    title="个人信息加载失败"
                    role="alert"
                    action={
                        <Button size="small" onClick={() => void profileQuery.refetch()}>
                            重试
                        </Button>
                    }
                >
                    {errorMessage(profileQuery.error, "请稍后重试")}
                </Callout>
            ) : profile ? (
                <div className="profile-sections">
                    <section className="profile-overview" aria-labelledby="profile-avatar-title">
                        <div className="profile-overview-heading">
                            <h3 id="profile-avatar-title">头像与账号</h3>
                            <p>头像会同步显示在工作区和创作消息中。</p>
                        </div>
                        <div className="profile-overview-main">
                            <UserAvatar user={profile.user} className="profile-avatar-preview" />
                            <div className="profile-overview-identity">
                                <strong>{profile.user.displayName || profile.user.username}</strong>
                                <span>账号 · {profile.user.username}</span>
                            </div>
                            <Button type="primary" icon={<ImagePlus className="size-4" />} disabled={!!pending} onClick={openAvatarDialog}>
                                更换头像
                            </Button>
                        </div>
                    </section>

                    {!profile.hasPassword ? (
                        <Callout
                            tone={reauthReady ? "success" : "info"}
                            title="验证当前身份"
                            icon={ShieldCheck}
                            action={
                                profile.linuxdoEnabled ? (
                                    <Button disabled={!!pending} onClick={() => window.location.assign(profileLinuxDOReauthURL())}>
                                        {reauthReady ? "重新验证" : "使用 Linux.do 验证"}
                                    </Button>
                                ) : undefined
                            }
                        >
                            {reauthReady
                                ? `身份验证已通过，有效期剩余 ${profileSecondsRemaining(Date.parse(profile.reauthenticatedUntil!), now)} 秒。`
                                : profile.linuxdoEnabled
                                  ? "设置密码或更换邮箱前，请使用已绑定的 Linux.do 账号重新验证。验证有效期为 5 分钟。"
                                  : "当前账号未设置密码，且 Linux.do 验证未启用，请联系管理员。"}
                            {reauthResult === "error" && !reauthReady ? (
                                <p className="profile-reauth-error" role="alert">
                                    Linux.do 身份验证失败，请重新验证。
                                </p>
                            ) : null}
                        </Callout>
                    ) : null}

                    <div className="profile-security-heading">
                        <h3>账户安全</h3>
                        <p>密码与邮箱分别验证，修改成功后需要重新登录。</p>
                    </div>
                    <div className="profile-security-grid">
                        <section className="profile-security-card" aria-labelledby="profile-password-title">
                            <div className="profile-card-heading">
                                <span className="profile-card-icon">
                                    <KeyRound className="size-5" />
                                </span>
                                <div>
                                    <h4 id="profile-password-title">{profile.hasPassword ? "修改密码" : "设置登录密码"}</h4>
                                    <p>更新后，所有设备上的登录会话都会退出。</p>
                                </div>
                            </div>
                            <Form
                                form={passwordForm}
                                name="profile-password"
                                layout="vertical"
                                requiredMark={false}
                                className="profile-form"
                                disabled={!!pending || !identityReady}
                                onFinish={(values) => void savePassword(values)}
                                onValuesChange={() => setError("password", "")}
                            >
                                {profile.hasPassword ? (
                                    <Form.Item name="currentPassword" label="当前密码" rules={[{ required: true, message: "请输入当前密码" }]}>
                                        <Input.Password autoComplete="current-password" />
                                    </Form.Item>
                                ) : null}
                                <Form.Item
                                    name="newPassword"
                                    label="新密码"
                                    rules={[
                                        {
                                            validator: async (_, value: string = "") => {
                                                const error = profilePasswordError(value);
                                                if (error) throw new Error(error);
                                            },
                                        },
                                    ]}
                                >
                                    <Input.Password autoComplete="new-password" placeholder="至少 8 个字符" />
                                </Form.Item>
                                <Form.Item
                                    name="confirmPassword"
                                    label="确认新密码"
                                    dependencies={["newPassword"]}
                                    rules={[
                                        { required: true, message: "请再次输入新密码" },
                                        {
                                            validator: async (_, value) => {
                                                if (value && value !== passwordForm.getFieldValue("newPassword")) throw new Error("两次输入的密码不一致");
                                            },
                                        },
                                    ]}
                                >
                                    <Input.Password autoComplete="new-password" />
                                </Form.Item>
                                {errors.password ? (
                                    <Callout tone="error" role="alert" className="profile-feedback">
                                        {errors.password}
                                    </Callout>
                                ) : null}
                                <Button type="primary" htmlType="submit" loading={pending === "password"} disabled={!!pending || !identityReady}>
                                    {profile.hasPassword ? "更新密码" : "设置密码"}
                                </Button>
                            </Form>
                        </section>

                        <section className="profile-security-card" aria-labelledby="profile-email-title">
                            <div className="profile-card-heading">
                                <span className="profile-card-icon">
                                    <Mail className="size-5" />
                                </span>
                                <div>
                                    <h4 id="profile-email-title">更换邮箱</h4>
                                    <p>验证新邮箱后生效，并退出所有登录会话。</p>
                                </div>
                            </div>
                            <div className="profile-current-email">
                                <span>当前邮箱</span>
                                <strong>{profile.user.email || "尚未绑定"}</strong>
                                {profile.user.email ? (
                                    <span className={`profile-email-status${profile.user.emailVerifiedAt ? " is-verified" : ""}`}>
                                        {profile.user.emailVerifiedAt ? <BadgeCheck className="size-3.5" /> : null}
                                        {profile.user.emailVerifiedAt ? "已验证" : "未验证"}
                                    </span>
                                ) : null}
                            </div>
                            {!profile.emailEnabled ? (
                                <Callout tone="warning" title="邮件服务未启用">
                                    管理员尚未配置可用的邮件服务，暂时无法更换邮箱。
                                </Callout>
                            ) : (
                                <Form
                                    form={emailForm}
                                    name="profile-email"
                                    layout="vertical"
                                    requiredMark={false}
                                    className="profile-form"
                                    disabled={!!pending || !identityReady}
                                    onValuesChange={resetEmailTicket}
                                    onFinish={(values) => void saveEmail(values)}
                                >
                                    {profile.hasPassword ? (
                                        <Form.Item name="currentPassword" label="当前密码" rules={[{ required: true, message: "请输入当前密码以验证身份" }]}>
                                            <Input.Password autoComplete="current-password" />
                                        </Form.Item>
                                    ) : null}
                                    <Form.Item
                                        name="email"
                                        label="新邮箱"
                                        rules={[
                                            { required: true, whitespace: true, message: "请输入新邮箱" },
                                            { type: "email", transform: (value: string) => value?.trim(), message: "请输入有效的邮箱地址" },
                                            {
                                                validator: async (_, value: string = "") => {
                                                    if (value.trim().toLowerCase() === profile.user.email?.toLowerCase()) throw new Error("新邮箱不能与当前邮箱相同");
                                                },
                                            },
                                        ]}
                                    >
                                        <Input type="email" autoComplete="email" />
                                    </Form.Item>
                                    <div className="profile-code-row">
                                        <Form.Item
                                            name="emailCode"
                                            label="邮箱验证码"
                                            rules={[
                                                { required: true, message: "请输入邮箱验证码" },
                                                { pattern: /^\d{6}$/, message: "请输入 6 位数字验证码" },
                                            ]}
                                        >
                                            <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
                                        </Form.Item>
                                        <Button loading={pending === "email-code"} disabled={!!pending || !identityReady || retrySeconds > 0} onClick={() => void sendEmailCode()}>
                                            {retrySeconds ? `${retrySeconds} 秒后重发` : emailTicket ? "重新发送" : "发送验证码"}
                                        </Button>
                                    </div>
                                    {emailTicket ? (
                                        <p className="profile-hint" role="status">
                                            {ticketSeconds ? `验证码已发送，${Math.ceil(ticketSeconds / 60)} 分钟内有效。` : "验证码已过期，请重新发送。"}
                                        </p>
                                    ) : null}
                                    {errors.email ? (
                                        <Callout tone="error" role="alert" className="profile-feedback">
                                            {errors.email}
                                        </Callout>
                                    ) : null}
                                    <Button type="primary" htmlType="submit" loading={pending === "email"} disabled={!!pending || !identityReady || !ticketSeconds}>
                                        更换邮箱
                                    </Button>
                                </Form>
                            )}
                        </section>
                    </div>
                </div>
            ) : null}
            {profile ? (
                <AppModal
                    open={avatarDialogOpen}
                    centered
                    width={560}
                    title="更换头像"
                    okText="保存头像"
                    confirmLoading={pending === "avatar" || pending === "reset-avatar"}
                    okButtonProps={{ disabled: !!pending || (avatarTab === "upload" ? !draftAvatar : profile.user.avatarMode === "default" && (profile.user.avatarPreset || "person") === defaultAvatarDraft) }}
                    cancelButtonProps={{ disabled: !!pending }}
                    closable={!pending}
                    keyboard={!pending}
                    mask={{ closable: !pending }}
                    onCancel={closeAvatarDialog}
                    onOk={() => void (avatarTab === "upload" ? saveAvatar() : saveDefaultAvatar())}
                >
                    <div className="profile-avatar-dialog-body">
                        <SegmentedControl<AvatarTab>
                            block
                            ariaLabel="头像来源"
                            value={avatarTab}
                            disabled={!!pending}
                            options={[
                                { value: "upload", label: "上传图片" },
                                { value: "preset", label: "系统头像" },
                            ]}
                            onChange={(tab) => {
                                setAvatarTab(tab);
                                setError("avatar", "");
                            }}
                        />
                        {avatarTab === "upload" ? (
                            <div className="profile-avatar-upload">
                                {draftAvatar ? (
                                    <img
                                        className="profile-avatar-dialog-preview"
                                        src={draftAvatar.url}
                                        alt="待保存的头像预览"
                                        onError={() => {
                                            setDraftAvatar(null);
                                            setError("avatar", "无法读取图片，请选择有效的 PNG 或 JPEG 图片");
                                        }}
                                    />
                                ) : (
                                    <UserAvatar user={profile.user} className="profile-avatar-dialog-preview" />
                                )}
                                <div className="profile-avatar-upload-controls">
                                    <p className="profile-avatar-upload-title">{draftAvatar ? "裁剪后的头像" : "当前头像"}</p>
                                    <p className="profile-hint">选择 PNG 或 JPEG 图片，可裁剪为正方形；文件最大 5 MiB。</p>
                                    <input ref={fileInput} type="file" accept="image/png,image/jpeg" hidden aria-label="选择头像图片" onChange={selectAvatar} disabled={!!pending} />
                                    <div className="profile-actions">
                                        <Button icon={<ImagePlus className="size-4" />} disabled={!!pending} onClick={() => fileInput.current?.click()}>
                                            {draftAvatar ? "重新选择" : "选择图片"}
                                        </Button>
                                        {draftAvatar ? (
                                            <Button icon={<Crop className="size-4" />} disabled={!!pending} onClick={() => setCropSource({ file: draftAvatar.sourceFile, url: URL.createObjectURL(draftAvatar.sourceFile) })}>
                                                调整裁剪
                                            </Button>
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <>
                                <p className="profile-hint">选择一款系统头像，保存后会同步到工作区。</p>
                                <div className="profile-default-avatar-grid" role="group" aria-label="系统头像">
                                    {DEFAULT_USER_AVATARS.map((preset) => (
                                        <button key={preset.id} type="button" className="profile-default-avatar-choice" aria-pressed={defaultAvatarDraft === preset.id} disabled={!!pending} onClick={() => setDefaultAvatarDraft(preset.id)}>
                                            <Avatar size={56} className="profile-default-avatar-icon" icon={<UserAvatar user={{ ...profile.user, avatarUrl: undefined, avatarMode: "default", avatarPreset: preset.id }} className="size-8" />} />
                                            <span>{preset.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                        {errors.avatar ? (
                            <Callout tone="error" role="alert" className="profile-feedback">
                                {errors.avatar}
                            </Callout>
                        ) : null}
                    </div>
                </AppModal>
            ) : null}
            {cropSource ? (
                <ImageCropDialog
                    dataUrl={cropSource.url}
                    open
                    title="裁剪头像"
                    fixedAspect={1}
                    confirmLoading={pending === "crop-avatar"}
                    onClose={() => {
                        if (!pendingRef.current) setCropSource(null);
                    }}
                    onConfirm={(crop) => void confirmAvatarCrop(crop)}
                />
            ) : null}
        </div>
    );
}
