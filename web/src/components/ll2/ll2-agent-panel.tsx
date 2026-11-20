import { ArrowUp, Check, Copy, Download, FileText, Film, LoaderCircle, Plus, Sparkles, Square, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { nanoid } from "nanoid";

import { LL2_MODELS } from "@/lib/ll2-models";
import { LL2Select } from "@/components/ll2/ll2-select";
import {
    ll2CurrentCanvasId,
    ll2PromptUrl,
    ll2ReadAgentMessages,
    ll2ReadSettings,
    ll2WriteAgentMessages,
    type LL2AgentMessage,
} from "@/lib/ll2-workspace";
import { ll2BuildCanvasNodes, ll2CanvasAgentEstimate, ll2CleanVideoPrompt, ll2RunCanvasAgent } from "@/services/ll2/ll2-canvas-agent";
import { ll2DownloadFilm, type LL2Film } from "@/services/ll2/ll2-films";
import {
    LL2_AGENT_SYSTEM,
    LL2_PROMPT_SYSTEM,
    LL2_TEXT_MODELS,
    LL2_THINK_SYSTEM,
    ll2ChatText,
    ll2TextModelName,
} from "@/services/ll2/ll2-text";
import type { LL2VideoProgress } from "@/services/ll2/ll2-video";
import { flushCanvasStorePersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useGlobalAgentStore, type CanvasVideoInsert } from "@/stores/use-global-agent-store";
import { useLL2AgentStore } from "@/stores/use-ll2-agent-store";
import { ll2OpenKeyDialog, useLL2Store } from "@/stores/use-ll2-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

type Starter = { title: string; hint: string; prompt: string; shape?: boolean };

/** Agent 的回答里可能带代码块：把三反引号包起来的部分渲染成等宽代码块，别压成一段文字。 */
function AgentMessageText({ text }: { text: string }) {
    const parts = text.split("```");
    return (
        <div className="ll2-agent-msg-text">
            {parts.map((part, index) => {
                if (index % 2 === 1) {
                    const lines = part.replace(/^\n/, "").split("\n");
                    const first = lines[0]?.trim() || "";
                    const hasLang = /^[a-zA-Z0-9+#.-]{1,16}$/.test(first);
                    const code = (hasLang ? lines.slice(1).join("\n") : part).trim();
                    return (
                        <pre key={index} className="ll2-agent-code">
                            <code>{code}</code>
                        </pre>
                    );
                }
                const body = part.trim();
                return body ? <p key={index}>{body}</p> : null;
            })}
        </div>
    );
}

/** 全站 Agent 的四个入口：提示词、运镜、代码、随便问，一眼看出它不只改稿。 */
const AGENT_STARTERS: Starter[] = [
    { title: "写一段出片提示词", hint: "给一句话，补成主体、光线、运镜都清楚的画面", prompt: "帮我把「雨夜老城的街角」写成一段可以直接生成视频的画面提示词，要有主体、光线和镜头运动" },
    { title: "帮我设计运镜", hint: "按剧情给几个镜头和镜头运动", prompt: "我有一段 15 秒的独白，人物从窗边走到桌前。帮我设计 3 个镜头，写清机位、景别和运镜" },
    { title: "写一段代码", hint: "小工具、脚本、页面都可以", prompt: "用 HTML + JavaScript 写一个单文件的小工具：输入一句话，统计字数和预计视频秒数，界面简洁一点" },
    { title: "随便问", hint: "剧本、分镜、提示词、工具问题都能聊", prompt: "我想做一支 30 秒的悬疑漫剧，帮我想一个开场钩子和前三镜" },
];

/** 画布里的文本助手：先陪用户把漫剧 / 短剧 / 提示词想清楚、写清楚，再交给 Agent 出片。 */
const CANVAS_STARTERS: Starter[] = [
    { title: "漫剧第一集怎么开头", hint: "定人物、冲突，再拆成 4 个画面", prompt: "我想做一个都市奇幻漫剧，第一集要在 30 秒内抓住人。帮我定开场人物、冲突和一个反转，再拆成 4 个画面，每格写清主体、光线和镜头怎么动" },
    { title: "短剧前三秒怎么抓人", hint: "开场画面、台词、镜头怎么接", prompt: "帮我写一个甜宠短剧的开场：前三秒出现什么画面、台词怎么说、镜头怎么动，后面 3 个镜头怎么接" },
    { title: "我的提示词缺了什么", hint: "先诊断，再给一版改好的", prompt: "我想拍「雨夜的老城，一个人撑伞走过」。请指出这段提示词还缺什么，告诉我该补哪些信息，再给一版改好的完整提示词" },
    { title: "整理成出片提示词", hint: "收成一段能直接交给 Agent 的话", prompt: "把刚才聊的内容整理成一段可以直接生成视频的画面提示词，只输出提示词正文，不要标题和解释", shape: true },
];

type VideoStage = "idle" | "confirm" | "running" | "done" | "error";

/**
 * 全站唯一的文本助手（用我们自己的文本模型，不依赖登录态）：
 * - 首页 / 灵感广场：叫「聊天改稿」，聊好的句子一键送回一句话成片。
 * - 无限画布：内嵌在这一张画布里，想清楚之后点「交给 Agent 出片」，
 *   提示词和成片都直接写回当前画布，不跳走、不打开第二个助手。
 */
export function LL2AgentPanel() {
    const open = useLL2AgentStore((state) => state.open);
    const setOpen = useLL2AgentStore((state) => state.setOpen);
    const consumePending = useLL2AgentStore((state) => state.consumePending);
    const apiKey = useLL2Store((state) => state.apiKey);
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const canvasId = ll2CurrentCanvasId(pathname);
    const inCanvas = Boolean(canvasId);
    // 面板常驻不卸载：每次进出画布重新读一次本机参数，避免设置页改了模型 / 时长 / 清晰度后，
    // 画布里仍按旧参数报价和出片。
    const settings = useMemo(() => ll2ReadSettings(), [inCanvas]);
    const estimate = useMemo(() => (inCanvas ? ll2CanvasAgentEstimate(settings) : null), [inCanvas, settings]);
    // 默认用更快的文本模型；用户在下拉里手动换过的会沿用。
    const [model, setModel] = useState(settings.textModel && settings.textModel !== "glm-5.3-flash" ? settings.textModel : "deepseek-v4.1-flash");
    const [draft, setDraft] = useState("");
    const [messages, setMessages] = useState<LL2AgentMessage[]>(() => ll2ReadAgentMessages());
    const [running, setRunning] = useState(false);
    const [error, setError] = useState("");
    const [copied, setCopied] = useState("");
    const [inserted, setInserted] = useState("");
    const listRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const friendlyName = ll2TextModelName(model);

    // Agent 出片链路的状态（只在画布里出现）。
    const [videoStage, setVideoStage] = useState<VideoStage>("idle");
    const [videoDraft, setVideoDraft] = useState("");
    const [videoProgress, setVideoProgress] = useState<LL2VideoProgress | null>(null);
    const [videoResult, setVideoResult] = useState<LL2Film | null>(null);
    const [videoCost, setVideoCost] = useState({ label: "", basis: "" });
    const [videoError, setVideoError] = useState("");
    const [downloadMessage, setDownloadMessage] = useState("");
    const videoAbortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    }, [open, messages, videoStage]);

    useEffect(
        () => () => {
            abortRef.current?.abort();
            videoAbortRef.current?.abort();
        },
        [],
    );

    // 离开画布时收起未完成的出片步骤，避免把上一张画布的上下文带过去。
    useEffect(() => {
        if (inCanvas) return;
        videoAbortRef.current?.abort();
        setVideoStage("idle");
        setVideoProgress(null);
        setVideoResult(null);
        setVideoError("");
    }, [inCanvas]);

    // 首页文本框 / 起步卡片 / 画布首屏带过来的待发送内容：打开即自动提交一次。
    useEffect(() => {
        if (!open) return;
        const pending = consumePending();
        if (pending) void send(pending);
        // send 依赖 messages，但本 effect 只应在 open / pending 变化时触发一次。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, consumePending]);

    const canvasProject = canvasId ? useCanvasStore.getState().projects.find((project) => project.id === canvasId) : null;

    const append = (...items: LL2AgentMessage[]) => {
        setMessages((previous) => ll2WriteAgentMessages([...previous, ...items]));
    };

    const clear = () => {
        abortRef.current?.abort();
        setRunning(false);
        setMessages(ll2WriteAgentMessages([]));
        setError("");
        setDraft("");
    };

    /** 默认用「想清楚、写清楚」的系统指令；点「整理成出片提示词」时换成只出正文的指令。 */
    const send = async (text: string, system: string = inCanvas ? LL2_THINK_SYSTEM : LL2_AGENT_SYSTEM) => {
        const prompt = text.trim();
        if (!prompt || running) return;
        if (!apiKey.trim()) {
            ll2OpenKeyDialog();
            return;
        }
        setError("");
        setDraft("");
        append({ id: nanoid(), role: "user", text: prompt, createdAt: Date.now() });
        setRunning(true);
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            const history = [...messages, { role: "user" as const, text: prompt, id: "", createdAt: 0 }]
                .slice(-8)
                .map((item) => ({ role: item.role, content: item.text }));
            const result = await ll2ChatText({
                apiKey,
                model,
                messages: [{ role: "system", content: system }, ...history],
                signal: controller.signal,
            });
            append({
                id: nanoid(),
                role: "assistant",
                text: result.text,
                model: result.model,
                costLabel: result.costLabel,
                costBasis: result.costBasis,
                createdAt: Date.now(),
            });
        } catch (cause) {
            if (!(cause instanceof DOMException && cause.name === "AbortError")) {
                setError(cause instanceof Error ? cause.message : "这次没写成，请稍后再试");
            }
        } finally {
            setRunning(false);
            abortRef.current = null;
        }
    };

    const copy = async (text: string, id: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(id);
            setTimeout(() => setCopied(""), 1800);
        } catch {
            setCopied("");
        }
    };

    /** 文本写回画布：优先用编辑器发布的回调（立刻可见），上下文没就绪时兜底写本机 store。 */
    const insertIntoCanvas = (text: string, id: string) => {
        if (!canvasId) {
            navigate("/canvas");
            return;
        }
        const context = useGlobalAgentStore.getState().canvas;
        if (context?.canvasId === canvasId && context.insertAgentText) {
            context.insertAgentText(text, "Agent 写的一句话");
        } else {
            const store = useCanvasStore.getState();
            const project = store.projects.find((item) => item.id === canvasId);
            if (!project) {
                setError("没找到当前画布，先新建或打开一张画布");
                return;
            }
            const rightmost = project.nodes.reduce((max, node) => Math.max(max, node.position.x + node.width), 80);
            const node: CanvasNodeData = {
                id: `text-${nanoid()}`,
                type: CanvasNodeType.Text,
                title: "Agent 写的一句话",
                position: { x: rightmost + 80, y: 80 },
                width: 360,
                height: 220,
                metadata: { content: text, textFormat: "plain", prompt: text, status: "success" },
            };
            store.updateProject(canvasId, { nodes: [...project.nodes, node] });
            void flushCanvasStorePersistence();
        }
        setInserted(id);
        setTimeout(() => setInserted(""), 1800);
    };

    /** 把整理好的内容交给 Agent 出片：先确认价格，再提交，最后写回同一张画布。 */
    const handOffToAgent = (text: string) => {
        if (!apiKey.trim()) {
            ll2OpenKeyDialog();
            return;
        }
        setVideoDraft(ll2CleanVideoPrompt(text));
        setVideoStage("confirm");
        setVideoError("");
        setVideoResult(null);
        setVideoProgress(null);
        setDownloadMessage("");
    };

    const closeVideo = () => {
        videoAbortRef.current?.abort();
        setVideoStage("idle");
        setVideoProgress(null);
        setVideoError("");
    };

    const writeResultIntoCanvas = (prompt: string, film: LL2Film) => {
        if (!canvasId) return;
        const payload: CanvasVideoInsert = {
            url: film.url,
            title: "Agent 生成的片子",
            prompt,
            model: film.model,
            seconds: film.seconds,
            resolution: film.resolution,
            taskId: film.taskId,
        };
        const context = useGlobalAgentStore.getState().canvas;
        if (context?.canvasId === canvasId && context.insertAgentText && context.insertAgentVideo) {
            // 文本助手写清楚的内容 + Agent 生成的片子，挨着放在同一张画布里。
            context.insertAgentText(prompt, "交给 Agent 的提示词");
            context.insertAgentVideo(payload);
            return;
        }
        // 兜底：画布还没发布上下文时，直接写本机画布，刷新后仍在。
        const store = useCanvasStore.getState();
        const project = store.projects.find((item) => item.id === canvasId);
        if (!project) return;
        const rightmost = project.nodes.reduce((max, node) => Math.max(max, node.position.x + node.width), 80);
        const nodes = ll2BuildCanvasNodes(prompt, film, rightmost);
        store.updateProject(canvasId, { nodes: [...project.nodes, ...nodes] });
        void flushCanvasStorePersistence();
    };

    const runVideo = async () => {
        const prompt = videoDraft.trim();
        if (!prompt) {
            setVideoError("先写一句要拍的画面，再交给 Agent");
            return;
        }
        setVideoStage("running");
        setVideoError("");
        setVideoResult(null);
        const controller = new AbortController();
        videoAbortRef.current = controller;
        try {
            const { outcome, film } = await ll2RunCanvasAgent({
                apiKey,
                prompt,
                settings,
                signal: controller.signal,
                onProgress: setVideoProgress,
            });
            writeResultIntoCanvas(prompt, film);
            setVideoResult(film);
            setVideoCost({ label: outcome.actualLabel, basis: outcome.actualBasis });
            setVideoStage("done");
        } catch (cause) {
            if (cause instanceof DOMException && cause.name === "AbortError") {
                setVideoError("已停止等待。任务可能还在生成，费用以 LL2 控制台账单为准");
            } else {
                setVideoError(`${cause instanceof Error ? cause.message : "生成失败，请稍后重试"} · 再试一次会新建任务`);
            }
            setVideoStage("error");
        } finally {
            setVideoProgress(null);
            videoAbortRef.current = null;
        }
    };

    const starters = inCanvas ? CANVAS_STARTERS : AGENT_STARTERS;
    const isAgent = !inCanvas;

    if (!open) {
        // 首页已经有「聊天改稿」页签和「打开聊天改稿」按钮，再挂一个悬浮按钮
        // 只是重复入口，还会压住底部示例卡片和「开始创作」。其它页面保留悬浮入口。
        // /models 是满宽价格表，右下角悬浮按钮会压住「一次大概多少」那一列；价格页不是创作页。
        if (pathname === "/models") return null;
        return (
            <button type="button" className={`ll2-agent-fab${inCanvas ? " is-canvas" : " is-agent"}`} onClick={() => setOpen(true)} aria-label={inCanvas ? "打开画布里的 Agent" : "打开 DMC Agent"}>
                <span className="ll2-agent-fab-orb" aria-hidden>
                    <Sparkles className="size-3.5" />
                </span>
                <span>{inCanvas ? "画布 Agent" : "Agent"}</span>
            </button>
        );
    }

    return (
        <aside className={`ll2-agent${inCanvas ? " is-canvas" : " is-agent"}`} aria-label={inCanvas ? "画布里的 Agent" : "DMC Agent"}>
            <header className="ll2-agent-head">
                {isAgent ? (
                    <>
                        <span className="ll2-agent-avatar" aria-hidden>
                            <Sparkles className="size-4" />
                        </span>
                        <span className="ll2-agent-identity">
                            <strong>DMC Agent</strong>
                            <small>写提示词 · 运镜 · 代码 · 随便问</small>
                        </span>
                        <button type="button" className="ll2-agent-icon" onClick={clear} aria-label="新对话" title="新对话">
                            <Plus className="size-4" />
                        </button>
                    </>
                ) : (
                    <>
                        <button type="button" className="ll2-agent-new" onClick={clear}>
                            <Plus className="size-3.5" /> 新对话
                        </button>
                        <span className="ll2-agent-head-meta">画布助手 · 我们的文本模型</span>
                    </>
                )}
                <button type="button" className="ll2-agent-icon" onClick={() => setOpen(false)} aria-label="收起助手">
                    <X className="size-4" />
                </button>
            </header>

            <div className="ll2-agent-scroll" ref={listRef}>
                {messages.length === 0 ? (
                    <div className="ll2-agent-welcome">
                        {inCanvas ? <span className="ll2-agent-orb" aria-hidden /> : null}
                        <h2>{inCanvas ? "先把想法写清楚，再交给 Agent 出片" : "我是 DMC Agent，想让我帮你做什么？"}</h2>
                        <p>
                            {inCanvas
                                ? "写漫剧、短剧，或问问提示词该怎么写。想清楚了，点「交给 Agent 出片」，片子会直接放进这张画布。"
                                : "写提示词、设计运镜、写代码、改脚本，或者随便聊两句。"}
                        </p>
                        <div className="ll2-agent-starters">
                            {starters.map((starter) => (
                                <button key={starter.title} type="button" onClick={() => void send(starter.prompt, starter.shape ? LL2_PROMPT_SYSTEM : undefined)} disabled={running}>
                                    <span>
                                        <strong>{starter.title}</strong>
                                        <small>{starter.hint}</small>
                                    </span>
                                    <ArrowUp className="size-3.5" />
                                </button>
                            ))}
                        </div>
                        <p className="ll2-agent-tip">
                            {inCanvas ? "先点「整理成出片提示词」，再点「交给 Agent 出片」，片子会放进这张画布。" : "写好的画面描述，可以一键「去出片」送进一句话成片。"}
                        </p>
                    </div>
                ) : (
                    <div className="ll2-agent-messages">
                        {messages.map((message) => (
                            <div key={message.id} className={`ll2-agent-msg is-${message.role}`}>
                                <AgentMessageText text={message.text} />
                                {message.role === "assistant" ? (
                                    <div className="ll2-agent-msg-foot">
                                        <span>{ll2TextModelName(message.model || model)} · 本次 {message.costLabel || "几乎不花钱"}</span>
                                        <div className="ll2-agent-msg-actions">
                                            <button type="button" onClick={() => void copy(message.text, message.id)} title="复制">
                                                {copied === message.id ? <Check className="size-3" /> : <Copy className="size-3" />}
                                                {copied === message.id ? "已复制" : "复制"}
                                            </button>
                                            {inCanvas ? (
                                                <button type="button" className="is-primary" onClick={() => handOffToAgent(message.text)} title="把这段内容交给 Agent 生成视频，并放进这张画布">
                                                    <Sparkles className="size-3" /> 交给 Agent 出片
                                                </button>
                                            ) : (
                                                <button type="button" onClick={() => navigate(ll2PromptUrl(ll2CleanVideoPrompt(message.text)))} title="送去一句话成片">
                                                    <Sparkles className="size-3" /> 去出片
                                                </button>
                                            )}
                                            <button type="button" onClick={() => insertIntoCanvas(message.text, message.id)} title="把这段文字记到画布上">
                                                {inserted === message.id ? <Check className="size-3" /> : <FileText className="size-3" />}
                                                {inserted === message.id ? "已放入" : "记到画布"}
                                            </button>
                                        </div>
                                        {message.costBasis ? <small>{message.costBasis}</small> : null}
                                    </div>
                                ) : null}
                            </div>
                        ))}
                        {running ? (
                            <div className="ll2-agent-msg is-assistant is-pending">
                                <LoaderCircle className="size-3.5 is-spinning" /> 正在写…
                            </div>
                        ) : null}
                    </div>
                )}
            </div>

            {inCanvas && estimate && videoStage !== "idle" ? (
                <div className="ll2-agent-video" aria-label="交给 Agent 出片">
                    <div className="ll2-agent-video-head">
                        <Film className="size-3.5" aria-hidden />
                        <strong>Agent 出片</strong>
                        <button type="button" onClick={closeVideo} aria-label="收起出片步骤"><X className="size-3.5" /></button>
                    </div>

                    {videoStage === "confirm" ? (
                        <>
                            <p className="ll2-agent-video-note">这是要交给 Agent 的画面描述，可以再改改：</p>
                            <textarea value={videoDraft} onChange={(event) => setVideoDraft(event.target.value)} rows={3} aria-label="交给 Agent 的画面描述" />
                            <div className="ll2-agent-video-price">
                                <span>{estimate.description}</span>
                                <strong>{estimate.label}</strong>
                            </div>
                            <small>{estimate.basis}</small>
                            <div className="ll2-agent-video-actions">
                                <button type="button" className="is-primary" onClick={() => void runVideo()}>确认出片 · {estimate.label}</button>
                                <button type="button" onClick={closeVideo}>先不出</button>
                            </div>
                            <small>点确认才提交任务。取消只是停止等待，费用以 LL2 控制台账单为准。</small>
                        </>
                    ) : null}

                    {videoStage === "running" ? (
                        <>
                            <p className="ll2-agent-video-note">
                                <LoaderCircle className="size-3.5 is-spinning" /> 任务已受理 · {videoProgress?.status || "排队中"} · 已等待 {Math.round((videoProgress?.elapsedMs || 0) / 1000)} 秒
                            </p>
                            <div className="ll2-agent-video-actions">
                                <button type="button" onClick={() => videoAbortRef.current?.abort()}><Square className="size-3" /> 停止等待</button>
                            </div>
                            <small>生成通常要一两分钟，关掉这个小窗口也不会让任务白跑。</small>
                        </>
                    ) : null}

                    {videoStage === "done" && videoResult ? (
                        <>
                            <p className="ll2-agent-video-note">已经放进这张画布了：提示词和片子挨着摆，方便接着改。</p>
                            <div className="ll2-agent-video-price">
                                <span>实际扣费</span>
                                <strong>{videoCost.label}</strong>
                            </div>
                            <small>{videoCost.basis}</small>
                            <small>生成的片子在云端保留 24 小时，请及时下载到这台电脑。</small>
                            <div className="ll2-agent-video-actions">
                                <button type="button" onClick={async () => setDownloadMessage((await ll2DownloadFilm(videoResult)).message)}><Download className="size-3" /> 下载到本机</button>
                                <Link to="/films"><Film className="size-3" /> 我的片子</Link>
                            </div>
                            {downloadMessage ? <small>{downloadMessage}</small> : null}
                            <small>再做一版会新建任务、重新计费。</small>
                        </>
                    ) : null}

                    {videoStage === "error" ? (
                        <>
                            <p className="ll2-agent-video-note is-error" role="alert">{videoError}</p>
                            <div className="ll2-agent-video-actions">
                                <button type="button" className="is-primary" onClick={() => void runVideo()}>再试一次（会新建任务）</button>
                                <button type="button" onClick={closeVideo}>关闭</button>
                            </div>
                        </>
                    ) : null}
                </div>
            ) : null}

            {error ? <div className="ll2-agent-error" role="alert">{error}</div> : null}

            <div className="ll2-agent-compose">
                <div className="ll2-agent-context">
                    {inCanvas ? `正在这张画布里 · ${canvasProject?.title || "本机画布"}` : isAgent ? "DMC Agent · 写提示词 / 运镜 / 代码" : "还没打开画布"}
                </div>
                <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            void send(draft);
                        }
                    }}
                    placeholder={inCanvas ? "想写漫剧、短剧，或不知道提示词怎么写？先说一句…" : "写提示词、设计运镜、写代码，或直接说你要做什么…"}
                    rows={3}
                    disabled={running}
                />
                <div className="ll2-agent-compose-bar">
                    <LL2Select
                        value={model}
                        onChange={(nextValue) => setModel(nextValue)}
                        ariaLabel="选一个写得顺手的"
                        title="换一个写法"
                        options={LL2_TEXT_MODELS.map((item) => ({ value: item.id, label: item.name }))}
                    />
                    <button type="button" className="ll2-agent-send" onClick={() => void send(draft)} disabled={running || !draft.trim()}>
                        {running ? <LoaderCircle className="size-3.5 is-spinning" /> : <ArrowUp className="size-3.5" />} 发送
                    </button>
                </div>
                <div className="ll2-agent-compose-foot">
                    <button type="button" className="ll2-agent-foot-link" onClick={ll2OpenKeyDialog}>{apiKey.trim() ? "已连接 LL2" : "连接 LL2"}</button>
                    <Link to="/models">模型广场 · {LL2_MODELS.length} 个模型 →</Link>
                </div>
            </div>

            {messages.length ? (
                <button type="button" className="ll2-agent-clear" onClick={clear}>
                    <Trash2 className="size-3" /> 清空本次对话
                </button>
            ) : null}
        </aside>
    );
}
