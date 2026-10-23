import { App, Button, Form, Input, InputNumber, Modal, Radio, Skeleton, Space, Tag } from "antd";
import { Select, Switch } from "@/pages/admin/ui/controls";
import {
    AlertCircle,
    AlertTriangle,
    AtSign,
    BadgeCheck,
    CheckCircle2,
    Copy,
    Edit3,
    KeyRound,
    Layers,
    Mail,
    MailCheck,
    Plus,
    RefreshCw,
    RotateCcw,
    Save,
    Send,
    Server,
    Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useBlocker } from "react-router";

import { cn } from "@/lib/utils";
import {
    getAdminEmailSetting,
    testAdminEmail,
    updateAdminEmailSetting,
    type EmailSender,
    type EmailSetting,
    type TestEmailInput,
} from "@/services/api/wallet";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { AdminStatusBadge, configuredSecretText, SettingsSectionCard } from "./admin-ui";

type SenderDraft = EmailSender & {
    newPassword?: string;
};

export default function EmailSettingsPanel() {
    const { message, modal } = App.useApp();
    const brandName = useAppearanceStore((state) => state.appearance.brandName) || "平台";
    const [setting, setSetting] = useState<EmailSetting | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [draftEnabled, setDraftEnabled] = useState(false);
    const [dispatchMode, setDispatchMode] = useState<"single" | "round_robin">("single");
    const [activeSenderId, setActiveSenderId] = useState<string>("");
    const [senders, setSenders] = useState<SenderDraft[]>([]);
    const [domainsText, setDomainsText] = useState("");
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState("");

    // 编辑/新建邮箱弹窗状态
    const [editorModalOpen, setEditorModalOpen] = useState(false);
    const [editingSenderIndex, setEditingSenderIndex] = useState<number | null>(null);
    const [senderForm] = Form.useForm<SenderDraft>();

    // 独立测试弹窗状态
    const [testModalOpen, setTestModalOpen] = useState(false);
    const [testingTarget, setTestingTarget] = useState<SenderDraft | null>(null);
    const [testRecipient, setTestRecipient] = useState("duck@ugreen.tv");
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

    const requestVersionRef = useRef(0);
    const navigationConfirmOpenRef = useRef(false);
    const navigationTriggerRef = useRef<HTMLElement | null>(null);

    const syncFromSetting = useCallback((s: EmailSetting) => {
        setSetting(s);
        setDraftEnabled(s.enabled);
        setDispatchMode(s.dispatchMode || "single");
        setActiveSenderId(s.activeSenderId || s.senders?.[0]?.id || "");
        setSenders(
            (s.senders || []).map((sender) => ({
                ...sender,
                newPassword: "",
            })),
        );
        setDomainsText((s.registrationAllowedDomains || []).join("\n"));
        setDirty(false);
    }, []);

    const load = useCallback(
        async (initial = false, announce = false) => {
            const requestVersion = ++requestVersionRef.current;
            if (initial) setLoading(true);
            else setRefreshing(true);
            setLoadError("");
            try {
                const result = await getAdminEmailSetting();
                if (requestVersion !== requestVersionRef.current) return;
                syncFromSetting(result.setting);
                setSaveError("");
                if (announce) message.success("已重新读取当前邮件服务配置");
            } catch (error) {
                if (requestVersion !== requestVersionRef.current) return;
                const errorMessage = error instanceof Error ? error.message : "读取邮件配置失败";
                setLoadError(errorMessage);
                if (!initial) message.error(errorMessage);
            } finally {
                if (requestVersion === requestVersionRef.current) {
                    setLoading(false);
                    setRefreshing(false);
                }
            }
        },
        [message, syncFromSetting],
    );

    useEffect(() => {
        void load(true);
        return () => {
            requestVersionRef.current += 1;
        };
    }, [load]);

    const blocker = useBlocker(dirty && !saving);

    useEffect(() => {
        const beforeUnload = (event: BeforeUnloadEvent) => {
            if (!dirty || saving) return;
            event.preventDefault();
        };
        window.addEventListener("beforeunload", beforeUnload);
        return () => window.removeEventListener("beforeunload", beforeUnload);
    }, [dirty, saving]);

    useEffect(() => {
        if (blocker.state !== "blocked" || navigationConfirmOpenRef.current) return;
        navigationConfirmOpenRef.current = true;
        navigationTriggerRef.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
        modal.confirm({
            title: "放弃邮件服务调整？",
            content: "当前发信配置有尚未保存的调整，离开后这些内容会丢失。服务端正在使用的邮件配置不会改变。",
            okText: "放弃并离开",
            cancelText: "继续编辑",
            okButtonProps: { danger: true },
            onOk: () => {
                navigationConfirmOpenRef.current = false;
                navigationTriggerRef.current = null;
                blocker.proceed();
            },
            onCancel: () => {
                navigationConfirmOpenRef.current = false;
                blocker.reset();
                window.requestAnimationFrame(() => {
                    const fallback = document.querySelector<HTMLButtonElement>(".admin-email-command-actions button");
                    const target = navigationTriggerRef.current?.isConnected ? navigationTriggerRef.current : fallback;
                    target?.focus();
                    navigationTriggerRef.current = null;
                });
            },
        });
    }, [blocker, modal]);

    const resetDraft = () => {
        if (!setting || saving) return;
        syncFromSetting(setting);
        setSaveError("");
        message.info("已撤销邮件服务的未保存调整");
    };

    const requestRefresh = () => {
        if (!dirty) {
            void load(false, true);
            return;
        }
        modal.confirm({
            title: "放弃调整并重新读取？",
            content: "重新读取会丢弃当前 SMTP 表单中的未保存内容，并以服务端配置为准。",
            okText: "放弃并刷新",
            cancelText: "继续编辑",
            okButtonProps: { danger: true },
            onOk: () => load(false, true),
        });
    };

    const markDirty = () => {
        setDirty(true);
        setSaveError("");
    };

    const handleSave = async () => {
        const allowedDomains = domainsText
            .split("\n")
            .map((s) => s.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, ""))
            .filter(Boolean);

        if (draftEnabled) {
            const enabledSenders = senders.filter((s) => s.enabled);
            if (!enabledSenders.length) {
                message.error("启用邮件服务时，请至少启用一个发信邮箱");
                return;
            }
            for (const sender of enabledSenders) {
                if (!sender.host || !sender.port || !sender.fromEmail) {
                    message.error(`邮箱 [${sender.name || sender.fromEmail}] 未完整填写主机、端口或发件邮箱`);
                    return;
                }
                if (!isValidEmail(sender.fromEmail)) {
                    message.error(`邮箱 [${sender.name || sender.fromEmail}] 的发件人地址格式无效`);
                    return;
                }
                if (sender.username && !sender.newPassword && !sender.hasPassword && !sender.password) {
                    message.error(`邮箱 [${sender.name || sender.fromEmail}] 已填写用户名，必须设置密码`);
                    return;
                }
            }
        }

        const payload: Partial<EmailSetting> = {
            enabled: draftEnabled,
            dispatchMode,
            activeSenderId,
            senders: senders.map((s) => ({
                id: s.id,
                name: s.name,
                host: s.host,
                port: s.port,
                username: s.username,
                password: s.newPassword || s.password || "",
                encryption: s.encryption,
                fromEmail: s.fromEmail,
                fromName: s.fromName,
                enabled: s.enabled,
            })),
            registrationAllowedDomains: allowedDomains,
        };

        setSaving(true);
        setSaveError("");
        try {
            const result = await updateAdminEmailSetting(payload);
            syncFromSetting(result.setting);
            message.success("邮件服务配置已保存并生效");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "保存邮件配置失败";
            setSaveError(`${errorMessage}。未自动重试，请重新核对后再决定是否保存。`);
            message.error(errorMessage);
        } finally {
            setSaving(false);
        }
    };

    const openAddSenderModal = () => {
        setEditingSenderIndex(null);
        senderForm.resetFields();
        senderForm.setFieldsValue({
            id: "",
            name: "",
            host: "",
            port: 465,
            encryption: "tls",
            username: "",
            newPassword: "",
            fromEmail: "",
            fromName: "",
            enabled: true,
        });
        setEditorModalOpen(true);
    };

    const openEditSenderModal = (index: number) => {
        const item = senders[index];
        setEditingSenderIndex(index);
        senderForm.resetFields();
        senderForm.setFieldsValue({
            ...item,
            newPassword: "",
        });
        setEditorModalOpen(true);
    };

    const handleSaveSenderFromModal = async () => {
        let values: SenderDraft;
        try {
            values = await senderForm.validateFields();
        } catch {
            return;
        }

        const nextList = [...senders];
        const senderPayload: SenderDraft = {
            id: values.id || (editingSenderIndex !== null && senders[editingSenderIndex]?.id) || `sender_${Date.now()}`,
            name: (values.name || "").trim() || (values.fromEmail || "").trim(),
            host: (values.host || "").trim(),
            port: Number(values.port) || 465,
            encryption: values.encryption || "tls",
            username: (values.username || "").trim(),
            password: values.newPassword?.trim() || (editingSenderIndex !== null ? senders[editingSenderIndex]?.password : "") || "",
            newPassword: values.newPassword?.trim() || "",
            hasPassword: Boolean(values.newPassword?.trim() || (editingSenderIndex !== null && senders[editingSenderIndex]?.hasPassword)),
            fromEmail: (values.fromEmail || "").trim().toLowerCase(),
            fromName: (values.fromName || "").trim(),
            enabled: values.enabled !== false,
        };

        if (editingSenderIndex !== null && editingSenderIndex >= 0) {
            nextList[editingSenderIndex] = senderPayload;
        } else {
            nextList.push(senderPayload);
            if (!activeSenderId) {
                setActiveSenderId(senderPayload.id);
            }
        }

        setSenders(nextList);
        markDirty();
        setEditorModalOpen(false);
        message.success(editingSenderIndex !== null ? "已更新发信邮箱项（待保存）" : "已添加发信邮箱项（待保存）");
    };

    const handleDeleteSender = (index: number) => {
        const target = senders[index];
        modal.confirm({
            title: `删除发信邮箱「${target.name}」？`,
            content: "删除后将不再使用该邮箱发信。保存设置后在服务端生效。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: () => {
                const nextList = senders.filter((_, i) => i !== index);
                setSenders(nextList);
                if (activeSenderId === target.id) {
                    setActiveSenderId(nextList[0]?.id || "");
                }
                markDirty();
                message.info("已移除该发信邮箱（待保存）");
            },
        });
    };

    const toggleSenderEnabled = (index: number, checked: boolean) => {
        const nextList = [...senders];
        nextList[index] = { ...nextList[index], enabled: checked };
        setSenders(nextList);
        markDirty();
    };

    const openTestModal = (sender: SenderDraft) => {
        setTestingTarget(sender);
        setTestResult(null);
        setTestModalOpen(true);
    };

    const handleRunTest = async (overrideTarget?: SenderDraft) => {
        const target = overrideTarget || testingTarget;
        const recipient = testRecipient.trim();
        if (!recipient) {
            message.warning("请输入用于接收测试邮件的邮箱地址");
            return;
        }
        if (!isValidEmail(recipient)) {
            message.warning("请输入有效的接收邮箱格式");
            return;
        }
        if (!target) {
            message.error("缺少发信邮箱配置参数");
            return;
        }

        setTesting(true);
        setTestResult(null);
        try {
            const input: TestEmailInput = {
                recipient,
                senderId: target.id || undefined,
                host: target.host,
                port: target.port,
                username: target.username,
                password: target.newPassword || target.password || undefined,
                encryption: target.encryption,
                fromEmail: target.fromEmail,
                fromName: target.fromName || brandName,
            };
            const response = await testAdminEmail(input);
            setTestResult({
                success: true,
                message: `测试邮件投递成功！耗时 ${response.result.durationMs}ms，请前往 ${recipient} 查收。`,
            });
            message.success("测试邮件发送成功！");
        } catch (error) {
            const msg = error instanceof Error ? error.message : "发信失败";
            setTestResult({
                success: false,
                message: `发信测试失败：${msg}`,
            });
            message.error(msg);
        } finally {
            setTesting(false);
        }
    };

    if (loading && !setting) {
        return (
            <div className="admin-settings-stack admin-email-settings" aria-label="正在读取邮件服务配置" role="status">
                <div className="admin-email-loading-card">
                    <Skeleton active paragraph={{ rows: 7 }} />
                </div>
            </div>
        );
    }

    if (!setting) {
        return (
            <div className="admin-settings-stack admin-email-settings">
                <div className="admin-email-load-error" role="alert">
                    <span className="admin-email-load-error-icon">
                        <AlertTriangle className="size-5" aria-hidden="true" />
                    </span>
                    <div>
                        <h2>无法读取邮件服务配置</h2>
                        <p>{loadError || "当前没有可显示的配置，请稍后重试。"}</p>
                    </div>
                    <Button icon={<RefreshCw className="size-4" />} loading={refreshing} onClick={() => void load(false, true)}>
                        重新读取
                    </Button>
                </div>
            </div>
        );
    }

    const enabledCount = senders.filter((s) => s.enabled).length;

    return (
        <div className="admin-settings-stack admin-email-settings">
            {/* 顶部操作命令栏 */}
            <div className={cn("admin-email-command-bar", dirty && "is-dirty")}>
                <div className="admin-email-command-copy" aria-live="polite">
                    <span className="admin-email-command-icon">
                        <MailCheck className="size-4" aria-hidden="true" />
                    </span>
                    <div>
                        <strong>{dirty ? "发信配置有未保存的调整" : `账户邮件：${setting.enabled ? "已启用" : "未启用"}`}</strong>
                        <p>
                            {dirty
                                ? "完成当前调整后，点击右侧「保存设置」生效。"
                                : `已配置 ${senders.length} 个发信通道（${enabledCount} 个启用），模式：${dispatchMode === "round_robin" ? "多通道轮询" : "单通道生效"}`}
                        </p>
                    </div>
                </div>
                <div className="admin-email-command-actions">
                    {dirty ? (
                        <Button icon={<RotateCcw className="size-4" />} disabled={saving} onClick={resetDraft}>
                            撤销调整
                        </Button>
                    ) : null}
                    <Button icon={<RefreshCw className="size-4" />} loading={refreshing} disabled={saving} onClick={requestRefresh}>
                        刷新状态
                    </Button>
                    <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty || loading || refreshing} onClick={() => void handleSave()}>
                        保存设置
                    </Button>
                </div>
            </div>

            {loadError || saveError ? (
                <div className="admin-email-inline-alert" role="alert">
                    <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                    <span>{saveError || `${loadError}。页面仍显示上一次成功读取的配置。`}</span>
                </div>
            ) : null}

            {/* 1. 总开关与发信策略 */}
            <div id="admin-email-delivery" className="admin-settings-anchor">
                <SettingsSectionCard
                    className="admin-email-section admin-email-delivery-section"
                    icon={<Send className="size-4" aria-hidden="true" />}
                    title="1. 是否发送账户安全邮件"
                    description="这是注册验证码和密码找回邮件的主开关。开启后可配置多个发信通道，并选择轮询或指定生效。"
                    status={
                        <AdminStatusBadge
                            label={draftEnabled ? (dirty && !setting.enabled ? "待启用" : "已启用") : dirty && setting.enabled ? "待停用" : "未启用"}
                            tone={dirty ? "warning" : draftEnabled ? "success" : "neutral"}
                        />
                    }
                >
                    <div className="admin-email-delivery-policy">
                        <span className="admin-email-policy-icon">
                            <MailCheck className="size-5" aria-hidden="true" />
                        </span>
                        <div className="admin-email-policy-copy">
                            <div className="flex flex-wrap items-center gap-2">
                                <strong>发送注册与密码找回验证码</strong>
                                <AdminStatusBadge label="保存后生效" tone="info" />
                            </div>
                            <p>启用后，普通邮箱注册和密码找回使用 6 位验证码；邮件发送失败时不会保留可用验证码。</p>
                            <span>关闭只停止后续账户邮件，不改变新用户注册开关，也不影响已有登录会话。</span>
                        </div>
                        <Switch
                            checked={draftEnabled}
                            disabled={loading || refreshing || saving}
                            aria-label="发送账户安全邮件"
                            onChange={(checked) => {
                                setDraftEnabled(checked);
                                markDirty();
                            }}
                        />
                    </div>
                </SettingsSectionCard>
            </div>

            {/* 2. 多发信邮箱配置与策略 */}
            {draftEnabled ? (
                <div id="admin-email-smtp" className="admin-settings-anchor">
                    <SettingsSectionCard
                        className="admin-email-section admin-email-configuration-section"
                        icon={<Server className="size-4" aria-hidden="true" />}
                        title="2. 配置 SMTP 连接与发件身份"
                        description="添加并管理多个 SMTP 发信邮箱。支持单通道指定生效或多通道自动轮询发信，每个通道均支持独立测试。"
                        status={
                            <AdminStatusBadge
                                label={dirty ? "待保存" : enabledCount > 0 ? "已配置" : "待配置"}
                                tone={dirty ? "warning" : enabledCount > 0 ? "success" : "neutral"}
                            />
                        }
                        footer={
                            <div className="flex w-full flex-wrap items-center justify-between gap-3">
                                <div className="admin-email-footer-note">
                                    <BadgeCheck className="size-4" aria-hidden="true" />
                                    <span>SMTP 密码由服务端独立加密存储，客户端测试发信不泄露明文</span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Button icon={<Plus className="size-4" />} onClick={openAddSenderModal}>
                                        添加发信邮箱
                                    </Button>
                                    <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty || loading || refreshing} onClick={() => void handleSave()}>
                                        保存设置
                                    </Button>
                                </div>
                            </div>
                        }
                    >
                        {/* 策略切换行 */}
                        <div className="mb-5 rounded-xl border border-white/5 bg-black/15 p-4 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-4">
                                <div>
                                    <h4 className="text-sm font-semibold text-foreground">发信分发策略</h4>
                                    <p className="text-xs text-foreground/50 mt-0.5">多通道轮询可分摊单日额度限制；单通道模式可手动指定主力发信邮箱。</p>
                                </div>
                                <Radio.Group
                                    value={dispatchMode}
                                    onChange={(e) => {
                                        setDispatchMode(e.target.value);
                                        markDirty();
                                    }}
                                    optionType="button"
                                    buttonStyle="solid"
                                    options={[
                                        { label: "多通道轮询分发 (Round-Robin)", value: "round_robin" },
                                        { label: "指定单个通道生效", value: "single" },
                                    ]}
                                />
                            </div>

                            {dispatchMode === "single" ? (
                                <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-white/5 text-xs">
                                    <span className="text-foreground/70">当前指定发信邮箱：</span>
                                    <Select
                                        className="w-64"
                                        value={activeSenderId}
                                        onChange={(val) => {
                                            setActiveSenderId(val);
                                            markDirty();
                                        }}
                                        options={senders.map((s) => ({
                                            value: s.id,
                                            label: `${s.name || s.fromEmail} (${s.fromEmail})`,
                                        }))}
                                    />
                                    {senders.find((s) => s.id === activeSenderId && !s.enabled) ? (
                                        <Tag color="warning">注意：当前指定邮箱处于停用状态</Tag>
                                    ) : null}
                                </div>
                            ) : (
                                <div className="flex items-center gap-2 text-xs text-emerald-400/80 pt-1">
                                    <CheckCircle2 className="size-3.5" />
                                    <span>轮询池共有 {enabledCount} 个已启用通道，系统将按顺序均摊发信并在故障时自动重试下一通道。</span>
                                </div>
                            )}
                        </div>

                        {/* 发信邮箱卡片列表 */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between pb-1">
                                <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground/60">
                                    已配置的发信邮箱 ({senders.length})
                                </h4>
                                <Button size="small" type="dashed" icon={<Plus className="size-3.5" />} onClick={openAddSenderModal}>
                                    添加邮箱
                                </Button>
                            </div>

                            {senders.length === 0 ? (
                                <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-xs text-foreground/45">
                                    <Mail className="mx-auto size-8 opacity-40 mb-2" />
                                    <p>暂未添加任何发信邮箱。请点击「添加邮箱」按钮配置您的第一条 SMTP 通道。</p>
                                </div>
                            ) : (
                                senders.map((item, index) => {
                                    const isActiveInSingle = dispatchMode === "single" && activeSenderId === item.id;
                                    const isInRoundRobin = dispatchMode === "round_robin" && item.enabled;

                                    return (
                                        <div
                                            key={item.id || index}
                                            className={cn(
                                                "relative flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-xl border p-4 transition-colors",
                                                item.enabled
                                                    ? "border-white/10 bg-black/20 hover:border-white/20"
                                                    : "border-white/5 bg-black/10 opacity-70",
                                            )}
                                        >
                                            <div className="flex items-start gap-3 min-w-0">
                                                <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-foreground/80 mt-0.5">
                                                    <Server className="size-4" />
                                                </div>
                                                <div className="min-w-0 space-y-1">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <strong className="text-sm font-semibold text-foreground truncate max-w-[260px]">
                                                            {item.name || item.fromEmail}
                                                        </strong>
                                                        {item.enabled ? (
                                                            <Tag color="success">启用</Tag>
                                                        ) : (
                                                            <Tag color="default">停用</Tag>
                                                        )}
                                                        {isActiveInSingle ? (
                                                            <Tag color="blue">当前生效</Tag>
                                                        ) : isInRoundRobin ? (
                                                            <Tag color="cyan">轮询中</Tag>
                                                        ) : null}
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-foreground/60 tabular-nums">
                                                        <span>
                                                            主机：<strong>{item.host}:{item.port}</strong> ({item.encryption?.toUpperCase() || "STARTTLS"})
                                                        </span>
                                                        <span>
                                                            发件人：<strong>{item.fromName || brandName}</strong> &lt;{item.fromEmail}&gt;
                                                        </span>
                                                        <span>
                                                            用户名：<strong>{item.username || "（无）"}</strong>
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex shrink-0 items-center gap-2 self-end md:self-center">
                                                <Switch
                                                    checked={item.enabled}
                                                    aria-label={`启用或停用${item.name}`}
                                                    onChange={(checked) => toggleSenderEnabled(index, checked)}
                                                />
                                                <Button size="small" icon={<Send className="size-3.5" />} onClick={() => openTestModal(item)}>
                                                    测试发信
                                                </Button>
                                                <Button size="small" icon={<Edit3 className="size-3.5" />} onClick={() => openEditSenderModal(index)}>
                                                    编辑
                                                </Button>
                                                <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => handleDeleteSender(index)} />
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </SettingsSectionCard>
                </div>
            ) : null}

            {/* 3. 域名白名单 */}
            <div id="admin-email-registration-domains" className="admin-settings-anchor">
                <SettingsSectionCard
                    className="admin-email-section"
                    icon={<MailCheck className="size-4" aria-hidden="true" />}
                    title="3. 电子邮件域名白名单"
                    description="每行填写一个允许注册的邮箱域名；不在白名单内的邮箱无法注册。"
                    status={
                        <AdminStatusBadge
                            label={domainsText.trim() ? "已限制范围" : "不限制服务商"}
                            tone={domainsText.trim() ? "info" : "neutral"}
                        />
                    }
                    footer={
                        <div className="flex w-full flex-wrap items-center justify-between gap-3">
                            <div className="admin-email-footer-note">
                                <BadgeCheck className="size-4" aria-hidden="true" />
                                <span>规则只影响新用户注册，不限制发件邮箱和已有账号找回密码</span>
                            </div>
                            <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty || loading || refreshing} onClick={() => void handleSave()}>
                                保存设置
                            </Button>
                        </div>
                    }
                >
                    <div className="admin-email-form-section">
                        <label className="block text-xs text-foreground/60 mb-2">
                            电子邮件域名白名单（每行一个域名，例如 ugreen.tv 或 qq.com）
                        </label>
                        <Input.TextArea
                            rows={6}
                            value={domainsText}
                            placeholder="gmail.com&#10;163.com&#10;qq.com&#10;ugreen.tv"
                            spellCheck={false}
                            onChange={(e) => {
                                setDomainsText(e.target.value);
                                markDirty();
                            }}
                        />
                    </div>
                </SettingsSectionCard>
            </div>

            {/* 添加 / 编辑邮箱弹窗 */}
            <Modal
                title={editingSenderIndex !== null ? "编辑发信邮箱" : "添加发信邮箱"}
                open={editorModalOpen}
                okText="确定"
                cancelText="取消"
                onOk={() => void handleSaveSenderFromModal()}
                onCancel={() => setEditorModalOpen(false)}
                width={560}
                destroyOnClose
            >
                <Form form={senderForm} layout="vertical" className="pt-2">
                    <Form.Item name="id" hidden>
                        <Input />
                    </Form.Item>
                    <Form.Item name="name" label="通道识别名称" rules={[{ required: true, message: "请输入通道名称" }]} extra="用于管理后台区分不同邮箱通道，如：飞书企业邮、SMTP2GO 等。">
                        <Input placeholder="例如：飞书发信 (mexai.cc)" />
                    </Form.Item>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Form.Item name="host" label="SMTP 主机" rules={[{ required: true, message: "请输入 SMTP 服务器地址" }]}>
                            <Input placeholder="smtp.larksuite.com" />
                        </Form.Item>
                        <Form.Item name="port" label="端口" rules={[{ required: true, message: "请输入端口" }]}>
                            <InputNumber min={1} max={65535} className="w-full" placeholder="465" />
                        </Form.Item>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Form.Item name="encryption" label="连接加密方式" rules={[{ required: true }]}>
                            <Select
                                options={[
                                    { label: "直接 TLS (通常 465)", value: "tls" },
                                    { label: "STARTTLS (通常 587)", value: "starttls" },
                                    { label: "无加密 (仅内网)", value: "none" },
                                ]}
                            />
                        </Form.Item>
                        <Form.Item name="enabled" label="启用状态" valuePropName="checked">
                            <Switch checkedChildren="启用" unCheckedChildren="停用" />
                        </Form.Item>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Form.Item name="username" label="SMTP 登录账号" extra="通常是完整邮箱地址">
                            <Input placeholder="mexai@mexai.cc" />
                        </Form.Item>
                        <Form.Item
                            name="newPassword"
                            label={editingSenderIndex !== null && senders[editingSenderIndex]?.hasPassword ? "SMTP 密码 / 专用密码 (留空保留已配置)" : "SMTP 密码 / 专用密码"}
                        >
                            <Input.Password placeholder="服务商提供的客户端专用授权码" />
                        </Form.Item>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Form.Item name="fromEmail" label="发件人邮箱 (From)" rules={[{ required: true, message: "请输入发件邮箱" }]}>
                            <Input inputMode="email" placeholder="mexai@mexai.cc" />
                        </Form.Item>
                        <Form.Item name="fromName" label="发件人名称" extra={`留空使用站点名称“${brandName}”`}>
                            <Input placeholder={brandName} />
                        </Form.Item>
                    </div>

                    {/* 弹窗内即时测试工具 */}
                    <div className="mt-3 rounded-lg border border-white/5 bg-white/5 p-3 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
                                <Send className="size-3.5 text-primary" />
                                弹窗内即时连通性测试
                            </span>
                            <span className="text-[10px] text-foreground/40">保存前即可验证参数</span>
                        </div>
                        <div className="flex gap-2">
                            <Input
                                size="small"
                                placeholder="输入测试收信邮箱，如 duck@ugreen.tv"
                                value={testRecipient}
                                onChange={(e) => setTestRecipient(e.target.value)}
                            />
                            <Button
                                size="small"
                                type="primary"
                                loading={testing}
                                onClick={async () => {
                                    let draftVals: SenderDraft;
                                    try {
                                        draftVals = await senderForm.validateFields();
                                    } catch {
                                        return;
                                    }
                                    await handleRunTest(draftVals);
                                }}
                            >
                                测试发送
                            </Button>
                        </div>
                        {testResult ? (
                            <div className={cn("text-xs p-2 rounded", testResult.success ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400")}>
                                {testResult.message}
                            </div>
                        ) : null}
                    </div>
                </Form>
            </Modal>

            {/* 独立快速测试弹窗 */}
            <Modal
                title={`测试发信通道：${testingTarget?.name || testingTarget?.fromEmail || ""}`}
                open={testModalOpen}
                okText="开始测试"
                cancelText="关闭"
                confirmLoading={testing}
                onOk={() => void handleRunTest()}
                onCancel={() => setTestModalOpen(false)}
                width={480}
            >
                <div className="py-2 space-y-3">
                    <p className="text-xs text-foreground/60 leading-relaxed">
                        系统将直接使用该通道（<strong>{testingTarget?.host}:{testingTarget?.port}</strong>，发件人：&lt;{testingTarget?.fromEmail}&gt;）向指定地址投递一封包含验证码排版的测试邮件。
                    </p>
                    <div>
                        <label className="block text-xs font-medium text-foreground mb-1.5">
                            接收测试邮件的邮箱地址：
                        </label>
                        <Input
                            placeholder="请输入收件邮箱，例如 duck@ugreen.tv"
                            value={testRecipient}
                            onChange={(e) => setTestRecipient(e.target.value)}
                            onPressEnter={() => void handleRunTest()}
                        />
                    </div>
                    {testResult ? (
                        <div
                            className={cn(
                                "flex items-start gap-2 p-3 rounded-lg text-xs leading-relaxed",
                                testResult.success ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300" : "bg-red-500/10 border border-red-500/20 text-red-300",
                            )}
                        >
                            {testResult.success ? (
                                <CheckCircle2 className="size-4 shrink-0 mt-0.5 text-emerald-400" />
                            ) : (
                                <AlertCircle className="size-4 shrink-0 mt-0.5 text-red-400" />
                            )}
                            <div>{testResult.message}</div>
                        </div>
                    ) : null}
                </div>
            </Modal>
        </div>
    );
}

function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
