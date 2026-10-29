import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { App, Button, Input, InputNumber, Select } from "antd";
import { AlertTriangle, ArrowLeft, BookOpenText, ClipboardPaste, FileUp, Cpu, Play } from "lucide-react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { DEFAULT_DRAMA_STYLE_ID, findDramaStyle } from "@/lib/drama/drama-styles";
import { decodeNovelText } from "@/lib/canvas/canvas-document";
import { analyzeNovel, EPISODE_GROUP_CHARS, EPISODE_SOURCE_CHARS, sourceChars, titleFromFileName } from "@/lib/drama/novel-parse";
import { ApiError } from "@/services/api/request";
import { linkCanvasToDrama } from "@/services/drama-canvas";
import { dramaChoiceKey, dramaVideoOptionFits, dramaVideoRatioIssue } from "@/lib/drama/model-choice";
import { DEFAULT_STORYBOARD } from "@/lib/drama/storyboard";
import {
    createDrama,
    estimateDrama,
    type DramaAssetSettings,
    type DramaCapability,
    type DramaEpisodeMode,
    type DramaMediaMode,
    type DramaModels,
    type DramaReviewMode,
    type DramaSkillRef,
    type DramaSourceFormat,
    type DramaStoryboardSettings,
    type DramaVideoContinuity,
} from "@/services/api/drama";

import { EpisodeGroupField, formatCount, formatCredits, MEDIA_MODE_LABEL, SOURCE_FORMAT_LABEL, SourceFormatPicker, VIDEO_CONTINUITY_LABEL } from "./drama-shared";
import { AssetSchemePicker, defaultAssetSettings, useAssetSchemes } from "./asset-scheme";
import { DramaModelPicker, useDramaModelCatalog } from "./drama-model-picker";
import { PromptSkillField } from "./prompt-skill";
import { EpisodeDurationInput, StoryboardRules } from "./storyboard-rules";
import { DramaStylePicker } from "./style-picker";
import "./drama.css";

const MAX_FILE_BYTES = 40 * 1024 * 1024;

/** 从画布“交给短剧自动制作”带来的预填内容；canvasId 是创建后要关联的原画布（已关联项目的画布不带）。 */
type DramaCreatePrefill = { name?: string; sourceFormat?: DramaSourceFormat; text: string; canvasId?: string };
const RATIOS = [
    { value: "9:16", label: "竖屏 9:16", w: 9, h: 16 },
    { value: "16:9", label: "横屏 16:9", w: 16, h: 9 },
    { value: "1:1", label: "方形 1:1", w: 12, h: 12 },
];
const LANGUAGES = ["中文普通话", "粤语", "英语", "日语"];
const REVIEW_MODES: Array<{ value: DramaReviewMode; title: string; detail: string }> = [
    { value: "sample", title: "先看样片，满意后全剧自动", detail: "先做完第 1 集成片，请你确认一次画风、角色和声线，之后所有集自动跑到成片。" },
    { value: "every", title: "每集确认提示词", detail: "每集生成视频前停下来，等你审阅各剧情段的视频提示词与参考图。" },
    { value: "auto", title: "全自动", detail: "不打断，直接从小说跑到成片，可随时在制作台修改重做。" },
];
const CAPABILITY_LABEL: Record<DramaCapability, string> = { text: "改编与分镜", image: "角色与场景参考图", video: "剧情段视频" };
const EPISODE_MODES: Array<{ value: DramaEpisodeMode; title: string; detail: string }> = [
    { value: "chapter", title: "按章分集", detail: "按章节顺序固定分集，默认每章一集，也可以每 2–12 章合成一集；可以只放第 1 集，之后在制作台追加。单章不超过 1.2 万字。" },
    { value: "auto", title: "整本导入，自动分集", detail: "由模型按剧情把章节规划成集（可合并或拆分章节），适合一次导入整本小说；章节多时耗时更长。" },
];

/** 按章分集时的章节分组预览，与服务端 groupDramaChapterEpisodes 一致。 */
function groupChapters(chapters: Array<{ text: string }>, size: number) {
    const groups: Array<{ label: string; chars: number }> = [];
    for (let start = 0; start < chapters.length; start += size) {
        const end = Math.min(start + size, chapters.length);
        const chars = chapters.slice(start, end).reduce((sum, chapter) => sum + sourceChars(chapter.text), 0);
        groups.push({ label: end - start > 1 ? `第 ${start + 1}–${end} 章` : `第 ${start + 1} 章`, chars });
    }
    return groups;
}

export default function DramaCreatePage() {
    const navigate = useNavigate();
    const { message } = App.useApp();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [dragOver, setDragOver] = useState(false);
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const [pasteMode, setPasteMode] = useState(searchParams.get("paste") === "1");
    const [pasteText, setPasteText] = useState("");
    const [sourceText, setSourceText] = useState("");
    const [sourceFormat, setSourceFormat] = useState<DramaSourceFormat>("novel");
    // 默认逐集：一次只让流水线处理一集，长篇整本导入容易让改编任务超时。
    const [chapterMode, setChapterMode] = useState<DramaEpisodeMode>("chapter");
    const [groupSize, setGroupSize] = useState(1);
    const episodeMode: DramaEpisodeMode = sourceFormat === "novel" ? chapterMode : "chapter";
    const perEpisode = episodeMode === "chapter";
    // 剧本与分镜每个标题就是一集；小说按章分集时可每 N 章合成一集。
    const chaptersPerEpisode = sourceFormat === "novel" && perEpisode ? groupSize : 1;
    const analysis = useMemo(() => (sourceText ? analyzeNovel(sourceText, { perEpisode }) : null), [perEpisode, sourceText]);
    const episodeGroups = useMemo(() => (analysis && perEpisode ? groupChapters(analysis.chapters, chaptersPerEpisode) : []), [analysis, chaptersPerEpisode, perEpisode]);
    const oversizedGroup = episodeGroups.find((group) => group.chars > EPISODE_GROUP_CHARS);
    const [name, setName] = useState("");
    const [aspectRatio, setAspectRatio] = useState("9:16");
    const [episodeSeconds, setEpisodeSeconds] = useState(90);
    const [styleId, setStyleId] = useState(DEFAULT_DRAMA_STYLE_ID);
    const [language, setLanguage] = useState(LANGUAGES[0]);
    const [reviewMode, setReviewMode] = useState<DramaReviewMode>("sample");
    // 默认先只跑文本：先看剧情、镜头、设定和段提示词对不对，再决定花钱生成参考图与视频。
    const [mediaMode, setMediaMode] = useState<DramaMediaMode>("manual");
    const [videoContinuity, setVideoContinuity] = useState<DramaVideoContinuity>("tail_frame");
    const [storyboard, setStoryboard] = useState<DramaStoryboardSettings>(DEFAULT_STORYBOARD);
    const [promptSkill, setPromptSkill] = useState<DramaSkillRef>();
    const [models, setModels] = useState<Partial<DramaModels>>({});
    const [budgetCredits, setBudgetCredits] = useState<number | null>(null);
    const assetCatalog = useAssetSchemes();
    const [assetDraft, setAssetDraft] = useState<DramaAssetSettings>();
    const assets = assetDraft || defaultAssetSettings(assetCatalog.data);
    const [previewIndex, setPreviewIndex] = useState(0);

    const style = findDramaStyle(styleId);
    const catalogQuery = useDramaModelCatalog();
    const resolvedModels = useMemo<DramaModels | undefined>(() => {
        const catalog = catalogQuery.data;
        if (!catalog) return undefined;
        const { defaults } = catalog;
        // 没手动选视频模型时按当前画幅与衔接方式挑：目录默认值给不出就换第一个给得出的，都不行留空并说明原因。
        const videoOptions = catalog.options.video || [];
        const fitting = videoOptions.filter((option) => dramaVideoOptionFits(option, aspectRatio, videoContinuity));
        const video = models.video || fitting.find((option) => dramaChoiceKey(option.choice) === dramaChoiceKey(defaults.video))?.choice || fitting[0]?.choice || {};
        return { text: models.text || defaults.text, image: models.image || defaults.image, video };
    }, [aspectRatio, catalogQuery.data, models, videoContinuity]);
    const videoOption = catalogQuery.data?.options.video?.find((option) => dramaChoiceKey(option.choice) === dramaChoiceKey(resolvedModels?.video));
    const imageOption = catalogQuery.data?.options.image?.find((option) => dramaChoiceKey(option.choice) === dramaChoiceKey(resolvedModels?.image));
    const missingCapabilities = (Object.keys(CAPABILITY_LABEL) as DramaCapability[]).filter((capability) => catalogQuery.data && !dramaChoiceKey(resolvedModels?.[capability]));
    // 目录里有视频模型、但没有一个能按当前画幅与衔接方式出片：说清原因，不笼统说“没有可用模型”。
    const noFittingVideo = missingCapabilities.includes("video") && Boolean(catalogQuery.data?.options.video?.length);
    const unavailableCapabilities = missingCapabilities.filter((capability) => !(capability === "video" && noFittingVideo));
    const videoRatioProblem = dramaVideoRatioIssue(videoOption, aspectRatio);
    // 服务端只在支持图生视频时下发 tailFrameChain，缺省即不支持。
    const tailFrameProblem = videoContinuity === "tail_frame" && Boolean(videoOption) && !videoOption?.tailFrameChain;
    const settings = {
        aspectRatio,
        episodeSeconds,
        stylePrompt: style?.prompt || "",
        styleName: style?.name || "",
        language,
        reviewMode,
        mediaMode,
        videoContinuity,
        storyboard,
        ...(promptSkill ? { promptSkill } : {}),
        concurrency: 4,
        models: resolvedModels,
        episodeMode,
        chaptersPerEpisode,
        ...(assets ? { assets } : {}),
    };
    const estimateQuery = useQuery({
        queryKey: [
            "drama-estimate",
            analysis?.chapters.length,
            analysis?.words,
            episodeMode,
            chaptersPerEpisode,
            episodeSeconds,
            aspectRatio,
            videoContinuity,
            JSON.stringify(storyboard),
            assets?.resolution || "",
            dramaChoiceKey(resolvedModels?.text),
            dramaChoiceKey(resolvedModels?.image),
            dramaChoiceKey(resolvedModels?.video),
        ],
        queryFn: ({ signal }) => estimateDrama({ chapterCount: analysis!.chapters.length, wordCount: analysis!.words, settings, episodeMode }, signal),
        enabled: Boolean(analysis && resolvedModels),
        staleTime: 30_000,
    });
    const estimate = estimateQuery.data;
    useEffect(() => {
        if (estimate && budgetCredits === null && estimate.maxMicrocredits > 0) setBudgetCredits(Math.ceil(estimate.maxMicrocredits / 1_000_000));
    }, [estimate, budgetCredits]);

    const loadText = (text: string, fileName?: string) => {
        const result = analyzeNovel(text, { perEpisode });
        if (!result.chapters.length) {
            message.error("没有读取到正文，请检查文件内容");
            return;
        }
        setSourceText(text);
        setBudgetCredits(null);
        if (fileName && !name) setName(titleFromFileName(fileName));
        if (!fileName && !name) setName(result.chapters[0]?.title.slice(0, 20) || "未命名短剧");
    };
    const loadFile = async (file: File) => {
        if (!/\.(txt|md|markdown)$/i.test(file.name)) {
            message.warning("目前支持 TXT 与 Markdown 文件");
            return;
        }
        if (file.size > MAX_FILE_BYTES) {
            message.warning("文件超过 40MB，请拆分后上传");
            return;
        }
        loadText(decodeNovelText(await file.arrayBuffer()), file.name);
    };
    const routeState = location.state as { file?: File; prefill?: DramaCreatePrefill } | null;
    const handedFile = routeState?.file;
    const prefill = routeState?.prefill;
    const handedRef = useRef(false);
    // 画布分镜带过来的原画布：作品创建后关联过去，成为它的精修画布。
    const linkCanvasRef = useRef<string | undefined>(undefined);
    useEffect(() => {
        if (handedRef.current || (!handedFile && !prefill?.text)) return;
        handedRef.current = true;
        if (handedFile) void loadFile(handedFile);
        else if (prefill) {
            if (prefill.sourceFormat) setSourceFormat(prefill.sourceFormat);
            loadText(prefill.text);
            // loadText 在没有名称时会取首章标题，这里在它之后设置，以画布带来的名称为准。
            if (prefill.name?.trim()) setName(prefill.name.trim().slice(0, 80));
            linkCanvasRef.current = prefill.canvasId;
        }
        // 文件与预填内容只用于首次进入，清掉路由状态避免刷新或返回时重复解析。
        navigate(".", { replace: true, state: null });
    }, [handedFile, prefill]); // eslint-disable-line react-hooks/exhaustive-deps
    const onDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setDragOver(false);
        const file = event.dataTransfer.files?.[0];
        if (file) void loadFile(file);
    };

    const create = useMutation({
        mutationFn: () =>
            createDrama({
                name: name.trim(),
                chapters: analysis!.chapters.map((chapter) => ({ title: chapter.title, text: chapter.text })),
                settings: { ...settings, models: resolvedModels },
                budgetMicrocredits: Math.max(0, Math.round((budgetCredits || 0) * 1_000_000)),
                start: true,
                sourceFormat,
                episodeMode,
            }),
        onSuccess: async (summary) => {
            const canvasId = linkCanvasRef.current;
            if (canvasId) {
                const { warning } = await linkCanvasToDrama(canvasId, summary.project.id);
                if (warning) message.warning(warning);
            }
            navigate(`/projects/${summary.project.id}`, { replace: true });
        },
        onError: (error) => message.error(error instanceof ApiError || error instanceof Error ? error.message : "创建失败"),
    });
    const tooLong = Boolean(analysis?.issues.some((issue) => issue.kind === "too_long")) || Boolean(oversizedGroup);
    const canStart = Boolean(analysis && name.trim() && resolvedModels && missingCapabilities.length === 0 && !videoRatioProblem && !tailFrameProblem && !tooLong && !create.isPending);
    const unitLabel = perEpisode && chaptersPerEpisode === 1 ? "集" : "章";

    const previewChapter = analysis?.chapters[previewIndex];
    const reset = () => {
        setSourceText("");
        setPasteText("");
        setName("");
        setPreviewIndex(0);
    };

    if (!analysis) {
        return (
            <WorkspacePage fluid scroll={false}>
                <div className="drama-root drama-compose-empty">
                    <header className="drama-compose-head">
                        <Link to="/projects">
                            <Button type="text" shape="circle" icon={<ArrowLeft className="size-4" />} aria-label="返回作品列表" />
                        </Link>
                        <h1>新建短剧</h1>
                    </header>
                    <div className="drama-compose-formats">
                        <SourceFormatPicker value={sourceFormat} onChange={setSourceFormat} row />
                    </div>
                    <div
                        className={`drama-drop ${dragOver ? "is-over" : ""}`}
                        onDragOver={(event) => {
                            event.preventDefault();
                            setDragOver(true);
                        }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={onDrop}
                    >
                        {pasteMode ? (
                            <div className="grid w-full max-w-[860px] gap-3">
                                <Input.TextArea
                                    autoFocus
                                    value={pasteText}
                                    onChange={(event) => setPasteText(event.target.value)}
                                    placeholder={`${SOURCE_FORMAT_LABEL[sourceFormat].placeholder}\n\n包含“第一章 / 第1集 / Chapter 1”这类标题时会自动拆分；${sourceFormat === "novel" ? "" : "每个标题就是一集，"}也可以只放第 1 集，之后在制作台逐集追加。`}
                                    autoSize={{ minRows: 14, maxRows: 24 }}
                                />
                                <div className="flex justify-end gap-2">
                                    <Button onClick={() => setPasteMode(false)}>取消</Button>
                                    <Button type="primary" disabled={!pasteText.trim()} onClick={() => loadText(pasteText)}>
                                        解析正文
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <span className="drama-drop-icon">
                                    <BookOpenText className="size-7" />
                                </span>
                                <h2>拖入{SOURCE_FORMAT_LABEL[sourceFormat].title}文件，剩下的交给流水线</h2>
                                <p>
                                    TXT 或 Markdown，自动识别 GBK / UTF-8 编码与“第 N 章 / 第 N 集”标题。可以只放第 1 集，做完再在制作台追加下一集；
                                    {sourceFormat === "novel" ? "引号里的对白会逐字保留为台词。" : "台词逐字保留，不会被改写。"}
                                </p>
                                <Button type="primary" size="large" icon={<FileUp className="size-4" />} onClick={() => fileInputRef.current?.click()}>
                                    选择{SOURCE_FORMAT_LABEL[sourceFormat].title}文件
                                </Button>
                                <button type="button" className="drama-link inline-flex items-center gap-1" onClick={() => setPasteMode(true)}>
                                    <ClipboardPaste className="size-3.5" />
                                    没有文件？直接粘贴
                                </button>
                                <div className="drama-drop-steps">
                                    {[sourceFormat === "storyboard" ? "导入分镜" : "解析分集", "建立角色、道具与场景", sourceFormat === "novel" ? "改编剧本与段提示词" : "拆镜与段提示词", "按剧情段生成视频", "合成成片"].map((step, index) => (
                                        <span key={step}>
                                            <b>{index + 1}</b>
                                            {step}
                                        </span>
                                    ))}
                                </div>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".txt,.md,.markdown,text/plain,text/markdown"
                                    className="hidden"
                                    onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        if (file) void loadFile(file);
                                        event.target.value = "";
                                    }}
                                />
                            </>
                        )}
                    </div>
                </div>
            </WorkspacePage>
        );
    }

    return (
        <WorkspacePage fluid scroll={false}>
            <div className="drama-root drama-compose">
                {/* 左：小说目录 */}
                <aside className="drama-compose-novel">
                    <header className="drama-compose-head">
                        <Link to="/projects">
                            <Button type="text" shape="circle" icon={<ArrowLeft className="size-4" />} aria-label="返回作品列表" />
                        </Link>
                        <h1>新建短剧</h1>
                        <Button size="small" type="text" className="!ml-auto" onClick={reset}>
                            换素材
                        </Button>
                    </header>
                    <div className="drama-stats">
                        <div className="drama-stat">
                            <div className="drama-stat-value">{formatCount(analysis.chapters.length)}</div>
                            <div className="drama-stat-label">{perEpisode ? "段原文" : "章节"}</div>
                        </div>
                        <div className="drama-stat">
                            <div className="drama-stat-value">{formatCount(analysis.words)}</div>
                            <div className="drama-stat-label">字</div>
                        </div>
                        <div className="drama-stat">
                            <div className="drama-stat-value">{estimate ? `≈${estimate.episodes}` : "—"}</div>
                            <div className="drama-stat-label">集</div>
                        </div>
                    </div>
                    {analysis.issues.length ? (
                        <div className="drama-issues">
                            {analysis.issues.map((issue) => (
                                <div key={issue.kind} className="drama-issue">
                                    <AlertTriangle className="size-3.5" />
                                    {issue.message}
                                </div>
                            ))}
                        </div>
                    ) : null}
                    <div className="drama-chapter-list thin-scrollbar" role="listbox" aria-label="章节">
                        {analysis.chapters.slice(0, 600).map((chapter, index) => (
                            <button
                                key={`${index}-${chapter.title}`}
                                type="button"
                                role="option"
                                aria-selected={index === previewIndex}
                                className={`drama-chapter-row ${(perEpisode ? sourceChars(chapter.text) > EPISODE_SOURCE_CHARS : chapter.words < 200) ? "is-warn" : ""}`}
                                onClick={() => setPreviewIndex(index)}
                            >
                                <span className="is-num">{String(index + 1).padStart(3, "0")}</span>
                                <span className="truncate text-left">{chapter.title}</span>
                                <span className="is-count">{formatCount(chapter.words)}</span>
                            </button>
                        ))}
                        {analysis.chapters.length > 600 ? (
                            <div className="px-4 py-3 text-center text-[var(--fs-tiny)] text-foreground/40">
                                另有 {analysis.chapters.length - 600} {unitLabel}
                            </div>
                        ) : null}
                    </div>
                </aside>

                {/* 中：风格与审阅，下方原文预览 */}
                <main className="drama-compose-main thin-scrollbar">
                    <section>
                        <div className="drama-section-title">
                            <h2>素材与分集</h2>
                            <span>{sourceFormat === "novel" ? "引号里的对白逐字保留为台词，不会被改写" : "剧本与分镜每个标题就是一集，台词逐字保留"}</span>
                        </div>
                        <div className="grid gap-3">
                            <SourceFormatPicker value={sourceFormat} onChange={setSourceFormat} row />
                            {sourceFormat === "novel" ? (
                                <div className="drama-media-modes is-row is-two" role="radiogroup" aria-label="分集方式">
                                    {EPISODE_MODES.map((mode) => (
                                        <button key={mode.value} type="button" role="radio" aria-checked={chapterMode === mode.value} className="drama-media-mode" onClick={() => setChapterMode(mode.value)}>
                                            <span className="drama-radio" />
                                            <span>
                                                <strong>
                                                    {mode.title}
                                                    {mode.value === "chapter" ? <em>推荐</em> : null}
                                                </strong>
                                                <span>{mode.detail}</span>
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                            {sourceFormat === "novel" && perEpisode ? (
                                <EpisodeGroupField
                                    value={groupSize}
                                    onChange={setGroupSize}
                                    chapterCount={analysis.chapters.length}
                                    error={oversizedGroup ? `${oversizedGroup.label}合计 ${formatCount(oversizedGroup.chars)} 字，每集原文不超过 ${formatCount(EPISODE_GROUP_CHARS)} 字，请减少每集章数` : undefined}
                                />
                            ) : null}
                        </div>
                    </section>
                    <DramaStylePicker value={styleId} onChange={setStyleId} />
                    <section>
                        <div className="drama-section-title">
                            <h2>角色参考图方案</h2>
                            <span>参考图是每个镜头保持人物一致的锚点，开工后也能在设置里改</span>
                        </div>
                        <AssetSchemePicker value={assets} onChange={setAssetDraft} sample={{ style: style?.prompt || "", characterName: "主角", sceneName: "主场景" }} layout="compact" imageModel={imageOption} />
                    </section>
                    <section>
                        <div className="drama-section-title">
                            <h2>分镜规则</h2>
                            <span>决定剧情段多长、段内镜头节奏、台词密度与转场</span>
                        </div>
                        <StoryboardRules value={storyboard} onChange={setStoryboard} episodeSeconds={episodeSeconds} maxVideoSeconds={videoOption?.maxVideoSeconds} videoModelLabel={resolvedModels?.video?.label} />
                    </section>
                    <section>
                        <div className="drama-section-title">
                            <h2>视频提示词技能</h2>
                            <span>撰写每个剧情段的视频提示词时遵循的写作方法</span>
                        </div>
                        <PromptSkillField value={promptSkill} onChange={setPromptSkill} />
                    </section>
                    <section>
                        <div className="drama-section-title">
                            <h2>审阅方式</h2>
                            <span>只在关键点打断你</span>
                        </div>
                        <div className="drama-review-modes" role="radiogroup" aria-label="审阅方式">
                            {REVIEW_MODES.map((mode) => (
                                <button key={mode.value} type="button" role="radio" aria-checked={reviewMode === mode.value} className="drama-review-mode" onClick={() => setReviewMode(mode.value)}>
                                    <span className="drama-radio" />
                                    <span>
                                        <strong>{mode.title}</strong>
                                        <span>{mode.detail}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    </section>
                    {previewChapter ? (
                        <section className="drama-compose-preview">
                            <div className="drama-section-title">
                                <h2>{previewChapter.title}</h2>
                                <span>原文预览 · {formatCount(previewChapter.words)} 字</span>
                            </div>
                            <div className="drama-compose-text thin-scrollbar">
                                {previewChapter.text.slice(0, 6000)}
                                {previewChapter.text.length > 6000 ? "……" : ""}
                            </div>
                        </section>
                    ) : null}
                </main>

                {/* 右：作品设置与启动 */}
                <aside className="drama-compose-side">
                    <div className="drama-compose-side-scroll thin-scrollbar">
                        <label className="block">
                            <div className="drama-option-label">作品名称</div>
                            <Input size="large" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="作品名称" />
                        </label>
                        <div>
                            <div className="drama-option-label">画幅</div>
                            <div className="drama-ratio-group" role="group" aria-label="画幅">
                                {RATIOS.map((ratio) => (
                                    <button key={ratio.value} type="button" className="drama-ratio" aria-pressed={aspectRatio === ratio.value} onClick={() => setAspectRatio(ratio.value)}>
                                        <span className="drama-ratio-shape" style={{ width: ratio.w, height: ratio.h }} />
                                        {ratio.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="block">
                                <div className="drama-option-label">单集时长</div>
                                <EpisodeDurationInput value={episodeSeconds} onChange={setEpisodeSeconds} />
                            </div>
                            <label className="block">
                                <div className="drama-option-label">对白语言</div>
                                <Select className="w-full" value={language} onChange={setLanguage} options={LANGUAGES.map((value) => ({ value, label: value }))} />
                            </label>
                        </div>
                        <div>
                            <div className="drama-option-label">生成节奏</div>
                            <div className="drama-media-modes" role="radiogroup" aria-label="生成节奏">
                                {(Object.keys(MEDIA_MODE_LABEL) as DramaMediaMode[]).map((mode) => (
                                    <button key={mode} type="button" role="radio" aria-checked={mediaMode === mode} className="drama-media-mode" onClick={() => setMediaMode(mode)}>
                                        <span className="drama-radio" />
                                        <span>
                                            <strong>
                                                {MEDIA_MODE_LABEL[mode].title}
                                                {mode === "manual" ? <em>推荐</em> : null}
                                            </strong>
                                            <span>{MEDIA_MODE_LABEL[mode].detail}</span>
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <div className="drama-option-label">段落衔接</div>
                            <div className="drama-media-modes" role="radiogroup" aria-label="段落衔接">
                                {(Object.keys(VIDEO_CONTINUITY_LABEL) as DramaVideoContinuity[]).map((mode) => (
                                    <button key={mode} type="button" role="radio" aria-checked={videoContinuity === mode} className="drama-media-mode" onClick={() => setVideoContinuity(mode)}>
                                        <span className="drama-radio" />
                                        <span>
                                            <strong>{VIDEO_CONTINUITY_LABEL[mode].title}</strong>
                                            <span>{VIDEO_CONTINUITY_LABEL[mode].detail}</span>
                                        </span>
                                    </button>
                                ))}
                            </div>
                            {tailFrameProblem ? (
                                <p className="drama-cfg-note" role="alert">
                                    当前视频模型不支持图生视频，无法尾帧续接；请改用并行出片或换模型。
                                </p>
                            ) : null}
                        </div>
                        <section className="drama-compose-models" aria-label="制作模型">
                            <div className="drama-compose-models-head">
                                <Cpu className="size-4 text-[var(--workspace-accent)]" />
                                <strong>制作模型</strong>
                                <span>{catalogQuery.isLoading ? "正在读取可用模型…" : "已自动选好，可按需更换"}</span>
                            </div>
                            {(Object.keys(CAPABILITY_LABEL) as DramaCapability[]).map((capability) => (
                                <div key={capability} className="drama-compose-model-row">
                                    <span>{CAPABILITY_LABEL[capability]}</span>
                                    <DramaModelPicker
                                        capability={capability}
                                        size="sm"
                                        showPrice={false}
                                        aspectRatio={aspectRatio}
                                        value={resolvedModels?.[capability]}
                                        placeholder={`选择${CAPABILITY_LABEL[capability]}模型`}
                                        onChange={(choice) => setModels((current) => ({ ...current, [capability]: choice }))}
                                    />
                                </div>
                            ))}
                            {videoRatioProblem ? (
                                <p className="drama-cfg-note" role="alert">
                                    当前视频模型{videoRatioProblem}，请换模型或改画幅。
                                </p>
                            ) : null}
                            {videoOption?.generateAudio === false ? <p className="drama-cfg-note">当前视频模型不同步生成声音，剧情段视频没有对白与音效。</p> : null}
                        </section>
                        <div className="drama-field">
                            <div className="drama-field-label">
                                <span>预算上限</span>
                                <small>留空或 0 为不限，达到后自动暂停</small>
                            </div>
                            <InputNumber className="!w-full" min={0} precision={0} value={budgetCredits} onChange={(value) => setBudgetCredits(value ?? 0)} suffix="积分" aria-label="预算上限" />
                        </div>
                        {unavailableCapabilities.length ? (
                            <p className="flex items-start gap-2 text-[var(--fs-tiny)] leading-5 text-[var(--status-error)]">
                                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                                还没有可用的{unavailableCapabilities.map((capability) => CAPABILITY_LABEL[capability]).join("、")}模型，请联系管理员在后台开通。
                            </p>
                        ) : null}
                        {noFittingVideo ? (
                            <p className="flex items-start gap-2 text-[var(--fs-tiny)] leading-5 text-[var(--status-error)]">
                                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                                {videoContinuity === "tail_frame" ? `没有能按 ${aspectRatio} 尾帧续接出片的视频模型，请换画幅、改用并行出片或联系管理员。` : `没有能按 ${aspectRatio} 出片的视频模型，请换画幅或联系管理员。`}
                            </p>
                        ) : null}
                    </div>
                    <footer className="drama-compose-launch">
                        <div className="drama-compose-estimate">
                            <div>
                                <b>{estimate ? `${estimate.episodes} 集` : "—"}</b>
                                <span>约 {estimate?.durationMinutes ?? "—"} 分钟</span>
                            </div>
                            <div>
                                <b>{estimate ? formatCount(estimate.shots) : "—"}</b>
                                <span>镜头</span>
                            </div>
                            <div>
                                <b>{estimate?.priced ? `${formatCredits(estimate.minMicrocredits)}–${formatCredits(estimate.maxMicrocredits)}` : "—"}</b>
                                <span>预计积分</span>
                            </div>
                        </div>
                        {mediaMode === "manual" ? (
                            <div className="text-[var(--fs-tiny)] text-foreground/50">开工只消耗文本模型费用；剧本、设定与段提示词确认后，再逐集生成参考图与视频</div>
                        ) : reviewMode === "sample" && estimate?.priced ? (
                            <div className="text-[var(--fs-tiny)] text-foreground/50">先做第 1 集样片，约 {formatCredits(estimate.sampleMicrocredits)} 积分，确认后再跑全剧</div>
                        ) : null}
                        {estimate?.note ? <div className="text-[var(--fs-micro)] text-foreground/40">{estimate.note}</div> : null}
                        <Button type="primary" size="large" block icon={<Play className="size-4" />} disabled={!canStart} loading={create.isPending} onClick={() => create.mutate()}>
                            {mediaMode === "manual" ? "开始改编剧本与分镜" : "开始自动制作"}
                        </Button>
                    </footer>
                </aside>
            </div>
        </WorkspacePage>
    );
}
