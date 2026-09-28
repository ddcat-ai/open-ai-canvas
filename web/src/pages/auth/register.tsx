import { type FormEvent, useEffect, useRef, useState, type ReactNode } from "react";
import { App, Button, Checkbox, Divider, Input, Modal, Segmented } from "antd";
import { ArrowRight, FileText, Info, LockKeyhole, Mail, TriangleAlert, UserRound } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";

import { getAuthSession, getAuthSettings, linuxDOLoginURL, register } from "@/services/api/auth";
import { LinuxDOIcon } from "./auth-scene";
import { ApiError } from "@/services/api/request";
import { VerificationFields } from "@/components/auth/verification-fields";
import { emptyVerification, methodLabels, verificationMethods, type VerificationMethod } from "@/services/api/verification";
import { useAppearanceStore } from "@/stores/use-appearance-store";

type AuthSettings = Awaited<ReturnType<typeof getAuthSettings>>;

export default function RegisterPage() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const { message } = App.useApp();
    const brandName = useAppearanceStore((state) => state.appearance.brandName) || "平台";
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

    // 协议标题与条款由后台「登录与注册」配置下发。标题未配置时才回退到当前品牌名，
    // 且只在确认拿到设置（settings 非空）后回退；接口失败时不猜标题，避免展示
    // 与后台真实配置不符的协议名。
    // 标题统一去掉书号后由页面补《》，避免后台已填《》时出现双书名号。
    const agreementTitle = ((settings?.agreementTitle || "").trim() || `${brandName}服务协议`).replace(/^《|》$/g, "");
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
                message.error(error instanceof Error ? error.message : "读取注册设置失败");
            });
        return () => {
            cancelled = true;
        };
    }, [message, settingsReloadKey]);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (registering.current || registerCountdown > 0) return;
        if (!agreementAccepted) {
            message.warning(`请先同意${agreementTitle}`);
            return;
        }
        if (password !== confirmPassword) {
            message.error("两次输入的密码不一致");
            return;
        }
        registering.current = true;
        setSubmitting(true);
        try {
            if (!settings?.firstUser && !verification.ticket) throw new Error("请先获取本次注册验证码");
            await register({ username, ...(settings?.firstUser ? { email } : verification), displayName, password, acceptedTerms: agreementAccepted });
            const { applyUserSession } = await import("@/lib/user-session");
            await applyUserSession(await getAuthSession());
            if (!settings?.firstUser) window.sessionStorage.setItem("infinite-canvas:model-setup-guide", "1");
            message.success(settings?.firstUser ? "管理员账号已创建" : "注册成功");
            navigate(next, { replace: true });
        } catch (error) {
            if (error instanceof ApiError && error.status === 429) setRegisterCountdown(Math.max(1, Math.ceil((error.retryAfterMs ?? 60000) / 1000)));
            message.error(error instanceof Error ? error.message : "注册失败");
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
                    首个账号自动成为管理员，邮箱验证码暂不要求。
                </Notice>
            ) : null}
            {registrationClosed ? (
                <Notice icon={<TriangleAlert className="size-3.5" />} tone="amber">
                    当前已关闭普通注册，请联系管理员创建账号。
                </Notice>
            ) : null}
            {verificationUnavailable ? (
                <Notice icon={<TriangleAlert className="size-3.5" />} tone="amber">
                    当前没有可用的注册验证方式，请联系管理员检查短信及邮件配置。
                </Notice>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
                <AuthField label="用户名">
                    <Input size="large" prefix={<UserRound className="auth-scene-icon size-4" />} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="3-32 位字符" autoComplete="username" required disabled={disabled} />
                </AuthField>
                <AuthField label="显示名称">
                    <Input size="large" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="不填则使用用户名" disabled={disabled} />
                </AuthField>
            </div>

            {settings?.firstUser ? <AuthField label="邮箱（可选）">
                <Input
                    size="large"
                    prefix={<Mail className="auth-scene-icon size-4" />}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="用于登录与安全验证"
                    autoComplete="email"
                    required={!settings?.firstUser}
                    disabled={disabled}
                />
            </AuthField> : <>
                {methods.length > 1 && <Segmented block aria-label="注册验证方式" options={methods.map((value) => ({ value, label: methodLabels[value] }))} value={method} disabled={submitting} onChange={(value) => { setMethod(value as VerificationMethod); setVerification({ ...emptyVerification }); }} />}
                {methods.length > 0 && <VerificationFields key={method} purpose="register" method={method} value={verification} onChange={setVerification} disabled={disabled || submitting} />}
            </>}

            <div className="grid gap-4 sm:grid-cols-2">
                <AuthField label="密码">
                    <Input.Password
                        size="large"
                        prefix={<LockKeyhole className="auth-scene-icon size-4" />}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="至少 8 位"
                        autoComplete="new-password"
                        required
                        disabled={disabled}
                    />
                </AuthField>
                <AuthField label="确认密码">
                    <Input.Password
                        size="large"
                        prefix={<LockKeyhole className="auth-scene-icon size-4" />}
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        placeholder="再次输入密码"
                        autoComplete="new-password"
                        required
                        disabled={disabled}
                    />
                </AuthField>
            </div>

            {settingsFailed ? (
                <Notice icon={<TriangleAlert className="size-3.5" />} tone="amber">
                    <span>
                        读取注册设置失败，暂时无法确认服务协议名称与条款。
                        <button type="button" className="auth-scene-link ml-1 transition" onClick={() => setSettingsReloadKey((value) => value + 1)}>
                            重新读取
                        </button>
                    </span>
                </Notice>
            ) : null}

            {settings ? (
                <div className="auth-agreement-row" data-accepted={agreementAccepted ? "true" : "false"}>
                    <Checkbox checked={agreementAccepted} onChange={(event) => setAgreementAccepted(event.target.checked)}>
                        <span className="auth-agreement-label">我已阅读并同意</span>
                    </Checkbox>
                    <button type="button" className="auth-agreement-link" onClick={() => setAgreementOpen(true)}>
                        《{agreementTitle}》
                    </button>
                </div>
            ) : null}

            <Button type="primary" htmlType="submit" size="large" block loading={submitting} disabled={disabled || registerCountdown > 0 || !agreementAccepted} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                {registerCountdown > 0 ? `${registerCountdown} 秒后可重试` : "创建账号"}
            </Button>
            {settings?.linuxdoEnabled && !settings.smsAndEmailRegistration ? (
                <>
                    <Divider plain className="auth-scene-divider">
                        或
                    </Divider>
                    <Button size="large" block disabled={!agreementAccepted} icon={<LinuxDOIcon />} href={agreementAccepted ? linuxDOLoginURL(next, true) : undefined}>
                        使用 Linux.do 注册 / 登录
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
                        服务协议内容待补充，请联系管理员在后台「登录与注册」中完善。
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
                    继续注册即表示你已阅读并接受本协议全部条款。
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
        <div data-tone={tone} className="auth-scene-notice flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs leading-5">
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
