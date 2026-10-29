import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { InputNumber } from "antd";
import { AlertTriangle } from "lucide-react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { getResourceAccess, resolveResourceAccessURL, resourceFileUrl, type ResourceAccessVariant } from "@/services/api/resources";
import type { DramaEpisodeRow, DramaEpisodeStage, DramaMediaMode, DramaMediaStatus, DramaSourceFormat, DramaVideoContinuity } from "@/services/api/drama";

export const PIPELINE_STEPS: Array<{ key: Exclude<DramaEpisodeStage, "queued" | "review" | "done">; label: string }> = [
    { key: "script", label: "剧本" },
    { key: "prompts", label: "段提示词" },
    { key: "video", label: "视频" },
    { key: "render", label: "成片" },
];

const STAGE_INDEX: Record<DramaEpisodeStage, number> = { queued: -1, script: 0, prompts: 1, review: 2, video: 2, render: 3, done: 4 };

export const STAGE_LABEL: Record<DramaEpisodeStage, string> = {
    queued: "排队中",
    script: "改编剧本",
    prompts: "撰写段提示词",
    review: "等待审阅",
    video: "生成视频",
    render: "合成成片",
    done: "已完成",
};

export { DRAMA_CAST_KIND_LABEL as CAST_KIND_LABEL, DRAMA_STATUS_LABEL as STATUS_LABEL, formatDramaCredits as formatCredits } from "@/lib/drama/drama-format";

/** 段落衔接方式的文案：新建页与设置页共用。 */
export const VIDEO_CONTINUITY_LABEL: Record<DramaVideoContinuity, { title: string; detail: string }> = {
    tail_frame: { title: "尾帧续接", detail: "第 2 段起用上一段最后一帧做首帧，同集按顺序逐段生成，画面衔接更稳" },
    parallel: { title: "并行出片", detail: "每段只按角色与场景参考图独立生成，同集各段一起提交，适合按班次批量出片的渠道" },
};

/** 生成节奏的文案：新建页与设置页共用。 */
export const MEDIA_MODE_LABEL: Record<DramaMediaMode, { title: string; detail: string }> = {
    manual: { title: "先出剧本与提示词，手动生成", detail: "只跑文本：作品圣经、分集、剧本、分镜、设定与各段视频提示词。确认后再逐集或全部生成参考图与视频" },
    auto: { title: "全自动出片", detail: "剧本写好后直接生成参考图和带原声的段视频，一路跑到成片" },
};

/** 素材类型文案：新建页、追加单集与原文编辑共用。placeholder 是粘贴框的格式提示。 */
export const SOURCE_FORMAT_LABEL: Record<DramaSourceFormat, { title: string; detail: string; placeholder: string; guide: string[] }> = {
    novel: {
        title: "小说原文",
        detail: "按原文改编成镜头，引号里的对白逐字保留",
        placeholder: "粘贴小说正文。对白放在引号里，会逐字保留为台词。",
        guide: ["引号“”「」里的对白逐字保留为台词", "叙述与心理描写改成可拍到的动作和表情", "需要旁白时只摘原文句子，不另写"],
    },
    script: {
        title: "剧本",
        detail: "已写好的剧情与台词，只拆镜头，台词一字不改",
        placeholder: "粘贴本集剧本，例如：\n第1场 内景 客厅 夜\n△林晚推门而入。\n林晚（冷笑）：你怎么还在这里？\n顾言：我等你很久了。",
        guide: ["一行一句：角色：台词，或 角色（表情）：台词", "△ 开头的行写动作与画面", "旁白写成 旁白：……；台词一字不改"],
    },
    storyboard: {
        title: "分镜",
        detail: "已做好的分镜表，按原镜头转录；表格可直接导入",
        placeholder: "粘贴分镜表（Markdown 表格或从表格软件复制的内容），第一行为表头，例如：\n| 场景 | 角色 | 景别 | 画面 | 台词 | 时长 |\n| 客厅 | 林晚 | 近景 | 林晚推门而入 | 林晚：你怎么还在这里？ | 3 |",
        guide: ["第一行是表头：场景、角色、景别、运镜、画面、台词、时长、转场", "Markdown 表格或从 Excel 复制的内容直接导入，不经过模型", "一格多句台词用 <br> 分开，会拆成连续镜头"],
    },
};

/** 每集章数：1 为每章一集；集数随章数实时换算。新建页与设置页共用。 */
export function EpisodeGroupField({ value, onChange, chapterCount, error, disabled }: { value: number; onChange: (value: number) => void; chapterCount?: number; error?: string; disabled?: boolean }) {
    return (
        <div className="drama-episode-group">
            <span>每</span>
            <InputNumber size="small" min={1} max={12} precision={0} value={value} disabled={disabled} onChange={(next) => onChange(Math.max(1, Math.min(12, Number(next) || 1)))} aria-label="每集章数" />
            <span>章一集</span>
            {chapterCount ? (
                <small>
                    共 {chapterCount} 章 → {Math.ceil(chapterCount / value)} 集
                </small>
            ) : null}
            {error ? (
                <p className="drama-episode-group-error" role="alert">
                    <AlertTriangle className="size-3.5" aria-hidden />
                    {error}
                </p>
            ) : null}
        </div>
    );
}

export function sourceFormatOf(value: string | undefined): DramaSourceFormat {
    return value === "script" || value === "storyboard" ? value : "novel";
}

export function SourceFormatPicker({ value, onChange, disabled, row }: { value: DramaSourceFormat; onChange: (value: DramaSourceFormat) => void; disabled?: boolean; row?: boolean }) {
    return (
        <div className={`drama-media-modes ${row ? "is-row" : ""}`} role="radiogroup" aria-label="素材类型">
            {(Object.keys(SOURCE_FORMAT_LABEL) as DramaSourceFormat[]).map((format) => (
                <button key={format} type="button" role="radio" aria-checked={value === format} className="drama-media-mode" disabled={disabled} onClick={() => onChange(format)}>
                    <span className="drama-radio" />
                    <span>
                        <strong>{SOURCE_FORMAT_LABEL[format].title}</strong>
                        <span>{SOURCE_FORMAT_LABEL[format].detail}</span>
                    </span>
                </button>
            ))}
        </div>
    );
}

export type EpisodeTone = "done" | "active" | "review" | "error" | "idle" | "ready";

export function episodeTone(episode: DramaEpisodeRow): EpisodeTone {
    if (episode.error || episode.stats.failed > 0) return "error";
    if (episode.awaitingMedia) return "ready";
    if (episode.stage === "review") return "review";
    if (episode.stage === "done" && !episode.finalStale) return "done";
    if (episode.stage === "queued") return "idle";
    return "active";
}

export function episodeStatusText(episode: DramaEpisodeRow) {
    if (episode.error) return "需要处理";
    if (episode.awaitingMedia) return `剧本就绪 · ${episode.shotCount} 镜 · 待生成画面`;
    if (episode.stage === "done" && episode.finalStale) return "已修改 · 待重新合成";
    const { stats } = episode;
    switch (episode.stage) {
        case "prompts":
            return stats.segments ? `提示词 ${stats.promptReady}/${stats.segments}` : STAGE_LABEL.prompts;
        case "video":
            return stats.segments ? `视频 ${stats.videoReady}/${stats.segments}` : STAGE_LABEL.video;
        case "done":
            return `已完成 · ${formatDuration(episode.durationMs)}`;
    }
    return STAGE_LABEL[episode.stage];
}

/** 每个流水线步骤的完成度：0 未开始、0-1 进行中、1 完成。 */
export function stepProgress(episode: DramaEpisodeRow, step: (typeof PIPELINE_STEPS)[number]["key"]) {
    const current = STAGE_INDEX[episode.stage];
    const index = PIPELINE_STEPS.findIndex((item) => item.key === step);
    if (episode.stage === "done" && !episode.finalStale) return 1;
    if (current > index) return 1;
    if (current < index) return 0;
    const total = Math.max(episode.stats.segments, 1);
    if (step === "prompts") return Math.max(0.08, episode.stats.promptReady / total);
    if (step === "video") return Math.max(0.08, episode.stats.videoReady / total);
    return 0.35;
}

export function StagePips({ episode, size = "sm" }: { episode: DramaEpisodeRow; size?: "sm" | "md" }) {
    const tone = episodeTone(episode);
    return (
        <span className={`drama-pips is-${size} is-${tone}`} aria-hidden>
            {PIPELINE_STEPS.map((step) => {
                const progress = stepProgress(episode, step.key);
                return (
                    <span key={step.key} className="drama-pip" title={step.label}>
                        <span className="drama-pip-fill" style={{ "--pip": progress } as CSSProperties} />
                    </span>
                );
            })}
        </span>
    );
}

export function formatDuration(ms: number) {
    const seconds = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(seconds / 60);
    return minutes ? `${minutes}分${String(seconds % 60).padStart(2, "0")}秒` : `${seconds}秒`;
}

export function formatClock(ms: number) {
    const seconds = Math.max(0, ms / 1000);
    return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}

export function formatCount(value: number) {
    if (value >= 10_000) return `${(value / 10_000).toFixed(value >= 100_000 ? 0 : 1)}万`;
    return value.toLocaleString("zh-CN");
}

export function aspectRatioValue(aspect: string) {
    const [width, height] = aspect.split(":").map(Number);
    return width && height ? `${width} / ${height}` : "9 / 16";
}

export function resourceUrl(id?: string) {
    return id ? resourceFileUrl(id) : "";
}

/** 加载失败后的自动重试间隔：访问地址过期、缩略图尚未生成或解码排队超时多是暂时的。 */
const THUMB_RETRY_DELAYS_MS = [1500, 5000];

/**
 * 资源缩略图。加载失败会自动重试两次，之后显示 failed（缺省为 fallback）；
 * loading 是加载中的占位（缺省为 fallback）。
 */
export function MediaThumb({ resourceId, alt, className, fallback, loading, failed }: { resourceId?: string; alt: string; className?: string; fallback?: ReactNode; loading?: ReactNode; failed?: ReactNode }) {
    const [retry, setRetry] = useState({ resourceId, attempt: 0 });
    const attempt = retry.resourceId === resourceId ? retry.attempt : 0;
    if (!resourceId) return <>{fallback ?? null}</>;
    const pending = loading ?? fallback ?? null;
    const delay = THUMB_RETRY_DELAYS_MS[attempt];
    const failure =
        delay === undefined ? (
            (failed ?? fallback ?? null)
        ) : (
            <ThumbRetry delayMs={delay} onRetry={() => setRetry({ resourceId, attempt: attempt + 1 })}>
                {pending}
            </ThumbRetry>
        );
    return <CachedResourceImage key={`${resourceId}:${attempt}`} storageKey={`resource:${resourceId}`} alt={alt} className={className} variant="thumbnail" fallback={failure} loadingFallback={pending} draggable={false} />;
}

function ThumbRetry({ delayMs, onRetry, children }: { delayMs: number; onRetry: () => void; children: ReactNode }) {
    const [handler] = useState(() => onRetry);
    useEffect(() => {
        const timer = window.setTimeout(handler, delayMs);
        return () => window.clearTimeout(timer);
    }, [delayMs, handler]);
    return <>{children}</>;
}

export function mediaBusy(status: DramaMediaStatus) {
    return status === "queued" || status === "running";
}

export function parseList(raw: string | undefined): string[] {
    try {
        const value: unknown = JSON.parse(raw || "[]");
        return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    } catch {
        return [];
    }
}

/** 把 SRT 转成浏览器 <track> 需要的 WebVTT。 */
export function srtToVtt(srt: string) {
    return `WEBVTT\n\n${srt.replace(/\r/g, "").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")}`;
}

/** 解析资源的授权播放地址；视频优先使用浏览器兼容的播放副本。 */
export function useResourceMediaUrl(resourceId: string | undefined, variant: ResourceAccessVariant = "original") {
    const [url, setUrl] = useState("");
    useEffect(() => {
        setUrl("");
        if (!resourceId) return;
        let active = true;
        void getResourceAccess(`resource:${resourceId}`, "display", variant)
            .catch(() => getResourceAccess(`resource:${resourceId}`, "display", "original"))
            .then((access) => {
                if (active) setUrl(resolveResourceAccessURL(access.url));
            })
            .catch(() => {
                if (active) setUrl(resourceUrl(resourceId));
            });
        return () => {
            active = false;
        };
    }, [resourceId, variant]);
    return url;
}

export async function downloadResource(resourceId: string, fileName: string) {
    const access = await getResourceAccess(`resource:${resourceId}`, "download", "original", fileName);
    const anchor = document.createElement("a");
    anchor.href = resolveResourceAccessURL(access.url);
    anchor.download = fileName;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
}

export function downloadText(content: string, fileName: string, mime = "text/plain") {
    const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
