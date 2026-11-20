import { App, Button } from "antd";
import { ArrowLeft, Code2, Columns2, Command, ExternalLink, Eye, FileWarning, Info, LoaderCircle, Lock, PanelLeft, Plus, RefreshCw, Save, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useBlocker, useNavigate, useParams } from "react-router";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState } from "@/components/layout/workspace-state";
import { Kbd } from "@/components/ui/base/kbd";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { Tooltip } from "@/components/ui/base/tooltip";
import { EmptyState } from "@/components/ui/product/empty-state";
import { getActiveUserScope } from "@/lib/user-scope";
import {
    SKILL_ENTRY_PATH,
    SKILL_MAX_FILES,
    SKILL_TEXT_LIMIT_BYTES,
    baseName,
    buildFileTree,
    buildSaveOperations,
    collectFolders,
    flattenTree,
    formatSkillBytes,
    isDescendantPath,
    isEntryDirty,
    isImagePath,
    isMarkdownPath,
    isTextEditablePath,
    joinPath,
    languageLabel,
    parentPath,
    pathConflict,
    utf8ByteLength,
    validateSkillPath,
    type SkillFileOperation,
    type WorkbenchEntry,
} from "@/lib/skills/skill-workbench-model";
import { SkillMarkdown } from "@/pages/skills/skill-detail-drawer";
import { SkillEditorDrawer, type SkillInfoInput } from "@/pages/skills/skill-editor-drawer";
import { SkillCodeEditor, type SkillCodeEditorHandle } from "@/pages/skills/workbench/skill-code-editor";
import { SkillQuickOpen } from "@/pages/skills/workbench/skill-quick-open";
import { SkillWorkbenchExplorer, fileIconFor, type ExplorerInput } from "@/pages/skills/workbench/skill-workbench-explorer";
import { ApiError } from "@/services/api/request";
import {
    SKILL_VERSION_CONFLICT_REASON,
    addSkill,
    getSkill,
    getSkillFile,
    listSkillFiles,
    saveSkillFiles,
    skillFileRawURL,
    syncSkill,
    type SaveSkillFilesInput,
    type SaveSkillFilesResult,
    type Skill,
    type SkillPackageFile,
    type SkillPackageFileContent,
} from "@/services/api/skills";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";

import "./skill-workbench.css";

type Tab = { path: string; preview: boolean };
type MarkdownMode = "edit" | "split" | "preview";
type FileState = { status: "loading" } | { status: "binary" } | { status: "error"; message: string };

const MIN_EXPLORER = 180;
const MAX_EXPLORER = 520;
const DEFAULT_EXPLORER = 264;
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const modKey = isMac ? "⌘" : "Ctrl";

function layoutKey() {
    return `yingce:skill-workbench:${getActiveUserScope()}:layout`;
}

function expandedKey(skillId: string) {
    return `yingce:skill-workbench:${getActiveUserScope()}:expanded:${skillId}`;
}

function readLayout(): { width: number; markdownMode: MarkdownMode } {
    try {
        const raw = JSON.parse(window.localStorage.getItem(layoutKey()) || "{}") as { width?: number; markdownMode?: MarkdownMode };
        const width = typeof raw.width === "number" ? Math.min(MAX_EXPLORER, Math.max(MIN_EXPLORER, raw.width)) : DEFAULT_EXPLORER;
        const markdownMode = raw.markdownMode === "edit" || raw.markdownMode === "preview" || raw.markdownMode === "split" ? raw.markdownMode : "split";
        return { width, markdownMode };
    } catch {
        return { width: DEFAULT_EXPLORER, markdownMode: "split" };
    }
}

function writeLayout(value: { width: number; markdownMode: MarkdownMode }) {
    try {
        window.localStorage.setItem(layoutKey(), JSON.stringify(value));
    } catch {
        // 隐私模式或配额已满时仅放弃记忆布局，不影响编辑。
    }
}

function readExpanded(skillId: string): Set<string> | null {
    try {
        const raw = window.localStorage.getItem(expandedKey(skillId));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? new Set(parsed.filter((item): item is string => typeof item === "string")) : null;
    } catch {
        return null;
    }
}

function sourceLabel(source: string) {
    if (source === "github") return "GitHub";
    if (source === "zip") return "技能包";
    if (source === "builtin") return "内置技能";
    return "Markdown";
}

function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}

/** 工作台读写技能文件的接口；用户端走作者接口，后台走管理员接口。 */
export type SkillWorkbenchApi = {
    getSkill: (id: string) => Promise<{ skill: Skill }>;
    listFiles: (id: string) => Promise<{ files: SkillPackageFile[] }>;
    getFile: (id: string, path: string) => Promise<{ file: SkillPackageFileContent }>;
    saveFiles: (id: string, input: SaveSkillFilesInput) => Promise<SaveSkillFilesResult>;
    rawURL: (id: string, path: string) => string;
};

export type SkillWorkbenchProps = {
    skillId: string;
    api: SkillWorkbenchApi;
    back: { to: string; label: string };
    /** 后台模式：可编辑所有非 GitHub 技能的内容和全部技能的基本信息；没有加入、同步等用户动作。 */
    admin?: { saveInfo: (skillId: string, input: SkillInfoInput) => Promise<{ skill: Skill }> };
};

const userWorkbenchApi: SkillWorkbenchApi = { getSkill, listFiles: listSkillFiles, getFile: getSkillFile, saveFiles: saveSkillFiles, rawURL: skillFileRawURL };

export default function SkillWorkbenchPage() {
    const { skillId = "" } = useParams();
    return <SkillWorkbench skillId={skillId} api={userWorkbenchApi} back={{ to: "/skills", label: "技能库" }} />;
}

export function SkillWorkbench({ skillId, api, back, admin }: SkillWorkbenchProps) {
    const navigate = useNavigate();
    const { message, modal } = App.useApp();
    const theme = useActiveTheme();
    const editorRef = useRef<SkillCodeEditorHandle | null>(null);
    const generationRef = useRef(0);

    const [skill, setSkill] = useState<Skill | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [reloadKey, setReloadKey] = useState(0);

    // 基线：最近一次从服务端读取或保存成功的版本。
    const [baseVersionId, setBaseVersionId] = useState("");
    const [baseFiles, setBaseFiles] = useState<Map<string, SkillPackageFile>>(() => new Map());
    const [baseContents, setBaseContents] = useState<Map<string, string>>(() => new Map());
    const [fileStates, setFileStates] = useState<Map<string, FileState>>(() => new Map());
    // 工作副本：路径变化、新建文件与文本缓冲，保存时折叠为一次批量操作。
    const [entries, setEntries] = useState<WorkbenchEntry[]>([]);
    const [buffers, setBuffers] = useState<Map<string, string>>(() => new Map());
    const [explicitFolders, setExplicitFolders] = useState<Set<string>>(() => new Set());

    const [tabs, setTabs] = useState<Tab[]>([]);
    const [activePath, setActivePath] = useState("");
    const [editorPath, setEditorPath] = useState("");
    const [focusedPath, setFocusedPath] = useState("");
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
    const [filter, setFilter] = useState("");
    const [explorerInput, setExplorerInput] = useState<ExplorerInput | null>(null);
    const [layout, setLayout] = useState(readLayout);
    const [explorerOpen, setExplorerOpen] = useState(() => typeof window === "undefined" || !window.matchMedia("(max-width: 767px)").matches);
    const [cursor, setCursor] = useState({ line: 1, column: 1 });
    const [saving, setSaving] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [adding, setAdding] = useState(false);
    const [quickOpen, setQuickOpen] = useState(false);
    const [infoOpen, setInfoOpen] = useState(false);

    const readOnly = !skill || skill.sourceType === "github" || (!admin && !skill.isOwner);
    const canEditInfo = Boolean(skill && (admin || skill.isOwner));

    // ---------- 加载 ----------
    useEffect(() => {
        if (!skillId) return;
        const generation = ++generationRef.current;
        setLoading(true);
        setLoadError("");
        Promise.all([api.getSkill(skillId), api.listFiles(skillId)])
            .then(([detail, list]) => {
                if (generation !== generationRef.current) return;
                const files = new Map(list.files.map((file) => [file.path, file]));
                setSkill(detail.skill);
                setBaseVersionId(detail.skill.versionId);
                setBaseFiles(files);
                setBaseContents(new Map());
                setFileStates(new Map());
                setEntries(list.files.map((file) => ({ path: file.path, origin: file.path })));
                setBuffers(new Map());
                setExplicitFolders(new Set());
                editorRef.current?.forgetAll();
                const stored = readExpanded(skillId);
                setExpanded(stored ?? new Set());
                setTabs((current) => {
                    const kept = current.filter((tab) => files.has(tab.path));
                    if (kept.length) return kept;
                    const entry = files.has(SKILL_ENTRY_PATH) ? SKILL_ENTRY_PATH : list.files[0]?.path;
                    return entry ? [{ path: entry, preview: false }] : [];
                });
                setActivePath((current) => (files.has(current) ? current : files.has(SKILL_ENTRY_PATH) ? SKILL_ENTRY_PATH : list.files[0]?.path || ""));
                setFocusedPath((current) => current || SKILL_ENTRY_PATH);
            })
            .catch((error) => {
                if (generation === generationRef.current) setLoadError(errorMessage(error, "技能文件加载失败"));
            })
            .finally(() => {
                if (generation === generationRef.current) setLoading(false);
            });
    }, [api, skillId, reloadKey]);

    useEffect(() => {
        if (!skillId || loading) return;
        try {
            window.localStorage.setItem(expandedKey(skillId), JSON.stringify([...expanded]));
        } catch {
            // 忽略本地存储失败。
        }
    }, [expanded, loading, skillId]);

    useEffect(() => writeLayout(layout), [layout]);

    // ---------- 派生状态 ----------
    const entryByPath = useMemo(() => new Map(entries.map((entry) => [entry.path, entry])), [entries]);
    const filePaths = useMemo(() => new Set(entries.map((entry) => entry.path)), [entries]);
    const folders = useMemo(() => collectFolders(filePaths, explicitFolders), [explicitFolders, filePaths]);
    const tree = useMemo(() => buildFileTree(filePaths, explicitFolders), [explicitFolders, filePaths]);
    const rows = useMemo(() => flattenTree(tree, expanded, filter), [expanded, filter, tree]);
    const dirtyPaths = useMemo(() => new Set(entries.filter((entry) => isEntryDirty(entry, buffers, baseContents)).map((entry) => entry.path)), [baseContents, buffers, entries]);
    const deletedCount = useMemo(() => {
        const kept = new Set(entries.flatMap((entry) => (entry.origin ? [entry.origin] : [])));
        return [...baseFiles.keys()].filter((path) => !kept.has(path)).length;
    }, [baseFiles, entries]);
    const pendingCount = dirtyPaths.size + deletedCount;
    const sortedPaths = useMemo(() => [...filePaths].sort(), [filePaths]);

    const textFor = useCallback(
        (path: string): string | undefined => {
            const buffer = buffers.get(path);
            if (buffer !== undefined) return buffer;
            const entry = entryByPath.get(path);
            if (!entry) return undefined;
            if (!entry.origin) return "";
            return baseContents.get(entry.origin);
        },
        [baseContents, buffers, entryByPath],
    );

    const activeEntry = entryByPath.get(activePath);
    const activeOrigin = activeEntry?.origin ?? null;
    const activeState = activeOrigin ? fileStates.get(activeOrigin) : undefined;
    const activeText = activePath ? textFor(activePath) : undefined;
    const activeIsText = Boolean(activeEntry && activeText !== undefined && !activeState);
    const activeMeta = activeOrigin ? baseFiles.get(activeOrigin) : undefined;
    const activeSize = activeIsText && activeText !== undefined ? utf8ByteLength(activeText) : (activeMeta?.size ?? 0);
    const activeIsMarkdown = activeIsText && isMarkdownPath(activePath);
    const markdownMode: MarkdownMode = activeIsMarkdown ? layout.markdownMode : "edit";

    // 编辑器只在文本文件之间切换；图片/二进制标签不卸载编辑器，切回时撤销历史仍在。
    useEffect(() => {
        if (activeIsText && activePath !== editorPath) setEditorPath(activePath);
    }, [activeIsText, activePath, editorPath]);

    // ---------- 文件内容 ----------
    const ensureContent = useCallback(
        (path: string) => {
            const entry = entryByPath.get(path);
            if (!entry?.origin || !skill) return;
            const origin = entry.origin;
            if (baseContents.has(origin) || fileStates.has(origin)) return;
            const meta = baseFiles.get(origin);
            if (meta && (meta.kind === "image" || meta.kind === "video" || meta.kind === "audio")) {
                setFileStates((current) => new Map(current).set(origin, { status: "binary" }));
                return;
            }
            if (meta && meta.size > SKILL_TEXT_LIMIT_BYTES) {
                setFileStates((current) => new Map(current).set(origin, { status: "error", message: "文件超过 512KB，无法在线编辑，请下载后查看。" }));
                return;
            }
            const generation = generationRef.current;
            setFileStates((current) => new Map(current).set(origin, { status: "loading" }));
            api.getFile(skill.skillId, origin)
                .then((result) => {
                    if (generation !== generationRef.current) return;
                    if (result.file.binary) {
                        setFileStates((current) => new Map(current).set(origin, { status: "binary" }));
                        return;
                    }
                    setBaseContents((current) => new Map(current).set(origin, result.file.content));
                    setFileStates((current) => {
                        const next = new Map(current);
                        next.delete(origin);
                        return next;
                    });
                })
                .catch((error) => {
                    if (generation !== generationRef.current) return;
                    setFileStates((current) => new Map(current).set(origin, { status: "error", message: errorMessage(error, "文件读取失败") }));
                });
        },
        [api, baseContents, baseFiles, entryByPath, fileStates, skill],
    );

    useEffect(() => {
        if (activePath) ensureContent(activePath);
    }, [activePath, ensureContent]);

    // ---------- 标签与树 ----------
    const revealPath = useCallback((path: string) => {
        setExpanded((current) => {
            let changed = false;
            const next = new Set(current);
            for (let dir = parentPath(path); dir; dir = parentPath(dir)) {
                if (!next.has(dir)) {
                    next.add(dir);
                    changed = true;
                }
            }
            return changed ? next : current;
        });
    }, []);

    const openFile = useCallback(
        (path: string, options: { preview?: boolean } = {}) => {
            setTabs((current) => {
                const existing = current.find((tab) => tab.path === path);
                if (existing) return options.preview || !existing.preview ? current : current.map((tab) => (tab.path === path ? { ...tab, preview: false } : tab));
                // 单击打开为预览标签（会被下一次单击替换），双击或编辑后固定，和 VS Code 一致。
                if (options.preview) {
                    const previewIndex = current.findIndex((tab) => tab.preview);
                    if (previewIndex >= 0) return current.map((tab, index) => (index === previewIndex ? { path, preview: true } : tab));
                    return [...current, { path, preview: true }];
                }
                return [...current, { path, preview: false }];
            });
            setActivePath(path);
            setFocusedPath(path);
            revealPath(path);
            if (window.matchMedia("(max-width: 767px)").matches) setExplorerOpen(false);
        },
        [revealPath],
    );

    const closeTab = useCallback((path: string) => {
        setTabs((current) => {
            const index = current.findIndex((tab) => tab.path === path);
            if (index < 0) return current;
            const next = current.filter((tab) => tab.path !== path);
            setActivePath((active) => (active === path ? next[Math.min(index, next.length - 1)]?.path || "" : active));
            return next;
        });
    }, []);

    const toggleFolder = useCallback((path: string, force?: boolean) => {
        setExpanded((current) => {
            const next = new Set(current);
            const open = force ?? !next.has(path);
            if (open) next.add(path);
            else next.delete(path);
            return next;
        });
    }, []);

    const handleChange = useCallback((path: string, value: string) => {
        setBuffers((current) => new Map(current).set(path, value));
        setTabs((current) => (current.some((tab) => tab.path === path && tab.preview) ? current.map((tab) => (tab.path === path ? { ...tab, preview: false } : tab)) : current));
    }, []);

    // ---------- 结构操作（只改工作副本，保存时统一提交） ----------
    const renamePrefix = (from: string, to: string, folder: boolean) => {
        const map = (path: string) => (folder ? (isDescendantPath(path, from) ? to + path.slice(from.length) : path) : path === from ? to : path);
        const moved = entries.filter((entry) => (folder ? isDescendantPath(entry.path, from) : entry.path === from)).map((entry) => entry.path);
        setEntries((current) => current.map((entry) => ({ ...entry, path: map(entry.path) })));
        setBuffers((current) => new Map([...current].map(([path, value]) => [map(path), value])));
        setTabs((current) => current.map((tab) => ({ ...tab, path: map(tab.path) })));
        setActivePath((current) => map(current));
        setEditorPath((current) => map(current));
        setFocusedPath(to);
        if (folder) {
            setExplicitFolders((current) => new Set([...current].map((path) => (path === from || isDescendantPath(path, from) ? to + path.slice(from.length) : path))));
            setExpanded((current) => new Set([...current].map((path) => (path === from || isDescendantPath(path, from) ? to + path.slice(from.length) : path))));
        }
        for (const path of moved) editorRef.current?.moveState(path, map(path));
        revealPath(to);
    };

    const submitExplorerInput = (raw: string): string | null => {
        const input = explorerInput;
        if (!input) return null;
        if (input.mode === "rename") {
            const target = joinPath(parentPath(input.path), raw);
            const invalid = validateSkillPath(target);
            if (invalid) return invalid;
            if (target === SKILL_ENTRY_PATH) return "SKILL.md 是技能入口，不能被替换";
            const ignore = (path: string) => (input.type === "file" ? path === input.path : isDescendantPath(path, input.path));
            const conflict = pathConflict(target, filePaths, input.type === "folder" ? new Set([...folders].filter((path) => path !== input.path && !isDescendantPath(path, input.path))) : folders, ignore);
            if (conflict) return conflict;
            if (input.type === "folder" && isDescendantPath(target, input.path)) return "不能移动到自身内部";
            if (input.type === "file" && isTextEditablePath(input.path) && !isTextEditablePath(target) && dirtyPaths.has(input.path)) return "有未保存修改的文本文件不能改为二进制扩展名";
            renamePrefix(input.path, target, input.type === "folder");
            setExplorerInput(null);
            return null;
        }
        const target = joinPath(input.parent, raw);
        const invalid = validateSkillPath(target);
        if (invalid) return invalid;
        const conflict = pathConflict(target, filePaths, folders);
        if (conflict) return conflict;
        if (input.mode === "new-folder") {
            setExplicitFolders((current) => new Set(current).add(target));
            revealPath(joinPath(target, "_"));
            setFocusedPath(target);
            setExplorerInput(null);
            return null;
        }
        if (!isTextEditablePath(target)) return "这里只能新建文本文件；图片等二进制资源请通过 ZIP 安装";
        if (filePaths.size >= SKILL_MAX_FILES) return `技能包最多 ${SKILL_MAX_FILES} 个文件`;
        setEntries((current) => [...current, { path: target, origin: null }]);
        setBuffers((current) => new Map(current).set(target, ""));
        setExplorerInput(null);
        openFile(target);
        requestAnimationFrame(() => editorRef.current?.focus());
        return null;
    };

    const startExplorerInput = (input: ExplorerInput) => {
        if (readOnly) return;
        if (input.mode !== "rename" && input.parent) revealPath(joinPath(input.parent, "_"));
        if (!explorerOpen) setExplorerOpen(true);
        setFilter("");
        setExplorerInput(input);
    };

    const deleteRow = (row: { path: string; type: "file" | "folder" }) => {
        if (readOnly || row.path === SKILL_ENTRY_PATH) return;
        const affected = row.type === "file" ? [row.path] : entries.filter((entry) => isDescendantPath(entry.path, row.path)).map((entry) => entry.path);
        modal.confirm({
            title: row.type === "file" ? `删除“${baseName(row.path)}”？` : `删除文件夹“${baseName(row.path)}”？`,
            content: row.type === "file" ? "保存后才会从技能包中移除；保存前可通过“放弃修改”恢复。" : `将移除其中 ${affected.length} 个文件。保存后生效，保存前可通过“放弃修改”恢复。`,
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: () => {
                const removed = new Set(affected);
                setEntries((current) => current.filter((entry) => !removed.has(entry.path)));
                setBuffers((current) => new Map([...current].filter(([path]) => !removed.has(path))));
                setTabs((current) => current.filter((tab) => !removed.has(tab.path)));
                setActivePath((current) => (removed.has(current) ? "" : current));
                if (row.type === "folder") setExplicitFolders((current) => new Set([...current].filter((path) => path !== row.path && !isDescendantPath(path, row.path))));
                for (const path of affected) editorRef.current?.forget(path);
                setFocusedPath(parentPath(row.path) || SKILL_ENTRY_PATH);
            },
        });
    };

    const revertFile = (path: string) => {
        const entry = entryByPath.get(path);
        if (!entry) return;
        setBuffers((current) => {
            const next = new Map(current);
            if (entry.origin) next.delete(path);
            else next.set(path, "");
            return next;
        });
    };

    const resetToBaseline = () => {
        setEntries([...baseFiles.keys()].map((path) => ({ path, origin: path })));
        setBuffers(new Map());
        setExplicitFolders(new Set());
        setTabs((current) => current.filter((tab) => baseFiles.has(tab.path)));
        setActivePath((current) => (baseFiles.has(current) ? current : baseFiles.has(SKILL_ENTRY_PATH) ? SKILL_ENTRY_PATH : ""));
        editorRef.current?.forgetAll();
    };

    const discardAll = () => {
        if (!pendingCount) return;
        modal.confirm({
            title: "放弃全部未保存的修改？",
            content: `${pendingCount} 处修改（含新建、改名和删除）将恢复到当前版本。`,
            okText: "放弃修改",
            okButtonProps: { danger: true },
            cancelText: "继续编辑",
            onOk: resetToBaseline,
        });
    };

    // ---------- 保存 ----------
    const save = async () => {
        if (!skill || readOnly || saving) return;
        if (!pendingCount) {
            message.info("没有需要保存的修改");
            return;
        }
        for (const entry of entries) {
            const text = buffers.get(entry.path);
            if (text !== undefined && utf8ByteLength(text) > SKILL_TEXT_LIMIT_BYTES) {
                message.error(`${entry.path} 超过 512KB，无法保存`);
                return;
            }
        }
        const operations: SkillFileOperation[] = buildSaveOperations({ basePaths: baseFiles.keys(), entries, buffers, baseContents });
        if (!operations.length) {
            message.info("没有需要保存的修改");
            return;
        }
        setSaving(true);
        try {
            const result = await api.saveFiles(skill.skillId, { baseVersionId, operations });
            const nextContents = new Map<string, string>();
            const nextStates = new Map<string, FileState>();
            for (const entry of entries) {
                const text = textFor(entry.path);
                if (text !== undefined) nextContents.set(entry.path, text);
                const state = entry.origin ? fileStates.get(entry.origin) : undefined;
                if (state && state.status !== "loading") nextStates.set(entry.path, state);
            }
            const files = new Map(result.files.map((file) => [file.path, file]));
            generationRef.current += 1;
            setSkill(result.skill);
            setBaseVersionId(result.skill.versionId);
            setBaseFiles(files);
            setBaseContents(nextContents);
            setFileStates(nextStates);
            setEntries(result.files.map((file) => ({ path: file.path, origin: file.path })));
            setBuffers(new Map());
            setExplicitFolders((current) => new Set([...current].filter((folder) => ![...files.keys()].some((path) => isDescendantPath(path, folder)))));
            setTabs((current) => current.filter((tab) => files.has(tab.path)).map((tab) => ({ ...tab, preview: false })));
            message.success(result.changed ? `已保存，生成版本 ${result.skill.version || ""}`.trim() : "内容没有变化，未生成新版本");
        } catch (error) {
            if (error instanceof ApiError && error.reason === SKILL_VERSION_CONFLICT_REASON) {
                modal.confirm({
                    title: "技能已在其他地方更新",
                    content: "当前编辑基于旧版本，无法直接保存。重新加载会丢弃这里的未保存修改；也可以先复制需要保留的内容再重新加载。",
                    okText: "重新加载",
                    okButtonProps: { danger: true },
                    cancelText: "继续编辑",
                    onOk: () => setReloadKey((value) => value + 1),
                });
                return;
            }
            const operationIndex = error instanceof ApiError ? Number(error.details?.operationIndex) : NaN;
            const target = Number.isInteger(operationIndex) ? operations[operationIndex]?.path : "";
            message.error(target ? `${errorMessage(error, "保存失败")}（${target}）` : errorMessage(error, "保存失败"));
        } finally {
            setSaving(false);
        }
    };

    const saveRef = useRef(save);
    saveRef.current = save;

    // ---------- 全局快捷键 ----------
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const mod = isMac ? event.metaKey : event.ctrlKey;
            if (!mod || event.altKey) return;
            const key = event.key.toLowerCase();
            if (key === "s") {
                event.preventDefault();
                void saveRef.current();
            } else if (key === "p" && !event.shiftKey) {
                event.preventDefault();
                setQuickOpen(true);
            } else if (key === "b" && !event.shiftKey) {
                event.preventDefault();
                setExplorerOpen((value) => !value);
            }
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, []);

    // ---------- 离开保护 ----------
    const guardActive = pendingCount > 0 && !saving;
    const blocker = useBlocker(({ currentLocation, nextLocation }) => guardActive && currentLocation.pathname !== nextLocation.pathname);
    useEffect(() => {
        if (!guardActive) return;
        const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, [guardActive]);
    const blockerPromptRef = useRef(false);
    useEffect(() => {
        if (blocker.state !== "blocked" || blockerPromptRef.current) return;
        blockerPromptRef.current = true;
        modal.confirm({
            title: "离开前放弃未保存的修改？",
            content: `还有 ${pendingCount} 处修改没有保存，离开后这些修改会丢失。`,
            okText: "放弃并离开",
            okButtonProps: { danger: true },
            cancelText: "继续编辑",
            onOk: () => {
                blockerPromptRef.current = false;
                blocker.proceed();
            },
            onCancel: () => {
                blockerPromptRef.current = false;
                blocker.reset();
            },
        });
    }, [blocker, modal, pendingCount]);

    // ---------- 只读模式动作 ----------
    const joinSkill = async () => {
        if (!skill) return;
        setAdding(true);
        try {
            const result = await addSkill(skill.skillId);
            setSkill((current) => (current ? { ...current, ...result.skill } : result.skill));
            message.success("已加入我的技能");
        } catch (error) {
            message.error(errorMessage(error, "加入技能失败"));
        } finally {
            setAdding(false);
        }
    };

    const synchronize = async () => {
        if (!skill) return;
        setSyncing(true);
        try {
            const result = await syncSkill(skill.skillId);
            message.success(result.skill.versionId === skill.versionId ? "已是最新版本" : "已同步最新版本");
            setReloadKey((value) => value + 1);
        } catch (error) {
            message.error(errorMessage(error, "GitHub 技能同步失败"));
        } finally {
            setSyncing(false);
        }
    };

    // ---------- 资源管理器拖拽宽度 ----------
    const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
    const onResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        resizeRef.current = { startX: event.clientX, startWidth: layout.width };
    };
    const onResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        const start = resizeRef.current;
        if (!start) return;
        const width = Math.min(MAX_EXPLORER, Math.max(MIN_EXPLORER, start.startWidth + event.clientX - start.startX));
        setLayout((current) => (current.width === width ? current : { ...current, width }));
    };
    const onResizeEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
        resizeRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };
    const onResizeKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const step = event.shiftKey ? 48 : 16;
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        setLayout((current) => ({ ...current, width: Math.min(MAX_EXPLORER, Math.max(MIN_EXPLORER, current.width + (event.key === "ArrowRight" ? step : -step))) }));
    };

    // ---------- 渲染 ----------
    if (loadError && !skill) {
        return (
            <WorkspacePage fluid scroll={false} className="skill-wb-page">
                <div className="skill-wb-center">
                    <WorkspaceErrorState description={loadError} onRetry={() => setReloadKey((value) => value + 1)} />
                </div>
            </WorkspacePage>
        );
    }

    if (!skill) {
        return (
            <WorkspacePage fluid scroll={false} className="skill-wb-page">
                <div className="skill-wb-center" role="status">
                    <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    <span>正在打开技能工作台…</span>
                </div>
            </WorkspacePage>
        );
    }

    const breadcrumbs = activePath ? activePath.split("/") : [];
    const rawURL = activeOrigin ? api.rawURL(skill.skillId, activeOrigin) : "";
    const statusText = readOnly ? "只读" : saving ? "正在保存…" : pendingCount ? `${pendingCount} 处未保存修改` : "已保存";

    return (
        <WorkspacePage fluid scroll={false} className="skill-wb-page">
            <div className="skill-wb" style={{ "--skill-wb-explorer-width": `${layout.width}px` } as CSSProperties} data-explorer={explorerOpen ? "open" : "closed"}>
                <header className="skill-wb-header">
                    <Button type="text" className="skill-wb-back" icon={<ArrowLeft className="size-4" />} onClick={() => navigate(back.to)}>
                        {back.label}
                    </Button>
                    <span className="skill-wb-header-divider" aria-hidden="true" />
                    <button type="button" className="skill-wb-icon-button" aria-label={explorerOpen ? "隐藏资源管理器" : "显示资源管理器"} aria-pressed={explorerOpen} title={`资源管理器 (${modKey}+B)`} onClick={() => setExplorerOpen((value) => !value)}>
                        <PanelLeft className="size-4" />
                    </button>
                    <div className="skill-wb-title">
                        <h1>{skill.skillName}</h1>
                        <span className="skill-wb-chip">v{skill.version || "1"}</span>
                        <span className="skill-wb-chip">{sourceLabel(skill.sourceType)}</span>
                        {skill.status !== 1 ? <span className="skill-wb-chip is-readonly">已下架</span> : null}
                        {readOnly ? (
                            <span className="skill-wb-chip is-readonly">
                                <Lock className="size-3" aria-hidden="true" />
                                只读
                            </span>
                        ) : null}
                    </div>
                    <div className="skill-wb-header-actions">
                        <Button className="skill-wb-quick-trigger" icon={<Command className="size-4" />} onClick={() => setQuickOpen(true)}>
                            <span>快速打开</span>
                            <Kbd>{modKey} P</Kbd>
                        </Button>
                        {canEditInfo ? (
                            <Button icon={<Info className="size-4" />} onClick={() => setInfoOpen(true)}>
                                技能信息
                            </Button>
                        ) : null}
                        {!readOnly && pendingCount ? (
                            <Button icon={<Undo2 className="size-4" />} onClick={discardAll}>
                                放弃修改
                            </Button>
                        ) : null}
                        {!readOnly ? (
                            <Button type="primary" loading={saving} disabled={!pendingCount} icon={<Save className="size-4" />} onClick={() => void save()}>
                                保存{pendingCount ? `（${pendingCount}）` : ""}
                            </Button>
                        ) : null}
                    </div>
                </header>

                {readOnly ? (
                    <div className="skill-wb-notice" role="note">
                        <Lock className="size-4 shrink-0" aria-hidden="true" />
                        {admin ? (
                            <span>GitHub 技能以仓库内容为准，后台只能浏览文件；名称、简介等基本信息可在“技能信息”中修改。</span>
                        ) : skill.isOwner && skill.sourceType === "github" ? (
                            <>
                                <span>GitHub 技能以仓库内容为准，这里仅供浏览。请在仓库修改后执行同步。</span>
                                <Button size="small" loading={syncing} icon={<RefreshCw className="size-3.5" />} onClick={() => void synchronize()}>
                                    同步
                                </Button>
                            </>
                        ) : (
                            <>
                                <span>
                                    只读模式：这是{skill.effectiveUser.name ? `“${skill.effectiveUser.name}”` : "其他作者"}的{skill.sourceType === "builtin" ? "内置" : ""}技能，可以浏览全部文件，但不能修改。
                                </span>
                                {!skill.isAdded ? (
                                    <Button size="small" loading={adding} icon={<Plus className="size-3.5" />} onClick={() => void joinSkill()}>
                                        加入我的技能
                                    </Button>
                                ) : null}
                            </>
                        )}
                    </div>
                ) : admin && skill.sourceType === "builtin" ? (
                    <div className="skill-wb-notice" role="note">
                        <Info className="size-4 shrink-0" aria-hidden="true" />
                        <span>这是内置技能。保存后会生成新版本，系统升级时不再用内置文件包覆盖这里的内容。</span>
                    </div>
                ) : null}

                <div className="skill-wb-body">
                    {explorerOpen ? (
                        <>
                            <aside className="skill-wb-sidebar">
                                <SkillWorkbenchExplorer
                                    rows={rows}
                                    filter={filter}
                                    activePath={activePath}
                                    focusedPath={focusedPath}
                                    dirtyPaths={dirtyPaths}
                                    readOnly={readOnly}
                                    input={explorerInput}
                                    fileCount={filePaths.size}
                                    onFilterChange={setFilter}
                                    onFocusPath={setFocusedPath}
                                    onToggleFolder={toggleFolder}
                                    onOpenFile={openFile}
                                    onCollapseAll={() => setExpanded(new Set())}
                                    onStartInput={startExplorerInput}
                                    onCancelInput={() => setExplorerInput(null)}
                                    onSubmitInput={submitExplorerInput}
                                    onDelete={deleteRow}
                                    onRevert={revertFile}
                                />
                            </aside>
                            <div
                                className="skill-wb-resizer"
                                role="separator"
                                aria-orientation="vertical"
                                aria-label="调整资源管理器宽度"
                                aria-valuemin={MIN_EXPLORER}
                                aria-valuemax={MAX_EXPLORER}
                                aria-valuenow={layout.width}
                                tabIndex={0}
                                onPointerDown={onResizeStart}
                                onPointerMove={onResizeMove}
                                onPointerUp={onResizeEnd}
                                onPointerCancel={onResizeEnd}
                                onDoubleClick={() => setLayout((current) => ({ ...current, width: DEFAULT_EXPLORER }))}
                                onKeyDown={onResizeKey}
                            />
                        </>
                    ) : null}

                    <main className="skill-wb-main">
                        <div className="skill-wb-tabs thin-scrollbar" role="tablist" aria-label="已打开的文件">
                            {tabs.map((tab) => {
                                const dirty = dirtyPaths.has(tab.path);
                                const active = tab.path === activePath;
                                return (
                                    <div
                                        key={tab.path}
                                        className={`skill-wb-tab${active ? " is-active" : ""}${tab.preview ? " is-preview" : ""}${dirty ? " is-dirty" : ""}`}
                                        onMouseDown={(event) => {
                                            if (event.button === 1) {
                                                event.preventDefault();
                                                closeTab(tab.path);
                                            }
                                        }}
                                    >
                                        <button
                                            type="button"
                                            role="tab"
                                            aria-selected={active}
                                            className="skill-wb-tab-main"
                                            title={tab.path}
                                            onClick={() => {
                                                setActivePath(tab.path);
                                                setFocusedPath(tab.path);
                                            }}
                                            onDoubleClick={() => openFile(tab.path)}
                                        >
                                            {fileIconFor(tab.path, "size-3.5")}
                                            <span>{baseName(tab.path)}</span>
                                        </button>
                                        <button
                                            type="button"
                                            className="skill-wb-tab-close"
                                            aria-label={dirty ? `${baseName(tab.path)} 有未保存修改，关闭标签` : `关闭 ${baseName(tab.path)}`}
                                            title={dirty ? "未保存（关闭标签不会丢失修改）" : "关闭"}
                                            onClick={() => closeTab(tab.path)}
                                        >
                                            <span className="skill-wb-tab-dot" aria-hidden="true" />
                                            <X className="size-3.5" aria-hidden="true" />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>

                        {activePath ? (
                            <div className="skill-wb-crumbs">
                                <nav className="skill-wb-crumb-list" aria-label="文件路径">
                                    {breadcrumbs.map((segment, index) => {
                                        const path = breadcrumbs.slice(0, index + 1).join("/");
                                        const last = index === breadcrumbs.length - 1;
                                        return (
                                            <span key={path} className="skill-wb-crumb">
                                                {index > 0 ? (
                                                    <span className="skill-wb-crumb-sep" aria-hidden="true">
                                                        /
                                                    </span>
                                                ) : null}
                                                {last ? (
                                                    <span aria-current="page">{segment}</span>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setExplorerOpen(true);
                                                            revealPath(joinPath(path, "_"));
                                                            setFocusedPath(path);
                                                        }}
                                                    >
                                                        {segment}
                                                    </button>
                                                )}
                                            </span>
                                        );
                                    })}
                                    {dirtyPaths.has(activePath) ? <span className="skill-wb-crumb-dirty">未保存</span> : null}
                                </nav>
                                {activeIsMarkdown ? (
                                    <SegmentedControl
                                        size="sm"
                                        ariaLabel="Markdown 视图"
                                        value={markdownMode}
                                        onChange={(value) => setLayout((current) => ({ ...current, markdownMode: value }))}
                                        options={[
                                            { value: "edit", icon: <Code2 className="size-3.5" />, label: "编辑" },
                                            { value: "split", icon: <Columns2 className="size-3.5" />, label: "分栏" },
                                            { value: "preview", icon: <Eye className="size-3.5" />, label: "预览" },
                                        ]}
                                    />
                                ) : null}
                                {rawURL ? (
                                    <Tooltip title="打开已保存的原始文件">
                                        <a className="skill-wb-icon-button" href={rawURL} target="_blank" rel="noreferrer" aria-label="打开已保存的原始文件">
                                            <ExternalLink className="size-4" />
                                        </a>
                                    </Tooltip>
                                ) : null}
                            </div>
                        ) : null}

                        <div className={`skill-wb-content is-${markdownMode}`}>
                            <div className="skill-wb-editor-pane" hidden={!activeIsText || markdownMode === "preview"}>
                                <SkillCodeEditor
                                    ref={editorRef}
                                    path={editorPath}
                                    value={editorPath ? (textFor(editorPath) ?? "") : ""}
                                    readOnly={readOnly}
                                    theme={theme}
                                    onChange={handleChange}
                                    onCursor={(line, column) => setCursor((current) => (current.line === line && current.column === column ? current : { line, column }))}
                                />
                            </div>
                            {activeIsMarkdown && markdownMode !== "edit" ? (
                                <div className="skill-wb-preview-pane thin-scrollbar" aria-label="Markdown 预览">
                                    <SkillMarkdown source={activeText ?? ""} currentPath={activePath} filePaths={filePaths} onNavigate={(path) => openFile(path)} />
                                </div>
                            ) : null}
                            {!activePath ? (
                                <div className="skill-wb-placeholder">
                                    <EmptyState
                                        icon={Code2}
                                        title="选择一个文件开始"
                                        description={readOnly ? "从左侧资源管理器选择文件浏览。" : "从左侧资源管理器选择文件，或新建文件。修改后统一保存为一个新版本。"}
                                        action={
                                            <div className="skill-wb-shortcuts">
                                                <span>
                                                    <Kbd>{modKey} P</Kbd>快速打开
                                                </span>
                                                {!readOnly ? (
                                                    <span>
                                                        <Kbd>{modKey} S</Kbd>保存
                                                    </span>
                                                ) : null}
                                                <span>
                                                    <Kbd>{modKey} B</Kbd>资源管理器
                                                </span>
                                            </div>
                                        }
                                    />
                                </div>
                            ) : activeEntry && !activeIsText ? (
                                <div className="skill-wb-placeholder">
                                    {activeState?.status === "binary" && isImagePath(activePath) && rawURL ? (
                                        <figure className="skill-wb-media">
                                            <img src={rawURL} alt={activePath} />
                                        </figure>
                                    ) : activeState?.status === "binary" && activeMeta?.kind === "video" && rawURL ? (
                                        <figure className="skill-wb-media">
                                            <video src={rawURL} controls playsInline preload="metadata" />
                                        </figure>
                                    ) : activeState?.status === "binary" && activeMeta?.kind === "audio" && rawURL ? (
                                        <figure className="skill-wb-media">
                                            <audio src={rawURL} controls preload="metadata" />
                                        </figure>
                                    ) : activeState?.status === "binary" || activeState?.status === "error" ? (
                                        <EmptyState
                                            icon={FileWarning}
                                            title={activeState.status === "error" ? "无法在线编辑" : "二进制文件"}
                                            description={activeState.status === "error" ? activeState.message : "该文件不是文本，只能只读查看或下载。"}
                                            action={
                                                rawURL ? (
                                                    <a className="skill-wb-link" href={rawURL} target="_blank" rel="noreferrer">
                                                        打开原始文件
                                                        <ExternalLink className="size-3.5" aria-hidden="true" />
                                                    </a>
                                                ) : undefined
                                            }
                                        />
                                    ) : (
                                        <div className="skill-wb-center" role="status">
                                            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                                            <span>正在读取 {baseName(activePath)}…</span>
                                        </div>
                                    )}
                                </div>
                            ) : null}
                        </div>

                        <footer className="skill-wb-status">
                            <span className={`skill-wb-status-item${pendingCount && !readOnly ? " is-dirty" : ""}`} role="status">
                                {readOnly ? <Lock className="size-3" aria-hidden="true" /> : null}
                                {statusText}
                            </span>
                            <span className="skill-wb-status-item" title={skill.versionId}>
                                版本 v{skill.version || "1"}
                            </span>
                            {loading ? (
                                <span className="skill-wb-status-item">
                                    <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                                    同步中
                                </span>
                            ) : null}
                            <span className="skill-wb-status-spacer" />
                            {activeIsText ? (
                                <span className="skill-wb-status-item">
                                    行 {cursor.line}，列 {cursor.column}
                                </span>
                            ) : null}
                            {activeEntry ? <span className="skill-wb-status-item">{formatSkillBytes(activeSize)}</span> : null}
                            {activeIsText ? <span className="skill-wb-status-item">UTF-8</span> : null}
                            {activeIsText ? <span className="skill-wb-status-item">空格：2</span> : null}
                            {activeEntry ? <span className="skill-wb-status-item">{activeIsText ? languageLabel(activePath) : activeMeta?.mimeType || "二进制"}</span> : null}
                        </footer>
                    </main>
                </div>
            </div>

            <SkillQuickOpen
                open={quickOpen}
                paths={sortedPaths}
                onClose={() => setQuickOpen(false)}
                onPick={(path) => {
                    openFile(path);
                    requestAnimationFrame(() => editorRef.current?.focus());
                }}
            />
            {canEditInfo ? (
                <SkillEditorDrawer
                    open={infoOpen}
                    skill={skill}
                    admin={admin ? { save: admin.saveInfo } : undefined}
                    onClose={() => setInfoOpen(false)}
                    onSaved={(next) => {
                        setInfoOpen(false);
                        // 单文件技能的抽屉会改写 SKILL.md 并生成新版本；有本地修改时保留工作副本，等待保存时由冲突检测兜底。
                        if (next.versionId !== skill.versionId && !pendingCount) setReloadKey((value) => value + 1);
                        else setSkill((current) => (current ? { ...current, ...next } : next));
                    }}
                />
            ) : null}
        </WorkspacePage>
    );
}
