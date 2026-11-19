/**
 * 我们自己的文本模型直连客户端 —— 只给自家 C 端创作台用。
 *
 * 2026-11-18 用户口径：「文本模型为我们的 C 端服务」，引导用户用它写漫剧、短剧，
 * 或在里面提问、解决创作中的问题；画布里的文本助手「负责想清楚、写清楚」，
 * 整理好的内容再交给 Agent 生成视频。
 *
 * 协议：POST https://api.ll2.cn/v1/chat/completions（OpenAI 兼容，非流式）
 * 计费：官网单价为元 / 1M Token，按 usage.prompt_tokens / completion_tokens 折算。
 *      文本模型没有「一次调用固定多少钱」，所以只给出本次实付，不做事前承诺价。
 *
 * Key 只从调用方传入（浏览器 localStorage），不写业务库、不经影策后端中转。
 * 边界：不接第三方平台、不给外部站点导流、不露内部模型代号；出片一律走我们自己的视频链路。
 */

import { LL2_API_BASE, LL2_MODELS, ll2FormatCNY, ll2ModelById, type LL2Model } from "@/lib/ll2-models";

export const LL2_TEXT_MODELS = LL2_MODELS.filter((model) => model.category === "text");
export const LL2_DEFAULT_TEXT_MODEL = "glm-5.3-flash";

/**
 * C 端不直接展示 glm-5.3-flash / ¥0.44/1M 这类内部写法。
 * 按目录顺序给出白话名字与大致花费档位，模型 id 仍用于实际请求。
 */
const TEXT_FRIENDLY_NAMES = [
    "写得最快 · 最省",
    "写得快 · 便宜",
    "写得稳 · 便宜",
    "想得更细 · 中等",
    "想得最细 · 稍贵",
    "读得最长 · 最贵",
];

export function ll2TextFriendlyName(id: string): string {
    const index = LL2_TEXT_MODELS.findIndex((item) => item.id === id);
    return TEXT_FRIENDLY_NAMES[index] ?? "聊天改稿";
}

/** 一次聊天大概花多少钱的白话说法，不给用户看小数。 */
export function ll2TextFriendlyCostLabel(costCNY: number): string {
    if (!Number.isFinite(costCNY) || costCNY <= 0) return "几乎不花钱";
    if (costCNY < 0.01) return "不到 1 分钱";
    if (costCNY < 0.1) return "几分钱";
    if (costCNY < 1) return "几毛钱";
    return `约 ¥${costCNY.toFixed(2)}`;
}

export type LL2TextModelId = string;

export type LL2ChatMessage = {
    role: "system" | "user" | "assistant";
    content: string;
};

export type LL2TextRequest = {
    apiKey: string;
    model: LL2TextModelId;
    messages: LL2ChatMessage[];
    signal?: AbortSignal;
    temperature?: number;
    /** 仅用于本地自测 / 将来切换环境，默认 LL2 官方网关。 */
    baseUrl?: string;
};

export type LL2TextResult = {
    text: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    costCNY: number;
    costLabel: string;
    costBasis: string;
};

type Json = Record<string, any>;

function endpointOf(req: LL2TextRequest) {
    const base = String(req.baseUrl || LL2_API_BASE).replace(/\/+$/, "");
    return `${base}/chat/completions`;
}

function textOf(payload: unknown, ...keys: string[]): string {
    if (!payload || typeof payload !== "object") return "";
    for (const key of keys) {
        const value = (payload as Json)[key];
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
}

function httpErrorMessage(status: number, payload: unknown): string {
    const detail = textOf(payload, "message", "msg") || textOf((payload as Json)?.error, "message", "msg");
    if (status === 401) return "LL2 Key 无效或已过期，请在「连接 LL2」里重新填入";
    if (status === 403) return "这个 Key 没有调用该文本模型的权限，请到 LL2 控制台确认";
    if (status === 429) return "LL2 账户触发限流，请稍后再试";
    if (status === 400) return detail ? `请求参数不被接受：${detail}` : "请求参数不被接受，请检查模型名与消息内容";
    if (status >= 500) return `LL2 服务暂时不可用（HTTP ${status}），请稍后重试`;
    return `文本生成失败（HTTP ${status}）${detail ? `：${detail}` : ""}`;
}

/** 按官网元 / 1M Token 单价折算本次费用；缺 usage 时返回 0 并明确标注。 */
export function ll2TextCost(modelId: string, promptTokens: number, completionTokens: number) {
    const model: LL2Model | undefined = ll2ModelById(modelId);
    const inputRate = model?.tokenInput ?? 0;
    const outputRate = model?.tokenOutput ?? 0;
    const amount = (promptTokens * inputRate + completionTokens * outputRate) / 1_000_000;
    return {
        costCNY: amount,
        costLabel: `¥${ll2FormatCNY(amount)}`,
        costBasis: `输入 ${promptTokens} × ¥${ll2FormatCNY(inputRate)}/1M + 输出 ${completionTokens} × ¥${ll2FormatCNY(outputRate)}/1M Token · 账单以 LL2 控制台为准`,
        knownRate: Boolean(model && (inputRate || outputRate)),
    };
}

export async function ll2ChatText(req: LL2TextRequest): Promise<LL2TextResult> {
    const model = String(req.model || LL2_DEFAULT_TEXT_MODEL).trim();
    if (!model) throw new Error("请先选择一个文本模型");
    if (!req.apiKey.trim()) throw new Error("还没填 LL2 Key，填一次就能用，不用注册账号");
    if (!req.messages.some((message) => message.role === "user" && message.content.trim())) throw new Error("先写一句你想让文本模型帮你做什么");

    let response: Response;
    try {
        response = await fetch(endpointOf(req), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${req.apiKey.trim()}`,
            },
            credentials: "omit",
            signal: req.signal,
            body: JSON.stringify({
                model,
                messages: req.messages,
                stream: false,
                ...(typeof req.temperature === "number" ? { temperature: req.temperature } : {}),
            }),
        });
    } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
        throw new Error("连不上 LL2 网关，请检查网络或稍后重试");
    }

    let payload: Json = {};
    try {
        payload = (await response.json()) as Json;
    } catch {
        payload = {};
    }
    if (!response.ok) throw new Error(httpErrorMessage(response.status, payload));

    const text = textOf(payload?.choices?.[0]?.message, "content") || textOf(payload?.choices?.[0], "text") || textOf(payload, "output_text");
    if (!text) throw new Error("LL2 返回了空内容，换个说法再试一次");

    const promptTokens = Number(payload?.usage?.prompt_tokens ?? payload?.usage?.input_tokens ?? 0) || 0;
    const completionTokens = Number(payload?.usage?.completion_tokens ?? payload?.usage?.output_tokens ?? 0) || 0;
    const cost = ll2TextCost(model, promptTokens, completionTokens);
    return {
        text,
        model,
        promptTokens,
        completionTokens,
        costCNY: cost.costCNY,
        // C 端只给白话档位，不展示 ¥0.0008 这类小数和 Token 术语。
        costLabel: ll2TextFriendlyCostLabel(cost.costCNY),
        costBasis: promptTokens || completionTokens
            ? "按写了多少字算，详细账单以 LL2 控制台为准"
            : "这次没读到字数，花了多少钱以 LL2 控制台账单为准",
    };
}

/**
 * 画布里唯一一个文本助手的默认系统指令：负责「想清楚、写清楚」。
 * 用我们自己的文本模型，陪用户写漫剧 / 短剧、分析提示词该怎么写、解决创作里卡住的问题。
 * 不推荐第三方平台、不提外部站点、不露内部模型代号。
 */
export const LL2_THINK_SYSTEM = [
    "你是 DMC 创作台自带的文本助手，用的是我们自己的文本模型。你的活儿是帮用户把想法想清楚、写清楚，不负责生成视频。",
    "用户会来问：漫剧 / 短剧怎么开头、怎么写分镜、提示词缺了什么、这段话怎么改得更有画面感，或创作中遇到的其它问题。",
    "回答用中文白话，短句、分点，先给结论再给理由；不写空洞套话，不用专业黑话，不提其它平台或产品名，不露模型代号和单价。",
    "写漫剧 / 短剧时，按「这一集讲什么 → 分成几个画面 → 每个画面的主体、光线、镜头怎么动」给清爽的分镜清单。",
    "用户明确要「写成可以出片的提示词」时，只给一段完整中文画面描述（主体 → 环境 → 光线 → 镜头运动 → 氛围），不加标题、不加解释、不加引号、不用 Markdown 代码块，120 字以内。",
    "用户如果是在改写、扩写或续写，就保留他原本的意图与关键名词，不凭空换题材。",
    "最后一句可以提醒：想清楚了就点「交给 Agent 出片」，片子会直接放进当前这张画布。",
].join("\n");

/** 「整理成出片提示词」专用：把聊好的内容收成一段可直接交给视频 Agent 的正文。 */
export const LL2_PROMPT_SYSTEM = [
    "你是 DMC 创作台的文本助手。把用户已经想好的内容，整理成一段可直接提交给视频生成模型的画面提示词。",
    "要求：只输出提示词正文本身，不要解释、不要标题、不要 Markdown 代码块、不要加引号、不要编号。",
    "内容按「主体 → 环境 → 光线 → 镜头运动 → 氛围/风格」组织，用一整段中文，120 字以内。",
    "保留用户原本的意图与关键名词，不凭空换题材。",
    "可用模型：MiniMax-H3（固定 768P，1–15 秒）、wan3.0-video（480P/720P/1080P，2–30 秒）。",
].join("\n");
