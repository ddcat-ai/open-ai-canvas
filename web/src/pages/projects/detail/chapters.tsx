import { useDeferredValue, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { App, Button, Dropdown, Form, Input, InputNumber, Modal, Popconfirm, Tooltip } from "antd";
import CharacterCount from "@tiptap/extension-character-count";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
    AlignCenter,
    AlignJustify,
    AlignLeft,
    AlignRight,
    Bold,
    Check,
    ChevronDown,
    Code2,
    Crosshair,
    Eraser,
    FileUp,
    GripVertical,
    Highlighter,
    Italic,
    Link2,
    List,
    ListOrdered,
    LayoutGrid,
    Minus,
    MoreHorizontal,
    MoveVertical,
    Plus,
    Quote,
    Redo2,
    Save,
    Search,
    Strikethrough,
    Trash2,
    Underline,
    Undo2,
    UsersRound,
    X,
} from "lucide-react";

import { useNavigate, useParams } from "react-router";

import { WorkspaceErrorState, WorkspaceState } from "@/components/layout/workspace-state";
import { resolveProjectCanvasStyle } from "@/components/canvas/canvas-style-picker-modal";
import { normalizeCharacterName } from "@/lib/canvas/canvas-character-reference";
import { decodeNovelText, splitTextIntoChapters } from "@/lib/canvas/canvas-document";
import { upsertProjectChapterStoryboard } from "@/lib/canvas/project-chapter-storyboard";
import { navigateToSettings } from "@/lib/settings-navigation";
import {
    createProjectAssetCandidates,
    createProjectUnit,
    deleteProjectUnit,
    getProjectUnit,
    importProjectUnits,
    linkCanvasUnit,
    reorderProjectUnits,
    updateProjectUnit,
    type ProjectUnit,
} from "@/services/api/projects";
import { createCanvasProjectWithRemoteSync, saveRemoteUserDataNow } from "@/services/user-data-sync";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";

import { formatCount, formatTime, statusLabel, type ProjectDetailViewProps } from "./shared";
import { extractChapterCharacters } from "./project-chapter-ai";

const CHAPTER_ROW_HEIGHT = 52;
const MAX_NOVEL_IMPORT_CHAPTERS = 2500;

export default function ProjectChaptersView({ detail, refreshProject, onCreateCanvas }: ProjectDetailViewProps) {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { chapterId = "" } = useParams();
    const initialSelectedId = detail.units.some((unit) => unit.id === chapterId) ? chapterId : detail.units[0]?.id || "";
    const [selectedId, setSelectedId] = useState(initialSelectedId);
    const [createOpen, setCreateOpen] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [moveTargetId, setMoveTargetId] = useState("");
    const [movePosition, setMovePosition] = useState<number | null>(null);
    const [orderedIds, setOrderedIds] = useState(() => detail.units.map((unit) => unit.id));
    const [draggedId, setDraggedId] = useState("");
    const [draftTitle, setDraftTitle] = useState("");
    const [draftHtml, setDraftHtml] = useState("");
    const [dirty, setDirty] = useState(false);
    const [extractingCharacters, setExtractingCharacters] = useState(false);
    const [importingCanvasId, setImportingCanvasId] = useState("");
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const localCanvases = useCanvasStore((state) => state.projects);
    const listRef = useRef<HTMLDivElement>(null);
    const deferredSearchQuery = useDeferredValue(searchQuery.trim().toLocaleLowerCase("zh-CN"));
    const orderedUnits = useMemo(() => {
        const byId = new Map(detail.units.map((unit) => [unit.id, unit]));
        return orderedIds.map((id) => byId.get(id)).filter((unit): unit is ProjectUnit => Boolean(unit));
    }, [detail.units, orderedIds]);
    const selectedUnitSummary = detail.units.find((unit) => unit.id === selectedId) || orderedUnits[0];
    const selectedUnitQuery = useQuery({
        queryKey: ["project-unit", detail.project.id, selectedId],
        queryFn: () => getProjectUnit(detail.project.id, selectedId),
        enabled: Boolean(selectedId),
    });
    const selectedUnit = selectedUnitQuery.data?.unit || selectedUnitSummary;
    const chapterNumberById = useMemo(() => new Map(orderedUnits.map((unit, index) => [unit.id, index + 1])), [orderedUnits]);
    const canvasCountByUnitId = useMemo(() => detail.canvasUnitLinks.reduce<Map<string, number>>((result, link) => result.set(link.unitId, (result.get(link.unitId) || 0) + 1), new Map()), [detail.canvasUnitLinks]);
    const projectCanvasTargets = useMemo(() => {
        const targets = new Map(detail.canvases.map((canvas) => [canvas.id, { id: canvas.id, title: canvas.title }]));
        localCanvases.filter((canvas) => canvas.projectId === detail.project.id).forEach((canvas) => targets.set(canvas.id, { id: canvas.id, title: canvas.title }));
        return Array.from(targets.values());
    }, [detail.canvases, detail.project.id, localCanvases]);
    const visibleUnits = useMemo(() => {
        if (!deferredSearchQuery) return orderedUnits;
        const numericQuery = /^\d+$/.test(deferredSearchQuery) ? deferredSearchQuery.replace(/^0+/, "") || "0" : "";
        return orderedUnits.filter((unit, index) => (numericQuery && String(index + 1).startsWith(numericQuery)) || unit.title.toLocaleLowerCase("zh-CN").includes(deferredSearchQuery));
    }, [deferredSearchQuery, orderedUnits]);
    const chapterVirtualizer = useVirtualizer({
        count: visibleUnits.length,
        getScrollElement: () => listRef.current,
        estimateSize: () => CHAPTER_ROW_HEIGHT,
        getItemKey: (index) => visibleUnits[index]?.id || index,
        initialOffset: () => readStoredScroll(`project-chapters:${detail.project.id}`),
        onChange: (instance, scrolling) => {
            if (!scrolling && instance.scrollOffset !== null) sessionStorage.setItem(`project-chapters:${detail.project.id}`, String(instance.scrollOffset));
        },
        overscan: 10,
    });

    useEffect(() => {
        setOrderedIds(detail.units.slice().sort((left, right) => left.position - right.position).map((unit) => unit.id));
        if (!detail.units.some((unit) => unit.id === selectedId)) setSelectedId(detail.units[0]?.id || "");
    }, [detail.units, selectedId]);

    useEffect(() => {
        if (!chapterId || chapterId === selectedId || dirty || !detail.units.some((unit) => unit.id === chapterId)) return;
        setSelectedId(chapterId);
    }, [chapterId, detail.units, dirty, selectedId]);

    useEffect(() => {
        if (!chapterId || dirty || detail.units.some((unit) => unit.id === chapterId)) return;
        const firstId = orderedUnits[0]?.id;
        navigate(firstId ? `/projects/${detail.project.id}/chapters/${firstId}` : `/projects/${detail.project.id}/chapters`, { replace: true });
    }, [chapterId, detail.project.id, detail.units, dirty, navigate, orderedUnits]);

    useEffect(() => {
        if (selectedId) sessionStorage.setItem(`project-active-chapter:${detail.project.id}`, selectedId);
    }, [detail.project.id, selectedId]);

    const saveMutation = useMutation({
        mutationFn: () => selectedUnitQuery.data?.unit
            ? updateProjectUnit(detail.project.id, selectedUnitQuery.data.unit.id, {
                title: draftTitle.trim(),
                sourceText: draftHtml,
                status: stripHtml(draftHtml) ? "ready" : "draft",
            })
            : Promise.reject(new Error("请选择章节")),
        onSuccess: ({ unit }) => { queryClient.setQueryData(["project-unit", detail.project.id, unit.id], { unit }); setDirty(false); refreshProject(); message.success("章节已保存"); },
        onError: (error) => message.error(error instanceof Error ? error.message : "章节保存失败"),
    });
    const createMutation = useMutation({
        mutationFn: (values: { title: string; sourceText?: string }) => createProjectUnit(detail.project.id, { kind: "chapter", title: values.title, sourceText: plainTextToHtml(values.sourceText || ""), position: detail.units.length }),
        onSuccess: ({ unit }) => { setCreateOpen(false); setSelectedId(unit.id); refreshProject(); navigate(`/projects/${detail.project.id}/chapters/${unit.id}`); message.success("章节已创建"); },
        onError: (error) => message.error(error instanceof Error ? error.message : "章节创建失败"),
    });
    const importMutation = useMutation({
        mutationFn: (chapters: Array<{ title: string; plainText: string }>) => importProjectUnits(detail.project.id, chapters.map((chapter) => ({ kind: "chapter", title: chapter.title, sourceText: plainTextToHtml(chapter.plainText) }))),
        onSuccess: ({ units }) => { setImportOpen(false); if (units[0]) { setSelectedId(units[0].id); navigate(`/projects/${detail.project.id}/chapters/${units[0].id}`); } refreshProject(); message.success(`已导入 ${units.length} 章`); },
        onError: (error) => message.error(error instanceof Error ? error.message : "小说导入失败"),
    });
    const reorderMutation = useMutation({
        mutationFn: (unitIds: string[]) => reorderProjectUnits(detail.project.id, unitIds),
        onSuccess: () => { refreshProject(); message.success("章节顺序已更新"); },
        onError: (error) => { refreshProject(); message.error(error instanceof Error ? error.message : "章节排序失败"); },
    });
    const deleteMutation = useMutation({
        mutationFn: (unitId: string) => deleteProjectUnit(detail.project.id, unitId),
        onSuccess: (_, unitId) => {
            const index = orderedIds.indexOf(unitId);
            const remaining = orderedIds.filter((id) => id !== unitId);
            setOrderedIds(remaining);
            if (selectedId === unitId) {
                const nextId = remaining[Math.min(index, remaining.length - 1)] || "";
                setSelectedId(nextId);
                navigate(nextId ? `/projects/${detail.project.id}/chapters/${nextId}` : `/projects/${detail.project.id}/chapters`, { replace: true });
            }
            refreshProject();
            message.success("章节已删除");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "章节删除失败"),
    });

    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true } }),
            TextAlign.configure({ types: ["heading", "paragraph"] }),
            TextStyle,
            Color.configure({ types: ["textStyle"] }),
            Highlight.configure({ multicolor: true }),
            CharacterCount,
            Placeholder.configure({ placeholder: "从这一章开始写下故事……" }),
        ],
        content: selectedUnitQuery.data?.unit.sourceText || "",
        editorProps: { attributes: { class: "project-chapter-editor focus:outline-none" } },
        onUpdate: ({ editor: nextEditor }) => { setDraftHtml(nextEditor.getHTML()); setDirty(true); },
    });

    useEffect(() => {
        if (!selectedUnitSummary) return;
        setDraftTitle(selectedUnitSummary.title);
        setDraftHtml("");
        setDirty(false);
    }, [selectedUnitSummary?.id]);

    useEffect(() => {
        const loadedUnit = selectedUnitQuery.data?.unit;
        if (!loadedUnit || !editor) return;
        setDraftTitle(loadedUnit.title);
        setDraftHtml(loadedUnit.sourceText || "");
        setDirty(false);
        editor.commands.setContent(loadedUnit.sourceText || "", { emitUpdate: false });
        // 只在切换章节时装载服务端内容，避免项目刷新覆盖当前未保存正文。
    }, [editor, selectedUnitQuery.data?.unit]);

    const wordCount = useMemo(() => editor?.storage.characterCount?.characters?.() || stripHtml(draftHtml).length || 0, [draftHtml, editor]);
    const chapterCanvasCount = (unitId: string) => canvasCountByUnitId.get(unitId) || 0;
    const chapterShotCount = (unitId: string) => detail.shots.filter((shot) => shot.unitId === unitId).length;
    const chapterAnalysisInput = () => {
        const unit = selectedUnitQuery.data?.unit;
        if (!unit) throw new Error("章节正文尚未加载完成");
        if (dirty) throw new Error("请先保存当前章节，再运行 AI 分析");
        const sourceText = editor?.getText().trim() || stripHtml(unit.sourceText);
        if (!sourceText) throw new Error("当前章节没有可分析的正文");
        const textModel = effectiveConfig.textModel || effectiveConfig.model;
        if (!isAiConfigReady(effectiveConfig, textModel)) {
            navigateToSettings({ continueCreation: true });
            return null;
        }
        return {
            projectId: detail.project.id,
            projectName: detail.project.name,
            chapterId: unit.id,
            chapterTitle: unit.title,
            sourceText,
            projectStyle: resolveProjectCanvasStyle(detail.project.stylePresetId, detail.project.styleProfileJson)?.prompt || "",
            config: effectiveConfig,
        };
    };
    const extractCharacters = async () => {
        try {
            const input = chapterAnalysisInput();
            if (!input) return;
            setExtractingCharacters(true);
            const characters = await extractChapterCharacters(input);
            // 已确认角色允许再次提取并作为候选归并，只有尚待处理的同名候选需要去重。
            const knownNames = new Set(detail.assetCandidates
                .filter((candidate) => candidate.category === "character" && candidate.status === "pending_confirmation")
                .map((candidate) => normalizeCharacterName(candidate.name)));
            const fresh = characters.filter((character) => ![character.name, ...character.aliases].map(normalizeCharacterName).some((name) => knownNames.has(name)));
            if (!fresh.length) {
                message.info("本章角色已存在于待确认列表中");
                return;
            }
            await createProjectAssetCandidates(detail.project.id, fresh.map((character) => ({ unitId: input.chapterId, name: character.name, category: "character", details: { ...character } })));
            refreshProject();
            message.success(`已提取 ${fresh.length} 个角色，请到项目资产确认`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "角色提取失败");
        } finally {
            setExtractingCharacters(false);
        }
    };
    const importStoryboardToCanvas = async (targetCanvasId?: string) => {
        if (!selectedUnit) return;
        const shots = detail.shots.filter((shot) => shot.unitId === selectedUnit.id);
        if (!shots.length) {
            message.warning("本章没有可导入的历史分镜");
            return;
        }
        setImportingCanvasId(targetCanvasId || "new");
        try {
            let canvasId = targetCanvasId || "";
            if (canvasId) {
                const canvas = useCanvasStore.getState().openProject(canvasId);
                if (!canvas) throw new Error("目标画布尚未同步到本地，请刷新后重试");
                const merged = upsertProjectChapterStoryboard(canvas.nodes, canvas.connections, { unit: selectedUnit, shots });
                useCanvasStore.getState().updateProject(canvasId, { nodes: merged.nodes, connections: merged.connections, projectId: detail.project.id });
                await saveRemoteUserDataNow();
            } else {
                const seed = upsertProjectChapterStoryboard([], [], { unit: selectedUnit, shots });
                const created = await createCanvasProjectWithRemoteSync(`${selectedUnit.title} · 分镜画布`, detail.project.id, { nodes: seed.nodes, connections: seed.connections });
                canvasId = created.id;
                if (created.syncError) {
                    message.warning(created.syncError instanceof Error ? `分镜画布已保存在本地，章节关联稍后重试：${created.syncError.message}` : "分镜画布已保存在本地，章节关联稍后重试");
                    navigate(`/canvas/${canvasId}`);
                    return;
                }
            }
            await linkCanvasUnit(detail.project.id, { canvasId, unitId: selectedUnit.id, role: "storyboard" });
            refreshProject();
            message.success(`已将 ${shots.length} 个分镜导入画布并关联本章`);
            navigate(`/canvas/${canvasId}`);
        } catch (error) {
            refreshProject();
            message.error(error instanceof Error ? `分镜导入失败：${error.message}` : "分镜导入失败");
        } finally {
            setImportingCanvasId("");
        }
    };
    const selectChapter = (unitId: string) => {
        if (unitId === selectedId) return;
        if (dirty) { message.warning("请先保存当前章节，再切换章节"); return; }
        setSelectedId(unitId);
        sessionStorage.setItem(`project-active-chapter:${detail.project.id}`, unitId);
        navigate(`/projects/${detail.project.id}/chapters/${unitId}`);
    };
    const moveChapter = (targetId: string) => {
        if (!draggedId || draggedId === targetId || reorderMutation.isPending) return;
        const next = orderedIds.filter((id) => id !== draggedId);
        next.splice(next.indexOf(targetId), 0, draggedId);
        setOrderedIds(next);
        setDraggedId("");
        reorderMutation.mutate(next);
    };
    const moveChapterToPosition = () => {
        if (!moveTargetId || !movePosition || reorderMutation.isPending) return;
        const next = orderedIds.filter((id) => id !== moveTargetId);
        const targetIndex = Math.min(Math.max(movePosition - 1, 0), next.length);
        next.splice(targetIndex, 0, moveTargetId);
        setOrderedIds(next);
        setMoveTargetId("");
        setMovePosition(null);
        reorderMutation.mutate(next);
        window.setTimeout(() => {
            const index = next.indexOf(moveTargetId);
            const visibleIndex = visibleUnits.findIndex((unit) => unit.id === moveTargetId);
            if (!deferredSearchQuery && index >= 0) chapterVirtualizer.scrollToIndex(index, { align: "center" });
            else if (visibleIndex >= 0) chapterVirtualizer.scrollToIndex(visibleIndex, { align: "center" });
        }, 0);
    };
    const revealSelectedChapter = () => {
        if (!selectedId) return;
        setSearchQuery("");
        window.setTimeout(() => {
            const index = orderedIds.indexOf(selectedId);
            if (index >= 0) chapterVirtualizer.scrollToIndex(index, { align: "center" });
        }, 0);
    };
    const handleListDragOver = (event: DragEvent<HTMLDivElement>) => {
        if (!draggedId || deferredSearchQuery) return;
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        const edge = 48;
        if (event.clientY < bounds.top + edge) event.currentTarget.scrollBy({ top: -24 });
        else if (event.clientY > bounds.bottom - edge) event.currentTarget.scrollBy({ top: 24 });
    };

    return (
        <div className="grid h-full min-h-0 min-w-0 w-full grid-rows-[minmax(180px,34vh)_minmax(0,1fr)] overflow-hidden lg:grid-cols-[232px_minmax(0,1fr)] lg:grid-rows-1">
            <aside className="flex min-h-0 min-w-0 w-full flex-col border-b border-border/70 bg-background/28 lg:border-b-0 lg:border-r">
                <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/70 px-2.5">
                    <div className="text-xs font-medium text-foreground/55">章节 <span className="ml-1 tabular-nums text-foreground/35">{detail.units.length.toLocaleString("zh-CN")}</span></div>
                    <div className="flex items-center gap-0.5">
                        {selectedId ? <Tooltip title="回到当前章节"><Button type="text" size="small" icon={<Crosshair className="size-3.5" />} aria-label="回到当前章节" onClick={revealSelectedChapter} /></Tooltip> : null}
                        <Tooltip title="导入小说"><Button type="text" size="small" icon={<FileUp className="size-3.5" />} aria-label="导入小说" onClick={() => setImportOpen(true)} /></Tooltip>
                        <Tooltip title="添加章节"><Button type="text" size="small" icon={<Plus className="size-4" />} aria-label="添加章节" onClick={() => setCreateOpen(true)} /></Tooltip>
                    </div>
                </div>
                <div className="shrink-0 border-b border-border/60 p-2">
                    <label className="flex h-8 items-center gap-1.5 rounded-md border border-border/75 bg-background/55 px-2 focus-within:border-[var(--workspace-accent)] focus-within:ring-2 focus-within:ring-[var(--workspace-accent-soft)]">
                        <Search className="size-3.5 shrink-0 text-foreground/32" />
                        <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && visibleUnits[0]) selectChapter(visibleUnits[0].id); }} className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-foreground/28" placeholder="搜索标题或章节序号" aria-label="搜索章节" />
                        {searchQuery ? <button type="button" onClick={() => setSearchQuery("")} className="grid size-5 shrink-0 place-items-center rounded text-foreground/32 hover:bg-foreground/[.06]" aria-label="清空章节搜索"><X className="size-3" /></button> : null}
                    </label>
                    {deferredSearchQuery ? <div className="mt-1 px-0.5 text-[var(--fs-micro)] tabular-nums text-foreground/35">找到 {visibleUnits.length.toLocaleString("zh-CN")} 章 · 搜索时使用“移动到”调整顺序</div> : null}
                </div>
                {orderedUnits.length ? (
                    <div ref={listRef} onDragOver={handleListDragOver} className="thin-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
                        {visibleUnits.length ? <div className="relative w-full" style={{ height: chapterVirtualizer.getTotalSize() }}>
                            {chapterVirtualizer.getVirtualItems().map((virtualItem) => {
                                const unit = visibleUnits[virtualItem.index];
                                if (!unit) return null;
                                const chapterNumber = chapterNumberById.get(unit.id) || virtualItem.index + 1;
                                return (
                                    <div key={unit.id} className="absolute left-0 top-0 w-full" style={{ height: virtualItem.size, transform: `translateY(${virtualItem.start}px)` }}>
                                        <div draggable={!dirty && !reorderMutation.isPending && !deferredSearchQuery} onDragStart={(event) => { setDraggedId(unit.id); event.dataTransfer.effectAllowed = "move"; }} onDragOver={(event) => { if (deferredSearchQuery) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={() => moveChapter(unit.id)} onDragEnd={() => setDraggedId("")} className={`group flex h-[50px] items-start rounded-md transition-colors duration-100 ${unit.id === selectedUnit?.id ? "bg-foreground/[.08]" : "hover:bg-foreground/[.04]"} ${draggedId === unit.id ? "opacity-45" : ""}`}>
                                            <button type="button" disabled={Boolean(deferredSearchQuery)} className="mt-2 grid size-6 shrink-0 cursor-grab place-items-center text-foreground/25 active:cursor-grabbing disabled:cursor-default disabled:opacity-35" aria-label={`拖动第 ${chapterNumber} 章排序`}><GripVertical className="size-3.5" /></button>
                                            <button type="button" onClick={() => selectChapter(unit.id)} className="flex min-w-0 flex-1 items-start gap-2 px-0 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--workspace-accent)]">
                                                <span className={`w-8 shrink-0 pt-0.5 text-[var(--fs-tiny)] tabular-nums ${unit.id === selectedUnit?.id ? "font-semibold text-[var(--workspace-accent)]" : "text-foreground/35"}`}>{String(chapterNumber).padStart(Math.max(2, String(orderedUnits.length).length), "0")}</span>
                                                <span className="min-w-0 flex-1"><span className={`block truncate text-[var(--fs-body)] ${unit.id === selectedUnit?.id ? "font-medium text-foreground" : "text-foreground/65"}`}>{unit.title}</span><span className="mt-0.5 flex items-center gap-1 text-[var(--fs-tiny)] text-foreground/38"><span>{statusLabel(unit.status)}</span>{chapterCanvasCount(unit.id) ? <><span>·</span><span>{chapterCanvasCount(unit.id)} 画布</span></> : null}</span></span>
                                            </button>
                                            <Dropdown trigger={["click"]} placement="bottomRight" menu={{ items: [{ key: "move", icon: <MoveVertical className="size-3.5" />, label: "移动到…" }], onClick: () => { setMoveTargetId(unit.id); setMovePosition(chapterNumber); } }}>
                                                <button type="button" className="mt-2 grid size-6 shrink-0 place-items-center rounded text-foreground/28 opacity-0 hover:bg-foreground/[.06] hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100" aria-label={`${unit.title}更多操作`}><MoreHorizontal className="size-3.5" /></button>
                                            </Dropdown>
                                            <Popconfirm title="删除此章节？" description="章节内容及关联制作记录将被删除，已关联的画布不会删除。" okText="删除" cancelText="取消" okButtonProps={{ danger: true, loading: deleteMutation.isPending }} onConfirm={() => deleteMutation.mutate(unit.id)}>
                                                <button type="button" className="mr-1 mt-2 grid size-6 shrink-0 place-items-center rounded text-foreground/28 opacity-0 hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`删除${unit.title}`}><Trash2 className="size-3.5" /></button>
                                            </Popconfirm>
                                        </div>
                                    </div>
                                );
                            })}
                        </div> : <div className="px-3 py-8 text-center text-xs text-foreground/40">没有匹配的章节</div>}
                    </div>
                ) : <WorkspaceState icon="projects" compact className="flex-1 px-4" title="还没有章节" description="添加章节后可继续编写正文和关联画布。" action={<Button size="small" type="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreateOpen(true)}>添加章节</Button>} />}
            </aside>

            <section className="min-h-0 min-w-0 w-full bg-background/18 p-2.5 sm:p-3.5">
                {selectedUnit ? (
                    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-border/80 bg-background">
                        <header className="flex shrink-0 flex-wrap items-start gap-3 border-b border-border/70 px-4 py-3">
                            <div className="min-w-0 flex-1">
                                <div className="mb-1 text-[var(--fs-tiny)] font-medium tabular-nums text-foreground/38">第 {String(orderedUnits.findIndex((unit) => unit.id === selectedUnit.id) + 1).padStart(2, "0")} 章</div>
                                <Input variant="borderless" value={draftTitle} disabled={!selectedUnitQuery.data?.unit} onChange={(event) => { setDraftTitle(event.target.value); setDirty(true); }} className="!h-auto !px-0 !py-0 !text-xl !font-semibold !leading-tight disabled:!cursor-wait disabled:!text-foreground" placeholder="章节标题" />
                                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[var(--fs-tiny)] text-foreground/38"><span>{dirty ? "有未保存修改" : `保存于 ${formatTime(selectedUnit.updatedAt)}`}</span><span>·</span><span>{formatCount(wordCount)} 字</span><span>·</span><span>{chapterCanvasCount(selectedUnit.id)} 个画布</span></div>
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                                <Button size="small" icon={<UsersRound className="size-3.5" />} disabled={!selectedUnitQuery.data?.unit || dirty || extractingCharacters} loading={extractingCharacters} onClick={() => void extractCharacters()}>提取角色</Button>
                                {chapterShotCount(selectedUnit.id) ? <Dropdown trigger={["click"]} menu={{ items: [{ key: "new", icon: <Plus className="size-3.5" />, label: "新建章节画布并导入" }, ...(projectCanvasTargets.length ? [{ type: "divider" as const }, ...projectCanvasTargets.map((canvas) => ({ key: canvas.id, icon: <LayoutGrid className="size-3.5" />, label: `导入到：${canvas.title}${detail.canvasUnitLinks.some((link) => link.canvasId === canvas.id && link.unitId === selectedUnit.id) ? " · 已关联本章" : ""}` }))] : [])], onClick: ({ key }) => void importStoryboardToCanvas(key === "new" ? undefined : key) }}><Button size="small" type="primary" icon={<LayoutGrid className="size-3.5" />} loading={Boolean(importingCanvasId)} disabled={extractingCharacters}>导入分镜</Button></Dropdown> : <Button size="small" type="primary" icon={<LayoutGrid className="size-3.5" />} disabled={!selectedUnitQuery.data?.unit || dirty || extractingCharacters} onClick={onCreateCanvas}>在画布中分镜</Button>}
                                <Button size="small" type={dirty ? "primary" : "default"} icon={dirty ? <Save className="size-3.5" /> : <Check className="size-3.5" />} disabled={!selectedUnitQuery.data?.unit || !dirty || !draftTitle.trim() || saveMutation.isPending} loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>{dirty ? "保存" : "已保存"}</Button>
                            </div>
                        </header>
                        <EditorToolbar editor={editor} />
                        <div className="project-chapter-editor-scroll thin-scrollbar min-h-0 flex-1 overflow-y-auto bg-foreground/[.012]">
                            {selectedUnitQuery.isLoading ? <WorkspaceState icon="loading" compact className="h-full" title="正在读取章节正文" description="正文准备完成后会自动显示。" /> : selectedUnitQuery.isError ? <WorkspaceErrorState compact title="章节正文读取失败" description={selectedUnitQuery.error instanceof Error ? selectedUnitQuery.error.message : "请检查网络连接后重试。"} onRetry={() => void selectedUnitQuery.refetch()} /> : <div className="project-chapter-editor-wrap min-h-full"><EditorContent editor={editor} /></div>}
                        </div>
                    </div>
                ) : <WorkspaceState icon="projects" compact className="h-full" title="请选择章节" description="从左侧章节列表选择一章开始编辑。" />}
            </section>
            <CreateChapterModal open={createOpen} onClose={() => setCreateOpen(false)} loading={createMutation.isPending} onSubmit={(values) => createMutation.mutate(values)} />
            <ImportNovelModal open={importOpen} loading={importMutation.isPending} onClose={() => setImportOpen(false)} onImport={(chapters) => importMutation.mutate(chapters)} />
            <Modal title="移动章节" open={Boolean(moveTargetId)} width={400} okText="移动" cancelText="取消" okButtonProps={{ disabled: !movePosition || movePosition < 1 || movePosition > orderedUnits.length, loading: reorderMutation.isPending }} onCancel={() => { setMoveTargetId(""); setMovePosition(null); }} onOk={moveChapterToPosition} styles={{ body: { paddingTop: 12 } }}>
                <div className="text-xs leading-5 text-foreground/50">输入目标章节位置。适合上千章项目的长距离调整，移动后其他章节会自动顺延。</div>
                <label className="mt-3 flex items-center gap-2 text-sm"><span className="shrink-0">移动到第</span><InputNumber min={1} max={orderedUnits.length} precision={0} value={movePosition} onChange={setMovePosition} className="min-w-0 flex-1" /><span className="shrink-0">章</span></label>
            </Modal>
        </div>
    );
}

function EditorToolbar({ editor }: { editor: Editor | null }) {
    const setLink = () => {
        if (!editor) return;
        const current = String(editor.getAttributes("link").href || "");
        const href = window.prompt("输入链接地址", current);
        if (href === null) return;
        if (!href.trim()) editor.chain().focus().unsetLink().run();
        else editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
    };
    const setColor = () => {
        const color = window.prompt("输入文字颜色，例如 #d97706", String(editor?.getAttributes("textStyle").color || "#d97706"));
        if (color?.trim()) editor?.chain().focus().setColor(color.trim()).run();
    };
    const setHighlight = () => {
        const color = window.prompt("输入高亮颜色，例如 #fef3c7", String(editor?.getAttributes("highlight").color || "#fef3c7"));
        if (color?.trim()) editor?.chain().focus().toggleHighlight({ color: color.trim() }).run();
    };
    const blockLabel = editor?.isActive("heading", { level: 1 }) ? "标题 1" : editor?.isActive("heading", { level: 2 }) ? "标题 2" : editor?.isActive("heading", { level: 3 }) ? "标题 3" : "正文";
    const alignment = editor?.isActive({ textAlign: "center" }) ? "center" : editor?.isActive({ textAlign: "right" }) ? "right" : editor?.isActive({ textAlign: "justify" }) ? "justify" : "left";
    const alignmentIcon = alignment === "center" ? <AlignCenter className="size-3.5" /> : alignment === "right" ? <AlignRight className="size-3.5" /> : alignment === "justify" ? <AlignJustify className="size-3.5" /> : <AlignLeft className="size-3.5" />;
    return (
        <div className="hide-scrollbar flex h-10 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/70 px-2">
            <EditorTool editor={editor} label="撤销" icon={<Undo2 className="size-3.5" />} onClick={() => editor?.chain().focus().undo().run()} />
            <EditorTool editor={editor} label="重做" icon={<Redo2 className="size-3.5" />} onClick={() => editor?.chain().focus().redo().run()} />
            <ToolbarDivider />
            <Dropdown trigger={["click"]} menu={{ selectedKeys: [blockLabel], items: ["正文", "标题 1", "标题 2", "标题 3"].map((key) => ({ key, label: key })), onClick: ({ key }) => key === "正文" ? editor?.chain().focus().setParagraph().run() : editor?.chain().focus().toggleHeading({ level: Number(key.slice(-1)) as 1 | 2 | 3 }).run() }}>
                <button type="button" className="flex h-7 items-center gap-1 rounded px-2 text-xs text-foreground/60 hover:bg-foreground/[.06]" aria-label="段落格式">{blockLabel}<ChevronDown className="size-3" /></button>
            </Dropdown>
            <EditorTool editor={editor} label="粗体" icon={<Bold className="size-3.5" />} onClick={() => editor?.chain().focus().toggleBold().run()} active={Boolean(editor?.isActive("bold"))} />
            <EditorTool editor={editor} label="斜体" icon={<Italic className="size-3.5" />} onClick={() => editor?.chain().focus().toggleItalic().run()} active={Boolean(editor?.isActive("italic"))} />
            <EditorTool editor={editor} label="下划线" icon={<Underline className="size-3.5" />} onClick={() => editor?.chain().focus().toggleUnderline().run()} active={Boolean(editor?.isActive("underline"))} />
            <EditorTool editor={editor} label="删除线" icon={<Strikethrough className="size-3.5" />} onClick={() => editor?.chain().focus().toggleStrike().run()} active={Boolean(editor?.isActive("strike"))} />
            <ToolbarDivider />
            <Dropdown trigger={["click"]} menu={{ selectedKeys: [alignment], items: [{ key: "left", icon: <AlignLeft className="size-3.5" />, label: "左对齐" }, { key: "center", icon: <AlignCenter className="size-3.5" />, label: "居中" }, { key: "right", icon: <AlignRight className="size-3.5" />, label: "右对齐" }, { key: "justify", icon: <AlignJustify className="size-3.5" />, label: "两端对齐" }], onClick: ({ key }) => editor?.chain().focus().setTextAlign(key).run() }}>
                <button type="button" className="grid size-7 place-items-center rounded text-foreground/60 hover:bg-foreground/[.06]" aria-label="文字对齐">{alignmentIcon}</button>
            </Dropdown>
            <EditorTool editor={editor} label="项目符号" icon={<List className="size-3.5" />} onClick={() => editor?.chain().focus().toggleBulletList().run()} active={Boolean(editor?.isActive("bulletList"))} />
            <EditorTool editor={editor} label="编号列表" icon={<ListOrdered className="size-3.5" />} onClick={() => editor?.chain().focus().toggleOrderedList().run()} active={Boolean(editor?.isActive("orderedList"))} />
            <EditorTool editor={editor} label="引用" icon={<Quote className="size-3.5" />} onClick={() => editor?.chain().focus().toggleBlockquote().run()} active={Boolean(editor?.isActive("blockquote"))} />
            <EditorTool editor={editor} label="链接" icon={<Link2 className="size-3.5" />} onClick={setLink} active={Boolean(editor?.isActive("link"))} />
            <Dropdown trigger={["click"]} placement="bottomRight" menu={{ items: [{ key: "color", icon: <span className="text-[var(--fs-label)] font-bold text-amber-600">A</span>, label: "文字颜色" }, { key: "highlight", icon: <Highlighter className="size-3.5" />, label: "高亮颜色" }, { type: "divider" }, { key: "code", icon: <Code2 className="size-3.5" />, label: "行内代码" }, { key: "rule", icon: <Minus className="size-3.5" />, label: "分隔线" }, { key: "clear", icon: <Eraser className="size-3.5" />, label: "清除格式" }], onClick: ({ key }) => { if (key === "color") setColor(); else if (key === "highlight") setHighlight(); else if (key === "code") editor?.chain().focus().toggleCode().run(); else if (key === "rule") editor?.chain().focus().setHorizontalRule().run(); else if (key === "clear") editor?.chain().focus().clearNodes().unsetAllMarks().run(); } }}>
                <button type="button" className="grid size-7 place-items-center rounded text-foreground/60 hover:bg-foreground/[.06]" aria-label="更多格式"><MoreHorizontal className="size-4" /></button>
            </Dropdown>
        </div>
    );
}

function EditorTool({ editor, label, icon, active = false, onClick }: { editor: Editor | null; label: string; icon: ReactNode; active?: boolean; onClick: () => void }) {
    return <Tooltip title={label}><button type="button" aria-label={label} className={`grid size-7 shrink-0 place-items-center rounded ${active ? "bg-foreground/[.08] text-[var(--workspace-accent)]" : "text-foreground/55 hover:bg-foreground/[.06] hover:text-foreground"}`} disabled={!editor} onClick={onClick}>{icon}</button></Tooltip>;
}

function ToolbarDivider() {
    return <span className="mx-1 h-4 w-px shrink-0 bg-border" />;
}

function CreateChapterModal({ open, onClose, loading, onSubmit }: { open: boolean; onClose: () => void; loading: boolean; onSubmit: (values: { title: string; sourceText?: string }) => void }) {
    return <Modal title="添加章节" open={open} footer={null} destroyOnHidden onCancel={onClose} width={480} styles={{ body: { paddingTop: 12 } }}><Form layout="vertical" onFinish={onSubmit}><Form.Item name="title" label="章节标题" rules={[{ required: true, whitespace: true, message: "请输入章节标题" }]}><Input autoFocus placeholder="例如：雨夜归城" /></Form.Item><Form.Item name="sourceText" label="正文（可选）"><Input.TextArea rows={4} placeholder="创建后仍可继续编辑和排版" /></Form.Item><div className="flex justify-end gap-2"><Button onClick={onClose}>取消</Button><Button type="primary" htmlType="submit" loading={loading}>创建章节</Button></div></Form></Modal>;
}

function ImportNovelModal({ open, loading, onClose, onImport }: { open: boolean; loading: boolean; onClose: () => void; onImport: (chapters: Array<{ title: string; plainText: string }>) => void }) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [text, setText] = useState("");
    const [fileName, setFileName] = useState("");
    const deferredText = useDeferredValue(text);
    const chapters = useMemo(() => deferredText.trim() ? splitTextIntoChapters(deferredText).map((chapter) => ({ title: chapter.title, plainText: chapter.plainText })) : [], [deferredText]);
    useEffect(() => { if (!open) { setText(""); setFileName(""); } }, [open]);
    const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        setFileName(file.name);
        setText(decodeNovelText(await file.arrayBuffer()));
    };
    return (
        <Modal title={null} open={open} footer={null} destroyOnHidden onCancel={onClose} width={760} styles={{ container: { padding: 0, overflow: "hidden" }, body: { padding: 0 } }}>
            <div className="flex min-h-[478px] flex-col">
                <header className="flex h-12 shrink-0 items-center border-b border-border px-4"><div><h2 className="text-sm font-semibold">导入小说</h2><p className="mt-0.5 text-[var(--fs-tiny)] text-foreground/42">自动识别章节标题，确认后追加到当前项目</p></div></header>
                <div className="grid min-h-[430px] flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_240px]">
                <div className="border-b border-border p-3 md:border-b-0 md:border-r">
                    <div className="mb-2 flex items-center justify-between gap-2"><div><div className="text-sm font-medium">小说正文</div><div className="mt-0.5 text-[var(--fs-label)] text-foreground/45">识别章节标题后追加到现有章节</div></div><Button size="small" icon={<FileUp className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>{fileName || "选择 TXT"}</Button></div>
                    <input ref={fileInputRef} type="file" accept=".txt,.md,text/plain,text/markdown" className="hidden" onChange={(event) => void readFile(event)} />
                    <Input.TextArea value={text} onChange={(event) => setText(event.target.value)} rows={16} placeholder={'也可以直接粘贴小说正文，例如：\n\n第一章 雨夜来信\n正文……\n\n第二章 灯塔以北\n正文……'} className="!resize-none" />
                </div>
                <div className="flex min-h-0 flex-col">
                    <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3 text-xs"><span className="font-medium">拆分预览</span><span className="tabular-nums text-foreground/45">{chapters.length} 章</span></div>
                    <ImportChapterPreview chapters={chapters} />
                    <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border p-3"><span className={`text-[var(--fs-tiny)] ${chapters.length > MAX_NOVEL_IMPORT_CHAPTERS ? "text-red-500" : "text-foreground/38"}`}>{chapters.length > MAX_NOVEL_IMPORT_CHAPTERS ? `最多一次导入 ${MAX_NOVEL_IMPORT_CHAPTERS.toLocaleString("zh-CN")} 章` : `支持最多 ${MAX_NOVEL_IMPORT_CHAPTERS.toLocaleString("zh-CN")} 章`}</span><div className="flex gap-2"><Button size="small" onClick={onClose}>取消</Button><Button size="small" type="primary" disabled={!chapters.length || chapters.length > MAX_NOVEL_IMPORT_CHAPTERS} loading={loading} onClick={() => onImport(chapters)}>导入 {chapters.length || ""} 章</Button></div></div>
                </div>
                </div>
            </div>
        </Modal>
    );
}

function ImportChapterPreview({ chapters }: { chapters: Array<{ title: string; plainText: string }> }) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const virtualizer = useVirtualizer({
        count: chapters.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => 49,
        overscan: 10,
    });
    return (
        <div ref={scrollRef} className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
            {chapters.length ? <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((virtualItem) => {
                    const chapter = chapters[virtualItem.index];
                    return <div key={`${chapter.title}-${virtualItem.index}`} className="absolute left-0 top-0 flex w-full gap-2 border-b border-border/60 px-1.5 py-2" style={{ height: virtualItem.size, transform: `translateY(${virtualItem.start}px)` }}><span className="w-8 shrink-0 pt-0.5 text-[var(--fs-tiny)] tabular-nums text-foreground/35">{String(virtualItem.index + 1).padStart(Math.max(2, String(chapters.length).length), "0")}</span><div className="min-w-0"><div className="truncate text-xs font-medium">{chapter.title}</div><div className="mt-0.5 text-[var(--fs-tiny)] text-foreground/40">{formatCount(chapter.plainText.length)} 字</div></div></div>;
                })}
            </div> : <div className="grid h-full place-items-center px-4 text-center text-xs leading-5 text-foreground/40">选择 TXT 文件或粘贴正文后，这里会显示拆分结果</div>}
        </div>
    );
}

function plainTextToHtml(value: string) {
    const escaped = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return escaped.split(/\n{2,}/).map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`).join("");
}

function stripHtml(value: string) {
    return value.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
}

function readStoredScroll(key: string) {
    const value = Number(sessionStorage.getItem(key) || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
}
