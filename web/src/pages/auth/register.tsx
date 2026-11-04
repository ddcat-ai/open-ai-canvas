import { type FormEvent, useEffect, useRef, useState, type ReactNode } from "react";
import { App, Button, Checkbox, Divider, Input, Modal, Segmented } from "antd";
import { ArrowRight, FileText, Info, LockKeyhole, Mail, TriangleAlert, UserRound } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";

import { getAuthSession, getAuthSettings, linuxDOLoginURL, register } from "@/services/api/auth";
import { LinuxDOIcon } from "./auth-scene";
import { ApiError } from "@/services/api/request";
import { VerificationFields } from "@/components/auth/verification-fields";
import { emptyVerification, verificationMethods, type VerificationMethod } from "@/services/api/verification";
import { useAppearanceStore } from "@/stores/use-appearance-store";

type AuthSettings = Awaited<ReturnType<typeof getAuthSettings>>;

const REFERRAL_CODE_STORAGE_KEY = "yingce:referral-code";

export default function RegisterPage() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const { message } = App.useApp();
    const { t } = useTranslation();
    const brandName = useAppearanceStore((state) => state.appearance.brandName) || t("auth.register.platform");
    const [settings, setSettings] = useState<AuthSettings | null>(null);
    const [username, setUsername] = useState("");
    const [email, setEmail] = useState("");
    const [verification, setVerification] = useState({ ...emptyVerification });
    const [method, setMethod] = useState<VerificationMethod>("email");
    const [displayName, setDisplayName] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [agreementAccepted, setAgreementAccepted] = useState(false);
    const [agreementOpen, setAgreementOpen] = useState(false);
    const [settingsFailed, setSettingsFailed] = useState(false);
    const [settingsReloadKey, setSettingsReloadKey] = useState(0);
    const [submitting, setSubmitting] = useState(false);
    const [registerCountdown, setRegisterCountdown] = useState(0);
    const registering = useRef(false);
    const next = safeNext(params.get("next"));
    // 推广码只存会话级缓存：用户从推广链接跳到登录页再回来注册时仍能归属，关闭浏览器后失效。
    const [referralCode] = useState(() => {
        const fromUrl = (params.get("ref") || "").trim();
        if (fromUrl) window.sessionStorage.setItem(REFERRAL_CODE_STORAGE_KEY, fromUrl);
        return fromUrl || window.sessionStorage.getItem(REFERRAL_CODE_STORAGE_KEY) || "";
    });

    // 协议标题与条款由后台「登录与注册」配置下发。标题未配置时才回退到当前品牌名，
    // 且只在确认拿到设置（settings 非空）后回退；接口失败时不猜标题，避免展示
    // 与后台真实配置不符的协议名。
    // 标题统一去掉书号后由页面补《》，避免后台已填《》时出现双书名号。
    const agreementTitle = ((settings?.agreementTitle || "").trim() || t("auth.register.defaultAgreement", { brand: brandName })).replace(/^《|》$/g, "");
    const agreementContent = (settings?.agreementContent || "").trim();
    const agreementParagraphs = agreementContent ? agreementContent.split(/\n\s*\n/) : [];

    useEffect(() => {
        let cancelled = false;
        setSettingsFailed(false);
        void getAuthSettings()
            .then((value) => { if (!cancelled) { setSettings(value); setMethod(verificationMethods(value, "register")[0] ?? "email"); } })
            .catch((error) => {
                if (cancelled) return;
                // 这里必须留下失败态：协议标题只能来自后台配置，读不到时不能用品牌名
                // 顶替，否则用户看到的是一个后台并不存在的协议名称。
                setSettingsFailed(true);
                message.error(error instanceof Error ? error.message : t("auth.register.settingsLoadFailed"));
            });
        return () => {
            cancelled = true;
        };
    }, [message, settingsReloadKey]);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (registering.current || registerCountdown > 0) return;
        if (!agreementAccepted) {
            message.warning(t("auth.register.agreeFirst", { title: agreementTitle }));
            return;
        }
        if (password !== confirmPassword) {
            message.error(t("auth.register.mismatch"));
            return;
        }
        registering.current = true;
        setSubmitting(true);
        try {
            if (!settings?.firstUser && !verification.ticket) throw new Error(t("auth.register.needCode"));
            await register({ username, ...(settings?.firstUser ? { email } : verification), displayName, password, acceptedTerms: agreementAccepted, ...(referralCode ? { referralCode } : {}) });
            window.sessionStorage.removeItem(REFERRAL_CODE_STORAGE_KEY);
            const { applyUserSession } = await import("@/lib/user-session");
            await applyUserSession(await getAuthSession());
            if (!settings?.firstUser) window.sessionStorage.setItem("yingce:model-setup-guide", "1");
            message.success(settings?.firstUser ? t("auth.register.adminCreated") : t("auth.register.success"));
            navigate(next, { replace: true });
        } catch (error) {
            if (error instanceof ApiError && error.status === 429) setRegisterCountdown(Math.max(1, Math.ceil((error.retryAfterMs ?? 60000) / 1000)));
            message.error(error instanceof Error ? error.message : t("auth.register.failed"));
        } finally {
            registering.current = false;
            setSubmitting(false);
        }
    };

    useEffect(() => {
        if (registerCountdown <= 0) return;
        const timer = window.setInterval(() => setRegisterCountdown((value) => Math.max(0, value - 1)), 1000);
        return () => window.clearInterval(timer);
    }, [registerCountdown]);

    const registrationClosed = settings?.registrationEnabled === false;
    const methods = settings ? verificationMethods(settings, "register") : [];
    const verificationUnavailable = Boolean(settings && !settings.firstUser && methods.length === 0);
    const disabled = !settings || registrationClosed || verificationUnavailable;

    return (
        <form onSubmit={submit} className="space-y-4">
            {settings?.firstUser ? (
                <Notice icon={<Info className="size-3.5" />} tone="blue">
                    {t("auth.register.firstUser")}
                </Notice>
            ) : null}
            {registrationClosed ? (
                <Notice icon={<TriangleAlert className="size-3.5" />} tone="amber">
                    {t("auth.register.closed")}
                </Notice>
            ) : null}
            {verificationUnavailable ? (
                <Notice icon={<TriangleAlert className="size-3.5" />} tone="amber">
                    {t("auth.register.noMethod")}
                </Notice>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
                <AuthField label={t("auth.register.username")}>
                    <Input size="large" prefix={<UserRound className="auth-scene-icon size-4" />} value={username} onChange={(event) => setUsername(event.target.value)} placeholder={t("auth.register.usernamePlaceholder")} autoComplete="username" required disabled={disabled} />
                </AuthField>
                <AuthField label={t("auth.register.displayName")}>
                    <Input size="large" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder={t("auth.register.displayNamePlaceholder")} disabled={disabled} />
                </AuthField>
            </div>

            {settings?.firstUser ? <AuthField label={t("auth.register.emailOptional")}>
                <Input
                    size="large"
                    prefix={<Mail className="auth-scene-icon size-4" />}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder={t("auth.register.emailPlaceholder")}
                    autoComplete="email"
                    required={!settings?.firstUser}
                    disabled={disabled}
                />
            </AuthField> : <>
                {methods.length > 1 && <Segmented block aria-label={t("auth.register.method")} options={methods.map((value) => ({ value, label: t(`auth.methods.${value}`) }))} value={method} disabled={submitting} onChange={(value) => { setMethod(value as VerificationMethod); setVerification({ ...emptyVerification }); }} />}
                {methods.length > 0 && <VerificationFields key={method} purpose="register" method={method} value={verification} onChange={setVerification} disabled={disabled || submitting} />}
            </>}

            <div className="grid gap-4 sm:grid-cols-2">
                <AuthField label={t("auth.register.password")}>
                    <Input.Password
                        size="large"
                        prefix={<LockKeyhole className="auth-scene-icon size-4" />}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder={t("auth.register.passwordPlaceholder")}
                        autoComplete="new-password"
                        required
                        disabled={disabled}
                    />
                </AuthField>
                <AuthField label={t("auth.register.confirmPassword")}>
                    <Input.Password
                        size="large"
                        prefix={<LockKeyhole className="auth-scene-icon size-4" />}
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        placeholder={t("auth.register.confirmPlaceholder")}
                        autoComplete="new-password"
                        required
                        disabled={disabled}
                    />
                </AuthField>
            </div>

            {settingsFailed ? (
                <Notice icon={<TriangleAlert className="size-3.5" />} tone="amber">
                    <span>
                        {t("auth.register.settingsFailed")}
                        <button type="button" className="auth-scene-link ml-1 transition" onClick={() => setSettingsReloadKey((value) => value + 1)}>
                            {t("auth.register.reload")}
                        </button>
                    </span>
                </Notice>
            ) : null}

            {settings ? (
                <div className="auth-agreement-row" data-accepted={agreementAccepted ? "true" : "false"}>
                    <Checkbox checked={agreementAccepted} onChange={(event) => setAgreementAccepted(event.target.checked)}>
                        <span className="auth-agreement-label">{t("auth.register.agree")}</span>
                    </Checkbox>
                    <button type="button" className="auth-agreement-link" onClick={() => setAgreementOpen(true)}>
                        《{agreementTitle}》
                    </button>
                </div>
            ) : null}

            <Button type="primary" htmlType="submit" size="large" block loading={submitting} disabled={disabled || registerCountdown > 0 || !agreementAccepted} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                {registerCountdown > 0 ? t("auth.register.retryIn", { seconds: registerCountdown }) : t("auth.register.submit")}
            </Button>
            {settings?.linuxdoEnabled && !settings.smsAndEmailRegistration ? (
                <>
                    <Divider plain className="auth-scene-divider">
                        {t("common.or")}
                    </Divider>
                    <Button size="large" block disabled={!agreementAccepted} icon={<LinuxDOIcon />} href={agreementAccepted ? linuxDOLoginURL(next, true) : undefined}>
                        {t("auth.register.linuxdo")}
                    </Button>
                </>
            ) : null}
            <Modal
                className="workspace-modal workspace-modal-compact auth-agreement-modal"
                title={agreementTitle}
                open={agreementOpen}
                onCancel={() => setAgreementOpen(false)}
                footer={null}
                destroyOnHidden
            >
                {agreementParagraphs.length === 0 ? (
                    <div className="auth-agreement-empty">
                        <FileText className="size-3.5 shrink-0" aria-hidden />
                        {t("auth.register.agreementEmpty")}
                    </div>
                ) : (
                    <div className="auth-agreement-body">
                        {agreementParagraphs.map((paragraph, index) => {
                            // 后台用纯文本框维护条款，「一、二、三…」条目通常和正文写在同一个
                            // 段落里（只用一个换行分隔）。这里把条目标题切出来单独成行并加重，
                            // 否则标题和正文会挤在同一行，长条款失去可扫描的层级。
                            const blocks = splitAgreementParagraph(paragraph);
                            return blocks.map((block, blockIndex) => (
                                <p key={`agreement-${index}-${blockIndex}`} data-role={block.heading ? "heading" : undefined}>
                                    {block.text}
                                </p>
                            ));
                        })}
                    </div>
                )}
                <p className="auth-agreement-meta">
                    <LockKeyhole className="size-3 shrink-0" aria-hidden />
                    {t("auth.register.agreementMeta")}
                </p>
            </Modal>
        </form>
    );
}

function AuthField({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="block space-y-2">
            <span className="auth-scene-label text-xs font-medium">{label}</span>
            {children}
        </label>
    );
}

function Notice({ icon, tone, children }: { icon: ReactNode; tone: "blue" | "amber"; children: ReactNode }) {
    return (
        <div data-tone={tone} className="auth-scene-notice flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5">
            <span className="mt-0.5 shrink-0">{icon}</span>
            {children}
        </div>
    );
}

function safeNext(value: string | null) {
    if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
    return value;
}

// 中文条款里「一、」「二、」这类条目标题常与正文写在同一个段落内（只隔一个换行）。
// 这里按「条目标题 + 紧随其后的正文」拆成独立段落，让标题能单独成行并加重；
// 没有条目标题的普通段落原样返回，不改变后台已经整理好的排版。
const AGREEMENT_HEADING = /^\s*([一二三四五六七八九十百]+、[^\n]{0,40})\n+([\s\S]+)$/;

function splitAgreementParagraph(paragraph: string): { text: string; heading: boolean }[] {
    const match = paragraph.match(AGREEMENT_HEADING);
    if (!match) {
        const headingOnly = /^\s*[一二三四五六七八九十百]+、[^\n]{0,40}\s*$/.test(paragraph);
        return [{ text: paragraph.trim(), heading: headingOnly }];
    }
    return [
        { text: match[1].trim(), heading: true },
        { text: match[2].trim(), heading: false },
    ];
}
