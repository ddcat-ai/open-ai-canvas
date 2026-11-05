import { useQuery } from "@tanstack/react-query";
import { App, Button, Input } from "antd";
import { CheckCircle2, Copy, ExternalLink, UserRoundPlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { PaymentCheckoutCode } from "@/components/payment-checkout-code";
import { Callout } from "@/components/ui/product/callout";
import { formatCredits } from "@/constant/credits";
import { useCopyText } from "@/hooks/use-copy-text";
import { currentLocale } from "@/i18n";
import { arkGroupPrice, formatArkTime } from "@/lib/ark-assets";
import { cn } from "@/lib/utils";
import { cancelArkPortraitSession, checkArkPortraitSession, createArkPortraitSession, createArkVirtualGroup, getArkPortraitSession, type ArkAssetConfig, type ArkPortraitSession } from "@/services/api/ark-portraits";

type ComposerProps = { config: ArkAssetConfig; onCancel: () => void };

/**
 * 真人素材组的三步流程：填写姓名 → 本人扫码完成 H5 认证 → 选中新素材组后上传照片。
 * 电脑端每 3 秒读取一次本地会话状态；手机完成认证后由服务端回调写入结果。
 */
export function ArkRealGroupComposer({ config, resume, onCancel, onVerified, onSessionsChanged }: ComposerProps & { resume?: ArkPortraitSession; onVerified: (arkGroupId: string) => void; onSessionsChanged: () => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const copyText = useCopyText();
    const [name, setName] = useState("");
    const [session, setSession] = useState<ArkPortraitSession | null>(resume || null);
    const [working, setWorking] = useState<"" | "start" | "check" | "cancel">("");
    const finished = useRef(false);
    const price = arkGroupPrice(config, "real");
    const step = session ? 2 : 1;

    const statusQuery = useQuery({
        queryKey: ["ark-portrait-session", session?.id],
        queryFn: ({ signal }) => getArkPortraitSession(session!.id, signal),
        enabled: Boolean(session?.id && session.status === "pending"),
        refetchInterval: 3_000,
    });

    useEffect(() => {
        const latest = statusQuery.data?.session;
        if (!latest || !session || latest.id !== session.id || latest.status === session.status) return;
        settle(latest);
        // settle 只依赖最新会话；session 由状态更新驱动。
    }, [statusQuery.data]);

    const settle = (latest: ArkPortraitSession) => {
        if (finished.current) return;
        if (latest.status === "verified") {
            finished.current = true;
            message.success(t("library.ark.realFlow.verified", { name: latest.name }));
            onSessionsChanged();
            onVerified(latest.groupId || "");
            return;
        }
        if (latest.status === "failed" || latest.status === "expired" || latest.status === "cancelled") {
            finished.current = true;
            if (latest.status !== "cancelled") message.warning(latest.error || t("library.ark.realFlow.failed"));
            onSessionsChanged();
            setSession(null);
            finished.current = false;
            return;
        }
        setSession((current) => (current ? { ...current, ...latest, h5Link: current.h5Link } : latest));
    };

    const start = async () => {
        const trimmed = name.trim();
        if (!trimmed) {
            message.warning(t("library.ark.realFlow.nameRequired"));
            return;
        }
        setWorking("start");
        try {
            const result = await createArkPortraitSession({ name: trimmed, lang: document.documentElement.lang || navigator.language });
            setSession(result.session);
            onSessionsChanged();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("library.ark.actionFailed"));
        } finally {
            setWorking("");
        }
    };

    const check = async () => {
        if (!session) return;
        setWorking("check");
        try {
            const result = await checkArkPortraitSession(session.id);
            settle(result.session);
        } catch (error) {
            message.warning(error instanceof Error ? error.message : t("library.ark.actionFailed"));
        } finally {
            setWorking("");
        }
    };

    const cancel = async () => {
        if (!session) {
            onCancel();
            return;
        }
        setWorking("cancel");
        try {
            await cancelArkPortraitSession(session.id);
            message.info(t("library.ark.realFlow.cancelled"));
            onSessionsChanged();
            onCancel();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("library.ark.actionFailed"));
        } finally {
            setWorking("");
        }
    };

    return (
        <div className="ark-composer" aria-live="polite">
            <header className="ark-composer-head">
                <div>
                    <h3>{t("library.ark.create.real")}</h3>
                    <p>{t("library.ark.kindHints.real")}</p>
                </div>
                <Button type="text" icon={<X className="size-4" />} aria-label={t("common.cancel")} onClick={() => (session ? void cancel() : onCancel())} />
            </header>
            <ol className="ark-steps" aria-label={t("library.ark.create.real")}>
                {[t("library.ark.realFlow.stepName"), t("library.ark.realFlow.stepVerify"), t("library.ark.realFlow.stepUpload")].map((label, index) => (
                    <li key={label} className={cn("ark-step", index + 1 === step && "is-current", index + 1 < step && "is-done")} aria-current={index + 1 === step ? "step" : undefined}>
                        <span className="ark-step-index">{index + 1 < step ? <CheckCircle2 aria-hidden /> : index + 1}</span>
                        <span>{label}</span>
                    </li>
                ))}
            </ol>

            {!session ? (
                <div className="ark-composer-form">
                    <label className="ark-field">
                        <span>{t("library.ark.realFlow.nameLabel")}</span>
                        <Input autoFocus value={name} maxLength={40} placeholder={t("library.ark.realFlow.namePlaceholder")} onChange={(event) => setName(event.target.value)} onPressEnter={() => void start()} />
                    </label>
                    <Callout tone="info">{t("library.ark.realFlow.consent")}</Callout>
                    <p className="ark-fee-note">{price > 0 ? t("library.ark.realFlow.fee", { price: formatCredits(price) }) : t("library.ark.realFlow.free")}</p>
                    <div className="ark-composer-actions">
                        <Button onClick={onCancel}>{t("common.cancel")}</Button>
                        <Button type="primary" icon={<UserRoundPlus className="size-4" />} loading={working === "start"} disabled={!name.trim()} onClick={() => void start()}>
                            {t("library.ark.realFlow.start")}
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="ark-session">
                    {session.h5Link ? (
                        <div className="ark-session-code">
                            <PaymentCheckoutCode value={session.h5Link} />
                        </div>
                    ) : null}
                    <div className="ark-session-copy">
                        <strong>{t("library.ark.realFlow.sessionTitle", { name: session.name })}</strong>
                        <span>{t("library.ark.realFlow.sessionHint")}</span>
                        <span>{t("library.ark.realFlow.sessionExpires", { time: formatArkTime(session.expiresAt, currentLocale()) })}</span>
                        {session.reservedMicrocredits > 0 ? <span className="ark-session-reserved">{t("library.ark.realFlow.reserved", { price: formatCredits(session.reservedMicrocredits) })}</span> : null}
                        <div className="ark-composer-actions is-start">
                            {session.h5Link ? (
                                <>
                                    <Button icon={<ExternalLink className="size-4" />} href={session.h5Link} target="_blank" rel="noopener noreferrer">
                                        {t("library.ark.realFlow.openLocal")}
                                    </Button>
                                    <Button icon={<Copy className="size-4" />} onClick={() => copyText(session.h5Link || "", t("library.ark.realFlow.linkCopied"))}>
                                        {t("library.ark.realFlow.copyLink")}
                                    </Button>
                                </>
                            ) : null}
                            <Button type="primary" icon={<CheckCircle2 className="size-4" />} loading={working === "check"} onClick={() => void check()}>
                                {t("library.ark.realFlow.completed")}
                            </Button>
                            <Button type="text" danger loading={working === "cancel"} onClick={() => void cancel()}>
                                {t("library.ark.realFlow.cancel")}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/** 虚拟素材组：名称与说明，创建成功后才扣费。 */
export function ArkVirtualGroupComposer({ config, onCancel, onCreated }: ComposerProps & { onCreated: (arkGroupId: string) => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [working, setWorking] = useState(false);
    const price = arkGroupPrice(config, "virtual");

    const submit = async () => {
        const trimmed = name.trim();
        if (!trimmed) {
            message.warning(t("library.ark.virtualFlow.nameRequired"));
            return;
        }
        setWorking(true);
        try {
            const result = await createArkVirtualGroup({ name: trimmed, description: description.trim() });
            message.success(t("library.ark.virtualFlow.created"));
            onCreated(result.group.groupId);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("library.ark.actionFailed"));
        } finally {
            setWorking(false);
        }
    };

    return (
        <div className="ark-composer">
            <header className="ark-composer-head">
                <div>
                    <h3>{t("library.ark.virtualFlow.title")}</h3>
                    <p>{t("library.ark.kindHints.virtual")}</p>
                </div>
                <Button type="text" icon={<X className="size-4" />} aria-label={t("common.cancel")} onClick={onCancel} />
            </header>
            <div className="ark-composer-form">
                <label className="ark-field">
                    <span>{t("library.ark.virtualFlow.nameLabel")}</span>
                    <Input autoFocus value={name} maxLength={40} placeholder={t("library.ark.virtualFlow.namePlaceholder")} onChange={(event) => setName(event.target.value)} onPressEnter={() => void submit()} />
                </label>
                <label className="ark-field">
                    <span>{t("library.ark.virtualFlow.descriptionLabel")}</span>
                    <Input.TextArea value={description} maxLength={200} autoSize={{ minRows: 2, maxRows: 4 }} placeholder={t("library.ark.virtualFlow.descriptionPlaceholder")} onChange={(event) => setDescription(event.target.value)} />
                </label>
                <p className="ark-fee-note">{price > 0 ? t("library.ark.virtualFlow.fee", { price: formatCredits(price) }) : t("library.ark.virtualFlow.free")}</p>
                <div className="ark-composer-actions">
                    <Button onClick={onCancel}>{t("common.cancel")}</Button>
                    <Button type="primary" loading={working} disabled={!name.trim()} onClick={() => void submit()}>
                        {t("library.ark.virtualFlow.submit")}
                    </Button>
                </div>
            </div>
        </div>
    );
}
