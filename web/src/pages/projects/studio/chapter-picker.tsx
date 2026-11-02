import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { App, Button, InputNumber } from "antd";
import { AlertTriangle, X } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal";
import { DEFAULT_SELECTED_CHAPTERS, groupChapterEpisodes } from "@/lib/drama/chapter-selection";
import { dramaKeys } from "@/lib/drama/drama-query-keys";
import { EPISODE_GROUP_CHARS, EPISODE_SOURCE_CHARS } from "@/lib/drama/novel-parse";
import { getDramaChapter, listDramaChapters, produceDramaChapters, type DramaChapterRef } from "@/services/api/drama";

import { ChapterPickList, type ChapterPickItem } from "../chapter-pick-list";
import { formatCount } from "../drama-shared";

const MAX_CHAPTERS_PER_EPISODE = 12;

/**
 * 原著章节：导入时没选中的章节保存为预留章节，在这里继续加入制作。加入后按章节顺序建成新的集追加在末尾，
 * 调度循环随后写剧本；新出现的角色、道具与场景在写剧本时即时建档。
 */
export function ChapterPickerModal({
    open,
    projectId,
    defaultPerEpisode,
    blockedReason,
    onClose,
    onProduced,
}: {
    open: boolean;
    projectId: string;
    defaultPerEpisode: number;
    blockedReason?: string;
    onClose: () => void;
    onProduced: (episodeIds: string[]) => void;
}) {
    const { message } = App.useApp();
    const chaptersQuery = useQuery({ queryKey: dramaKeys.chapters(projectId), queryFn: ({ signal }) => listDramaChapters(projectId, signal), enabled: open });
    const chapters = useMemo(() => chaptersQuery.data?.chapters || [], [chaptersQuery.data]);
    // 默认选“接下来”的几章：从第一个预留章节起连续的预留章节。
    const [picked, setPicked] = useState<{ source: DramaChapterRef[]; chapters: Set<number> } | null>(null);
    const selection = useMemo(() => {
        if (picked?.source === chapters) return picked.chapters;
        const reserved = chapters.flatMap((chapter, index) => (chapter.reserved ? [index] : []));
        return new Set(reserved.slice(0, DEFAULT_SELECTED_CHAPTERS));
    }, [chapters, picked]);
    const [perEpisode, setPerEpisode] = useState<number | null>(null);
    const size = perEpisode ?? Math.max(1, defaultPerEpisode);
    const [previewIndex, setPreviewIndex] = useState<number>();
    const firstReserved = chapters.findIndex((chapter) => chapter.reserved);
    const preview = chapters[previewIndex ?? (firstReserved >= 0 ? firstReserved : 0)];
    const previewQuery = useQuery({ queryKey: [...dramaKeys.chapters(projectId), preview?.id], queryFn: ({ signal }) => getDramaChapter(projectId, preview!.id, signal), enabled: open && Boolean(preview), staleTime: 60_000 });

    const items = useMemo<ChapterPickItem[]>(
        () =>
            chapters.map((chapter) => ({
                key: chapter.id,
                title: chapter.title,
                words: chapter.wordCount,
                warn: chapter.reserved && chapter.wordCount > EPISODE_SOURCE_CHARS,
                disabled: !chapter.reserved,
                note: chapter.reserved ? undefined : chapter.episodeNumber ? `第 ${chapter.episodeNumber} 集` : "已加入",
            })),
        [chapters],
    );
    const chosen = useMemo(() => [...selection].filter((index) => chapters[index]?.reserved).sort((left, right) => left - right), [chapters, selection]);
    const groups = useMemo(
        () =>
            groupChapterEpisodes(
                chosen.map((index) => ({ position: chapters[index].position, chars: chapters[index].wordCount })),
                size,
            ),
        [chapters, chosen, size],
    );
    const longChapters = chosen.filter((index) => chapters[index].wordCount > EPISODE_SOURCE_CHARS).length;
    const oversized = groups.find((group) => group.chars > EPISODE_GROUP_CHARS);
    const reservedCount = items.filter((item) => !item.disabled).length;
    const problem = blockedReason
        ? blockedReason
        : longChapters
          ? `选中的 ${longChapters} 章原文超过 ${EPISODE_SOURCE_CHARS / 10_000} 万字，请先在该集的原文里拆开或取消选中`
          : oversized
            ? `${oversized.label}合计 ${formatCount(oversized.chars)} 字，每集原文不超过 ${formatCount(EPISODE_GROUP_CHARS)} 字，请减少每集章数`
            : "";

    const produce = useMutation({
        mutationFn: () => produceDramaChapters(projectId, { chapterIds: chosen.map((index) => chapters[index].id), chaptersPerEpisode: size }),
        onSuccess: (result) => {
            message.success(`已加入 ${chosen.length} 章，新建 ${result.episodeIds.length} 集，开始改编`);
            setPicked(null);
            onProduced(result.episodeIds);
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "加入制作失败"),
    });

    return (
        <AppModal open={open} onCancel={onClose} footer={null} title={null} closable={false} flush centered width="min(1120px, calc(100vw - 48px))" rootClassName="drama-root" aria-label="原著章节">
            <div className="drama-composer">
                <header className="drama-composer-head">
                    <div className="min-w-0">
                        <strong>原著章节</strong>
                        <span>勾选导入时未加入制作的章节，按章节顺序建成新的集追加在末尾；已做好的集不受影响</span>
                    </div>
                    <Button type="text" icon={<X className="size-4" />} aria-label="关闭" onClick={onClose} />
                </header>
                <div className="drama-composer-body drama-chapter-picker-body">
                    <aside className="drama-chapter-picker-side">
                        {chaptersQuery.isLoading ? (
                            <div className="drama-empty is-compact">正在读取原著目录…</div>
                        ) : chaptersQuery.isError ? (
                            <div className="drama-empty is-compact">
                                原著目录读取失败
                                <Button size="small" onClick={() => void chaptersQuery.refetch()}>
                                    重试
                                </Button>
                            </div>
                        ) : (
                            <ChapterPickList items={items} selected={selection} onChange={(next) => setPicked({ source: chapters, chapters: next })} previewIndex={previewIndex ?? firstReserved} onPreview={setPreviewIndex} quickLabel="接下来" />
                        )}
                    </aside>
                    <section className="drama-composer-editor">
                        {problem ? (
                            <div className="drama-composer-notice" role="alert">
                                <AlertTriangle className="size-4 shrink-0" />
                                {problem}
                            </div>
                        ) : null}
                        <div className="drama-chapter-picker-preview thin-scrollbar" aria-label="原文预览">
                            {preview ? (
                                <>
                                    <h3>
                                        {preview.title}
                                        <small>
                                            {formatCount(preview.wordCount)} 字{preview.reserved ? " · 未加入制作" : preview.episodeNumber ? ` · 第 ${preview.episodeNumber} 集` : ""}
                                        </small>
                                    </h3>
                                    <p>{previewQuery.isLoading ? "正在读取原文…" : previewQuery.isError ? "原文读取失败" : (previewQuery.data?.chapter.sourceText || "").slice(0, 8000)}</p>
                                </>
                            ) : (
                                <p>没有原著章节</p>
                            )}
                        </div>
                    </section>
                </div>
                <footer className="drama-composer-foot">
                    <span className="drama-chapter-picker-size">
                        每集
                        <InputNumber size="small" min={1} max={MAX_CHAPTERS_PER_EPISODE} precision={0} value={size} onChange={(value) => setPerEpisode(value || 1)} aria-label="每集章数" />章
                    </span>
                    <span className="drama-composer-count">{reservedCount ? `未加入制作 ${formatCount(reservedCount)} 章 · 选中 ${formatCount(chosen.length)} 章将建成 ${formatCount(groups.length)} 集` : "原著章节已全部加入制作"}</span>
                    <span className="flex-1" />
                    <Button onClick={onClose}>取消</Button>
                    <Button type="primary" disabled={!chosen.length || Boolean(problem)} loading={produce.isPending} onClick={() => produce.mutate()}>
                        加入制作
                    </Button>
                </footer>
            </div>
        </AppModal>
    );
}
