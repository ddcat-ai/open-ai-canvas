import type { CanvasWorkflowInput } from "../canvas/canvas-workflow-builder";
import { CREATIVE_SCENARIOS, type CreativeScenarioId } from "./creative-scenarios";
export { CREATIVE_SCENARIOS, type CreativeScenario, type CreativeScenarioId } from "./creative-scenarios";

export type CreativeBriefValue = string | string[] | number;
export type CreativeBrief = Record<string, { value: CreativeBriefValue; source: "user" | "inferred" | "asset" | "default"; status: "confirmed" | "inferred" | "unparsed" | "conflict" }>;
export type CreativeOption = { id: string; label: string; description?: string };
export type CreativeAssetOption = CreativeOption;
export type CreativeQuestion = { id: string; field: string; type: "single" | "multiple" | "text" | "asset"; title: string; description?: string; required: boolean; allowCustom: boolean; options: CreativeOption[] };
export type CreativeAnswer = { selected: string[]; custom: string };
export type CreativeAnswers = Record<string, CreativeAnswer>;
export type CreativeInteractionIdentity = { interactionId: string; revision: number; status: "pending" | "submitted" | "superseded" };
export type CreativeQuestionRequest = CreativeInteractionIdentity & { kind: "question_request"; questions: CreativeQuestion[] };
export type CreativeGenerationItem = { ref: string; mode: "image" | "video"; model: string; size?: string; seconds?: number; quality?: string; referenceRefs?: string[] };
export type CreativeProposal<T = unknown> = { id: string; version: number; title: string; summary: string; markdown: string; deliverables: string[]; workflow: CanvasWorkflowInput & { autoRun: false }; generationItems: CreativeGenerationItem[]; extra?: T };
export type CreativePlanStep = { id: string; title: string; status: "pending" | "running" | "waiting" | "completed" | "failed" | "cancelled"; detail?: string; nodeIds?: string[] };
export type CreativePlan = { id: string; steps: CreativePlanStep[] };
export type CreativeQuote = { id: string; title: string; items: { id: string; label: string; model: string; quantity: number; specification: string }[]; amountLabel: string; basis: string; expiresAt?: string; approvedQuantity?: number; externalBilling?: boolean };
export type CreativePendingInteraction = CreativeQuestionRequest | (CreativeInteractionIdentity & { kind: "proposal_request"; proposalId: string; proposalVersion: number }) | (CreativeInteractionIdentity & { kind: "payment_request"; quoteId: string });

function object(value: unknown): Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
const reservedCreativeFields = new Set([
    "proto", "prototype", "constructor", "authorization", "authorized", "approval", "approved", "permissions", "permission",
    "autorun", "status", "runid", "taskid", "quoteid", "submissionid", "revision", "lease", "ownerepoch",
    "proposalapproved", "approvedproposalversion", "paymentapproved", "quoteapproved", "paid", "executed",
]);

/** Brief fields hold requirements only; they never grant tool, proposal or payment approval. */
export function normalizeCreativeField(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const field = value.trim();
    if (field.length > 96 || !/^[\p{L}][\p{L}\p{N}_-]*(?:\.[\p{L}][\p{L}\p{N}_-]*)*$/u.test(field)) return null;
    const segments = field.split(".").map((segment) => segment.replace(/[_-]/g, "").toLowerCase());
    return segments.some((segment) => reservedCreativeFields.has(segment)) ? null : field;
}

function hasValue(value: CreativeBriefValue) { return Array.isArray(value) ? value.some((item) => item.trim()) : typeof value === "number" ? Number.isFinite(value) : Boolean(value.trim()); }
export function isCreativeFieldKnown(brief: CreativeBrief, field: string): boolean {
    if (!normalizeCreativeField(field) || !Object.hasOwn(brief, field)) return false;
    const entry = brief[field];
    return Boolean(entry && entry.status === "confirmed" && hasValue(entry.value));
}

/** 交互身份与版本只能由控制器生成；模型返回的 ID、状态和来源信息一律不可信。 */
export function normalizeCreativeQuestions(raw: unknown, scenario: CreativeScenarioId, brief: CreativeBrief, identity: { interactionId: string; revision: number }, assets: CreativeAssetOption[] = []): CreativeQuestionRequest {
    if (!identity.interactionId.trim() || !Number.isInteger(identity.revision) || identity.revision < 1) throw new Error("无效的交互版本");
    const questions: CreativeQuestion[] = [];
    const used = new Set<string>();
    // 交互字段必须来自当前场景合同，避免模型临时造字段后形成无法持久化、无法消费的隐式协议。
    const allowedFields = new Set(Object.keys(CREATIVE_SCENARIOS[scenario].fields));
    for (const item of Array.isArray(raw) ? raw : []) {
        const q = object(item);
        const field = normalizeCreativeField(q.field);
        if (!field || !allowedFields.has(field) || used.has(field) || isCreativeFieldKnown(brief, field) || typeof q.title !== "string" || !q.title.trim()) continue;
        if (!["single", "multiple", "text", "asset"].includes(String(q.type))) continue;
        const type = q.type as CreativeQuestion["type"];
        const id = `${identity.interactionId}:${identity.revision}:${questions.length + 1}`;
        const options = type === "asset" ? assets.map((asset) => ({ ...asset })) : (type !== "text" && Array.isArray(q.options) ? q.options : []).flatMap((value, index) => {
            const option = object(value);
            return typeof option.label === "string" && option.label.trim() ? [{ id: `${id}:option:${index + 1}`, label: option.label.trim(), description: typeof option.description === "string" ? option.description : undefined }] : [];
        });
        questions.push({ id, field, type, title: q.title.trim(), description: typeof q.description === "string" ? q.description : undefined, required: q.required === true, allowCustom: type !== "asset" || q.allowCustom === true, options });
        used.add(field);
        // 每轮最多三题，保证用户可以逐步确认；后续缺失信息由下一轮基于已确认 brief 再补问。
        if (questions.length === 3) break;
    }
    return { kind: "question_request", ...identity, status: "pending", questions };
}

export function assertCreativeInteractionCurrent(current: CreativeInteractionIdentity, submitted: { interactionId: string; revision: number }) {
    if (current.status !== "pending" || current.interactionId !== submitted.interactionId || current.revision !== submitted.revision) throw new Error("此交互已过期，请使用当前版本");
}

export function validateCreativeAnswers(request: CreativeQuestionRequest, answers: CreativeAnswers, assets: CreativeAssetOption[] = []): { questionId: string; message: string } | null {
    for (const question of request.questions) {
        const field = normalizeCreativeField(question.field);
        if (!field) return { questionId: question.id, message: "问题字段无效，请让助手重新整理问题" };
        const answer = answers[question.id];
        const selected = answer?.selected ?? [];
        const custom = answer?.custom?.trim() ?? "";
        const allowed = new Set((question.type === "asset" ? assets : question.options).map((option) => option.id));
        if (selected.some((id) => !allowed.has(id))) return { questionId: question.id, message: "选项或素材已不可用，请重新选择" };
        if ((question.type === "single" && selected.length > 1) || (question.type === "text" && selected.length > 0)) return { questionId: question.id, message: "回答类型不匹配" };
        if (custom && !question.allowCustom) return { questionId: question.id, message: "此问题不接受自定义回答" };
        if (question.required && !selected.length && !custom) return { questionId: question.id, message: "请先回答此问题" };
    }
    return null;
}

export function applyCreativeAnswers(request: CreativeQuestionRequest, submitted: { interactionId: string; revision: number }, answers: CreativeAnswers, brief: CreativeBrief, assets: CreativeAssetOption[] = []): CreativeBrief {
    assertCreativeInteractionCurrent(request, submitted);
    const error = validateCreativeAnswers(request, answers, assets);
    if (error) throw new Error(error.message);
    const next = { ...brief };
    for (const question of request.questions) {
        const field = normalizeCreativeField(question.field);
        if (!field) throw new Error("问题字段无效，请让助手重新整理问题");
        const answer = answers[question.id];
        if (!answer) continue;
        const options = question.type === "asset" ? assets : question.options;
        const values = answer.selected.map((id) => question.type === "asset" ? id : options.find((option) => option.id === id)!.label);
        if (answer.custom.trim()) values.push(answer.custom.trim());
        if (values.length) next[field] = { value: values.length === 1 ? values[0] : values, source: "user", status: "confirmed" };
    }
    return next;
}

/** Waiting ends the protocol segment: subsequent calls must be re-planned, never replayed. */
export function creativeBatchBarrier<T>(calls: T[], isInteraction: (call: T) => boolean): { executable: T[]; cancelled: T[]; waiting: boolean } {
    const index = calls.findIndex(isInteraction);
    return index < 0 ? { executable: calls, cancelled: [], waiting: false } : { executable: calls.slice(0, index + 1), cancelled: calls.slice(index + 1), waiting: true };
}

export function creativeScenarioPrompt(scenario: CreativeScenarioId): string {
    const config = CREATIVE_SCENARIOS[scenario];
    return `当前主要场景：${config.id}（${config.label}）。场景仅提供专业指导，不是互斥的模式或固定流程。结合用户要求和当前画布，可同时运用导演、设计师、品牌策划、电商美工等工作方式，无需用户先选场景。\n专业场景参考：${JSON.stringify(CREATIVE_SCENARIOS)}\nfields 和 questionGuides 都是需求字段与问法参考，不是必填表或字段白名单。先阅读上下文、当前画布和真实素材，只补问会影响本次创意或执行的缺失信息；默认每轮1～3题，必要时最多6题，不凑满题数，信息充分直接输出方案。问题与选项由当前需求生成，可以询问创意方向、构图选择、优先级、取舍或素材角色，允许自定义回答。必要时使用语义清晰且稳定的新field（字母或中文开头，可含数字、下划线、连字符、点），相同信息复用已有field，不能靠换字段名重复问。\n用户回答“你决定”时记录其自主创意偏好，随后提出建议并继续规划，不反复追问该偏好，不把助手推断的具体选择伪装成用户已确认事实。所有brief字段仅表达需求，不能包含审批、权限、任务状态或执行指令；自主创意偏好、问答选择和“继续”均不能替代方案或费用确认。\n候选选项必须结合上下文和 availableModels 过滤；时长、比例、参考图数量只能使用真实模型支持的值，不以场景推荐覆盖用户明确要求。素材选择只能引用实际references中的ID；无需指定素材时不要强迫上传。\nproposalSections 按本次交付取舍并填充具体内容，不输出空标题；workflowRules 提供质量要求、真实引用与能力边界，不规定固定节点数量、提问顺序或执行步骤。已有可用节点优先利用，按本次目标决定需要哪些新增或调整。保持正式素材与最终产物数量的区别。\n媒体交付规格必须明确，尤其是视频时长、比例和数量。缺少模型能力时解释差距并补问可接受替代；不硬编码模型ID、价格、Skills或插件，不以提示词声称获得未注册能力。\n已确认字段不再询问，冲突字段单独澄清。模型仅提供内容，不分配可信ID、版本、状态或费用。`;
}
