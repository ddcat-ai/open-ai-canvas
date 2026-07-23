import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { App, Dropdown, Input, Modal, Tooltip } from "antd";
import {
    AlignCenter,
    AlignJustify,
    AlignLeft,
    AlignRight,
    ArrowDown,
    ArrowUp,
    Bold,
    Check,
    ChevronDown,
    ChevronLeft,
    Code2,
    Eraser,
    FileDown,
    Film,
    Highlighter,
    Italic,
    Link2,
    List,
    ListOrdered,
    LoaderCircle,
    Minus,
    MoreHorizontal,
    Plus,
    Quote,
    Redo2,
    Save,
    Sparkles,
    Strikethrough,
    Trash2,
    Underline,
    Undo2,
    UserRound,
    X,
} from "lucide-react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import CharacterCount from "@tiptap/extension-character-count";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import type { Editor } from "@tiptap/core";
import type { CanvasDocumentChapter, CanvasNodeData, CanvasRichDocument } from "@/types/canvas";
import { buildRichDocument, createDocumentChapter, decodeNovelText, emptyDocument, normalizeDocumentChapters, splitTextIntoChapters } from "@/lib/canvas/canvas-document";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type ChapterAnalyzeResult = { storyboardNodeId: string } | void;

type CanvasDocumentEditorModalProps = {
    node: CanvasNodeData | null;
    open: boolean;
    saving?: boolean;
    analyzing?: boolean;
    characterAnalyzing?: boolean;
    onClose: () => void;
    onSave: (document: CanvasRichDocument, title: string) => Promise<void> | void;
    onAnalyze: (document: CanvasRichDocument, title: string) => Promise<void> | void;
    onAnalyzeCharacters: (document: CanvasRichDocument, title: string, chapter?: CanvasDocumentChapter) => Promise<void> | void;
    onAnalyzeChapter: (document: CanvasRichDocument, chapter: CanvasDocumentChapter, title: string) => Promise<ChapterAnalyzeResult>;
};

export function CanvasDocumentEditorModal({ node, open, saving = false, analyzing = false, characterAnalyzing = false, onClose, onSave, onAnalyze, onAnalyzeCharacters, onAnalyzeChapter }: CanvasDocumentEditorModalProps) {
    const { modal, message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [title, setTitle] = useState("");
    const [chapters, setChaptersState] = useState<CanvasDocumentChapter[]>([]);
    const [activeChapterId, setActiveChapterIdState] = useState("");
    const [sourceFileName, setSourceFileName] = useState<string>();
    const [dirty, setDirty] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [analyzingChapterId, setAnalyzingChapterId] = useState<string | null>(null);
    const [batchAnalyzing, setBatchAnalyzing] = useState(false);
    const chaptersRef = useRef<CanvasDocumentChapter[]>([]);
    const activeChapterIdRef = useRef("");
    const fileInputRef = useRef<HTMLInputElement>(null);

    const setChapters = (next: CanvasDocumentChapter[]) => {
        chaptersRef.current = next;
        setChaptersState(next);
    };
    const setActiveChapterId = (id: string) => {
        activeChapterIdRef.current = id;
        setActiveChapterIdState(id);
    };

    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true } }),
            TextAlign.configure({ types: ["heading", "paragraph"] }),
            TextStyle,
            Color.configure({ types: ["textStyle"] }),
            Highlight.configure({ multicolor: true }),
            CharacterCount,
            Placeholder.configure({ placeholder: "开始写这一章，或导入已有小说…" }),
        ],
        content: emptyDocument(),
        editorProps: { attributes: { class: "canvas-document-editor min-h-full px-2 py-2.5 outline-none" } },
        onUpdate: () => setDirty(true),
    });

    useEffect(() => {
        if (!open || !node || !editor) return;
        const document = node.metadata?.document;
        const normalized = normalizeDocumentChapters(document, node.metadata?.content || "");
        const activeId = document?.activeChapterId && normalized.some((chapter) => chapter.id === document.activeChapterId) ? document.activeChapterId : normalized[0].id;
        setChapters(normalized);
        setActiveChapterId(activeId);
        editor.commands.setContent(normalized.find((chapter) => chapter.id === activeId)?.json || emptyDocument(), { emitUpdate: false });
        setTitle(node.title || "小说");
        setSourceFileName(document?.sourceFileName);
        setSidebarOpen(true);
        setDirty(false);
    }, [editor, node?.id, open]);

    const activeChapter = useMemo(() => chapters.find((chapter) => chapter.id === activeChapterId) || chapters[0], [activeChapterId, chapters]);
    const totalCharacters = useMemo(
        () => chapters.reduce((total, chapter) => total + chapter.characterCount, 0) - (activeChapter?.characterCount || 0) + (editor?.storage.characterCount?.characters?.() || 0),
        [activeChapter?.characterCount, chapters, dirty, editor],
    );

    const captureActiveChapter = (base = chaptersRef.current) => {
        if (!editor) return base;
        const id = activeChapterIdRef.current;
        const plainText = editor.getText({ blockSeparator: "\n\n" }).trim();
        return base.map((chapter) =>
            chapter.id !== id
                ? chapter
                : {
                      ...chapter,
                      json: editor.getJSON() as unknown as Record<string, unknown>,
                      plainText,
                      characterCount: editor.storage.characterCount?.characters?.() ?? Array.from(plainText).length,
                      updatedAt: new Date().toISOString(),
                  },
        );
    };

    const buildDocument = (allowEmpty = false) => {
        const next = captureActiveChapter();
        setChapters(next);
        const document = buildRichDocument(node?.metadata?.document, next, activeChapterIdRef.current, sourceFileName);
        if (!allowEmpty && !document.chapters?.some((chapter) => chapter.plainText.trim())) {
            message.warning("请先输入小说内容");
            return null;
        }
        return document;
    };

    const switchChapter = (id: string) => {
        if (!editor || id === activeChapterIdRef.current) return;
        const next = captureActiveChapter();
        setChapters(next);
        setActiveChapterId(id);
        editor.commands.setContent(next.find((chapter) => chapter.id === id)?.json || emptyDocument(), { emitUpdate: false });
    };

    const addChapter = () => {
        const next = captureActiveChapter();
        const chapter = createDocumentChapter(`第 ${next.length + 1} 章`, "", next.length);
        setChapters([...next, chapter]);
        setActiveChapterId(chapter.id);
        editor?.commands.setContent(chapter.json, { emitUpdate: false });
        setDirty(true);
    };

    const removeChapter = (chapter: CanvasDocumentChapter) => {
        if (chaptersRef.current.length <= 1) return;
        modal.confirm({
            title: `删除“${chapter.title}”？`,
            content: "本章正文会从小说节点中删除，已经生成的画布分镜节点不会自动删除。",
            okText: "删除章节",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: () => {
                const captured = captureActiveChapter();
                const index = captured.findIndex((item) => item.id === chapter.id);
                const next = captured.filter((item) => item.id !== chapter.id).map((item, order) => ({ ...item, order }));
                const nextActive = activeChapterIdRef.current === chapter.id ? next[Math.min(index, next.length - 1)] : next.find((item) => item.id === activeChapterIdRef.current);
                setChapters(next);
                if (nextActive) {
                    setActiveChapterId(nextActive.id);
                    editor?.commands.setContent(nextActive.json, { emitUpdate: false });
                }
                setDirty(true);
            },
        });
    };

    const moveChapter = (id: string, direction: -1 | 1) => {
        const next = captureActiveChapter();
        const index = next.findIndex((chapter) => chapter.id === id);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target], next[index]];
        setChapters(next.map((chapter, order) => ({ ...chapter, order })));
        setDirty(true);
    };

    const renameActiveChapter = (value: string) => {
        setChapters(chaptersRef.current.map((chapter) => (chapter.id === activeChapterIdRef.current ? { ...chapter, title: value } : chapter)));
        setDirty(true);
    };

    const save = async () => {
        const document = buildDocument(true);
        if (!document) return;
        await onSave(document, title.trim() || "小说");
        setDirty(false);
    };

    const analyzeWholeDocument = async () => {
        const document = buildDocument();
        if (!document) return;
        await onAnalyze(document, title.trim() || "小说");
        setDirty(false);
    };

    const analyzeCharacters = async (scope: "chapter" | "document") => {
        const document = buildDocument();
        if (!document) return;
        const chapter = scope === "chapter" ? document.chapters?.find((item) => item.id === activeChapterIdRef.current) : undefined;
        if (scope === "chapter" && !chapter?.plainText.trim()) return message.warning("当前章节还没有正文");
        await onAnalyzeCharacters(document, title.trim() || "小说", chapter);
        setDirty(false);
    };

    const analyzeOneChapter = async (chapterId = activeChapterIdRef.current) => {
        const document = buildDocument();
        const chapter = document?.chapters?.find((item) => item.id === chapterId);
        if (!document || !chapter) return;
        if (!chapter.plainText.trim()) return message.warning("当前章节还没有正文");
        setAnalyzingChapterId(chapter.id);
        setChapters((document.chapters || []).map((item) => (item.id === chapter.id ? { ...item, storyboardStatus: "processing" } : item)));
        try {
            const result = await onAnalyzeChapter(document, chapter, title.trim() || "小说");
            if (!result) {
                setChapters(chaptersRef.current.map((item) => (item.id === chapter.id ? { ...item, storyboardStatus: "idle" } : item)));
                return;
            }
            const next = chaptersRef.current.map((item) => (item.id === chapter.id ? { ...item, storyboardStatus: "success" as const, storyboardNodeId: result.storyboardNodeId } : item));
            setChapters(next);
            await onSave(buildRichDocument(node?.metadata?.document, next, activeChapterIdRef.current, sourceFileName), title.trim() || "小说");
            message.success(`“${chapter.title}”已生成分镜节点`);
            setDirty(false);
        } catch (error) {
            setChapters(chaptersRef.current.map((item) => (item.id === chapter.id ? { ...item, storyboardStatus: "error" } : item)));
            message.error(error instanceof Error ? error.message : "章节分镜生成失败");
        } finally {
            setAnalyzingChapterId(null);
        }
    };

    const analyzeAllChapters = async () => {
        const document = buildDocument();
        if (!document?.chapters?.length) return;
        const targets = document.chapters.filter((chapter) => chapter.plainText.trim());
        if (!targets.length) return message.warning("小说还没有可拆分的章节正文");
        setBatchAnalyzing(true);
        try {
            for (const chapter of targets) await analyzeOneChapter(chapter.id);
        } finally {
            setBatchAnalyzing(false);
        }
    };

    const close = () => {
        if (!dirty || saving || analyzing || characterAnalyzing || analyzingChapterId || batchAnalyzing) return onClose();
        modal.confirm({ title: "放弃未保存内容？", content: "关闭后本次章节编辑不会写回小说节点。", okText: "放弃编辑", cancelText: "继续编辑", onOk: onClose });
    };

    const importFile = async (file?: File) => {
        if (!file || !editor) return;
        try {
            let text = "";
            if (file.name.toLowerCase().endsWith(".docx")) {
                const mammoth = await import("mammoth");
                text = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
            } else text = decodeNovelText(await file.arrayBuffer());
            if (!text.trim()) throw new Error("文件中没有可编辑的文字");
            const imported = splitTextIntoChapters(text);
            setChapters(imported);
            setActiveChapterId(imported[0].id);
            editor.commands.setContent(imported[0].json, { emitUpdate: false });
            setSourceFileName(file.name);
            setTitle(file.name.replace(/\.(txt|md|markdown|docx)$/i, "") || "小说");
            setDirty(true);
            message.success(imported.length > 1 ? `已识别并导入 ${imported.length} 个章节` : `已导入 ${file.name}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "小说导入失败");
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    return (
        <Modal
            className="canvas-document-modal"
            open={open}
            title={null}
            footer={null}
            width="min(1600px, calc(100vw - 32px))"
            centered
            closable={false}
            destroyOnHidden
            onCancel={close}
            style={{ maxWidth: "calc(100vw - 32px)", paddingBottom: 0 }}
            styles={{
                container: { padding: 0, overflow: "hidden", borderRadius: 10 },
                body: { padding: 0 },
            }}
        >
            <div className="canvas-document-shell flex h-[min(92dvh,920px)] min-h-[480px] flex-col overflow-hidden" style={{ color: theme.node.text, background: theme.node.panel }}>
                <header className="canvas-document-header flex h-12 shrink-0 items-center gap-1.5 border-b px-3" style={{ borderColor: theme.node.stroke }}>
                    <Input
                        variant="borderless"
                        value={title}
                        onChange={(event) => {
                            setTitle(event.target.value);
                            setDirty(true);
                        }}
                        className="canvas-document-title-input !h-8 min-w-0 max-w-[320px] !px-0 text-[13px] font-semibold"
                        placeholder="小说标题"
                    />
                    <span className="hidden shrink-0 text-[10px] sm:inline" style={{ color: theme.node.muted }}>
                        {chapters.length} 章 · {formatCharacterCount(totalCharacters)} 字
                    </span>
                    <input ref={fileInputRef} type="file" accept=".txt,.md,.markdown,.docx" className="hidden" onChange={(event) => void importFile(event.target.files?.[0])} />
                    <div className="canvas-document-header-actions ml-auto flex shrink-0 items-center gap-0.5">
                        <Tooltip title="导入 TXT、Markdown 或 DOCX">
                            <span className="inline-flex">
                                <DocumentActionButton iconOnly ariaLabel="导入小说" onClick={() => fileInputRef.current?.click()}>
                                    <FileDown className="size-3.5" />
                                </DocumentActionButton>
                            </span>
                        </Tooltip>
                        <Dropdown
                            trigger={["click"]}
                            placement="bottomRight"
                            menu={{
                                items: [
                                    { key: "chapterCharacters", icon: <UserRound className="size-3.5" />, label: `拆解本章角色 · ${activeChapter?.title || "当前章"}`, disabled: analyzing },
                                    { key: "documentCharacters", icon: <UserRound className="size-3.5" />, label: "拆解整本角色", disabled: analyzing },
                                    { type: "divider" },
                                    { key: "documentStoryboard", icon: <Film className="size-3.5" />, label: "整本生成分镜", disabled: characterAnalyzing },
                                ],
                                onClick: ({ key }) => {
                                    if (key === "chapterCharacters") void analyzeCharacters("chapter");
                                    else if (key === "documentCharacters") void analyzeCharacters("document");
                                    else if (key === "documentStoryboard") void analyzeWholeDocument();
                                },
                            }}
                        >
                            <span className="inline-flex">
                                <DocumentActionButton loading={characterAnalyzing || analyzing} ariaLabel="打开 AI 拆解菜单" style={{ background: theme.toolbar.itemHover }}>
                                    <Sparkles className="size-3.5" />
                                    <span className="max-sm:hidden">AI拆解</span>
                                    <ChevronDown className="size-2.5 opacity-60" />
                                </DocumentActionButton>
                            </span>
                        </Dropdown>
                        <span className="mx-0.5 h-3 w-px" style={{ background: theme.node.stroke }} />
                        <Tooltip title={dirty ? "保存修改" : "保存"}>
                            <span className="inline-flex">
                                <DocumentActionButton
                                    iconOnly
                                    loading={saving}
                                    disabled={analyzing || characterAnalyzing}
                                    ariaLabel={dirty ? "保存小说，有未保存修改" : "保存小说"}
                                    style={{ background: dirty ? theme.toolbar.itemHover : "transparent" }}
                                    onClick={() => void save()}
                                >
                                    <Save className="size-3.5" />
                                </DocumentActionButton>
                            </span>
                        </Tooltip>
                        <Tooltip title="关闭">
                            <span className="inline-flex">
                                <DocumentActionButton iconOnly ariaLabel="关闭小说编辑器" onClick={close}>
                                    <X className="size-3.5" />
                                </DocumentActionButton>
                            </span>
                        </Tooltip>
                    </div>
                </header>

                <div className="flex min-h-0 flex-1">
                    <aside
                        className={`${sidebarOpen ? "w-[184px]" : "w-0"} canvas-document-sidebar relative shrink-0 overflow-hidden border-r transition-[width] max-md:absolute max-md:bottom-8 max-md:left-0 max-md:top-12 max-md:z-20 max-md:shadow-2xl`}
                        style={{ borderColor: theme.node.stroke, background: theme.canvas.background }}
                    >
                        <div className="flex h-full w-[184px] flex-col">
                            <div className="flex h-10 shrink-0 items-center gap-1.5 border-b px-2.5" style={{ borderColor: theme.node.stroke }}>
                                <span className="text-[12px] font-semibold tracking-wide">章节目录</span>
                                <span className="text-[11px]" style={{ color: theme.node.muted }}>
                                    {chapters.length}
                                </span>
                                <span className="ml-auto" />
                                <Tooltip title="拆分全部章节分镜">
                                    <button type="button" className="canvas-document-icon-button grid size-8 place-items-center rounded-md transition" disabled={batchAnalyzing} onClick={() => void analyzeAllChapters()}>
                                        <Film className="size-3.5" />
                                    </button>
                                </Tooltip>
                                <Tooltip title="新增章节">
                                    <button type="button" className="canvas-document-icon-button grid size-8 place-items-center rounded-md transition" onClick={addChapter}>
                                        <Plus className="size-3.5" />
                                    </button>
                                </Tooltip>
                            </div>
                            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
                                {chapters.map((chapter, index) => {
                                    const active = chapter.id === activeChapterId;
                                    return (
                                        <button
                                            key={chapter.id}
                                            type="button"
                                            className={`canvas-document-chapter group mb-1 flex w-full items-start gap-1.5 rounded-md border-0 px-2 py-1.5 text-left transition ${active ? "is-active" : ""}`}
                                            style={{ background: active ? theme.toolbar.itemHover : "transparent" }}
                                            onClick={() => switchChapter(chapter.id)}
                                        >
                                            <span className="mt-0.5 w-5 shrink-0 text-[10px] tabular-nums" style={{ color: theme.node.faint }}>
                                                {String(index + 1).padStart(2, "0")}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-xs font-medium">{chapter.title || `第 ${index + 1} 章`}</span>
                                                <span className="mt-1 flex items-center gap-1.5 text-[10px]" style={{ color: theme.node.muted }}>
                                                    {formatCharacterCount(active ? editor?.storage.characterCount?.characters?.() || 0 : chapter.characterCount)} 字
                                                    {chapter.storyboardStatus === "success" ? (
                                                        <>
                                                            <Check className="size-3" />
                                                            已分镜
                                                        </>
                                                    ) : chapter.storyboardStatus === "processing" ? (
                                                        "拆分中"
                                                    ) : chapter.storyboardStatus === "error" ? (
                                                        "失败"
                                                    ) : null}
                                                </span>
                                            </span>
                                            <span className="hidden items-center group-hover:flex">
                                                <MiniButton
                                                    label="上移"
                                                    disabled={index === 0}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        moveChapter(chapter.id, -1);
                                                    }}
                                                >
                                                    <ArrowUp className="size-3" />
                                                </MiniButton>
                                                <MiniButton
                                                    label="下移"
                                                    disabled={index === chapters.length - 1}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        moveChapter(chapter.id, 1);
                                                    }}
                                                >
                                                    <ArrowDown className="size-3" />
                                                </MiniButton>
                                                <MiniButton
                                                    label="删除"
                                                    disabled={chapters.length <= 1}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        removeChapter(chapter);
                                                    }}
                                                >
                                                    <Trash2 className="size-3" />
                                                </MiniButton>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="shrink-0 border-t p-1.5" style={{ borderColor: theme.node.stroke }}>
                                <button type="button" className="canvas-document-add-chapter flex h-8 w-full items-center justify-center gap-1.5 rounded-md border-0 text-xs font-medium transition" onClick={addChapter}>
                                    <Plus className="size-3.5" />
                                    新增章节
                                </button>
                            </div>
                        </div>
                    </aside>

                    <main className="relative flex min-w-0 flex-1 flex-col">
                        <div className="canvas-document-toolbar flex h-10 shrink-0 items-center gap-1.5 border-b px-2" style={{ borderColor: theme.node.stroke }}>
                            <Tooltip title={sidebarOpen ? "收起章节" : "展开章节"}>
                                <button type="button" className="canvas-document-icon-button grid size-8 place-items-center rounded-md transition" onClick={() => setSidebarOpen((value) => !value)}>
                                    <ChevronLeft className={`size-3.5 transition ${sidebarOpen ? "" : "rotate-180"}`} />
                                </button>
                            </Tooltip>
                            <div className="h-5 w-px" style={{ background: theme.node.stroke }} />
                            <DocumentToolbar editor={editor} />
                        </div>
                        <div className="canvas-document-chapter-title flex h-9 shrink-0 items-center gap-1.5 border-b px-2.5" style={{ borderColor: theme.node.stroke, background: theme.canvas.background }}>
                            <Input variant="borderless" value={activeChapter?.title || ""} onChange={(event) => renameActiveChapter(event.target.value)} className="!h-7 !px-0 text-[13px] font-semibold" placeholder="章节名称" />
                            <DocumentActionButton loading={analyzingChapterId === activeChapterId} ariaLabel="拆分本章分镜" onClick={() => void analyzeOneChapter()}>
                                <Film className="size-3.5" />
                                本章分镜
                            </DocumentActionButton>
                        </div>
                        <div className="canvas-document-editor-scroll thin-scrollbar min-h-0 flex-1 overflow-y-auto" style={{ background: theme.canvas.background }}>
                            <div className="min-h-full w-full">
                                <EditorContent editor={editor} />
                            </div>
                        </div>
                        <footer className="canvas-document-footer flex h-8 shrink-0 items-center gap-3 border-t px-2" style={{ borderColor: theme.node.stroke }}>
                            <span className="text-[11px]" style={{ color: theme.node.muted }}>
                                本章 {editor?.storage.characterCount?.characters?.() ?? 0} 字
                            </span>
                            <span className="text-[11px]" style={{ color: dirty ? theme.accent.primary : theme.node.muted }}>
                                {dirty ? "有未保存修改" : "已保存"}
                            </span>
                            <span className="ml-auto hidden max-w-[220px] truncate text-[10px] sm:block" style={{ color: theme.node.faint }}>
                                {sourceFileName || "画布小说节点"}
                            </span>
                        </footer>
                    </main>
                </div>
            </div>
        </Modal>
    );
}

function DocumentActionButton({
    children,
    ariaLabel,
    className = "",
    disabled = false,
    iconOnly = false,
    loading = false,
    style,
    onClick,
}: {
    children: ReactNode;
    ariaLabel: string;
    className?: string;
    disabled?: boolean;
    iconOnly?: boolean;
    loading?: boolean;
    style?: CSSProperties;
    onClick?: () => void;
}) {
    const compactStyle: CSSProperties = {
        height: 24,
        minHeight: 24,
        width: iconOnly ? 24 : undefined,
        minWidth: iconOnly ? 24 : undefined,
        padding: iconOnly ? 0 : "0 8px",
        gap: 5,
        borderRadius: 6,
        border: "1px solid transparent",
        background: "transparent",
        color: "inherit",
        fontSize: 10.5,
        fontWeight: 540,
        lineHeight: 1,
        ...style,
    };
    return (
        <button type="button" aria-label={ariaLabel} aria-busy={loading || undefined} disabled={disabled || loading} className={`canvas-document-action ${iconOnly ? "is-icon" : ""} ${className}`} style={compactStyle} onClick={onClick}>
            <span className="canvas-document-action-content" style={{ opacity: loading ? 0.24 : 1 }}>
                {children}
            </span>
            {loading ? <LoaderCircle className="absolute size-3.5 animate-spin motion-reduce:animate-none" style={{ color: "currentColor" }} /> : null}
        </button>
    );
}

function DocumentToolbar({ editor }: { editor: Editor | null }) {
    const setLink = () => {
        if (!editor) return;
        const current = String(editor.getAttributes("link").href || "");
        const href = window.prompt("输入链接地址", current);
        if (href === null) return;
        if (!href.trim()) editor.chain().focus().unsetLink().run();
        else editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
    };
    const setColor = () => {
        if (!editor) return;
        const color = window.prompt("输入文字颜色（例如 #d97706）", String(editor.getAttributes("textStyle").color || "#d97706"));
        if (color?.trim()) editor.chain().focus().setColor(color.trim()).run();
    };
    const setHighlight = () => {
        if (!editor) return;
        const color = window.prompt("输入高亮颜色（例如 #fef3c7）", String(editor.getAttributes("highlight").color || "#fef3c7"));
        if (color?.trim()) editor.chain().focus().toggleHighlight({ color: color.trim() }).run();
    };
    const blockLabel = editor?.isActive("heading", { level: 1 }) ? "标题 1" : editor?.isActive("heading", { level: 2 }) ? "标题 2" : editor?.isActive("heading", { level: 3 }) ? "标题 3" : "正文";
    const alignment = editor?.isActive({ textAlign: "center" }) ? "center" : editor?.isActive({ textAlign: "right" }) ? "right" : editor?.isActive({ textAlign: "justify" }) ? "justify" : "left";
    const alignmentIcon = alignment === "center" ? <AlignCenter className="size-3.5" /> : alignment === "right" ? <AlignRight className="size-3.5" /> : alignment === "justify" ? <AlignJustify className="size-3.5" /> : <AlignLeft className="size-3.5" />;
    return (
        <div className="canvas-document-toolbar-groups hide-scrollbar flex min-w-0 items-center gap-0.5 overflow-x-auto">
            <DocumentToolButton label="撤销" onClick={() => editor?.chain().focus().undo().run()}>
                <Undo2 className="size-3.5" />
            </DocumentToolButton>
            <DocumentToolButton label="重做" onClick={() => editor?.chain().focus().redo().run()}>
                <Redo2 className="size-3.5" />
            </DocumentToolButton>
            <ToolbarDivider />
            <Dropdown
                trigger={["click"]}
                placement="bottomLeft"
                menu={{
                    selectedKeys: [blockLabel],
                    items: [
                        { key: "正文", label: "正文" },
                        { key: "标题 1", label: "标题 1" },
                        { key: "标题 2", label: "标题 2" },
                        { key: "标题 3", label: "标题 3" },
                    ],
                    onClick: ({ key }) => {
                        if (key === "正文") editor?.chain().focus().setParagraph().run();
                        else
                            editor
                                ?.chain()
                                .focus()
                                .toggleHeading({ level: Number(key.slice(-1)) as 1 | 2 | 3 })
                                .run();
                    },
                }}
            >
                <button type="button" className="canvas-document-toolbar-menu" aria-label="段落格式">
                    <span>{blockLabel}</span>
                    <ChevronDown className="size-3" />
                </button>
            </Dropdown>
            <DocumentToolButton label="粗体" active={Boolean(editor?.isActive("bold"))} onClick={() => editor?.chain().focus().toggleBold().run()}>
                <Bold className="size-3.5" />
            </DocumentToolButton>
            <DocumentToolButton label="斜体" active={Boolean(editor?.isActive("italic"))} onClick={() => editor?.chain().focus().toggleItalic().run()}>
                <Italic className="size-3.5" />
            </DocumentToolButton>
            <DocumentToolButton label="下划线" active={Boolean(editor?.isActive("underline"))} onClick={() => editor?.chain().focus().toggleUnderline().run()}>
                <Underline className="size-3.5" />
            </DocumentToolButton>
            <DocumentToolButton label="删除线" active={Boolean(editor?.isActive("strike"))} onClick={() => editor?.chain().focus().toggleStrike().run()}>
                <Strikethrough className="size-3.5" />
            </DocumentToolButton>
            <ToolbarDivider />
            <Dropdown
                trigger={["click"]}
                placement="bottomLeft"
                menu={{
                    selectedKeys: [alignment],
                    items: [
                        { key: "left", icon: <AlignLeft className="size-3.5" />, label: "左对齐" },
                        { key: "center", icon: <AlignCenter className="size-3.5" />, label: "居中" },
                        { key: "right", icon: <AlignRight className="size-3.5" />, label: "右对齐" },
                        { key: "justify", icon: <AlignJustify className="size-3.5" />, label: "两端对齐" },
                    ],
                    onClick: ({ key }) => editor?.chain().focus().setTextAlign(key).run(),
                }}
            >
                <button type="button" className="canvas-document-toolbar-menu is-icon" aria-label="文字对齐">
                    {alignmentIcon}
                    <ChevronDown className="size-3" />
                </button>
            </Dropdown>
            <DocumentToolButton label="无序列表" active={Boolean(editor?.isActive("bulletList"))} onClick={() => editor?.chain().focus().toggleBulletList().run()}>
                <List className="size-3.5" />
            </DocumentToolButton>
            <DocumentToolButton label="有序列表" active={Boolean(editor?.isActive("orderedList"))} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
                <ListOrdered className="size-3.5" />
            </DocumentToolButton>
            <DocumentToolButton label="引用" active={Boolean(editor?.isActive("blockquote"))} onClick={() => editor?.chain().focus().toggleBlockquote().run()}>
                <Quote className="size-3.5" />
            </DocumentToolButton>
            <DocumentToolButton label="插入链接" active={Boolean(editor?.isActive("link"))} onClick={setLink}>
                <Link2 className="size-3.5" />
            </DocumentToolButton>
            <Dropdown
                trigger={["click"]}
                placement="bottomRight"
                menu={{
                    items: [
                        {
                            key: "color",
                            icon: (
                                <span className="text-[11px] font-bold" style={{ color: "#d97706" }}>
                                    A
                                </span>
                            ),
                            label: "文字颜色",
                        },
                        { key: "highlight", icon: <Highlighter className="size-3.5" />, label: "高亮颜色" },
                        { type: "divider" },
                        { key: "code", icon: <Code2 className="size-3.5" />, label: "行内代码" },
                        { key: "codeBlock", icon: <span className="text-[10px] font-bold">{`<>`}</span>, label: "代码块" },
                        { key: "rule", icon: <Minus className="size-3.5" />, label: "插入分隔线" },
                        { type: "divider" },
                        { key: "clear", icon: <Eraser className="size-3.5" />, label: "清除格式" },
                    ],
                    onClick: ({ key }) => {
                        if (key === "color") setColor();
                        else if (key === "highlight") setHighlight();
                        else if (key === "code") editor?.chain().focus().toggleCode().run();
                        else if (key === "codeBlock") editor?.chain().focus().toggleCodeBlock().run();
                        else if (key === "rule") editor?.chain().focus().setHorizontalRule().run();
                        else if (key === "clear") editor?.chain().focus().clearNodes().unsetAllMarks().run();
                    },
                }}
            >
                <button type="button" className="canvas-document-toolbar-menu is-icon" aria-label="更多格式">
                    <MoreHorizontal className="size-4" />
                </button>
            </Dropdown>
        </div>
    );
}

function DocumentToolButton({ label, active, children, onClick }: { label: string; active?: boolean; children: ReactNode; onClick: () => void }) {
    return (
        <Tooltip title={label}>
            <button
                type="button"
                aria-label={label}
                aria-pressed={active}
                className="canvas-document-tool-button grid size-8 shrink-0 place-items-center rounded-md transition focus-visible:outline-none"
                style={{ background: active ? "rgba(79,110,232,.14)" : undefined }}
                onClick={onClick}
            >
                {children}
            </button>
        </Tooltip>
    );
}

function MiniButton({ label, disabled, children, onClick }: { label: string; disabled?: boolean; children: ReactNode; onClick: (event: MouseEvent<HTMLButtonElement>) => void }) {
    return (
        <Tooltip title={label}>
            <span>
                <button
                    type="button"
                    disabled={disabled}
                    aria-label={label}
                    className="grid size-6 place-items-center rounded opacity-55 transition enabled:hover:bg-black/10 enabled:hover:opacity-100 disabled:opacity-20 dark:enabled:hover:bg-white/10"
                    onClick={onClick}
                >
                    {children}
                </button>
            </span>
        </Tooltip>
    );
}

function ToolbarDivider() {
    return <span className="mx-1 h-5 w-px shrink-0 bg-black/10 dark:bg-white/10" />;
}

function formatCharacterCount(count: number) {
    return count >= 10000 ? `${(count / 10000).toFixed(count >= 100000 ? 0 : 1)} 万` : count.toLocaleString("zh-CN");
}
