import { ArrowRight, AtSign, Check, Download, Film, LoaderCircle, Plus, Sparkles, Square, UploadCloud, Wand2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { LL2AssetLibrary } from "./ll2-asset-library";

import {
    LL2_CONNECTED_VIDEO_MODELS,
    LL2_VIDEO_DURATION,
    ll2FormatCNY,
    ll2FriendlyCNY,
    ll2PreciseCNY,
    ll2SpecFor,
    ll2TiersFor,
    type LL2ConnectedVideoModel,
} from "@/lib/ll2-models";
import { ll2ReadSettings, ll2WriteSettings } from "@/lib/ll2-workspace";
import { ll2AddFilm, ll2DownloadFilm, type LL2Film } from "@/services/ll2/ll2-films";
import { ll2AssetIdByTitle, ll2AssetToMediaInput } from "@/services/ll2/ll2-assets";
import {
    ll2ApplyMentionTags,
    ll2BuildMediaContent,
    ll2MediaModeLabel,
    ll2MediaSummary,
    ll2MentionToken,
    ll2ParseMentionTitles,
    ll2ReadDroppedImage,
    ll2ValidateMedia,
    type LL2MediaInput,
} from "@/services/ll2/ll2-media";
import { ll2FetchHdBlob, ll2RunHd, type LL2HdProgress } from "@/services/ll2/ll2-hd";
import { ll2GenerateVideo, type LL2VideoProgress } from "@/services/ll2/ll2-video";
import { LL2_DEFAULT_TEXT_MODEL, ll2ChatText } from "@/services/ll2/ll2-text";
import { ll2UpscaleEstimate, ll2UpscaleTargetLabel, ll2UpscaleTargetsFor, type LL2UpscaleTarget } from "@/lib/ll2-upscale";
import { useLL2AgentStore } from "@/stores/use-ll2-agent-store";
import { ll2OpenKeyDialog, useLL2Store } from "@/stores/use-ll2-store";
import { LL2SaveAssetDialog, type LL2SaveAssetDraft } from "@/components/ll2/ll2-save-asset-dialog";
import { LL2Select } from "@/components/ll2/ll2-select";

type Tab = "video" | "text" | "chat";

// 默认停在「视频」。拖一张图常驻在这一页给小白；「素材库 @」打开资产库，
// 上传后在句子里 @ 引用，可以引用很多张图和视频 —— 两者不是同一个入口。
const TABS: { id: Tab; label: string; action?: boolean }[] = [
    { id: "video", label: "视频" },
    { id: "text", label: "文本" },
    { id: "chat", label: "聊天改稿" },
];

type QuickIdea = { title: string; hint: string; prompt: string; mode: "video" | "text" };

/** 四张起步卡片：每张带一行白话说明，点一下把示例「填进去」，不删用户已写的内容。 */
const QUICK_IDEAS: QuickIdea[] = [
    { title: "生成第一个镜头", hint: "描述画面、镜头怎么动、光线什么样", mode: "video", prompt: "黄昏的海面，镜头缓缓向前推进，云在移动，远处有一艘小船，金色反光从画面右下角扫过" },
    { title: "照一张图出片", hint: "拖一张图进来，照它的样子拍", mode: "video", prompt: "照参考图的色调与构图，镜头缓慢向前推进，保持光线与材质一致" },
    { title: "加一段运镜", hint: "让镜头推近、拉远，或绕着主体转一圈", mode: "video", prompt: "镜头从人物背后缓缓推近，越过肩膀看见前方的街道，最后停在一盏亮着的路灯上" },
    { title: "帮我写提示词", hint: "不会写画面？先聊两句，帮你写成一句话", mode: "text", prompt: "帮我把「一个雨夜的街角」写成可以直接生成视频的画面提示词" },
];

/**
 * 影策·体验站「一句话想法」那一块，按 C 端白话重画：
 * 一个大输入框 + 一张拖图 + @ 引用资产库 + 一排参数 + 开始创作。
 *
 * 两条素材来源（用户 17:26 口径），合并后仍只有一条生成链路：
 *   拖进框里：只收 1 张图片，给小白「让这张图动起来」
 *   @ 引用：从本机资产库选，可以多张图 / 多段视频
 *   1 张图=首帧，2 张图=首尾帧，≥3 或含视频=多参考，见 ll2-media.ts 契约。
 * 界面不出现「文生 / 图生 / 视频生视频 / 首尾帧」这些专业词。
 */
export function LL2OneShot() {
    const apiKey = useLL2Store((state) => state.apiKey);
    const connected = Boolean(apiKey.trim());
    const openAgentWith = useLL2AgentStore((state) => state.openWith);
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const settings = useMemo(() => ll2ReadSettings(), []);

    const [tab, setTab] = useState<Tab>("video");
    const [model, setModel] = useState<LL2ConnectedVideoModel>(settings.videoModel);
    const [resolution, setResolution] = useState(settings.resolution);
    const [seconds, setSeconds] = useState(settings.seconds);
    const [ratio, setRatio] = useState(settings.ratio);
    const [prompt, setPrompt] = useState("");
    const [running, setRunning] = useState(false);
    const [polishing, setPolishing] = useState(false);
    const [polishNote, setPolishNote] = useState("");
    const polishAbortRef = useRef<AbortController | null>(null);
    const [progress, setProgress] = useState<LL2VideoProgress | null>(null);
    const [error, setError] = useState("");
    const [hint, setHint] = useState("");
    const [result, setResult] = useState<{ film: LL2Film; label: string; basis: string; previewUrl?: string } | null>(null);
    /** 生成后是否顺便超分：默认不勾，客户不勾就不多花钱。 */
    const [upscale, setUpscale] = useState<LL2UpscaleTarget | "">("");
    const [promptOptimizer, setPromptOptimizer] = useState(settings.promptOptimizer);
    const [hdProgress, setHdProgress] = useState<LL2HdProgress | null>(null);
    const [downloadMessage, setDownloadMessage] = useState("");
    /** media 只放「拖进来的那一张图」；@ 引用的素材从提示词里的 @[名称] 解析。 */
    const [media, setMedia] = useState<LL2MediaInput[]>([]);
    const [mediaBusy, setMediaBusy] = useState(false);
    const [saveAssetDraft, setSaveAssetDraft] = useState<LL2SaveAssetDraft | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const [libraryOpen, setLibraryOpen] = useState(false);
    const [mentionAnchor, setMentionAnchor] = useState<number | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    /** 超分结果要带 Key 下载成 blob 才能播，临时 objectURL 用完要回收。 */
    const previewUrlRef = useRef<string>("");
    /** 等待计时器：不依赖网关轮询，每秒自己走，页面看起来是活的。 */
    const waitStartRef = useRef(0);
    const [waitSeconds, setWaitSeconds] = useState(0);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const promptRef = useRef<HTMLTextAreaElement | null>(null);
    const plusRef = useRef<HTMLButtonElement | null>(null);
    const [libraryAnchor, setLibraryAnchor] = useState<{ left: number; top: number } | null>(null);
    // 读文件是异步的。用 ref 保存最新拖图 + 同步互斥，避免连续拖两次互相覆盖。
    const mediaRef = useRef<LL2MediaInput[]>([]);
    const mediaBusyRef = useRef(false);
    // React 18 StrictMode 会把 effect 连跑两遍，而 navigate(replace) 是异步的：
    // 第二遍跑到时 ?quote= 还没从 URL 上消失，同一个 @ 引用会被插两次。
    // 用「本轮 query 串」做一次性闸门，同一串参数只消费一次。
    const consumedQueryRef = useRef<string | null>(null);

    // 资产页点「@ 引用」会带 ?quote=素材名 回来；插进句子后清掉参数，刷新不会重复插入。
    // 灵感广场「用这个想法」会把提示词和推荐规格放在 ?prompt= 里带回来。
    useEffect(() => {
        const token = searchParams.toString();
        if (consumedQueryRef.current === token) return;
        consumedQueryRef.current = token;

        const quoteTitle = searchParams.get("quote");
        if (quoteTitle) {
            setTab("video");
            setPrompt((previous) => `${previous.trim()}${previous.trim() ? " " : ""}@[${quoteTitle}] `);
            setHint(`已引用「${quoteTitle}」。写一句话说清你想要的画面就能出片；想再引用别的素材，打 @ 就行。`);
            navigate("/", { replace: true });
            return;
        }
        const incoming = searchParams.get("prompt");
        if (!incoming) return;
        setPrompt(incoming);
        setTab(searchParams.get("mode") === "text" ? "text" : "video");
        const modelParam = searchParams.get("model");
        const nextModel = modelParam === "wan3.0-video" || modelParam === "MiniMax-H3" ? modelParam : null;
        if (nextModel) {
            const available = ll2TiersFor(nextModel);
            const resolutionParam = (searchParams.get("resolution") || "").toLowerCase();
            const nextResolution = available.find((tier) => tier.resolution.toLowerCase() === resolutionParam)?.resolution || available[0]?.resolution || "768P";
            const range = LL2_VIDEO_DURATION[nextModel];
            const requested = Number(searchParams.get("seconds"));
            const nextSeconds = Number.isFinite(requested) && requested > 0 ? Math.min(range.max, Math.max(range.min, requested)) : range.default;
            setModel(nextModel);
            setResolution(nextResolution);
            setSeconds(nextSeconds);
            ll2WriteSettings({ ...ll2ReadSettings(), videoModel: nextModel, resolution: nextResolution, seconds: nextSeconds });
        }
        // 灵感想法同样只落地一次，免得刷新页面又盖掉用户刚改好的句子。
        navigate("/", { replace: true });
    }, [searchParams, navigate]);

    useEffect(() => () => abortRef.current?.abort(), []);

    // 等待期间每秒刷新「已等待 N 秒」，不要等 5 秒一次的轮询才动。
    useEffect(() => {
        if (!running) {
            setWaitSeconds(0);
            return;
        }
        const timer = window.setInterval(() => {
            setWaitSeconds(Math.max(0, Math.floor((Date.now() - waitStartRef.current) / 1000)));
        }, 1000);
        return () => window.clearInterval(timer);
    }, [running]);

    const tiers = useMemo(() => ll2TiersFor(model), [model]);
    const range = LL2_VIDEO_DURATION[model];
    const estimate = ll2PreciseCNY(model, seconds, resolution);
    const upscaleTargets = useMemo(() => ll2UpscaleTargetsFor(resolution), [resolution]);

    useEffect(() => {
        // 换模型/清晰度后，原来选的超分档可能不合法（比如已经是 4K），自动收回。
        setUpscale((current) => (current && upscaleTargets.some((target) => target.id === current) ? current : ""));
    }, [upscaleTargets]);
    const hdEstimate = upscale ? ll2UpscaleEstimate(seconds, upscale) : null;
    // 合计只用于展示：生成 + 超分是两笔账单，明细里分开写。
    const totalLabel = hdEstimate ? `约 ${ll2FriendlyCNY(estimate.amount + hdEstimate.amount)}` : estimate.label;
    const totalBasis = hdEstimate ? `生成 ${estimate.label} + 超分 ${hdEstimate.label} · 按 LL2 官网单价估算` : estimate.basis;
    // 等待态只留一句「正在生成」，不写解释文字。
    const waiting = !running
        ? null
        : hdProgress
            ? { title: hdProgress.stage === "downloading" ? "正在取回高清版" : "正在超分" }
            : { title: "正在生成" };
    const spec = ll2SpecFor(model);
    const mentionTitles = useMemo(() => ll2ParseMentionTitles(prompt), [prompt]);
    const hasMedia = media.length > 0;
    const hasAnyReference = hasMedia || mentionTitles.length > 0;
    const modeLabel = mentionTitles.length
        ? `已 @ 引用 ${mentionTitles.length} 个素材`
        : ll2MediaModeLabel(ll2BuildMediaContent(media).mode);

    const syncSettings = (patch: Partial<typeof settings>) => ll2WriteSettings({ ...settings, ...patch });

    /** 拖图 / 选图：不再直接当首帧，而是先存进本机资产库，之后在句子里 @ 引用它。 */
    const addDroppedImage = async (files: File[]) => {
        if (running || mediaBusyRef.current || !files.length) return;
        mediaBusyRef.current = true;
        setMediaBusy(true);
        setError("");
        setHint("");
        try {
            const file = files[0];
            const item = await ll2ReadDroppedImage(file);
            setSaveAssetDraft({ file, dataUrl: item.dataUrl, name: item.name.replace(/\.[^.]+$/, "") });
            if (files.length > 1) setHint("一次只收一张图，其它几张没放进来；要存的话再拖一次。");
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "这张图读不了，换一张试试");
        } finally {
            mediaBusyRef.current = false;
            setMediaBusy(false);
            setDragOver(false);
        }
    };

    /** 打开素材库；anchor 是「打 @ 触发」时光标所在位置，选中后把引用插回这里。 */
    const openLibrary = (anchor: number | null = null) => {
        setTab("video");
        setMentionAnchor(anchor);
        setError("");
        // 菜单贴着「＋」或输入框底部弹出（和画布 @ 菜单同一种用法），不再整屏弹抽屉。
        const trigger = anchor === null ? plusRef.current : promptRef.current;
        const rect = trigger?.getBoundingClientRect();
        setLibraryAnchor(rect ? { left: rect.left, top: rect.bottom + 8 } : null);
        setLibraryOpen(true);
    };

    /** 把 @[素材名] 插到 anchor 处；anchor 为空则追加到句尾。拖图「保存并引用」与素材库 @ 共用这段。 */
    const applyMention = (token: string, anchor: number | null) => {
        setPrompt((previous) => {
            const pos = typeof anchor === "number" ? Math.min(anchor, previous.length) : previous.length;
            const before = previous.slice(0, pos);
            const spacer = before && !/\s$/.test(before) ? " " : "";
            return `${before}${spacer}${token} ${previous.slice(pos)}`;
        });
    };

    const insertMention = (token: string) => {
        applyMention(token, mentionAnchor);
        setLibraryOpen(false);
        setMentionAnchor(null);
        setHint(`已引用 ${token}。句子里的 @ 会和素材一起送去生成。`);
    };

    /** 在句子里打 @ 就弹出素材库；触发用的那个 @ 不留在文本里，避免变成 @@[名称]。 */
    const handlePromptChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
        const next = event.target.value;
        const caret = event.target.selectionStart ?? next.length;
        if (caret > 0 && next[caret - 1] === "@") {
            setPrompt(next.slice(0, caret - 1) + next.slice(caret));
            openLibrary(caret - 1);
            return;
        }
        setPrompt(next);
    };

    /** 一句话成片里的 AI 润色：直接把用户这句话改写成可出片的画面提示词。 */
    const polishPrompt = async () => {
        const text = prompt.trim();
        if (!text || polishing || !connected) return;
        const controller = new AbortController();
        polishAbortRef.current = controller;
        setPolishing(true);
        setPolishNote("");
        try {
            const result = await ll2ChatText({
                apiKey,
                model: LL2_DEFAULT_TEXT_MODEL,
                temperature: 0.6,
                signal: controller.signal,
                messages: [
                    {
                        role: "system",
                        content:
                            "你是短视频与漫剧的画面提示词编辑。把用户这句话改写成可以直接交给视频模型的中文提示词：保留原意和人物/场景设定，补足主体、动作、场景、光线、镜头运动与风格；不要添加与原意冲突的内容，不要解释、不要分点、不要加引号，只输出润色后的提示词，控制在 300 字以内。",
                    },
                    { role: "user", content: text },
                ],
            });
            const cleaned = result.text
                .trim()
                .replace(/^[“”"']+|[“”"']+$/g, "")
                .trim();
            if (!cleaned) throw new Error("没有拿到润色结果，再试一次");
            setPrompt(cleaned);
            promptRef.current?.focus();
            setPolishNote("已润色 · " + result.costLabel);
        } catch (error) {
            if (!controller.signal.aborted) setPolishNote(error instanceof Error ? error.message : "润色失败，稍后再试");
        } finally {
            setPolishing(false);
            polishAbortRef.current = null;
        }
    };
    const removeMedia = (id: string) => {
        if (running) return;
        setMedia((previous) => {
            const next = previous.filter((item) => item.id !== id);
            mediaRef.current = next;
            return next;
        });
        setHint("");
        setError("");
    };

    const openFilePicker = () => {
        setTab("video");
        if (!running) fileInputRef.current?.click();
    };

    const onSectionDragOver = (event: DragEvent<HTMLElement>) => {
        if (running || mediaBusyRef.current || !Array.from(event.dataTransfer.types).includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDragOver(true);
    };

    const onSectionDragLeave = (event: DragEvent<HTMLElement>) => {
        // 只有在真正离开整个输入区时才收起高亮，避免掠过子元素时闪烁。
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
    };

    const onSectionDrop = (event: DragEvent<HTMLElement>) => {
        if (running || mediaBusyRef.current) return;
        const files = Array.from(event.dataTransfer.files || []);
        if (!files.length) return;
        event.preventDefault();
        setTab("video");
        void addDroppedImage(files);
    };

    /** 超分版要带 Bearer 下载成 blob 再存；普通片子沿用原来的直链下载。 */
    const downloadResult = async () => {
        if (!result) return;
        if (!result.film.requiresAuth) {
            setDownloadMessage((await ll2DownloadFilm(result.film)).message);
            return;
        }
        try {
            const blob = await ll2FetchHdBlob(result.film.url, apiKey);
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `LL2_${result.film.resolution.replace(/[^\w.-]+/g, "_")}_${result.film.seconds}s.mp4`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
            setDownloadMessage("已下载到本机");
        } catch (cause) {
            setDownloadMessage(cause instanceof Error ? cause.message : "下载失败，请稍后再试");
        }
    };

    const start = async () => {
        if (!connected) {
            ll2OpenKeyDialog();
            return;
        }
        if (!prompt.trim()) {
            setError("先写一句话，说清你想要的画面");
            return;
        }
        setError("");
        setHint("");
        setResult(null);
        setDownloadMessage("");
        if (previewUrlRef.current) {
            URL.revokeObjectURL(previewUrlRef.current);
            previewUrlRef.current = "";
        }
        setRunning(true);
        waitStartRef.current = Date.now();
        setWaitSeconds(0);
        const controller = new AbortController();
        abortRef.current = controller;
        // 准备 / 生成 / 超分三段，错误文案要分清是哪一段失败。
        let phase: "prepare" | "generate" | "upscale" = "prepare";
        let generated: { film: LL2Film; label: string; basis: string; previewUrl?: string } | null = null;
        try {
            // @ 引用按提示词里出现的顺序还原成素材；资产库里的视频可能要从本机 Blob 读出来。
            const mentioned: LL2MediaInput[] = [];
            for (const title of ll2ParseMentionTitles(prompt)) {
                const assetId = ll2AssetIdByTitle(title);
                if (!assetId) throw new Error(`引用的「${title}」不在素材库里了，请重新 @ 选一次`);
                mentioned.push(await ll2AssetToMediaInput(assetId));
            }
            const allMedia = [...media, ...mentioned];
            const mediaCheck = ll2ValidateMedia(allMedia);
            if (!mediaCheck.ok) throw new Error(mediaCheck.message);
            const build = ll2BuildMediaContent(allMedia);
            const finalPrompt = ll2ApplyMentionTags(prompt, build, media.length);
            if (!finalPrompt.trim()) throw new Error("先写一句话，说清你想要的画面");

            phase = "generate";
            const outcome = await ll2GenerateVideo(
                { apiKey, model, prompt: finalPrompt, seconds, resolution, ratio, signal: controller.signal, media: build.items, promptOptimizer },
                setProgress,
            );
            const film = ll2AddFilm({
                id: outcome.taskId,
                taskId: outcome.taskId,
                model: outcome.model,
                // 作品库里存用户原句，不存自动加的 <Picture N> 标签，读起来干净。
                prompt: prompt.trim(),
                seconds: outcome.seconds,
                chargedSeconds: outcome.chargedSeconds,
                resolution: outcome.resolution,
                ratio: outcome.ratio,
                estimateCNY: outcome.estimateCNY,
                actualCNY: outcome.actualCNY,
                url: outcome.url,
                createdAt: outcome.createdAt,
                requiresAuth: outcome.requiresAuth,
            }).find((item) => item.id === outcome.taskId)!;
            if (outcome.previewUrl) previewUrlRef.current = outcome.previewUrl;
            generated = { film, label: outcome.actualLabel, basis: outcome.actualBasis, previewUrl: outcome.previewUrl };
            if (!upscale) {
                setResult(generated);
            } else {
                // 超分是第二段：必须等生成拿到公网直链后才能提交 /hd/tasks。
                phase = "upscale";
                setProgress(null);
                waitStartRef.current = Date.now();
                setWaitSeconds(0);
                setHint(`片子生成好了，正在超分到 ${ll2UpscaleTargetLabel(upscale)}…`);
                const hd = await ll2RunHd(
                    { apiKey, videoUrl: outcome.url, resolution: upscale, duration: outcome.seconds, signal: controller.signal },
                    setHdProgress,
                );
                setHdProgress((current) => (current ? { ...current, stage: "downloading" } : current));
                const blob = await ll2FetchHdBlob(hd.url, apiKey, controller.signal);
                const previewUrl = URL.createObjectURL(blob);
                previewUrlRef.current = previewUrl;
                const hdFilm = ll2AddFilm({
                    id: `hd-${hd.taskId}`,
                    taskId: hd.taskId,
                    model: outcome.model,
                    prompt: prompt.trim(),
                    seconds: outcome.seconds,
                    chargedSeconds: outcome.chargedSeconds,
                    resolution: ll2UpscaleTargetLabel(hd.resolution),
                    ratio: outcome.ratio,
                    estimateCNY: hdEstimate?.amount || 0,
                    actualCNY: hdEstimate?.amount || 0,
                    url: hd.url,
                    createdAt: Date.now(),
                    requiresAuth: true,
                    upscaledFrom: outcome.taskId,
                }).find((item) => item.id === `hd-${hd.taskId}`)!;
                setResult({
                    film: hdFilm,
                    label: `超分 ${hdEstimate?.label || ""}`,
                    basis: `${hdEstimate?.basis || ""} · 原片也留在「我的片子」`,
                    previewUrl,
                });
                setHint(`已超分到 ${ll2UpscaleTargetLabel(hd.resolution)}，可以直接下载高清版；原片也留着。`);
            }
        } catch (cause) {
            if (cause instanceof DOMException && cause.name === "AbortError") {
                setError(phase === "upscale" ? "已停止等待超分，原片已经生成好了" : "已停止等待。任务可能还在生成，费用以 LL2 控制台账单为准");
            } else {
                const message = cause instanceof Error ? cause.message : "生成失败，请稍后重试";
                if (phase === "upscale" && generated) {
                    // 超分失败不能把已经生成的片子吞掉：结果卡退回原片，再给一句可重试的说明。
                    setResult(generated);
                    setError(`片子已经生成好了；超分没成功，可以再点一次试试。${message}`);
                } else {
                    setError(phase === "generate" ? `${message} · 再试一次会新建任务` : message);
                }
            }
        } finally {
            setRunning(false);
            setProgress(null);
            setHdProgress(null);
            abortRef.current = null;
        }
    };

    const switchTab = (next: Tab) => {
        setTab(next);
        setError("");
        setHint("");
        // 不自动拉开右侧助手：它会盖住起步卡片（尤其是最右那张）。
    };

    /** 起步卡片只「填入示例」：已有内容就接在后面，绝不覆盖。 */
    const fillExample = (idea: QuickIdea) => {
        setPrompt((previous) => (previous.trim() ? `${previous.trim()}\n${idea.prompt}` : idea.prompt));
        setTab(idea.mode);
        setError("");
        setHint(`已把「${idea.title}」的示例填进去，你原来写的内容还在。`);
    };

    return (
        <>
            <section
                className={`ll2-oneshot${dragOver ? " is-drag-over" : ""}`}
                aria-label="一句话想法"
                onDragOver={onSectionDragOver}
                onDragLeave={onSectionDragLeave}
                onDrop={onSectionDrop}
            >
                <div className="ll2-oneshot-tabs" role="tablist" aria-label="创作类型">
                    {TABS.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            role={item.action ? undefined : "tab"}
                            aria-selected={item.action ? undefined : tab === item.id}
                            className={!item.action && tab === item.id ? "is-active" : ""}
                            onClick={() => switchTab(item.id)}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>

                <input
                    ref={fileInputRef}
                    className="ll2-oneshot-file-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                    hidden
                    onChange={(event) => {
                        void addDroppedImage(Array.from(event.target.files || []));
                        event.target.value = "";
                    }}
                />

                {tab === "video" || tab === "text" ? (
                    <>
                        <textarea
                            ref={promptRef}
                            className="ll2-oneshot-input"
                            value={prompt}
                            onChange={handlePromptChange}
                            placeholder={tab === "video" ? "写一句话，说清你想拍的画面。打 @ 可以引用素材库里的图片" : "想写漫剧、短剧，或不知道提示词怎么写？先说一句，我们的文本模型帮你理清"}
                            rows={3}
                            maxLength={7000}
                            disabled={running}
                        />

                        {tab === "video" ? (
                            <div className="ll2-oneshot-polish">
                                <button
                                    type="button"
                                    className="ll2-oneshot-polish-btn"
                                    onClick={() => void polishPrompt()}
                                    disabled={!connected || !prompt.trim() || running || polishing}
                                    title={connected ? "让文本模型把这句话润色成更容易出片的画面提示词" : "先连接 LL2 才能润色"}
                                >
                                    {polishing ? <LoaderCircle className="size-3.5 is-spinning" aria-hidden /> : <Wand2 className="size-3.5" aria-hidden />}
                                    {polishing ? "正在润色…" : "AI 润色提示词"}
                                </button>
                                {polishNote ? <span className="ll2-oneshot-polish-note">{polishNote}</span> : null}
                            </div>
                        ) : null}

                        {/* 没填 Key 之前不露任何模型 / 分辨率 / 价格；填了之后按
                            「模型 → 分辨率 → 单价 → 时长 → 本次一共」逐项排清楚。 */}
                        {connected && tab === "video" ? (
                            <div className="ll2-oneshot-pricing" aria-label="本次生成的价格明细">
                                <div className="ll2-price-grid">
                                    <button
                                        ref={plusRef}
                                        type="button"
                                        className="ll2-chip ll2-chip-add"
                                        onClick={() => openLibrary()}
                                        disabled={running || mediaBusy}
                                        title="添加素材：上传后在句子里打 @ 引用"
                                        aria-label="添加素材"
                                    >
                                        <Plus className="size-4" aria-hidden />
                                    </button>
                                    <div className="ll2-price-cell">
                                        <span>模型</span>
                                        <LL2Select
                                            variant="plain"
                                            value={model}
                                            ariaLabel="选择视频模型"
                                            options={LL2_CONNECTED_VIDEO_MODELS.map((id) => ({ value: id, label: id }))}
                                            onChange={(nextValue) => {
                                                const next = nextValue as LL2ConnectedVideoModel;
                                                setModel(next);
                                                const nextTiers = ll2TiersFor(next);
                                                setResolution(nextTiers[0]?.resolution || "768P");
                                                syncSettings({ videoModel: next, resolution: nextTiers[0]?.resolution || "768P" });
                                            }}
                                        />
                                        <small>{spec?.resolutions || "—"}</small>
                                    </div>
                                    <div className="ll2-price-cell">
                                        <span>分辨率</span>
                                        <LL2Select
                                            variant="plain"
                                            value={resolution}
                                            ariaLabel="清晰度"
                                            disabled={tiers.length < 2}
                                            options={tiers.map((tier) => ({ value: tier.resolution, label: tier.label }))}
                                            onChange={(nextValue) => {
                                                setResolution(nextValue);
                                                syncSettings({ resolution: nextValue });
                                            }}
                                        />
                                        <small>{spec?.duration || "按成片秒数"}</small>
                                    </div>
                                    <div className="ll2-price-cell">
                                        <span>单价</span>
                                        <strong>¥{ll2FormatCNY(estimate.perSecond)} / 秒</strong>
                                        <small>{spec?.unit || "按成片秒数"}</small>
                                    </div>
                                    <div className="ll2-price-cell">
                                        <span>时长</span>
                                        <LL2Select
                                            variant="plain"
                                            value={String(seconds)}
                                            ariaLabel="时长"
                                            options={Array.from({ length: range.max - range.min + 1 }, (_, index) => range.min + index).map((value) => ({ value: String(value), label: `${value} 秒` }))}
                                            onChange={(nextValue) => {
                                                const value = Number(nextValue);
                                                setSeconds(value);
                                                syncSettings({ seconds: value });
                                            }}
                                        />
                                        <small>想要几秒就选几秒</small>
                                    </div>
                                </div>
                                <div className="ll2-options">
                                    <label className="ll2-option-card">
                                        <input
                                            type="checkbox"
                                            checked={Boolean(upscale)}
                                            disabled={running || !upscaleTargets.length}
                                            onChange={(event) => setUpscale(event.target.checked ? (upscaleTargets[0]?.id || "") : "")}
                                        />
                                        <span className="ll2-option-icon"><Sparkles className="size-4" aria-hidden /></span>
                                        <span className="ll2-option-text">
                                            <strong>生成后顺便超分</strong>
                                            <small>{upscaleTargets.length ? "不勾不多花钱" : "已是最高档"}</small>
                                        </span>
                                        <span className="ll2-option-box"><Check className="size-3" aria-hidden /></span>
                                    </label>
                                    {model === "MiniMax-H3" ? (
                                        <label className="ll2-option-card">
                                            <input
                                                type="checkbox"
                                                checked={promptOptimizer}
                                                disabled={running}
                                                onChange={(event) => {
                                                    setPromptOptimizer(event.target.checked);
                                                    syncSettings({ promptOptimizer: event.target.checked });
                                                }}
                                            />
                                            <span className="ll2-option-icon"><Wand2 className="size-4" aria-hidden /></span>
                                            <span className="ll2-option-text">
                                                <strong>提示词优化</strong>
                                                <small>H3 先按官方格式整理一遍</small>
                                            </span>
                                            <span className="ll2-option-box"><Check className="size-3" aria-hidden /></span>
                                        </label>
                                    ) : null}
                                </div>
                                {upscale ? (
                                    <div className="ll2-upscale-target">
                                        <span>超分到</span>
                                        <LL2Select
                                            value={upscale}
                                            disabled={running}
                                            ariaLabel="超分到"
                                            options={upscaleTargets.map((target) => ({ value: target.id, label: target.label }))}
                                            onChange={(nextValue) => setUpscale(nextValue as LL2UpscaleTarget)}
                                        />
                                        <small>{hdEstimate ? `+ ${hdEstimate.label} · ${hdEstimate.basis}` : ""}</small>
                                    </div>
                                ) : null}
                                <div className="ll2-price-total">
                                    <div className="ll2-price-total-text">
                                        <span>本次一共</span>
                                        <strong>{totalLabel}</strong>
                                        <small>{totalBasis}</small>
                                    </div>
                                    <div className="ll2-price-actions">
                                        {running ? (
                                            <button type="button" className="ll2-oneshot-submit is-running" onClick={() => abortRef.current?.abort()}>
                                                <Square className="size-3.5" /> 取消
                                            </button>
                                        ) : (
                                            <button type="button" className="ll2-oneshot-submit" onClick={() => void start()}>
                                                <ArrowRight className="size-3.5" /> 开始创作
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="ll2-oneshot-bar">
                                {!connected ? (
                                    <>
                                        <span className="ll2-oneshot-locked-note">
                                            <span className="ll2-oneshot-preview-line">
                                                写一句话 → 这次大概 <strong className="ll2-oneshot-preview-price">{estimate.label}</strong> → 填一次 Key → 出一支片子
                                                <button type="button" className="ll2-inline-link" onClick={ll2OpenKeyDialog}>连接 LL2</button>
                                            </span>
                                            <small className="ll2-oneshot-preview-basis">{estimate.basis}</small>
                                        </span>
                                        <button type="button" className="ll2-oneshot-submit" onClick={ll2OpenKeyDialog}>
                                            <ArrowRight className="size-3.5" /> 开始创作
                                        </button>
                                    </>
                                ) : tab === "text" ? (
                                    <>
                        <span className="ll2-oneshot-text-note">用我们自己的文本模型：写漫剧 / 短剧、改提示词、问创作问题 · 写一次大约不到 1 分钱，不生成视频</span>
                        <button type="button" className="ll2-oneshot-submit" onClick={() => openAgentWith(prompt)}>
                            <Sparkles className="size-3.5" /> 让聊天改稿写
                        </button>
                                    </>
                                ) : null}
                            </div>
                        )}


                    </>
                ) : null}

                {tab === "chat" ? (
                    <div className="ll2-oneshot-empty">
                        <strong>不会写？先聊两句</strong>
                        <p>「聊天改稿」用的是我们自己的文本模型，陪你写漫剧、短剧、改提示词，也能回答创作里卡住的问题。点下面的按钮才打开，不会自己弹出来挡住这一页。</p>
                        <p>聊好的句子可以一键送回这里出片；在无限画布里，还能直接交给 Agent 生成视频并放进那张画布。</p>
                        <button type="button" className="ll2-oneshot-submit" onClick={() => openAgentWith(prompt)}><Sparkles className="size-3.5" /> 打开聊天改稿</button>
                    </div>
                ) : null}

                {waiting ? (
                    <div className="ll2-oneshot-waiting" role="status" aria-live="polite">
                        <div className="ll2-oneshot-waiting-head">
                            <LoaderCircle className="size-4 is-spinning" aria-hidden />
                            <strong>{waiting.title}</strong>
                            <span className="ll2-oneshot-waiting-time">已等待 {waitSeconds} 秒</span>
                            <button type="button" className="ll2-oneshot-waiting-cancel" onClick={() => abortRef.current?.abort()}>
                                取消
                            </button>
                        </div>
                        <div className="ll2-oneshot-waiting-bar" aria-hidden="true"><span /></div>
                    </div>
                ) : null}
                {hint ? <div className="ll2-oneshot-status is-hint" role="note">{hint}</div> : null}
                {error ? <div className="ll2-oneshot-status is-error" role="alert">{error}</div> : null}
                {result ? (
                    <div className="ll2-oneshot-result">
                        <video src={result.previewUrl || result.film.url} controls playsInline preload="metadata" />
                        <div>
                            <span className="ll2-oneshot-result-cost">实际扣费 <strong>{result.label}</strong></span>
                            <small>{result.basis}</small>
                            <small>生成的片子在云端保留 24 小时，请及时下载到这台电脑。</small>
                            <small>再做一版会新建任务、重新计费；取消或失败前的费用以 LL2 控制台账单为准。</small>
                            <div className="ll2-oneshot-result-actions">
                                <button type="button" onClick={() => void downloadResult()}><Download className="size-3.5" /> 下载到本机</button>
                                <Link to="/films"><Film className="size-3.5" /> 我的片子</Link>
                            </div>
                            {downloadMessage ? <p>{downloadMessage}</p> : null}
                        </div>
                    </div>
                ) : null}

                <div className="ll2-oneshot-foot">
                    <Check className="size-3.5" /> {connected
                        ? "价格按 LL2 官网单价预估，账单以控制台为准"
                        : "不用注册账号 · 只要填一次 Key · 写好的内容不会被清掉"}
                </div>
            </section>

            <LL2QuickIdeas onPick={fillExample} />

            <LL2AssetLibrary
                open={libraryOpen}
                anchor={libraryAnchor}
                onClose={() => { setLibraryOpen(false); setMentionAnchor(null); }}
                onQuote={insertMention}
            />

            <LL2SaveAssetDialog
                draft={saveAssetDraft}
                onClose={() => setSaveAssetDraft(null)}
                onSaved={(result, mode) => {
                    setSaveAssetDraft(null);
                    if (mode === "quote") {
                        // 拖图的最简路径：存进资产库的同时直接引用，不让用户再手动打一次 @。
                        applyMention(ll2MentionToken(result.title), null);
                        setHint(`「${result.title}」已存进资产库，也引用到这句话里了；再写一句画面描述就能出片。`);
                        return;
                    }
                    setHint(`「${result.title}」已存进资产库。在句子里打 @ 就能引用它。`);
                }}
            />
        </>
    );
}

/** 首页四张起步卡片：点一下「填入示例」，不覆盖已经写好的句子。 */
export function LL2QuickIdeas({ onPick }: { onPick?: (idea: QuickIdea) => void }) {
    return (
        <div className="ll2-quick-ideas">
            {QUICK_IDEAS.map((idea) => (
                <button key={idea.title} type="button" onClick={() => onPick?.(idea)} title="填入示例，不会删掉你已经写好的内容">
                    <span className="ll2-quick-idea-tag">填入示例</span>
                    <strong>{idea.title}</strong>
                    <small>{idea.hint}</small>
                </button>
            ))}
        </div>
    );
}
