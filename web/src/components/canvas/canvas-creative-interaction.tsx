import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "antd";
import { useTranslation } from "react-i18next";
import { translate } from "@/i18n";
import { CanvasAnchoredDropdown as Dropdown } from "./canvas-anchored-dropdown";
import localforage from "localforage";
import type { CanvasAssistantMessage } from "@/types/canvas";
import type { AiConfig } from "@/stores/use-config-store";
import { getActiveUserScope } from "@/lib/user-scope";
import { assertCreativeBriefSpecifications, initialCreativeState, normalizeCreativeProposal, type CreativeAgentState } from "@/lib/creation/creative-agent-state";
import type { CreativeAnswers, CreativeQuote } from "@/lib/creation/creative-agent-contract";
import { CreativeAgentController, type CreativeCanvasAdapter, type CreativeControllerView } from "@/services/creative-agent-controller";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import { resolveMediaUrl } from "@/services/file-storage";
import { CreativeProposalCard, CreativeQuestionCard, CreativeQuoteCard } from "@/components/creation/creative-agent-cards";
import { snapshotCreativePlan } from "@/lib/creation/creative-plan";
import { generationErrorMessage } from "@/lib/generation-error";

export type CanvasCreativeDetail = {
    kind: "creative-interaction";
    input: Record<string, unknown>;
    runId?: string;
    status?: string;
    quotes?: CreativeQuote[];
    approvedProposalVersion?: number;
    state: CreativeAgentState;
};
export function canvasCreativeDetail(message: CanvasAssistantMessage): CanvasCreativeDetail | undefined {
    const detail = message.detail as Partial<CanvasCreativeDetail> | undefined;
    return detail?.kind === "creative-interaction" && detail.state?.schemaVersion === 1 ? detail as CanvasCreativeDetail : undefined;
}

// 历史中的失败方案也按当前模型目录校验，将真实错误反馈给原 Agent，而不是丢掉失败的工具参数。
export function creativeProposalFailure(detail: CanvasCreativeDetail, config: AiConfig): string | undefined {
    if (!detail.input.proposal || detail.state.proposal || detail.state.questions?.questions.length) return;
    try {
        const proposal = normalizeCreativeProposal(detail.input.proposal, "validation", 1, config, detail.state.references);
        assertCreativeBriefSpecifications(proposal, detail.state.brief);
    } catch (cause) {
        return generationErrorMessage(cause);
    }
}

type Props = {
    message: CanvasAssistantMessage; sessionId: string; active: boolean; superseded?: boolean; config: AiConfig; canvas: CreativeCanvasAdapter;
    onUpdate: (message: CanvasAssistantMessage) => void;
    onContinue: (text: string) => void;
    onReview: () => void;
    onEditPrompt: (text: string) => void;
    onBusy: (id: string, busy: boolean) => void;
};

// 嵌入原助手消息，不拥有输入框、会话列表或模型选择。detail 保存回看快照，run 保存执行事实。
export function CanvasCreativeInteraction(props: Props) {
    const { t } = useTranslation();
    const detail = canvasCreativeDetail(props.message)!;
    const [view, setView] = useState<CreativeControllerView>({ state: detail.state, busy: false, hasControl: false });
    const [error, setError] = useState("");
    const [answers, setAnswers] = useState<CreativeAnswers>(detail.state.answers || {});
    const controller = useRef<CreativeAgentController | null>(null);
    const latest = useRef(props); latest.current = props;
    const saved = useRef("");
    const quoteHistory = useRef<CreativeQuote[]>(detail.quotes || []);
    const answersEdited = useRef(false);
    const presentationAttempted = useRef(false);
    const hadControl = useRef(false);
    const scope = getActiveUserScope();
    const invoke = (promise?: Promise<unknown>) => { if (promise) { setError(""); void promise.catch((cause) => { if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(generationErrorMessage(cause)); }); } };

    useEffect(() => {
        let live = true;
        presentationAttempted.current = false;
        hadControl.current = false;
        const original = canvasCreativeDetail(latest.current.message)!;
        setView({ state: original.state, busy: false, hasControl: false });
        const instance = new CreativeAgentController({
            clientKey: `canvas-chat:${props.sessionId}:${props.message.id}`,
            config: () => latest.current.config,
            canvas: () => latest.current.canvas,
            onOpenCanvas: () => setError(translate("canvasA.creative.otherCanvas")),
            onChange: (next) => {
                if (!live) return;
                // Recovery clears the controller error and the rejected action's local UI error together.
                if (next.hasControl && !hadControl.current && !next.error) setError("");
                hadControl.current = next.hasControl;
                setView(next); latest.current.onBusy(props.message.id, next.busy);
                if (!next.run || !latest.current.active) return;
                if (next.quote) quoteHistory.current = [...quoteHistory.current.filter((quote) => quote.id !== next.quote!.id), next.quote];
                const nextDetail: CanvasCreativeDetail = { kind: "creative-interaction", input: original.input, state: next.state, runId: next.run.id, status: next.run.status, quotes: quoteHistory.current, approvedProposalVersion: next.run.approvedProposalVersion };
                const signature = JSON.stringify(nextDetail);
                if (signature !== saved.current) {
                    saved.current = signature;
                    latest.current.onUpdate({ ...latest.current.message, detail: nextDetail });
                }
            },
        });
        controller.current = instance;
        const initialize = async () => {
            if (!original.runId && !props.active) return;
            await instance.load(original.runId, original.state, !props.active);
        };
        invoke(initialize());
        return () => { live = false; instance.dispose(); latest.current.onBusy(props.message.id, false); if (controller.current === instance) controller.current = null; };
    }, [props.message.id, props.sessionId, props.canvas.canvasId, props.active, scope]);

    useEffect(() => {
        if (!props.active || !view.hasControl || view.busy || view.state.externalInteractionPresented || presentationAttempted.current) return;
        presentationAttempted.current = true;
        invoke(controller.current?.presentInteraction(detail.input));
    }, [props.active, view.hasControl, view.busy, view.state.externalInteractionPresented]);

    const question = view.state.questions;
    const answerKey = `canvas-creative-answers:${scope}:${props.sessionId}:${props.message.id}:${question?.interactionId || ""}`;
    useEffect(() => {
        let live = true;
        answersEdited.current = false;
        setAnswers(view.state.answers || {});
        if (question?.status === "pending") void localforage.getItem<CreativeAnswers>(answerKey).then((value) => { if (live && !answersEdited.current && value) setAnswers(value); }).catch(() => undefined);
        return () => { live = false; };
    }, [answerKey, question?.status]);
    const blocked = !props.active || !view.hasControl || view.busy;
    const status = view.run?.status || detail.status;
    const awaitingProposal = status === "waiting_proposal" && !view.state.modificationRequested && !view.state.pendingEdits;
    const proposalFailure = creativeProposalFailure({ ...detail, state: view.state }, props.config);
    const modify = (text: string) => {
        if (!props.active) { props.onEditPrompt(text); return; }
        invoke(controller.current?.requestModification().then(() => props.onEditPrompt(text)));
    };
    const continueWork = async () => {
        const instance = controller.current;
        if (!instance) return;
        await instance.takeControl();
        if (proposalFailure) { props.onContinue("请根据当前真实素材和校验反馈调整方案。能自行修正的请修正，需要我提供信息时请直接提问，仍须确认后才制作。"); return; }
        if (detail.input.proposal && !view.state.proposal) { await instance.presentInteraction(detail.input, true); return; }
        if (view.quote && Date.parse(view.quote.expiresAt || "") <= Date.now()) { await instance.refreshQuotes(); return; }
        if (["running", "paused", "waiting_canvas", "waiting_task"].includes(status || "")) { await instance.resume(); return; }
        props.onContinue("保留已确认的要求，在已授权范围内继续当前任务，自行处理常规选择和技术问题；确实阻塞时再询问。");
    };
    const rawError = proposalFailure || error || view.error;
    const userError = rawError ? generationErrorMessage(rawError) : undefined;
    const failedGenerations = view.state.media.filter((item) => item.status === "failed" && item.failureKind !== "observation");
    const onlyFailedRemaining = failedGenerations.length > 0 && !view.state.media.some((item) => ["queued", "running", "write_failed"].includes(item.status) || item.failureKind === "observation" && item.status === "failed");
    const feedback = onlyFailedRemaining ? t("canvasA.creative.partialFailed") : userError ? /恢复|连接|网络|接管|执行权|代次/.test(userError) ? t("canvasA.creative.feedbackRecover")
        : /报价|费用|价格|过期/.test(userError) ? t("canvasA.creative.feedbackQuote")
        : /素材|参考|引用/.test(userError) ? t("canvasA.creative.feedbackReferences")
        : t("canvasA.creative.feedbackIncomplete") : undefined;
    const submitAnswers = async (submitted: CreativeAnswers) => {
        await controller.current!.answer(submitted, false);
        await localforage.removeItem(answerKey).catch(() => undefined);
        const summary = question!.questions.map((item) => {
            const answer = submitted[item.id];
            const options = item.type === "asset" ? view.state.references.map((ref) => ({ id: ref.id, label: ref.title })) : item.options;
            return `${item.title}：${[...(answer?.selected || []).map((id) => options.find((option) => option.id === id)?.label || id), answer?.custom].filter(Boolean).join("、") || "由助手建议"}`;
        }).join("\n");
        latest.current.onContinue(summary);
    };

    return <div className="space-y-3" data-canvas-no-zoom data-canvas-wheel-scroll>
        {question && <CreativeQuestionCard request={props.superseded && question.status === "pending" ? { ...question, status: "superseded" } : question} answers={answers} assets={view.state.references.map((ref) => ({ id: ref.id, label: ref.title }))} busy={view.busy} disabled={!props.active || !view.hasControl} onModify={() => modify(`我想修改之前的回答（${question.questions.map((item) => item.title).join("、")}）：`)} onAnswersChange={(next) => { answersEdited.current = true; setAnswers(next); invoke(localforage.setItem(answerKey, next)); }} onSubmit={submitAnswers} />}
        {view.state.proposal && <CreativeProposalCard proposal={view.state.proposal} archived={!props.active || !awaitingProposal} modifiable={!view.busy} disabled={props.active ? blocked : false} busy={view.busy} onApprove={() => invoke(controller.current?.approveProposal())} onModify={() => modify(`请修改方案《${view.state.proposal!.title}》：`)} onRedirect={() => modify("保留已确认的要求和素材，换一个创意方向。")} />}
        {view.state.pendingEdits && <div className="creative-agent-card"><p>{t("canvasA.creative.pendingEdits", { count: view.state.pendingEdits.length })}</p><Button disabled={blocked} onClick={() => invoke(controller.current?.approveEdits())}>{t("canvasA.creative.approveEdits")}</Button></div>}
        {props.active && view.quote && <CreativeQuoteCard quote={view.quote} busy={view.busy} disabled={blocked} onApprove={() => invoke(controller.current?.approvePayment())} onRefresh={() => invoke(controller.current?.refreshQuotes())} />}
        {(detail.quotes || []).filter((quote) => !props.active || quote.id !== view.quote?.id).map((quote) => <details key={quote.id} className="creative-agent-receipt"><summary>{t("canvasA.creative.quoteSummary", { status: quote.approvedQuantity ? t("canvasA.creative.quoteApproved") : t("canvasA.creative.quoteHistory"), amount: quote.amountLabel, count: quote.items.length })}</summary><p>{quote.basis}</p><ul>{quote.items.map((item) => <li key={item.id}>{item.label} · {item.model} · {item.specification}</li>)}</ul></details>)}
        {view.state.media.filter((item) => item.taskId || item.storageKey || item.error).map((item) => {
            const hasResource = Boolean(resourceIdFromStorageKey(item.storageKey));
            const video = view.state.proposal?.generationItems.find((entry) => entry.ref === item.ref)?.mode === "video";
            return <div className="creative-agent-card" key={item.ref}>
                <strong>{view.state.proposal?.workflow.nodes.find((node) => node.ref === item.ref)?.title || item.ref}</strong>
                {!item.error && !hasResource && item.taskId && <p className="creative-agent-muted">{view.busy ? item.status === "running" ? t("canvasA.creative.mediaRunning") : t("canvasA.creative.mediaQueued") : t("canvasA.creative.mediaSubmitted")}</p>}
                {hasResource ? <CreativeAgentMedia storageKey={item.storageKey!} video={video} alt={item.ref} actions={props.active ? <Dropdown trigger={["click"]} disabled={blocked} menu={{ items: [{ key: "adjust", label: t("canvasA.creative.adjust") }, { key: "redo", label: t("canvasA.creative.redoMenu") }], onClick: ({ key }) => key === "redo" ? invoke(controller.current?.redo(item.ref)) : modify(`请调整《${view.state.proposal?.workflow.nodes.find((entry) => entry.ref === item.ref)?.title || item.ref}》，保留其他作品：`) }}><Button type="text" disabled={blocked}>{t("canvasA.creative.more")}</Button></Dropdown> : null} /> : null}
                {item.error && <p className="creative-agent-muted">{t("canvasA.creative.itemNeedsWork")}</p>}
                {item.error && <details className="creative-agent-receipt"><summary>{t("canvasA.creative.viewFailure")}</summary><p>{generationErrorMessage(item.error)}</p></details>}
                {props.active && item.status === "failed" && item.failureKind !== "observation" && <Button type="primary" disabled={blocked} onClick={() => invoke(controller.current?.redo(item.ref))}>{t("canvasA.creative.redoItem")}</Button>}
                {!hasResource && props.active ? <div className="creative-agent-actions"><Dropdown trigger={["click"]} disabled={blocked} menu={{ items: [{ key: "adjust", label: t("canvasA.creative.adjust") }, { key: "redo", label: t("canvasA.creative.redoMenu") }], onClick: ({ key }) => key === "redo" ? invoke(controller.current?.redo(item.ref)) : modify(`请调整《${view.state.proposal?.workflow.nodes.find((entry) => entry.ref === item.ref)?.title || item.ref}》，保留其他作品：`) }}><Button type="text" disabled={blocked}>{t("canvasA.creative.more")}</Button></Dropdown></div> : null}
            </div>;
        })}
        {!props.active && userError && <details className="creative-agent-receipt"><summary>{t("canvasA.creative.archivedIncomplete")}</summary><p>{feedback}</p></details>}
        {props.active && <div className="creative-agent-next" role="status">
            <p>{view.busy ? t("canvasA.creative.nextBusy") : !view.hasControl ? userError ? t("canvasA.creative.nextRecoverFailed") : t("canvasA.creative.nextRecovering") : view.state.modificationRequested ? t("canvasA.creative.nextModify") : feedback || (view.quote ? t("canvasA.creative.nextQuote") : awaitingProposal ? t("canvasA.creative.nextProposal") : question?.status === "pending" ? t("canvasA.creative.nextQuestion") : status === "completed" ? t("canvasA.creative.nextCompleted") : t("canvasA.creative.nextReady"))}</p>
            <div className="creative-agent-actions">
                {!view.busy && !view.hasControl && <Button onClick={() => invoke(view.run ? controller.current?.takeControl() : controller.current?.load(detail.runId, detail.state))}>{t("canvasA.creative.retryConnect")}</Button>}
                {view.busy && ["running", "waiting_task", "waiting_canvas"].includes(status || "") ? <Button onClick={() => invoke(controller.current?.pause())}>{t("canvasA.creative.stop")}</Button>
                    : !view.busy && view.hasControl && !view.state.modificationRequested && !view.quote && !awaitingProposal && !view.state.pendingEdits && question?.status !== "pending" ? <>
                        {!onlyFailedRemaining && <Button type="primary" onClick={() => status === "completed" && !feedback ? props.onReview() : invoke(continueWork())}>{status === "completed" && !feedback ? t("canvasA.creative.continueCreating") : t("canvasA.creative.continueWork")}</Button>}
                        <Button onClick={() => modify("我想调整当前创作要求：")}>{t("canvasA.creative.modify")}</Button>
                    </> : null}
            </div>
            {status === "paused" && <small className="creative-agent-muted">{t("canvasA.creative.pausedNote")}</small>}
        </div>}
    </div>;
}

function CreativeAgentMedia({ storageKey, video, alt, actions }: { storageKey: string; video: boolean; alt: string; actions?: ReactNode }) {
    const { t } = useTranslation();
    const [url, setUrl] = useState("");
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setUrl("");
        setFailed(false);
        void resolveMediaUrl(storageKey)
            .then((resolved) => {
                if (!cancelled) setUrl(resolved);
            })
            .catch(() => {
                if (!cancelled) setFailed(true);
            });
        return () => {
            cancelled = true;
        };
    }, [storageKey]);

    return <>
        {url ? (video ? <video className="w-full max-h-80 object-contain" src={url} controls preload="metadata" /> : <img className="w-full max-h-80 object-contain" src={url} alt={alt} />) : <p className="creative-agent-muted">{failed ? t("canvasA.creative.mediaUrlFailed") : t("canvasA.creative.mediaLoading")}</p>}
        <div className="creative-agent-actions">{url ? <a href={url} target="_blank" rel="noreferrer">{t("canvasA.creative.viewMedia")}</a> : null}{actions}</div>
    </>;
}

export function creativeInteractionSeed(history: CanvasAssistantMessage[]): CreativeAgentState {
    const previous = history.findLast((message) => canvasCreativeDetail(message));
    const state = previous ? canvasCreativeDetail(previous)!.state : initialCreativeState();
    return { ...initialCreativeState(), scene: state.scene, brief: state.brief, references: state.references, dynamicPlan: snapshotCreativePlan(state),
        messages: history.filter((message) => message.role === "user" || message.role === "assistant").slice(-30).map((message) => ({ id: message.id, role: message.role as "user" | "assistant", text: message.text })),
    };
}
