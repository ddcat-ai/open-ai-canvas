import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Avatar, Button, Form, Input, Skeleton } from "antd";
import { BadgeCheck, BarChart3, Crop, ImagePlus, KeyRound, Mail, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";

import { UserAvatar } from "@/components/layout/user-avatar";
import { useAuthEntry } from "@/hooks/use-auth-entry";
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
import { profileWechatURL } from "@/services/api/wechat";
import { getNotificationSettings, updateNotificationSettings } from "@/services/api/email";
import { Switch } from "@/components/ui/base/switch";
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
    const { t } = useTranslation();
    const { message } = App.useApp();
    const { showLoginAfterSignOut } = useAuthEntry();
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
    const bindResult = searchParams.get("bind");
    const [reauthResult] = useState(oauthResult);
    const reauthReady = profileReauthReady(profile?.reauthenticatedUntil, now);
    const identityReady = !!profile?.hasPassword || reauthReady;
    const retrySeconds = profileSecondsRemaining(retryAt, now);
    const ticketSeconds = emailTicket ? profileSecondsRemaining(emailTicket.expiresAt, now) : 0;

    useEffect(() => {
        if (!oauthResult && !bindResult) return;
        if (bindResult) message[bindResult === "success" ? "success" : "error"](bindResult === "success" ? t("auth.wechat.bound") : t("auth.wechat.bindFailed"));
        const next = new URLSearchParams(searchParams);
        next.delete("reauth");
        next.delete("bind");
        setSearchParams(next, { replace: true });
    }, [oauthResult, bindResult, message, t, searchParams, setSearchParams]);

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
            const msg = errorMessage(error, t("account.settings.profile.cropFailed"));
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
            message.success(t("account.settings.profile.avatarSaved"));
        } catch (error) {
            setError("avatar", errorMessage(error, t("account.settings.profile.avatarFailed")));
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
            message.success(t("account.settings.profile.presetSaved"));
        } catch (error) {
            setError("avatar", errorMessage(error, t("account.settings.profile.avatarFailed")));
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
            message.error({ content: t("account.settings.profile.clearSessionFailed", { notice, error: errorMessage(error, t("account.settings.profile.loginAgain")) }), duration: 8 });
        } finally {
            showLoginAfterSignOut();
        }
    };

    const savePassword = async (values: PasswordFields) => {
        if (!(profile?.hasPassword || profileReauthReady(profile?.reauthenticatedUntil, Date.now())) || !begin("password")) return;
        setError("password", "");
        try {
            await changeProfilePassword({ currentPassword: profile?.hasPassword ? values.currentPassword : "", newPassword: values.newPassword });
            await finishSecurityChange(t("account.settings.profile.passwordUpdated"));
        } catch (error) {
            setError("password", errorMessage(error, t("account.settings.profile.passwordFailed")));
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
            message.success(t("account.settings.profile.codeSent"));
        } catch (error) {
            if (error instanceof ApiError && error.retryAfterMs) setRetryAt(Date.now() + error.retryAfterMs);
            setError("email", errorMessage(error, t("account.settings.profile.codeFailed")));
        } finally {
            end();
        }
    };

    const saveEmail = async (values: EmailFields) => {
        if (!profile?.emailEnabled || !(profile.hasPassword || profileReauthReady(profile.reauthenticatedUntil, Date.now())) || !emailTicket || !profileSecondsRemaining(emailTicket.expiresAt, Date.now()) || !begin("email")) return;
        setError("email", "");
        try {
            const result = await changeProfileEmail({ ticket: emailTicket.value, emailCode: values.emailCode, currentPassword: profile.hasPassword ? values.currentPassword : "" });
            await finishSecurityChange(result.notificationStatus === "failed" ? t("account.settings.profile.emailUpdatedNotifyFailed") : t("account.settings.profile.emailUpdated"), result.notificationStatus === "failed");
        } catch (error) {
            setError("email", errorMessage(error, t("account.settings.profile.emailFailed")));
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
                    <h2>{t("settings.sections.profile.label")}</h2>
                    <p>{t("account.settings.profile.description")}</p>
                </div>
                <Button icon={<RefreshCw className="size-4" />} loading={profileQuery.isFetching} disabled={!!pending} onClick={() => void profileQuery.refetch()}>
                    {t("account.settings.profile.refresh")}
                </Button>
            </div>
            {profileQuery.isPending ? (
                <Skeleton active paragraph={{ rows: 7 }} />
            ) : profileQuery.isError ? (
                <Callout
                    tone="error"
                    title={t("account.settings.profile.loadFailed")}
                    role="alert"
                    action={
                        <Button size="small" onClick={() => void profileQuery.refetch()}>
                            {t("common.retry")}
                        </Button>
                    }
                >
                    {errorMessage(profileQuery.error, t("account.settings.profile.tryLater"))}
                </Callout>
            ) : profile ? (
                <div className="profile-sections">
                    <section className="profile-overview" aria-labelledby="profile-avatar-title">
                        <div className="profile-overview-heading">
                            <h3 id="profile-avatar-title">{t("account.settings.profile.avatarTitle")}</h3>
                            <p>{t("account.settings.profile.avatarDescription")}</p>
                        </div>
                        <div className="profile-overview-main">
                            <UserAvatar user={profile.user} className="profile-avatar-preview" />
                            <div className="profile-overview-identity">
                                <strong>{profile.user.displayName || profile.user.username}</strong>
                                <span>{t("account.settings.profile.account", { username: profile.user.username })}</span>
                            </div>
                            <Button type="primary" icon={<ImagePlus className="size-4" />} disabled={!!pending} onClick={openAvatarDialog}>
                                {t("account.settings.profile.changeAvatar")}
                            </Button>
                        </div>
                    </section>

                    {profile.wechatEnabled || profile.wechatBound ? (
                        <Callout
                            title={t("auth.wechat.title")}
                            icon={ShieldCheck}
                            action={
                                !profile.wechatBound ? (
                                    <Button disabled={!!pending || !profile.wechatEnabled} onClick={() => window.location.assign(profileWechatURL("bind"))}>
                                        {t("auth.wechat.bind")}
                                    </Button>
                                ) : undefined
                            }
                        >
                            {profile.wechatBound ? t("auth.wechat.boundHint") : t("auth.wechat.bindHint")}
                        </Callout>
                    ) : null}

                    {!profile.hasPassword ? (
                        <Callout
                            tone={reauthReady ? "success" : "info"}
                            title={t("account.settings.profile.verifyTitle")}
                            icon={ShieldCheck}
                            action={
                                profile.wechatEnabled && profile.wechatBound ? (
                                    <Button disabled={!!pending} onClick={() => window.location.assign(profileWechatURL("reauth"))}>
                                        {t("auth.wechat.verify")}
                                    </Button>
                                ) : profile.linuxdoEnabled && profile.linuxdoBound ? (
                                    <Button disabled={!!pending} onClick={() => window.location.assign(profileLinuxDOReauthURL())}>
                                        {reauthReady ? t("account.settings.profile.reverify") : t("account.settings.profile.verifyLinuxdo")}
                                    </Button>
                                ) : undefined
                            }
                        >
                            {reauthReady
                                ? t("account.settings.profile.verified", { seconds: profileSecondsRemaining(Date.parse(profile.reauthenticatedUntil!), now) })
                                : (profile.wechatEnabled && profile.wechatBound) || (profile.linuxdoEnabled && profile.linuxdoBound)
                                  ? t("auth.wechat.verifyHint")
                                  : t("account.settings.profile.verifyUnavailable")}
                            {reauthResult === "error" && !reauthReady ? (
                                <p className="profile-reauth-error" role="alert">
                                    {t("account.settings.profile.verifyFailed")}
                                </p>
                            ) : null}
                        </Callout>
                    ) : null}

                    <div className="profile-security-heading">
                        <h3>{t("account.settings.profile.securityTitle")}</h3>
                        <p>{t("account.settings.profile.securityDescription")}</p>
                    </div>
                    <div className="profile-security-grid">
                        <section className="profile-security-card" aria-labelledby="profile-password-title">
                            <div className="profile-card-heading">
                                <span className="profile-card-icon">
                                    <KeyRound className="size-5" />
                                </span>
                                <div>
                                    <h4 id="profile-password-title">{profile.hasPassword ? t("account.settings.profile.changePassword") : t("account.settings.profile.setPassword")}</h4>
                                    <p>{t("account.settings.profile.passwordHint")}</p>
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
                                    <Form.Item name="currentPassword" label={t("account.settings.profile.currentPassword")} rules={[{ required: true, message: t("account.settings.profile.currentPasswordRequired") }]}>
                                        <Input.Password autoComplete="current-password" />
                                    </Form.Item>
                                ) : null}
                                <Form.Item
                                    name="newPassword"
                                    label={t("account.settings.profile.newPassword")}
                                    rules={[
                                        {
                                            validator: async (_, value: string = "") => {
                                                const error = profilePasswordError(value);
                                                if (error) throw new Error(error);
                                            },
                                        },
                                    ]}
                                >
                                    <Input.Password autoComplete="new-password" placeholder={t("account.settings.profile.passwordPlaceholder")} />
                                </Form.Item>
                                <Form.Item
                                    name="confirmPassword"
                                    label={t("account.settings.profile.confirmPassword")}
                                    dependencies={["newPassword"]}
                                    rules={[
                                        { required: true, message: t("account.settings.profile.confirmRequired") },
                                        {
                                            validator: async (_, value) => {
                                                if (value && value !== passwordForm.getFieldValue("newPassword")) throw new Error(t("auth.register.mismatch"));
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
                                    {profile.hasPassword ? t("account.settings.profile.updatePassword") : t("account.settings.profile.setPasswordSubmit")}
                                </Button>
                            </Form>
                        </section>

                        <section className="profile-security-card" aria-labelledby="profile-email-title">
                            <div className="profile-card-heading">
                                <span className="profile-card-icon">
                                    <Mail className="size-5" />
                                </span>
                                <div>
                                    <h4 id="profile-email-title">{t("account.settings.profile.changeEmail")}</h4>
                                    <p>{t("account.settings.profile.emailHint")}</p>
                                </div>
                            </div>
                            <div className="profile-current-email">
                                <span>{t("account.settings.profile.currentEmail")}</span>
                                <strong>{profile.user.email || t("account.settings.profile.emailUnbound")}</strong>
                                {profile.user.email ? (
                                    <span className={`profile-email-status${profile.user.emailVerifiedAt ? " is-verified" : ""}`}>
                                        {profile.user.emailVerifiedAt ? <BadgeCheck className="size-3.5" /> : null}
                                        {profile.user.emailVerifiedAt ? t("account.settings.profile.verifiedStatus") : t("account.settings.profile.unverifiedStatus")}
                                    </span>
                                ) : null}
                            </div>
                            {!profile.emailEnabled ? (
                                <Callout tone="warning" title={t("account.settings.profile.emailDisabledTitle")}>
                                    {t("account.settings.profile.emailDisabled")}
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
                                        <Form.Item name="currentPassword" label={t("account.settings.profile.currentPassword")} rules={[{ required: true, message: t("account.settings.profile.currentPasswordVerify") }]}>
                                            <Input.Password autoComplete="current-password" />
                                        </Form.Item>
                                    ) : null}
                                    <Form.Item
                                        name="email"
                                        label={t("account.settings.profile.newEmail")}
                                        rules={[
                                            { required: true, whitespace: true, message: t("account.settings.profile.newEmailRequired") },
                                            { type: "email", transform: (value: string) => value?.trim(), message: t("account.settings.profile.emailInvalid") },
                                            {
                                                validator: async (_, value: string = "") => {
                                                    if (profile.user.emailVerifiedAt && value.trim().toLowerCase() === profile.user.email?.toLowerCase()) throw new Error(t("account.settings.profile.emailSame"));
                                                },
                                            },
                                        ]}
                                    >
                                        <Input type="email" autoComplete="email" />
                                    </Form.Item>
                                    <div className="profile-code-row">
                                        <Form.Item
                                            name="emailCode"
                                            label={t("auth.recovery.code")}
                                            rules={[
                                                { required: true, message: t("account.settings.profile.codeRequired") },
                                                { pattern: /^\d{6}$/, message: t("account.settings.profile.codeInvalid") },
                                            ]}
                                        >
                                            <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
                                        </Form.Item>
                                        <Button loading={pending === "email-code"} disabled={!!pending || !identityReady || retrySeconds > 0} onClick={() => void sendEmailCode()}>
                                            {retrySeconds ? t("auth.verification.resendIn", { seconds: retrySeconds }) : emailTicket ? t("auth.recovery.resend") : t("auth.recovery.send")}
                                        </Button>
                                    </div>
                                    {emailTicket ? (
                                        <p className="profile-hint" role="status">
                                            {ticketSeconds ? t("account.settings.profile.codeValid", { minutes: Math.ceil(ticketSeconds / 60) }) : t("account.settings.profile.codeExpired")}
                                        </p>
                                    ) : null}
                                    {errors.email ? (
                                        <Callout tone="error" role="alert" className="profile-feedback">
                                            {errors.email}
                                        </Callout>
                                    ) : null}
                                    <Button type="primary" htmlType="submit" loading={pending === "email"} disabled={!!pending || !identityReady || !ticketSeconds}>
                                        {t("account.settings.profile.changeEmail")}
                                    </Button>
                                </Form>
                            )}
                        </section>

                        <ConsumptionReportCard />
                    </div>
                </div>
            ) : null}
            {profile ? (
                <AppModal
                    open={avatarDialogOpen}
                    centered
                    width={560}
                    title={t("account.settings.profile.changeAvatar")}
                    okText={t("account.settings.profile.saveAvatar")}
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
                            ariaLabel={t("account.settings.profile.avatarSource")}
                            value={avatarTab}
                            disabled={!!pending}
                            options={[
                                { value: "upload", label: t("account.settings.profile.upload") },
                                { value: "preset", label: t("account.settings.profile.preset") },
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
                                        alt={t("account.settings.profile.previewAlt")}
                                        onError={() => {
                                            setDraftAvatar(null);
                                            setError("avatar", t("account.settings.profile.imageUnreadable"));
                                        }}
                                    />
                                ) : (
                                    <UserAvatar user={profile.user} className="profile-avatar-dialog-preview" />
                                )}
                                <div className="profile-avatar-upload-controls">
                                    <p className="profile-avatar-upload-title">{draftAvatar ? t("account.settings.profile.croppedAvatar") : t("account.settings.profile.currentAvatar")}</p>
                                    <p className="profile-hint">{t("account.settings.profile.uploadHint")}</p>
                                    <input ref={fileInput} type="file" accept="image/png,image/jpeg" hidden aria-label={t("account.settings.profile.selectAvatarImage")} onChange={selectAvatar} disabled={!!pending} />
                                    <div className="profile-actions">
                                        <Button icon={<ImagePlus className="size-4" />} disabled={!!pending} onClick={() => fileInput.current?.click()}>
                                            {draftAvatar ? t("account.settings.profile.reselect") : t("account.settings.profile.selectImage")}
                                        </Button>
                                        {draftAvatar ? (
                                            <Button icon={<Crop className="size-4" />} disabled={!!pending} onClick={() => setCropSource({ file: draftAvatar.sourceFile, url: URL.createObjectURL(draftAvatar.sourceFile) })}>
                                                {t("account.settings.profile.adjustCrop")}
                                            </Button>
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <>
                                <p className="profile-hint">{t("account.settings.profile.presetHint")}</p>
                                <div className="profile-default-avatar-grid" role="group" aria-label={t("account.settings.profile.preset")}>
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
                    title={t("account.settings.profile.cropTitle")}
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

function ConsumptionReportCard() {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const userId = useUserStore((state) => state.user?.id);
    const queryKey = ["notification-settings", userId];
    const query = useQuery({ queryKey, queryFn: ({ signal }) => getNotificationSettings(signal).then((data) => data.settings), enabled: Boolean(userId) });
    const [saving, setSaving] = useState(false);
    const settings = query.data;
    const enabled = Boolean(settings?.consumptionReportEnabled);

    const toggle = async (next: boolean) => {
        setSaving(true);
        try {
            const result = await updateNotificationSettings({ consumptionReportEnabled: next });
            queryClient.setQueryData(queryKey, result.settings);
            message.success(next ? t("account.settings.profile.reportEnabled") : t("account.settings.profile.reportDisabled"));
        } catch (error) {
            message.error(errorMessage(error, t("account.settings.profile.reportFailed")));
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="profile-security-card" aria-labelledby="profile-report-title">
            <div className="profile-card-heading">
                <span className="profile-card-icon">
                    <BarChart3 className="size-5" />
                </span>
                <div>
                    <h4 id="profile-report-title">{t("account.settings.profile.reportTitle")}</h4>
                    <p>{t("account.settings.profile.reportHint")}</p>
                </div>
            </div>
            {query.isLoading ? (
                <Skeleton active paragraph={{ rows: 1 }} title={false} />
            ) : (
                <div className="profile-report-row">
                    <span>{enabled && settings?.email ? t("account.settings.profile.reportOn", { email: settings.email }) : t("account.settings.profile.reportOff")}</span>
                    <Switch checked={enabled} loading={saving} disabled={saving || (!enabled && !settings?.emailAvailable)} aria-label={t("account.settings.profile.reportToggle")} onChange={(next) => void toggle(next)} />
                </div>
            )}
            {!query.isLoading && !enabled && settings && !settings.emailAvailable ? (
                <Callout tone="warning" className="profile-feedback">
                    {t("account.settings.profile.reportUnavailable")}
                </Callout>
            ) : null}
            {query.isError ? (
                <Callout tone="error" role="alert" className="profile-feedback">
                    {errorMessage(query.error, t("account.settings.profile.reportFailed"))}
                </Callout>
            ) : null}
        </section>
    );
}
