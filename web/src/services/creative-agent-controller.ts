import { nanoid } from "nanoid";
import { applyCanvasOperations, type CanvasOperation, type CanvasSnapshot } from "@/lib/canvas/canvas-operation-contract";
import { buildCanvasContext } from "@/lib/canvas/canvas-context-discovery";
import { applyCreativeAnswers, creativeScenarioPrompt, normalizeCreativeQuestions, CREATIVE_SCENARIOS, type CreativeAnswers, type CreativeQuote } from "@/lib/creation/creative-agent-contract";
import { assertCreativeBriefSpecifications, creativeNodeId, creativeProposalOps, initialCreativeState, mergeCreativeBrief, normalizeCreativeProposal, readCreativeState, type CreativeAgentState, type CreativeMediaState } from "@/lib/creation/creative-agent-state";
import { CREATIVE_AGENT_SYSTEM_PROMPT, CREATIVE_AGENT_TOOLS, parseCreativeToolArguments } from "@/lib/creation/creative-agent-tools";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { submittedProducedModel } from "@/lib/canvas/produced-model";
import { getActiveUserScope } from "@/lib/user-scope";
import { logicalModelIDForConfig, modelDisplayName, resolveModelRequestConfig, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { creationRuns, type CreationGuard, type CreationRun, type CreationRunDetail, type CreationStatus, type CreationSubmission } from "./api/creation-runs";
import { parseBackendGenerationResult, prepareBackendGenerationTask, prepareBackendToolGenerationTask } from "./api/generation-task";
import { queryGenerationTask, waitForGenerationTask, type GenerationTask } from "./api/task-center";
import { resourceFileUrl, resourceIdFromStorageKey } from "./api/resources";
import type { ResponseInputMessage, ResponseToolCall } from "./api/image";
import { listAddedSkills } from "./api/skills";
import { skillRuntime } from "./skill-runtime";
import { ensureCanvasNodeAsset } from "./project-asset-sync";
import { withRemoteUserDataSyncExclusive } from "./user-data-sync";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { creativeVideoSpecificationError } from "@/lib/creation/creative-agent-state";
import { updateCreativePlan } from "@/lib/creation/creative-plan";

export type CreativeCanvasAdapter = { canvasId: string; read: () => CanvasSnapshot; apply: (ops: CanvasOperation[]) => Promise<CanvasSnapshot> };
export type CreativeControllerView = { run?: CreationRun; state: CreativeAgentState; busy: boolean; hasControl: boolean; error?: string; quote?: CreativeQuote };
type ControllerOptions = { clientKey?: string; config: () => AiConfig; canvas: () => CreativeCanvasAdapter | undefined; onChange: (view: CreativeControllerView) => void; onOpenCanvas: (canvasId: string, runId: string) => void; api?: typeof creationRuns; waitTask?: typeof waitForGenerationTask; queryTask?: typeof queryGenerationTask; ensureAsset?: typeof ensureCanvasNodeAsset };

// 单一浏览器执行器；运行事实和费用批准以服务端记录为准，页面只提供就绪的画布适配器。
export class CreativeAgentController {
    private run?: CreationRun;
    private state = initialCreativeState();
    private submissions: CreationSubmission[] = [];
    private owner = nanoid();
    private scope = getActiveUserScope();
    private abort = new AbortController();
    private busy = false;
    private hasControl = false;
    private disposed = false;
    private heartbeat?: ReturnType<typeof setInterval>;
    private error?: string;
    private api: typeof creationRuns;
    private waitTask: typeof waitForGenerationTask;
    private queryTask: typeof queryGenerationTask;
    private getAsset() { return this.options.ensureAsset || ensureCanvasNodeAsset; }
    constructor(private options: ControllerOptions) { this.api = options.api || creationRuns; this.waitTask = options.waitTask || waitForGenerationTask; this.queryTask = options.queryTask || queryGenerationTask; }

    private emit() { if (!this.disposed) this.options.onChange({ run: this.run, state: this.state, busy: this.busy, hasControl: this.hasControl, error: this.error, quote: this.quote() }); }
    private assertLive() { if (this.disposed || this.abort.signal.aborted || this.scope !== getActiveUserScope()) throw new DOMException("执行已停止或账号已切换", "AbortError"); }
    private guard(): CreationGuard { this.assertLive(); if (!this.run || !this.hasControl) throw new Error("请先接管当前任务，再继续操作"); return { owner: this.owner, executionEpoch: this.run.executionEpoch }; }
    private accept(detail: CreationRunDetail) { this.run = detail.run; this.state = readCreativeState(detail.run.state); this.submissions = detail.submissions || []; }
    private async save(status: CreationStatus = this.run?.status || "idle") {
        const guard = this.guard();
        this.run = await this.api.save(this.run!.id, { ...guard, revision: this.run!.revision, status, state: this.state as unknown as Record<string, unknown> }, this.abort.signal);
        this.assertLive(); this.emit();
    }
    private async action(operation: () => Promise<void>, takeOver = false) {
        if (this.busy) throw new Error("上一项操作仍在处理，请稍候");
        if (this.disposed || this.scope !== getActiveUserScope()) throw new DOMException("页面已关闭", "AbortError");
        this.busy = true; this.error = undefined; this.emit();
        try { if (this.run) await this.ensureControl(takeOver); await operation(); }
        catch (error) {
            if (!this.disposed && !(error instanceof DOMException && error.name === "AbortError")) { this.error = error instanceof Error ? error.message : "操作未完成"; this.emit(); }
            throw error;
        } finally { this.busy = false; this.emit(); }
    }

    async load(runId?: string, seed?: Partial<CreativeAgentState>, readOnly = false) {
        await this.action(async () => {
            if (runId) this.accept(await this.api.get(runId, this.abort.signal));
            else this.accept(await this.api.create({ clientKey: this.options.clientKey || nanoid(), canvasId: this.options.canvas()?.canvasId, state: { ...initialCreativeState(), ...seed } }, this.abort.signal));
            this.assertLive();
            if (!readOnly) {
                this.startHeartbeat();
                await this.ensureControl(true);
            }
            this.emit();
        });
    }
    private async claim() {
        this.run = await this.api.claim(this.run!.id, { expectedEpoch: this.run!.executionEpoch, owner: this.owner }, this.abort.signal);
        this.assertLive(); this.hasControl = true;
        this.startHeartbeat();
    }
    private startHeartbeat() {
        if (this.heartbeat) return;
        this.heartbeat = setInterval(() => {
            if (this.disposed || !this.run) return;
            if (!this.hasControl) {
                if (!this.busy) void this.ensureControl().then(() => { this.error = undefined; this.emit(); }).catch((error) => {
                    if (this.disposed) return;
                    this.error = error instanceof Error ? error.message : "连接恢复失败，请重试";
                    this.emit();
                });
                return;
            }
            if (this.abort.signal.aborted) return;
            void this.api.heartbeat(this.run.id, this.guard(), this.abort.signal).then((result) => {
                if (!this.disposed && this.run) this.run = { ...this.run, leaseExpiresAt: result.leaseExpiresAt };
            }).catch(() => { if (this.disposed) return; this.hasControl = false; this.abort.abort(); this.error = "连接暂时中断，正在恢复。已有作品会保留。"; this.emit(); });
        }, 15_000);
    }
    private restoring?: Promise<void>;
    private async ensureControl(takeOver = false): Promise<void> {
        if (this.hasControl && !this.abort.signal.aborted && Date.parse(this.run?.leaseExpiresAt || "") > Date.now() + 3000) return;
        if (this.restoring) {
            if (!takeOver) return this.restoring;
            try { await this.restoring; } catch { /* Explicit reconnect retries after the passive recovery attempt. */ }
            return this.ensureControl(true);
        }
        this.restoring = (async () => {
            if (this.disposed || this.scope !== getActiveUserScope()) throw new DOMException("页面已关闭", "AbortError");
            if (this.abort.signal.aborted) this.abort = new AbortController();
            const detail = await this.api.get(this.run!.id, this.abort.signal);
            this.assertLive();
            const run = detail.run;
            if (!takeOver && run.executionOwner && run.executionOwner !== this.owner && Date.parse(run.leaseExpiresAt || "") > Date.now()) throw new Error("当前创作连接已切换，请点击重试连接继续。");
            // Only replace the lease here; never overwrite local edits or unknown submission results.
            this.run = { ...this.run!, executionOwner: run.executionOwner, executionEpoch: run.executionEpoch, leaseExpiresAt: run.leaseExpiresAt };
            await this.claim();
        })();
        try { await this.restoring; } finally { this.restoring = undefined; }
    }
    async takeControl() {
        if (this.disposed) return;
        await this.action(async () => { this.accept(await this.api.get(this.run!.id, this.abort.signal)); }, true);
    }
    async refresh() { await this.action(async () => { this.accept(await this.api.get(this.run!.id, this.abort.signal)); }); }
    dispose() {
        this.disposed = true; this.abort.abort(); if (this.heartbeat) clearInterval(this.heartbeat);
        if (this.hasControl && this.run) void this.api.release(this.run.id, { executionEpoch: this.run.executionEpoch, owner: this.owner }).catch(() => undefined);
        this.hasControl = false;
    }
    async pause() {
        if (!this.hasControl || !this.run) return;
        const guard = this.guard();
        this.abort.abort();
        this.state = { ...this.state, error: "已暂停后续操作。已提交的生成任务仍可在任务中心继续运行。" };
        try {
            this.run = await this.api.save(this.run.id, { ...guard, revision: this.run.revision, status: "paused", state: this.state as unknown as Record<string, unknown> });
        } finally {
            try { await this.api.release(this.run.id, guard); }
            finally { this.hasControl = false; this.startHeartbeat(); this.emit(); }
        }
    }
    async configure(patch: Pick<CreativeAgentState, "scene" | "references" | "selectedSkillIds" | "textModel">) { await this.action(async () => { this.state = { ...this.state, ...patch }; await this.save(); }); }

    async requestModification() {
        await this.action(async () => {
            if (this.state.media.some((item) => ["queued", "running"].includes(item.status))) throw new Error("已有生成还在处理，请继续处理以同步结果，完成后再修改方案。");
            this.run = await this.api.invalidateProposal(this.run!.id, { ...this.guard(), revision: this.run!.revision }, this.abort.signal);
            this.state = { ...this.state, modificationRequested: true, pendingPayment: undefined, pendingEdits: undefined, pendingRedo: undefined };
            await this.save("idle");
        });
    }

    async send(text: string) {
        if (!text.trim()) return;
        await this.action(async () => {
            this.guard();
            if (this.state.media.some((item) => ["queued", "running"].includes(item.status))) throw new Error("请先暂停或等当前生成完成，再调整需求；已提交任务不会被文字修改取消");
            if (this.run?.approvedProposalVersion) this.run = await this.api.invalidateProposal(this.run.id, { ...this.guard(), revision: this.run.revision }, this.abort.signal);
            this.state = { ...this.state, questions: undefined, answers: undefined, pendingPayment: undefined, planning: undefined, pendingEdits: undefined, pendingRedo: undefined, error: undefined, messages: [...this.state.messages, { id: nanoid(), role: "user", text: text.trim() }] };
            await this.save("running");
            await this.preparePlanning(text.trim());
        });
    }
    async answer(answers: CreativeAnswers, continuePlanning = true) {
        await this.action(async () => {
            const question = this.state.questions;
            if (!question) throw new Error("当前没有待回答问题");
            const brief = applyCreativeAnswers(question, question, answers, this.state.brief, this.assets());
            const summary = question.questions.map((item) => `${item.title}：${JSON.stringify(brief[item.field]?.value ?? "由助手建议")}`).join("\n");
            this.state = { ...this.state, brief, questions: { ...question, status: "submitted" }, answers, messages: [...this.state.messages, { id: nanoid(), role: "user", text: summary, question: { ...question, status: "submitted" }, answers }] };
            await this.save(continuePlanning ? "running" : "idle");
            if (continuePlanning) await this.preparePlanning(summary);
        });
    }
    // 原在线 Agent 工具循环已完成模型请求；此入口仅校验并持久化交互，不再调用第二个模型。
    async presentInteraction(data: Record<string, unknown>, revalidate = false) {
        await this.action(async () => {
            this.guard();
            if (revalidate && (this.state.proposal || this.state.canvasApplied || this.run?.approvedProposalVersion || this.state.pendingPayment?.length || this.state.media.some((item) => item.taskId))) throw new Error("此方案已有批准或执行记录，不能重复呈现，请修改方案后重新确认");
            if (this.state.externalInteractionPresented && !revalidate) return;
            this.state = { ...this.state, externalInteractionPresented: true };
            await this.consumePlanning({ resultJson: JSON.stringify({ toolCalls: [{ id: "interaction", type: "function", function: { name: "creative_respond", arguments: JSON.stringify(data) } }] }) } as GenerationTask);
        });
    }
    private assets() { return this.state.references.map((item) => ({ id: item.id, label: item.title })); }
    private requestConfig(model?: string): AiConfig {
        const config = this.options.config(), selected = model || this.state.textModel || config.textModel || config.model;
        const next: AiConfig = { ...config, model: selected, count: "1", taskWorkflowProvider: "model" };
        const requestConfig = resolveModelRequestConfig(next, selected);
        if (!logicalModelIDForConfig(next) && !requestConfig.channelId) throw new Error("智能创作需要系统受管模型，请选择系统模型；自定义渠道和本机模型仍可使用原直接生成入口");
        return next;
    }
    private async preparePlanning(prompt: string) {
        if (this.state.modelCalls >= 32) throw new Error("此任务已达到 32 次分析调用上限，请新建任务并沿用当前方案");
        const config = this.requestConfig();
        const skills = await listAddedSkills();
        const prepared = await skillRuntime.prepare({ profile: "creation", prompt, skills: skills.skills || [], selectedSkillIds: this.state.selectedSkillIds });
        this.assertLive();
        const catalogue = (["image", "video"] as const).flatMap((mode) => selectableModelsByCapability(config, mode).slice(0, 20).map((model) => ({ mode, model, name: modelDisplayName(config, model), capability: modelCapabilityConfigFor(config, model) })));
        const canvas = this.options.canvas();
        const imageReferences = this.state.references.filter((reference) => reference.kind === "image" && reference.storageKey);
        const protocol: ResponseInputMessage[] = [
            { role: "system", content: `${CREATIVE_AGENT_SYSTEM_PROMPT}\n${creativeScenarioPrompt(this.state.scene)}\n用户系统提示：${config.systemPrompt || ""}` },
            ...this.state.messages.slice(-20).map((message) => ({ role: message.role, content: message.text })),
            { role: "user", content: [{ type: "text", text: JSON.stringify({ brief: this.state.brief, proposal: this.state.proposal, availableModels: catalogue, references: this.state.references, canvas: canvas ? buildCanvasContext(canvas.read()) : { available: false, instruction: "首页不能操作画布" }, currentRequest: prepared.prompt }) }, ...imageReferences.map((reference) => ({ type: "image_url" as const, image_url: { url: reference.storageKey! } }))] },
        ];
        const itemKey = `planning:${nanoid()}`;
        this.state = { ...this.state, planning: { itemKey, protocol, model: config.model, prompt }, pendingPayment: undefined };
        await this.save("running");
        await this.ensurePlanningSubmission();
    }
    private async ensurePlanningSubmission() {
        const planning = this.state.planning;
        if (!planning) throw new Error("缺少待恢复的规划内容");
        let submission = this.submissions.find((item) => item.itemKey === planning.itemKey);
        if (!submission) {
            const config = this.requestConfig(planning.model);
            const request = prepareBackendToolGenerationTask({ prompt: planning.prompt || "继续创作", config: { ...config, systemPrompt: "" }, messages: planning.protocol, tools: CREATIVE_AGENT_TOOLS, toolChoice: "auto", signal: this.abort.signal });
            request.input = { ...request.input, referenceImages: this.state.references.filter((reference) => reference.kind === "image" && reference.storageKey).map((reference) => ({ id: reference.id, name: reference.title, storageKey: reference.storageKey })) };
            submission = await this.api.prepare(this.run!.id, { ...this.guard(), itemKey: planning.itemKey, request }, this.abort.signal);
        }
        this.assertLive(); this.upsertSubmission(submission);
        this.state = { ...this.state, planning: { ...planning, submissionId: submission.id }, pendingPayment: [submission.id] };
        await this.save("waiting_payment");
    }
    private upsertSubmission(submission: CreationSubmission) { this.submissions = [...this.submissions.filter((item) => item.id !== submission.id), submission]; }
    private quote(): CreativeQuote | undefined {
        // pendingPayment also retains submitted IDs for recovery; only unsubmitted items need a fee card.
        const pending = this.state.pendingPayment?.map((id) => this.submissions.find((item) => item.id === id)).filter((item): item is CreationSubmission => Boolean(item && !item.taskId && !item.revokedAt));
        if (!pending?.length) return undefined;
        const amount = pending.reduce((sum, item) => sum + item.quote.amountMicrocredits, 0);
        const estimated = pending.some((item) => item.quote.estimated);
        return { id: pending.map((item) => item.id).join(":"), title: this.state.planning && !this.state.planning.consumed ? "确认本次理解与规划费用" : "确认本批生成费用", items: pending.map((item) => { const media = this.state.media.find((media) => media.submissionId === item.id); const node = this.state.proposal?.workflow.nodes.find((node) => node.ref === media?.ref); return { id: item.id, label: node?.title || "理解需求并生成问答或方案", model: item.quote.model, quantity: 1, specification: [...Object.entries(item.quote.options || {}).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => `${({ size: "比例/尺寸", videoSeconds: "时长（秒）", vquality: "清晰度", quality: "质量", count: "数量" } as Record<string, string>)[key] || key}：${String(value)}`), `${item.quote.billingMode === "token" ? "按用量" : item.quote.billingMode === "per_second" ? "按秒" : "按次"}计费，本项${item.quote.estimated ? "预计" : ""} ${(item.quote.amountMicrocredits / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 6 })} 积分`].join(" · ") }; }), amountLabel: `${estimated ? "预计 " : ""}${(amount / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 6 })} 积分`, basis: estimated ? "按实际用量结算，此金额为估算，不是费用上限。仅批准列出的调用。" : "按当前报价，仅批准本批列出的生成项。", expiresAt: pending.map((item) => item.quote.expiresAt).sort()[0], approvedQuantity: pending.filter((item) => item.approvedAt).length };
    }

    async approvePayment() {
        const expiresAt = this.quote()?.expiresAt;
        if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
            await this.refreshQuotes();
            return;
        }
        await this.action(async () => {
            const ids = this.state.pendingPayment;
            if (!ids?.length) throw new Error("当前没有待批准费用");
            const unapproved = ids.filter((id) => { const item = this.submissions.find((item) => item.id === id); return item && !item.taskId && !item.approvedAt && !item.revokedAt; });
            if (this.run!.status === "paused") await this.save("waiting_payment");
            if (unapproved.length) {
                const result = await this.api.approve(this.run!.id, { ...this.guard(), submissionIds: unapproved }, this.abort.signal);
                result.submissions.forEach((item) => this.upsertSubmission(item));
            }
            await this.executeApproved(ids);
        });
    }
    async refreshQuotes() {
        await this.action(async () => {
            if (!this.state.pendingPayment?.length) throw new Error("当前没有待更新报价");
            for (const id of [...this.state.pendingPayment]) {
                if (this.submissions.find((item) => item.id === id)?.taskId) continue;
                const next = await this.api.refreshQuote(this.run!.id, { ...this.guard(), submissionId: id }, this.abort.signal);
                this.guard(); this.upsertSubmission(next);
                this.state = { ...this.state,
                    pendingPayment: this.state.pendingPayment!.map((item) => item === id ? next.id : item),
                    planning: this.state.planning?.submissionId === id ? { ...this.state.planning, submissionId: next.id, itemKey: next.itemKey } : this.state.planning,
                    media: this.state.media.map((item) => item.submissionId === id ? { ...item, submissionId: next.id } : item),
                };
                await this.save("waiting_payment");
            }
        });
    }
    private async executeApproved(ids: string[]) {
        const planning = this.state.planning;
        if (planning?.submissionId && ids.includes(planning.submissionId) && !planning.consumed) {
            await this.save("waiting_task");
            const task = await this.api.execute(this.run!.id, { ...this.guard(), submissionId: planning.submissionId }, this.abort.signal);
            this.upsertSubmission({ ...this.submissions.find((item) => item.id === planning.submissionId)!, taskId: task.id });
            const completed = await this.waitTask(task.id, { initialTask: task, signal: this.abort.signal });
            this.assertLive();
            await this.consumePlanning(completed);
            return;
        }
        if (!this.options.canvas()) throw new Error("媒体生成只能在对应画布页面继续");
        await this.save("running");
        const errors: string[] = [];
        for (const id of ids) {
            this.guard();
            const media = this.state.media.find((item) => item.submissionId === id);
            if (!media || media.status === "ready") continue;
            try {
                const task = await this.api.execute(this.run!.id, { ...this.guard(), submissionId: id }, this.abort.signal);
                this.upsertSubmission({ ...this.submissions.find((item) => item.id === id)!, taskId: task.id });
                this.setMedia(media.ref, { taskId: task.id, status: task.status === "succeeded" ? "running" : "queued", error: undefined });
                await this.save("waiting_task");
            } catch (error) { this.assertLive(); errors.push(error instanceof Error ? error.message : "提交未确认"); }
        }
        // 等待已提交项，不会因观察失败创建新的任务。
        for (const id of ids) {
            const media = this.state.media.find((item) => item.submissionId === id);
            if (media?.taskId && media.status !== "ready") {
                try { await this.observeMedia(media); } catch (error) { this.assertLive(); errors.push(error instanceof Error ? error.message : "生成未完成"); }
            }
        }
        if (errors.length) { await this.save("paused"); throw new Error([...new Set(errors)].join("；")); }
        this.state = { ...this.state, pendingPayment: undefined };
        await this.prepareMediaBatch();
    }
    private async consumePlanning(task: GenerationTask) {
        const output = parseBackendGenerationResult(task);
        const calls = output.toolCalls || [];
        const first = calls.find((call) => call.function.name === "creative_respond");
        const results = calls.map((call) => ({ role: "tool" as const, tool_call_id: call.id, content: JSON.stringify({ status: call === first ? "presented_to_user" : "cancelled", reason: call === first ? "内容待程序校验和用户确认" : "交互形成等待屏障，后续调用必须重新规划" }) }));
        const protocol = [...(this.state.planning?.protocol || []), ...calls.map(toolInput), ...results];
        this.state = { ...this.state, modelCalls: this.state.modelCalls + 1, pendingPayment: undefined, planning: this.state.planning ? { ...this.state.planning, consumed: true, protocol } : undefined };
        if (!first) {
            if (!output.text?.trim()) throw new Error("助手没有返回可展示的内容");
            this.state = { ...this.state, messages: [...this.state.messages, { id: nanoid(), role: "assistant", text: output.text }] };
            await this.save("idle"); return;
        }
        const data = parseCreativeToolArguments(first.function.arguments);
        const scene = typeof data.scenario === "string" && Object.hasOwn(CREATIVE_SCENARIOS, data.scenario) ? data.scenario as CreativeAgentState["scene"] : this.state.scene;
        const brief = mergeCreativeBrief(this.state.brief, data.brief, scene, this.state.messages.findLast((message) => message.role === "user")?.text || "");
        const questions = normalizeCreativeQuestions(data.questions, scene, brief, { interactionId: nanoid(), revision: 1 }, this.assets());
        const message = typeof data.message === "string" ? data.message : output.text || "已整理你的要求。";
        this.state = { ...this.state, scene, brief, dynamicPlan: updateCreativePlan(data.plan, this.state.dynamicPlan, nanoid()), messages: [...this.state.messages, { id: nanoid(), role: "assistant", text: message }], questions: undefined, answers: undefined };
        if (questions.questions.length) {
            this.state = { ...this.state, questions };
            await this.save("waiting_answer"); return;
        }
        if (data.proposal) {
            const proposal = normalizeCreativeProposal(data.proposal, nanoid(), Math.max(this.state.proposal?.version || 0, this.run?.approvedProposalVersion || 0) + 1, this.options.config(), this.state.references);
            assertCreativeBriefSpecifications(proposal, brief);
            this.state = { ...this.state, proposal, operations: undefined, canvasApplied: false, media: proposal.generationItems.map((item) => ({ ref: item.ref, nodeId: creativeNodeId(this.run!.id, proposal.version, item.ref), attempt: 1, status: "pending" })) };
            await this.save("waiting_proposal"); return;
        }
        if (Array.isArray(data.edits) && data.edits.length) {
            const canvas = this.options.canvas();
            if (!canvas) throw new Error("请进入画布后再调整节点");
            const current = canvas.read();
            const ops: CanvasOperation[] = data.edits.map((raw) => {
                const edit = raw as Record<string, unknown>;
                const id = typeof edit.nodeId === "string" ? edit.nodeId : "";
                if (!current.nodes.some((node) => node.id === id)) throw new Error("助手建议修改的节点不存在");
                return { type: "update_node", id, patch: { ...(typeof edit.title === "string" ? { title: edit.title } : {}) }, metadata: { ...(typeof edit.prompt === "string" ? { prompt: edit.prompt, composerContent: edit.prompt } : {}), ...(typeof edit.content === "string" && current.nodes.find((node) => node.id === id)?.type === "text" ? { content: edit.content } : {}) } };
            });
            this.state = { ...this.state, pendingEdits: ops };
            await this.save("waiting_proposal"); return;
        }
        await this.save("idle");
    }
    async approveProposal() {
        await this.action(async () => {
            const proposal = this.state.proposal;
            if (!proposal || this.run?.status !== "waiting_proposal") throw new Error("当前方案已过期或无需确认");
            assertCreativeBriefSpecifications(proposal, this.state.brief);
            const snapshot = this.options.canvas()?.read() || { projectId: "", title: "", nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
            const ops = creativeProposalOps(this.run!.id, proposal, snapshot, this.options.config());
            proposal.extra = { ...(proposal.extra as Record<string, unknown> || {}), nodeIds: Object.fromEntries(proposal.workflow.nodes.map((node) => [node.ref, creativeNodeId(this.run!.id, proposal.version, node.ref)])) };
            this.state = { ...this.state, proposal, operations: ops, messages: [...this.state.messages, { id: nanoid(), role: "assistant", text: `方案 v${proposal.version}：${proposal.title}`, proposal }] };
            await this.save("waiting_proposal");
            this.run = await this.api.approveProposal(this.run!.id, { ...this.guard(), revision: this.run!.revision, proposalVersion: proposal.version, proposal, ops }, this.abort.signal);
            const linked = await this.api.canvas(this.run.id, this.guard(), this.abort.signal);
            this.run = linked.run;
            await this.save("waiting_canvas");
            if (this.options.canvas()?.canvasId === linked.canvasId) await this.applyProposal();
            else { await this.api.release(this.run.id, this.guard()); this.hasControl = false; this.options.onOpenCanvas(linked.canvasId, this.run.id); }
        });
    }
    async approveEdits() {
        await this.action(async () => {
            const ops = this.state.pendingEdits;
            if (!ops?.length) throw new Error("当前没有待确认节点调整");
            const version = Math.max(this.state.proposal?.version || 0, this.run?.approvedProposalVersion || 0) + 1;
            this.run = await this.api.approveProposal(this.run!.id, { ...this.guard(), revision: this.run!.revision, proposalVersion: version, proposal: { title: "局部节点调整", ops }, ops }, this.abort.signal);
            await this.commitOps(ops);
            this.state = { ...this.state, pendingEdits: undefined, messages: [...this.state.messages, { id: nanoid(), role: "assistant", text: "已更新指定节点字段。" }] };
            await this.save("idle");
        });
    }
    private async applyProposal() {
        if (this.state.canvasApplied) return;
        if (!this.state.operations || !this.state.proposal) throw new Error("缺少已批准方案的操作记录，请重新核对");
        await this.commitOps(this.state.operations);
        this.state = { ...this.state, canvasApplied: true };
        await this.save("running");
        await this.prepareMediaBatch();
    }
    private async commitOps(ops: CanvasOperation[]) {
        return withRemoteUserDataSyncExclusive(() => this.commitOpsExclusive(ops));
    }
    private async commitOpsExclusive(ops: CanvasOperation[]) {
        const adapter = this.options.canvas();
        if (!adapter || adapter.canvasId !== this.run?.canvasId) throw new Error("对应画布尚未加载，不能执行画布操作");
        this.guard();
        const remote = await this.api.canvasSnapshot(this.run.id, this.abort.signal);
        const remoteSnapshot = { ...adapter.read(), projectId: remote.document.id, nodes: remote.document.nodes, connections: remote.document.connections };
        const missing = reconcileOps(ops, remoteSnapshot);
        if (missing.length) {
            const next = applyCanvasOperations(remoteSnapshot, missing);
            await this.api.commitCanvas(this.run.id, { ...this.guard(), expectedSnapshotHash: remote.snapshotHash, document: { ...remote.document, nodes: next.nodes, connections: next.connections } }, this.abort.signal);
        }
        this.guard();
        const localOps = reconcileOps(ops, adapter.read());
        if (localOps.length) {
            const applied = await adapter.apply(localOps);
            // 同一保存队列释放前更新持久化源，避免排队的自动保存仍提交操作前快照。
            if (useCanvasStore.getState().projects.some((project) => project.id === adapter.canvasId)) {
                useCanvasStore.getState().updateProject(adapter.canvasId, { nodes: applied.nodes, connections: applied.connections });
            }
        }
        this.assertLive();
    }
    private setMedia(ref: string, patch: Partial<CreativeMediaState>) { this.state = { ...this.state, media: this.state.media.map((item) => item.ref === ref ? { ...item, ...patch } : item) }; this.emit(); }
    private async prepareMediaBatch() {
        const proposal = this.state.proposal;
        const adapter = this.options.canvas();
        if (!proposal || !adapter || !this.state.canvasApplied) throw new Error("请先在画布中完成方案接续");
        const existingRefs = Object.keys((proposal.extra as { existingAssets?: Record<string, unknown> } | undefined)?.existingAssets || {});
        const ready = new Set([...existingRefs, ...this.state.media.filter((item) => item.status === "ready").map((item) => item.ref)]);
        if (this.state.media.every((item) => item.status === "ready")) {
            this.state = { ...this.state, pendingPayment: undefined, messages: [...this.state.messages, { id: nanoid(), role: "assistant", text: "本次产物已生成并保存，可以在会话和画布查看。" }] };
            await this.save("completed"); return;
        }
        const candidates = this.state.media.filter((media) => media.status === "pending" && proposal.generationItems.find((item) => item.ref === media.ref)?.referenceRefs?.every((ref) => ready.has(ref)) !== false);
        const ids: string[] = [];
        for (const media of candidates) {
            const item = proposal.generationItems.find((item) => item.ref === media.ref)!;
            const snapshot = adapter.read(), node = snapshot.nodes.find((node) => node.id === media.nodeId);
            if (!node) throw new Error(`节点 ${media.ref} 已被删除，请核对后继续，不会重新创建`);
            const nodeIds = (proposal.extra as { nodeIds?: Record<string, string> } | undefined)?.nodeIds;
            const referenceNodes = [...(item.referenceRefs || []).map((ref) => nodeIds?.[ref] || this.state.media.find((media) => media.ref === ref)?.nodeId || creativeNodeId(this.run!.id, proposal.version, ref)), ...(proposal.workflow.nodes.find((node) => node.ref === item.ref)?.referenceNodeIds || [])].map((id) => snapshot.nodes.find((node) => node.id === id));
            const referenceImages = referenceNodes.map((reference) => {
                const storageKey = typeof reference?.metadata?.storageKey === "string" ? reference.metadata.storageKey : "";
                const resourceId = resourceIdFromStorageKey(storageKey);
                if (!reference || !resourceId || reference.metadata?.status !== "success") throw new Error("引用素材尚未就绪，请选择实际可用的资源");
                return { id: reference.id, name: reference.title || "参考图", type: reference.metadata?.mimeType || "image/png", storageKey, dataUrl: resourceFileUrl(resourceId) };
            });
            const config = { ...this.requestConfig(item.model), count: "1", ...(item.size ? { size: item.size } : {}), ...(item.seconds !== undefined ? { videoSeconds: String(item.seconds) } : {}), ...(item.quality ? item.mode === "video" ? { vquality: item.quality } : { quality: item.quality } : {}) };
            const request = await prepareBackendGenerationTask({ projectId: this.run!.canvasId, mode: item.mode, prompt: node.metadata?.prompt || "", config, referenceImages, signal: this.abort.signal, metadata: { source: "creative-agent", creationRunId: this.run!.id, nodeId: node.id, conversationId: this.run!.id } });
            request.input = { ...request.input, nodeId: node.id };
            const submission = await this.api.prepare(this.run!.id, { ...this.guard(), itemKey: `media:v${proposal.version}:${media.ref}:${media.attempt}`, proposalVersion: proposal.version, request }, this.abort.signal);
            this.upsertSubmission(submission); this.setMedia(media.ref, { submissionId: submission.id }); ids.push(submission.id);
            this.state = { ...this.state, pendingPayment: [...ids] }; await this.save("waiting_payment");
        }
        if (!ids.length) { await this.save("paused"); throw new Error("当前没有可执行项，请先处理失败任务或核对素材依赖"); }
    }
    private async observeMedia(media: CreativeMediaState) {
        let task: GenerationTask;
        let observedStatus: GenerationTask["status"] | undefined;
        try {
            task = await this.waitTask(media.taskId!, { signal: this.abort.signal, onTaskUpdate: (task) => { observedStatus = task.status; if (!this.disposed) this.setMedia(media.ref, { status: task.status === "queued" ? "queued" : "running" }); } });
        } catch (error) {
            if (this.abort.signal.aborted) throw error;
            this.setMedia(media.ref, { status: "failed", failureKind: observedStatus === "failed" || observedStatus === "cancelled" ? "generation" : "observation", error: error instanceof Error ? error.message : "生成失败" }); await this.save("paused"); throw error;
        }
        this.guard();
        try {
            const result = parseBackendGenerationResult(task), output = result.video || result.images?.[0];
            if (!output?.storageKey || !resourceIdFromStorageKey(output.storageKey)) throw new Error("任务已完成，但资源尚未就绪；请恢复回写，不要重新生成");
            const adapter = this.options.canvas();
            const node = adapter?.read().nodes.find((node) => node.id === media.nodeId);
            if (!node) throw new Error("目标节点已删除，产物仍保留在任务中心和素材库");
            const generationItem = this.state.proposal?.generationItems.find((item) => item.ref === media.ref);
            const producedModel = submittedProducedModel(task.model) || submittedProducedModel(generationItem?.model);
            const metadata = { content: resourceFileUrl(resourceIdFromStorageKey(output.storageKey)!), storageKey: output.storageKey, status: "success" as const, naturalWidth: output.width, naturalHeight: output.height, bytes: output.bytes, mimeType: output.mimeType, ...(result.video ? { durationMs: result.video.durationMs } : {}), generationTaskId: task.id, producedModel, producedModelCandidate: undefined };
            const asset = await this.getAsset()({ canvasId: this.run!.canvasId!, node: { ...node, metadata: { ...node.metadata, ...metadata } }, source: "canvas-generation", taskId: task.id, signal: this.abort.signal });
            this.guard();
            await this.commitOps([{ type: "update_node", id: media.nodeId, metadata: { ...metadata, assetId: asset.assetId } }]);
            const specificationError = result.video && creativeVideoSpecificationError(this.state.proposal?.generationItems.find((item) => item.ref === media.ref), result.video);
            if (specificationError) {
                this.setMedia(media.ref, { status: "failed", storageKey: output.storageKey, error: specificationError });
                throw new Error(specificationError);
            }
            this.setMedia(media.ref, { status: "ready", storageKey: output.storageKey, error: undefined }); await this.save("waiting_task");
        } catch (error) { if (this.abort.signal.aborted) throw error; this.setMedia(media.ref, { status: this.state.media.find((item) => item.ref === media.ref)?.status === "failed" ? "failed" : "write_failed", error: error instanceof Error ? error.message : "资源回写失败" }); await this.save("paused"); throw error; }
    }
    async resume() {
        await this.action(async () => {
            this.guard(); this.accept(await this.api.get(this.run!.id, this.abort.signal));
            if (this.state.modificationRequested) throw new Error("请先说明想修改的内容，调整后的方案需要重新确认。");
            this.state = { ...this.state, error: undefined };
            await this.save(this.state.questions?.status === "pending" ? "waiting_answer" : "running");
            if (this.state.pendingRedo) { await this.continueRedo(); return; }
            if (!this.state.planning && this.state.messages.at(-1)?.role === "user") {
                if (this.state.externalInteractionPresented) { await this.save("idle"); return; }
                await this.preparePlanning(this.state.messages.at(-1)!.text); return;
            }
            if (this.state.planning && !this.state.planning.consumed && !this.state.planning.submissionId) await this.ensurePlanningSubmission();
            const planning = this.state.planning;
            if (planning?.submissionId && !planning.consumed) {
                const submission = this.submissions.find((item) => item.id === planning.submissionId);
                if (submission?.taskId) { const task = await this.waitTask(submission.taskId, { signal: this.abort.signal }); await this.consumePlanning(task); return; }
                if (submission?.approvedAt) { await this.executeApproved([submission.id]); return; }
                this.state = { ...this.state, pendingPayment: [planning.submissionId] }; await this.save("waiting_payment"); return;
            }
            if (!this.state.canvasApplied && this.state.proposal && this.run!.approvedProposalHash && this.run!.approvedProposalVersion === this.state.proposal.version) {
                const linked = await this.api.canvas(this.run!.id, this.guard(), this.abort.signal); this.run = linked.run;
                if (this.options.canvas()?.canvasId !== linked.canvasId) { await this.save("waiting_canvas"); await this.api.release(this.run.id, this.guard()); this.hasControl = false; this.options.onOpenCanvas(linked.canvasId, this.run.id); return; }
                await this.applyProposal(); return;
            }
            if (this.state.questions?.status === "pending") return;
            if (this.state.pendingEdits) { await this.save("waiting_proposal"); return; }
            if (this.state.proposal && !this.state.canvasApplied) { await this.save("waiting_proposal"); return; }
            const errors: string[] = [];
            for (const media of this.state.media) {
                const submission = this.submissions.find((item) => item.id === media.submissionId);
                if (submission?.taskId && media.status !== "ready") { this.setMedia(media.ref, { taskId: submission.taskId }); try { await this.observeMedia({ ...media, taskId: submission.taskId }); } catch (error) { this.assertLive(); errors.push(error instanceof Error ? error.message : "生成未完成"); } }
            }
            if (errors.length) { await this.save("paused"); throw new Error([...new Set(errors)].join("；")); }
            const approved = this.state.pendingPayment?.filter((id) => this.submissions.some((item) => item.id === id && item.approvedAt));
            if (approved?.length) await this.executeApproved(approved);
            else if (this.state.pendingPayment?.length) await this.save("waiting_payment");
            else if (this.state.proposal && this.state.canvasApplied) await this.prepareMediaBatch();
        });
    }
    async redo(ref: string) {
        await this.action(async () => {
            if (this.state.pendingRedo) throw new Error("已有待恢复的重做操作，请先核对状态并继续");
            const media = this.state.media.find((item) => item.ref === ref);
            if (!media) throw new Error("生成项不存在");
            if (media.taskId) { const task = await this.queryTask(media.taskId, { signal: this.abort.signal }); if (["running", "queued"].includes(task.status) || task.billing?.status === "uncertain") throw new Error("原任务仍在执行或账务待核对，不能重新扣费"); }
            const canvas = this.options.canvas();
            const proposal = this.state.proposal;
            if (!canvas || !proposal) throw new Error("请先打开对应画布");
            const snapshot = canvas.read();
            const node = snapshot.nodes.find((node) => node.id === media.nodeId);
            if (!node) throw new Error("目标节点已删除，不能自动重建");
            const version = Math.max(proposal.version, this.run!.approvedProposalVersion || 0) + 1;
            const nodeIds = (proposal.extra as { nodeIds?: Record<string, string> } | undefined)?.nodeIds || Object.fromEntries(proposal.workflow.nodes.map((node) => [node.ref, creativeNodeId(this.run!.id, proposal.version, node.ref)]));
            const operations: CanvasOperation[] = Object.values(nodeIds).map((id) => { const current = snapshot.nodes.find((node) => node.id === id); if (!current) throw new Error("原方案节点已被删除，请核对方案后继续"); return { type: "update_node", id, metadata: { ...current.metadata } }; });
            const nextProposal = { ...proposal, version, extra: { ...(proposal.extra as Record<string, unknown> || {}), nodeIds }, generationItems: proposal.generationItems.map((item) => item.ref === ref ? { ...item, model: String(node.metadata?.model || item.model), size: node.metadata?.size || item.size, seconds: node.metadata?.seconds ? Number(node.metadata.seconds) : item.seconds, quality: (item.mode === "video" ? node.metadata?.vquality : node.metadata?.quality) || item.quality } : item) };
            assertCreativeBriefSpecifications(nextProposal, this.state.brief);
            this.state = { ...this.state, proposal: nextProposal, operations, pendingPayment: undefined, planning: undefined, pendingRedo: { ref, attempt: media.attempt + 1, proposalVersion: version } };
            await this.save("running");
            await this.continueRedo();
        });
    }
    private async continueRedo() {
        const intent = this.state.pendingRedo, proposal = this.state.proposal, operations = this.state.operations;
        if (!intent || !proposal || proposal.version !== intent.proposalVersion || !operations || !this.state.media.some((media) => media.ref === intent.ref)) throw new Error("重做记录不完整，请重新核对方案");
        if (this.run!.approvedProposalVersion !== intent.proposalVersion || !this.run!.approvedProposalHash) {
            this.run = await this.api.approveProposal(this.run!.id, { ...this.guard(), revision: this.run!.revision, proposalVersion: intent.proposalVersion, proposal, ops: operations }, this.abort.signal);
        }
        this.guard();
        this.setMedia(intent.ref, { status: "pending", attempt: intent.attempt, submissionId: undefined, taskId: undefined, error: undefined });
        this.state = { ...this.state, pendingRedo: undefined };
        await this.save("running");
        await this.prepareMediaBatch();
    }
}

function reconcileOps(ops: CanvasOperation[], snapshot: CanvasSnapshot): CanvasOperation[] {
    return ops.filter((op) => {
        if (op.type === "add_node") return !snapshot.nodes.some((node) => node.id === op.id);
        if (op.type === "connect_nodes") return !snapshot.connections.some((edge) => edge.id === op.id || edge.fromNodeId === op.fromNodeId && edge.toNodeId === op.toNodeId);
        if (op.type === "run_generation") throw new Error("画布写入不能直接提交收费生成");
        return true;
    });
}
function toolInput(call: ResponseToolCall): ResponseInputMessage { return { type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments, ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}) }; }
