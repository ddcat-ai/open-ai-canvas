import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Dropdown } from "antd";
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
        return cause instanceof Error ? cause.message : "方案结构未通过校验";
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
    const invoke = (promise?: Promise<unknown>) => { if (promise) { setError(""); void promise.catch((cause) => { if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "操作未完成"); }); } };

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
            onOpenCanvas: () => setError("当前会话仅操作所在画布，请在对应画布打开历史会话。"),
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
    const failedGenerations = view.state.media.filter((item) => item.status === "failed" && item.failureKind !== "observation");
    const onlyFailedRemaining = failedGenerations.length > 0 && !view.state.media.some((item) => ["queued", "running", "write_failed"].includes(item.status) || item.failureKind === "observation" && item.status === "failed");
    const feedback = onlyFailedRemaining ? "部分作品生成失败。请在失败作品下方重新生成，先核对费用；已成功的作品会保留。" : rawError ? /恢复|连接|网络|接管|执行权|代次/.test(rawError) ? "状态读取未完成，可以继续处理重试。已有作品会保留。"
        : /报价|费用|价格|过期/.test(rawError) ? "生成费用需要重新确认，继续后会显示最新价格。"
        : /素材|参考|引用/.test(rawError) ? "参考素材还需要核对，助手会继续处理，必要时请你选择。"
        : "这一步还没有完成。已有内容已保留，可以继续处理或修改要求。" : undefined;
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
        {view.state.pendingEdits && <div className="creative-agent-card"><p>将调整 {view.state.pendingEdits.length} 个节点的指定字段。</p><Button disabled={blocked} onClick={() => invoke(controller.current?.approveEdits())}>确认节点调整</Button></div>}
        {props.active && view.quote && <CreativeQuoteCard quote={view.quote} busy={view.busy} disabled={blocked} onApprove={() => invoke(controller.current?.approvePayment())} onRefresh={() => invoke(controller.current?.refreshQuotes())} />}
        {(detail.quotes || []).filter((quote) => !props.active || quote.id !== view.quote?.id).map((quote) => <details key={quote.id} className="creative-agent-receipt"><summary>{quote.approvedQuantity ? "已确认生成" : "历史报价"} · {quote.amountLabel} · {quote.items.length} 项</summary><p>{quote.basis}</p><ul>{quote.items.map((item) => <li key={item.id}>{item.label} · {item.model} · {item.specification}</li>)}</ul></details>)}
        {view.state.media.filter((item) => item.taskId || item.storageKey || item.error).map((item) => {
            const hasResource = Boolean(resourceIdFromStorageKey(item.storageKey));
            const video = view.state.proposal?.generationItems.find((entry) => entry.ref === item.ref)?.mode === "video";
            return <div className="creative-agent-card" key={item.ref}>
                <strong>{view.state.proposal?.workflow.nodes.find((node) => node.ref === item.ref)?.title || item.ref}</strong>
                {!item.error && !hasResource && item.taskId && <p className="creative-agent-muted">{view.busy ? item.status === "running" ? "正在生成，完成后自动显示。" : "已提交，正在等待生成结果。" : "任务已提交。点击下方“继续处理”读取最新结果，无需重复确认费用。"}</p>}
                {hasResource ? <CreativeAgentMedia storageKey={item.storageKey!} video={video} alt={item.ref} actions={props.active ? <Dropdown trigger={["click"]} disabled={blocked} menu={{ items: [{ key: "adjust", label: "调整作品" }, { key: "redo", label: "重新生成（费用另行确认）" }], onClick: ({ key }) => key === "redo" ? invoke(controller.current?.redo(item.ref)) : modify(`请调整《${view.state.proposal?.workflow.nodes.find((entry) => entry.ref === item.ref)?.title || item.ref}》，保留其他作品：`) }}><Button type="text" disabled={blocked}>更多</Button></Dropdown> : null} /> : null}
                {item.error && <p className="creative-agent-muted">这项作品还需要处理，已有结果会保留。</p>}
                {item.error && <details className="creative-agent-receipt"><summary>查看失败原因</summary><p>{item.error}</p></details>}
                {props.active && item.status === "failed" && item.failureKind !== "observation" && <Button type="primary" disabled={blocked} onClick={() => invoke(controller.current?.redo(item.ref))}>重新生成此项 · 先确认费用</Button>}
                {!hasResource && props.active ? <div className="creative-agent-actions"><Dropdown trigger={["click"]} disabled={blocked} menu={{ items: [{ key: "adjust", label: "调整作品" }, { key: "redo", label: "重新生成（费用另行确认）" }], onClick: ({ key }) => key === "redo" ? invoke(controller.current?.redo(item.ref)) : modify(`请调整《${view.state.proposal?.workflow.nodes.find((entry) => entry.ref === item.ref)?.title || item.ref}》，保留其他作品：`) }}><Button type="text" disabled={blocked}>更多</Button></Dropdown></div> : null}
            </div>;
        })}
        {!props.active && rawError && <details className="creative-agent-receipt"><summary>这一步未完成，后续对话中可继续调整</summary><p>{feedback}</p></details>}
        {props.active && <div className="creative-agent-next" role="status">
            <p>{view.busy ? "正在处理，请稍候…" : !view.hasControl ? rawError ? "暂时无法恢复当前创作，可以重试连接。已有作品会保留。" : "正在恢复当前创作，请稍候…" : view.state.modificationRequested ? "在下方告诉我想改哪里，调整后再确认。" : feedback || (view.quote ? "确认费用后，就开始本批制作。" : awaitingProposal ? "看看方案是否符合你的想法，确认后继续。" : question?.status === "pending" ? "选择一个答案，也可以在下方直接补充。" : status === "completed" ? "本阶段已完成。可以查看作品，或告诉我想改哪里。" : "准备好了，可以继续。")}</p>
            <div className="creative-agent-actions">
                {!view.busy && !view.hasControl && <Button onClick={() => invoke(view.run ? controller.current?.takeControl() : controller.current?.load(detail.runId, detail.state))}>重试连接</Button>}
                {view.busy && ["running", "waiting_task", "waiting_canvas"].includes(status || "") ? <Button onClick={() => invoke(controller.current?.pause())}>停止后续制作</Button>
                    : !view.busy && view.hasControl && !view.state.modificationRequested && !view.quote && !awaitingProposal && !view.state.pendingEdits && question?.status !== "pending" ? <>
                        {!onlyFailedRemaining && <Button type="primary" onClick={() => status === "completed" && !feedback ? props.onReview() : invoke(continueWork())}>{status === "completed" && !feedback ? "继续创作" : "继续处理"}</Button>}
                        <Button onClick={() => modify("我想调整当前创作要求：")}>修改</Button>
                    </> : null}
            </div>
            {status === "paused" && <small className="creative-agent-muted">已停止后续制作。已提交的生成可能仍在处理，已有作品不会删除。</small>}
        </div>}
    </div>;
}

function CreativeAgentMedia({ storageKey, video, alt, actions }: { storageKey: string; video: boolean; alt: string; actions?: ReactNode }) {
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
        {url ? (video ? <video className="w-full max-h-80 object-contain" src={url} controls preload="metadata" /> : <img className="w-full max-h-80 object-contain" src={url} alt={alt} />) : <p className="creative-agent-muted">{failed ? "作品地址读取失败，请刷新后重试。" : "正在读取作品…"}</p>}
        <div className="creative-agent-actions">{url ? <a href={url} target="_blank" rel="noreferrer">查看作品</a> : null}{actions}</div>
    </>;
}

export function creativeInteractionSeed(history: CanvasAssistantMessage[]): CreativeAgentState {
    const previous = history.findLast((message) => canvasCreativeDetail(message));
    const state = previous ? canvasCreativeDetail(previous)!.state : initialCreativeState();
    return { ...initialCreativeState(), scene: state.scene, brief: state.brief, references: state.references, dynamicPlan: snapshotCreativePlan(state),
        messages: history.filter((message) => message.role === "user" || message.role === "assistant").slice(-30).map((message) => ({ id: message.id, role: message.role as "user" | "assistant", text: message.text })),
    };
}
