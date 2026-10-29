import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { App, Button } from "antd";
import { AntTooltip as Tooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import { AlertTriangle, ArrowDownToLine, ArrowUpToLine, BookOpen, BookOpenText, CheckCircle2, Clapperboard, PanelRightClose, PanelRightOpen, Pencil, PenLine, Quote, ScanSearch, Trash2 } from "lucide-react";

import { averageShotSeconds, normalizeStoryboard, TRANSITION_LABEL } from "@/lib/drama/storyboard";
import { getDramaChapter, type DramaDialogueCheck, type DramaEpisodeDetail, type DramaShot, type DramaShotPatch, type DramaStoryboardSettings } from "@/services/api/drama";

import { formatCount, SOURCE_FORMAT_LABEL, sourceFormatOf } from "../drama-shared";
import { SourceEditModal } from "./episode-source";
import { JobDetailModal } from "./job-detail";
import { ShotEditor } from "./segment-dialog";
import type { EpisodeEmpty } from "./storyboard";

function storyboardSummary(value: DramaStoryboardSettings) {
    const rules = normalizeStoryboard(value);
    const duration = `${{ fast: "快节奏", standard: "标准节奏", slow: "舒缓节奏" }[rules.pacing]}（平均 ${averageShotSeconds(rules)} 秒/镜）· 对白${{ dense: "密集", standard: "标准", sparse: "克制" }[rules.dialogue]} · 剧情段${{ auto: "智能切分", fixed: `固定 ${rules.segmentSeconds} 秒`, range: `${rules.segmentMinSeconds}–${rules.segmentMaxSeconds} 秒` }[rules.segmentMode]}`;
    const transition = rules.transition === "auto" ? "转场智能" : `转场统一${TRANSITION_LABEL[rules.transition]}`;
    return `${duration} · ${transition}`;
}

type SceneGroup = { key: string; scene: string; shots: DramaShot[] };

function groupScenes(shots: DramaShot[]): SceneGroup[] {
    const groups: SceneGroup[] = [];
    for (const shot of shots) {
        const last = groups[groups.length - 1];
        if (last && last.scene === shot.scene) last.shots.push(shot);
        else groups.push({ key: shot.id, scene: shot.scene, shots: [shot] });
    }
    return groups;
}

/** 在原文里定位镜头出处；整句找不到时退回前 16 个字，仍找不到就不标注。 */
function locateQuote(text: string, quote: string) {
    const needle = quote.trim().replace(/^[「“"]+|[」”"]+$/g, "");
    if (!needle) return -1;
    const index = text.indexOf(needle);
    if (index >= 0 || needle.length <= 16) return index >= 0 ? index : -1;
    return text.indexOf(needle.slice(0, 16));
}

export function ScriptView({
    projectId,
    detail,
    storyboard,
    currentId,
    busy,
    onCurrent,
    onRescript,
    onPatchShot,
    onInsertShot,
    onDeleteShot,
    onSourceSaved,
    empty,
}: {
    projectId: string;
    detail: DramaEpisodeDetail;
    storyboard: DramaStoryboardSettings;
    currentId: string;
    busy: boolean;
    onCurrent: (id: string) => void;
    onRescript: () => void;
    onPatchShot: (shot: DramaShot, patch: DramaShotPatch) => void;
    onInsertShot: (shot: DramaShot, position: "before" | "after") => void;
    onDeleteShot: (shot: DramaShot) => void;
    /** 原文已保存；rescript=true 时需要按新原文重新改编。 */
    onSourceSaved: (rescript: boolean) => void;
    empty: EpisodeEmpty;
}) {
    const [processOpen, setProcessOpen] = useState(false);
    const [editingChapterId, setEditingChapterId] = useState("");
    const { modal } = App.useApp();
    const { episode, shots, chapters } = detail;
    const format = sourceFormatOf(episode.sourceFormat);
    const [sourceOpen, setSourceOpen] = useState(true);
    const current = shots.find((shot) => shot.id === currentId);
    const scenes = useMemo(() => groupScenes(shots), [shots]);
    const segmentSizes = useMemo(() => {
        const sizes = new Map<number, number>();
        for (const shot of shots) sizes.set(shot.segmentIndex, (sizes.get(shot.segmentIndex) || 0) + 1);
        return sizes;
    }, [shots]);
    const confirmDelete = (shot: DramaShot) =>
        modal.confirm({
            title: `删除镜头 ${String(shot.position + 1).padStart(2, "0")}？`,
            content: shot.dialogue ? `这个镜头的台词“${shot.dialogue}”会一起删除，本段视频提示词与视频标记过期。` : "本段视频提示词与视频会标记过期，需要重新撰写和生成。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            centered: true,
            onOk: () => onDeleteShot(shot),
        });
    const confirmRescript = () =>
        modal.confirm({
            title: `重新改编第 ${episode.number} 集？`,
            content: "会基于原文重新生成剧本、镜头与剧情段，各段视频提示词与视频都需要重新生成；已生成的段视频保留在版本记录中。",
            okText: "重新改编",
            cancelText: "取消",
            centered: true,
            onOk: onRescript,
        });

    return (
        <div className={`drama-scriptv ${sourceOpen ? "" : "is-source-hidden"}`}>
            <div className="drama-scriptv-main thin-scrollbar">
                <section className="drama-scriptv-brief">
                    <div className="drama-scriptv-brief-head">
                        <span className="drama-eyebrow">本集梗概</span>
                        <span className="drama-scriptv-format" title={SOURCE_FORMAT_LABEL[format].detail}>
                            素材：{SOURCE_FORMAT_LABEL[format].title}
                        </span>
                        <div className="ml-auto flex items-center gap-2">
                            {detail.scriptJob ? (
                                <Button size="small" type="text" icon={<ScanSearch className="size-3.5" />} onClick={() => setProcessOpen(true)}>
                                    改编过程
                                </Button>
                            ) : null}
                            <Button size="small" type="text" icon={<PenLine className="size-3.5" />} disabled={busy} onClick={confirmRescript}>
                                重新改编
                            </Button>
                            <Tooltip title={sourceOpen ? "收起原文" : "对照原文"}>
                                <Button
                                    size="small"
                                    type="text"
                                    icon={sourceOpen ? <PanelRightClose className="size-3.5" /> : <PanelRightOpen className="size-3.5" />}
                                    aria-pressed={sourceOpen}
                                    aria-label={sourceOpen ? "收起原文" : "对照原文"}
                                    onClick={() => setSourceOpen((open) => !open)}
                                />
                            </Tooltip>
                        </div>
                    </div>
                    <p className="drama-scriptv-synopsis">{episode.synopsis || "改编完成后显示本集梗概。"}</p>
                    <div className="drama-scriptv-beats">
                        <div>
                            <span>开场钩子</span>
                            <p>{episode.hook || "—"}</p>
                        </div>
                        <div>
                            <span>结尾悬念</span>
                            <p>{episode.cliffhanger || "—"}</p>
                        </div>
                    </div>
                    <div className="drama-scriptv-rules">
                        <span>分镜规则</span>
                        <b>{storyboardSummary(storyboard)}</b>
                        <span>
                            · 实际 {shots.length} 镜 · {(shots.reduce((sum, shot) => sum + shot.durationMs, 0) / 1000).toFixed(0)} 秒
                        </span>
                    </div>
                    {detail.dialogueCheck ? <DialogueCheckNotice check={detail.dialogueCheck} busy={busy} onRescript={confirmRescript} /> : null}
                </section>

                {shots.length ? (
                    <div className="drama-screenplay">
                        {scenes.map((group, sceneIndex) => (
                            <section key={group.key} className="drama-screenplay-scene">
                                <header>
                                    <span className="drama-screenplay-scene-no">场 {sceneIndex + 1}</span>
                                    <strong>{group.scene || "未命名场景"}</strong>
                                    <span className="drama-screenplay-scene-meta">
                                        {group.shots.length} 镜 · {(group.shots.reduce((sum, shot) => sum + shot.durationMs, 0) / 1000).toFixed(0)} 秒
                                    </span>
                                </header>
                                {group.shots.map((shot) => (
                                    <div
                                        key={shot.id}
                                        className="drama-screenplay-shot"
                                        role="button"
                                        tabIndex={0}
                                        aria-current={shot.id === currentId}
                                        onClick={() => {
                                            if (shot.id !== currentId) onCurrent(shot.id);
                                        }}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter" && event.target === event.currentTarget) onCurrent(shot.id);
                                        }}
                                    >
                                        <span className="drama-screenplay-index">{String(shot.position + 1).padStart(2, "0")}</span>
                                        <div className="min-w-0">
                                            {shot.id === currentId ? null : (
                                                <span className="drama-screenplay-edit" aria-hidden>
                                                    <Pencil className="size-3.5" />
                                                </span>
                                            )}
                                            <div className="drama-screenplay-tags">
                                                {shot.shotSize ? <span>{shot.shotSize}</span> : null}
                                                {shot.camera && shot.camera !== "固定" ? <span>{shot.camera}</span> : null}
                                                <span>{(shot.durationMs / 1000).toFixed(1)}s</span>
                                                {shot.transition && shot.transition !== "cut" ? <span className="is-transition">{TRANSITION_LABEL[shot.transition as keyof typeof TRANSITION_LABEL]}进入</span> : null}
                                                {shot.sourceQuote ? (
                                                    <span className="is-source">
                                                        <Quote className="size-3" />
                                                        有原文出处
                                                    </span>
                                                ) : null}
                                            </div>
                                            {shot.id === currentId ? (
                                                // 选中的镜头直接在剧本里改：失焦保存，改动只让本段提示词与视频过期。
                                                <div className="drama-screenplay-editor" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                                                    <ShotEditor shot={shot} onPatch={(patch) => onPatchShot(shot, patch)} />
                                                    <div className="drama-screenplay-editor-actions">
                                                        <Button size="small" icon={<ArrowUpToLine className="size-3.5" />} disabled={busy} onClick={() => onInsertShot(shot, "before")}>
                                                            在前面插入镜头
                                                        </Button>
                                                        <Button size="small" icon={<ArrowDownToLine className="size-3.5" />} disabled={busy} onClick={() => onInsertShot(shot, "after")}>
                                                            在后面插入镜头
                                                        </Button>
                                                        <span className="flex-1" />
                                                        <Tooltip title={(segmentSizes.get(shot.segmentIndex) || 0) <= 1 ? "这是本剧情段唯一的镜头，删除会改变分段；可以改写内容或重新改编本集" : ""}>
                                                            <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} disabled={busy || (segmentSizes.get(shot.segmentIndex) || 0) <= 1} onClick={() => confirmDelete(shot)}>
                                                                删除镜头
                                                            </Button>
                                                        </Tooltip>
                                                    </div>
                                                </div>
                                            ) : (
                                                <>
                                                    {shot.action ? <p className="drama-screenplay-action">{shot.action}</p> : null}
                                                    {shot.dialogue ? (
                                                        <div className="drama-screenplay-line">
                                                            <b>{shot.speaker || "旁白"}</b>
                                                            <p>{shot.dialogue}</p>
                                                        </div>
                                                    ) : null}
                                                    {!shot.action && !shot.dialogue ? <p className="drama-screenplay-action is-empty">空镜头，点击填写动作或台词</p> : null}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </section>
                        ))}
                    </div>
                ) : (
                    <div className="drama-scriptv-pending">
                        <Clapperboard className="size-7" />
                        <strong>{empty.title}</strong>
                        <span>{empty.text} 右侧可以先读本集对应的小说原文。</span>
                        {empty.action}
                    </div>
                )}
            </div>
            <JobDetailModal projectId={projectId} job={processOpen ? detail.scriptJob : undefined} onClose={() => setProcessOpen(false)} onLocate={() => undefined} />
            {sourceOpen ? <SourcePane projectId={projectId} chapters={chapters} quote={current?.sourceQuote || ""} onEdit={setEditingChapterId} /> : null}
            <SourceEditModal
                open={Boolean(editingChapterId)}
                projectId={projectId}
                episodeId={episode.id}
                episodeFormat={format}
                chapter={chapters.find((chapter) => chapter.id === editingChapterId)}
                onClose={() => setEditingChapterId("")}
                onSaved={(rescript) => {
                    setEditingChapterId("");
                    onSourceSaved(rescript);
                }}
            />
        </div>
    );
}

/** 原文台词逐句核对：列出没有逐字出现在镜头台词里的原文台词（被删或被改写）。 */
function DialogueCheckNotice({ check, busy, onRescript }: { check: DramaDialogueCheck; busy: boolean; onRescript: () => void }) {
    const [expanded, setExpanded] = useState(false);
    if (!check.sourceLines) return null;
    if (!check.missingCount) {
        return (
            <div className="drama-dialogue-check is-ok">
                <CheckCircle2 className="size-3.5 shrink-0" />
                原文 {check.sourceLines} 句台词都已逐字保留在镜头里
            </div>
        );
    }
    const shown = expanded ? check.missing : check.missing.slice(0, 3);
    return (
        <div className="drama-dialogue-check" role="status">
            <div className="drama-dialogue-check-head">
                <AlertTriangle className="size-4 shrink-0" />
                <strong>
                    原文 {check.sourceLines} 句台词中有 {check.missingCount} 句没有逐字出现在镜头里
                </strong>
                <span className="flex-1" />
                <Button size="small" disabled={busy} onClick={onRescript}>
                    重新改编
                </Button>
            </div>
            <span className="drama-dialogue-check-hint">可能被删掉或改写了。可以点镜头直接改台词、插入镜头补上，或重新改编本集。</span>
            <ul>
                {shown.map((line) => (
                    <li key={line}>「{line}」</li>
                ))}
            </ul>
            {check.missing.length > 3 ? (
                <button type="button" className="drama-link" onClick={() => setExpanded((value) => !value)}>
                    {expanded ? "收起" : `展开全部${check.missingCount > check.missing.length ? `（显示前 ${check.missing.length} 句）` : ""}`}
                </button>
            ) : null}
        </div>
    );
}

function SourcePane({ projectId, chapters, quote, onEdit }: { projectId: string; chapters: DramaEpisodeDetail["chapters"]; quote: string; onEdit: (chapterId: string) => void }) {
    const [chapterId, setChapterId] = useState(chapters[0]?.id || "");
    const activeId = chapters.some((chapter) => chapter.id === chapterId) ? chapterId : chapters[0]?.id || "";
    const query = useQuery({ queryKey: ["drama", projectId, "chapter", activeId], queryFn: ({ signal }) => getDramaChapter(projectId, activeId, signal), enabled: Boolean(activeId), staleTime: 300_000 });
    const text = query.data?.chapter.sourceText || "";
    const hit = text && quote ? locateQuote(text, quote) : -1;
    const markRef = useRef<HTMLElement>(null);
    const needleLength = hit >= 0 ? Math.min(quote.trim().length, text.length - hit) : 0;

    useEffect(() => {
        markRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, [hit, activeId]);

    if (!chapters.length) {
        return (
            <aside className="drama-source">
                <div className="drama-source-empty">
                    <BookOpenText className="size-6" />
                    本集还没有关联原文章节
                </div>
            </aside>
        );
    }
    return (
        <aside className="drama-source" aria-label="小说原文">
            <header className="drama-source-head">
                <div className="drama-source-title">
                    <span className="drama-eyebrow">
                        <BookOpen className="size-3.5" />
                        原文对照
                    </span>
                    {activeId ? (
                        <Button size="small" type="text" icon={<Pencil className="size-3.5" />} onClick={() => onEdit(activeId)}>
                            编辑原文
                        </Button>
                    ) : null}
                </div>
                <div className="drama-source-tabs thin-scrollbar" role="tablist" aria-label="原文章节">
                    {chapters.map((chapter) => (
                        <button key={chapter.id} type="button" role="tab" aria-selected={chapter.id === activeId} onClick={() => setChapterId(chapter.id)}>
                            {chapter.title}
                            <span>{formatCount(chapter.wordCount)} 字</span>
                        </button>
                    ))}
                </div>
            </header>
            <div className="drama-source-text thin-scrollbar">
                {query.isLoading ? (
                    <div className="drama-source-empty">正在读取原文…</div>
                ) : hit >= 0 ? (
                    <>
                        {text.slice(0, hit)}
                        <mark ref={markRef}>{text.slice(hit, hit + needleLength)}</mark>
                        {text.slice(hit + needleLength)}
                    </>
                ) : (
                    text
                )}
            </div>
            {quote && hit < 0 && text ? (
                <footer className="drama-source-foot">当前镜头的出处不在这一章，可切换章节查看</footer>
            ) : quote ? (
                <footer className="drama-source-foot is-hit">已高亮当前镜头的原文出处</footer>
            ) : (
                <footer className="drama-source-foot">点选左侧镜头，自动定位对应原文</footer>
            )}
        </aside>
    );
}
