import { App, Button, Input, Skeleton } from "antd";
import { AlertTriangle, KeyRound, MessageSquareText, RotateCcw, Save, Send, ShieldCheck, Smartphone } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getAdminSmsSetting, testAdminSms, updateAdminSmsSetting, type SmsSetting } from "@/services/api/sms";
import { Switch } from "@/pages/admin/ui/controls";

import { AdminPageFrame } from "../components/admin-shell";
import { AdminStatusBadge, configuredSecretText, SettingsSectionCard } from "../components/admin-ui";

type TestStatus = "idle" | "sending" | "success" | "error";

type SmsDraft = {
    accessKeyId: string;
    signName: string;
    registerTemplateCode: string;
    resetTemplateCode: string;
    regionId: string;
};

const EMPTY_DRAFT: SmsDraft = { accessKeyId: "", signName: "", registerTemplateCode: "", resetTemplateCode: "", regionId: "" };

/**
 * 短信服务配置页（阿里云短信）。
 *
 * ⚠️ 密钥是**只进不出**的：加载回来只有 `hasAccessKeySecret`，输入框永远空着，
 *    留空 = 保留原密钥（与「邮件服务」页同一套口径）。
 *
 * ⚠️ 「发送测试短信」会**真发一条、按条计费**，所以走 `modal.confirm` 二次确认 ——
 *    但它是唯一能证明 AccessKey / 签名 / 模板三者都配对了的手段（这三样在阿里云都是审核制的，
 *    配错时只有真发一次才会暴露）。
 */
export default function SmsSettingsPage() {
    const { message, modal } = App.useApp();
    const [setting, setSetting] = useState<SmsSetting | null>(null);
    const [enabled, setEnabled] = useState(false);
    const [draft, setDraft] = useState<SmsDraft>(EMPTY_DRAFT);
    const [secret, setSecret] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState("");
    const [testPhone, setTestPhone] = useState("");
    const [testStatus, setTestStatus] = useState<TestStatus>("idle");
    /** 阿里云返回的流水号 —— 「显示成功但没收到」时拿它去控制台的发送记录对账。 */
    const [testBizId, setTestBizId] = useState("");
    const [testError, setTestError] = useState("");

    const applySetting = useCallback((next: SmsSetting) => {
        setSetting(next);
        setEnabled(next.enabled);
        setDraft({
            accessKeyId: next.accessKeyId || "",
            signName: next.signName || "",
            registerTemplateCode: next.registerTemplateCode || "",
            resetTemplateCode: next.resetTemplateCode || "",
            regionId: next.regionId || "",
        });
        setSecret("");
    }, []);

    const load = useCallback(
        async (announce = false) => {
            setLoading(true);
            setLoadError("");
            try {
                const result = await getAdminSmsSetting();
                applySetting(result.setting);
                if (announce) message.success("已刷新短信配置");
            } catch (error) {
                setLoadError(error instanceof Error ? error.message : "读取短信配置失败");
            } finally {
                setLoading(false);
            }
        },
        [applySetting, message],
    );

    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const dirty = Boolean(
        setting &&
            (enabled !== setting.enabled ||
                draft.accessKeyId !== (setting.accessKeyId || "") ||
                draft.signName !== (setting.signName || "") ||
                draft.registerTemplateCode !== (setting.registerTemplateCode || "") ||
                draft.resetTemplateCode !== (setting.resetTemplateCode || "") ||
                draft.regionId !== (setting.regionId || "") ||
                secret.trim() !== ""),
    );

    const save = async () => {
        setSaving(true);
        setSaveError("");
        try {
            const result = await updateAdminSmsSetting({
                enabled,
                accessKeyId: draft.accessKeyId.trim(),
                signName: draft.signName.trim(),
                registerTemplateCode: draft.registerTemplateCode.trim(),
                resetTemplateCode: draft.resetTemplateCode.trim(),
                regionId: draft.regionId.trim(),
                // 留空 = 不改密钥（服务端按空串跳过）。
                ...(secret.trim() ? { accessKeySecret: secret.trim() } : {}),
            });
            applySetting(result.setting);
            message.success("短信配置已保存");
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : "保存失败");
        } finally {
            setSaving(false);
        }
    };

    const runTest = () => {
        const phone = testPhone.trim();
        if (!phone) {
            message.warning("请先填写要接收测试短信的手机号");
            return;
        }
        modal.confirm({
            title: "发送测试短信？",
            content: `将真实发送一条短信到 ${phone}，按条计费。确认继续？`,
            okText: "发送",
            cancelText: "取消",
            onOk: async () => {
                setTestStatus("sending");
                setTestError("");
                try {
                    const result = await testAdminSms(phone);
                    setTestBizId(result.bizId || "");
                    setTestStatus("success");
                    message.success("阿里云已接收（提交成功）");
                } catch (error) {
                    setTestStatus("error");
                    setTestError(error instanceof Error ? error.message : "发送失败");
                }
            },
        });
    };

    const statusLabel = setting?.configured ? (enabled ? "已启用" : "已配置、未启用") : "未配置完成";

    return (
        <AdminPageFrame title="短信服务" description="注册/找回密码的短信验证码（阿里云短信）" scroll>
            <div className="flex flex-col gap-4">
                {loadError ? (
                    <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[var(--fs-caption)] text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1">{loadError}</span>
                        <Button size="small" onClick={() => void load(true)}>
                            重试
                        </Button>
                    </div>
                ) : null}

                {loading && !setting ? (
                    <Skeleton active paragraph={{ rows: 6 }} />
                ) : (
                    <>
                        <SettingsSectionCard
                            icon={<MessageSquareText className="size-4" />}
                            title="1. 是否启用短信验证码"
                            description="关闭后：注册页与找回密码页都不显示「手机号」那条路（已绑定的手机号不受影响）。"
                            status={{ label: statusLabel }}
                            footer={
                                <div className="flex items-center gap-2">
                                    <Button icon={<RotateCcw className="size-4" />} disabled={!dirty || saving} onClick={() => setting && applySetting(setting)}>
                                        撤销调整
                                    </Button>
                                    <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty} onClick={() => void save()}>
                                        保存
                                    </Button>
                                </div>
                            }
                        >
                            <div className="flex items-center gap-3">
                                <Switch checked={enabled} onChange={setEnabled} />
                                <span className="text-[var(--fs-label)]">{enabled ? "已启用" : "已关闭"}</span>
                            </div>
                        </SettingsSectionCard>

                        <SettingsSectionCard icon={<KeyRound className="size-4" />} title="2. 阿里云凭证" description="在阿里云 RAM 控制台创建 RAM 用户（授权 AliyunDysmsFullAccess），拿 AccessKey。密钥只进不出，留空即不修改。">
                            <div className="grid gap-3 sm:grid-cols-2">
                                <label className="flex flex-col gap-1.5">
                                    <span className="text-[var(--fs-caption)] text-foreground/62">AccessKey ID</span>
                                    <Input value={draft.accessKeyId} onChange={(event) => setDraft((current) => ({ ...current, accessKeyId: event.target.value }))} placeholder="LTAI…" autoComplete="off" />
                                </label>
                                <label className="flex flex-col gap-1.5">
                                    <span className="text-[var(--fs-caption)] text-foreground/62">{setting?.hasAccessKeySecret ? `AccessKey Secret（${configuredSecretText}）` : "AccessKey Secret"}</span>
                                    <Input.Password value={secret} onChange={(event) => setSecret(event.target.value)} placeholder={setting?.hasAccessKeySecret ? "留空保留原密钥" : "阿里云 AccessKey Secret"} autoComplete="new-password" />
                                </label>
                                <label className="flex flex-col gap-1.5">
                                    <span className="text-[var(--fs-caption)] text-foreground/62">短信签名（SignName）</span>
                                    <Input value={draft.signName} onChange={(event) => setDraft((current) => ({ ...current, signName: event.target.value }))} placeholder="控制台审核通过的签名名称" />
                                </label>
                                <label className="flex flex-col gap-1.5">
                                    <span className="text-[var(--fs-caption)] text-foreground/62">区域（RegionId）</span>
                                    <Input value={draft.regionId} onChange={(event) => setDraft((current) => ({ ...current, regionId: event.target.value }))} placeholder="cn-hangzhou" />
                                </label>
                            </div>
                        </SettingsSectionCard>

                        <SettingsSectionCard icon={<ShieldCheck className="size-4" />} title="3. 短信模板" description="模板在阿里云控制台申请并审核通过后，把模板 CODE 填进来。模板里的变量名必须是 {code}。">
                            <div className="grid gap-3 sm:grid-cols-2">
                                <label className="flex flex-col gap-1.5">
                                    <span className="text-[var(--fs-caption)] text-foreground/62">注册验证码模板 CODE</span>
                                    <Input value={draft.registerTemplateCode} onChange={(event) => setDraft((current) => ({ ...current, registerTemplateCode: event.target.value }))} placeholder="SMS_…" />
                                </label>
                                <label className="flex flex-col gap-1.5">
                                    <span className="text-[var(--fs-caption)] text-foreground/62">找回密码模板 CODE</span>
                                    <Input value={draft.resetTemplateCode} onChange={(event) => setDraft((current) => ({ ...current, resetTemplateCode: event.target.value }))} placeholder="留空则与注册模板共用" />
                                </label>
                            </div>
                        </SettingsSectionCard>

                        <SettingsSectionCard icon={<Smartphone className="size-4" />} title="4. 连通性测试" description="真实发送一条短信（按条计费）。这是唯一能证明 AccessKey、签名、模板三者都配对的方法。"
                            status={testStatus === "success" ? { label: "发送成功" } : testStatus === "error" ? { label: "发送失败" } : undefined}
                        >
                            <div className="flex flex-wrap items-center gap-2">
                                <Input className="max-w-[240px]" value={testPhone} onChange={(event) => setTestPhone(event.target.value)} placeholder="接收测试短信的手机号" />
                                <Button icon={<Send className="size-4" />} loading={testStatus === "sending"} onClick={runTest}>
                                    发送测试短信
                                </Button>
                                {testStatus !== "idle" && testStatus !== "sending" ? <AdminStatusBadge label={testStatus === "success" ? "已发送" : "失败"} tone={testStatus === "success" ? "success" : "error"} /> : null}
                            </div>
                            {testError ? <p className="mt-2 text-[var(--fs-caption)] text-rose-600 dark:text-rose-400">{testError}</p> : null}
                            {testStatus === "success" ? (
                                <div className="mt-2 flex flex-col gap-1 text-[var(--fs-caption)] text-foreground/62">
                                    {/* ⚠️ 这句必须说清楚：阿里云返回 OK 只代表**它收下了**，运营商回执失败照样收不到。 */}
                                    <span>
                                        「提交成功」只代表阿里云接收了请求，<strong>不等于已送达</strong>。若没收到，请拿流水号去
                                        <span className="whitespace-nowrap">阿里云控制台 → 短信服务 → 发送记录</span> 查投递状态与失败原因。
                                    </span>
                                    {testBizId ? <span className="font-mono">流水号 BizId：{testBizId}</span> : null}
                                    <span>常见原因：用了阿里云自带的<strong>测试签名/测试模板</strong>（只能发往控制台里绑定过的测试号码）、签名或模板刚过审还没生效、号码在退订黑名单里。</span>
                                </div>
                            ) : null}
                            <p className="mt-2 text-[var(--fs-caption)] text-foreground/52">
                                提示：显示「未配置完成」时，多半是签名或模板还没在阿里云审核通过 —— 那三样都是审核制的，审核通过前发送会直接失败。
                            </p>
                        </SettingsSectionCard>

                        {saveError ? <p className="text-[var(--fs-caption)] text-rose-600 dark:text-rose-400">{saveError}</p> : null}
                    </>
                )}
            </div>
        </AdminPageFrame>
    );
}
