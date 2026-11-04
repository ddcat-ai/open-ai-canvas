import { Dropdown, type MenuProps } from "antd";
import { BookOpen, ChevronRight, ChevronsDownUp, File, FileArchive, FileAudio, FileBraces, FileCode2, FileImage, FilePlus, FileText, FileVideo, Folder, FolderOpen, FolderPlus, MoreHorizontal, PencilLine, Search, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { SKILL_ENTRY_PATH, fileExtension, type TreeRow } from "@/lib/skills/skill-workbench-model";

export type ExplorerInput = { mode: "new-file" | "new-folder"; parent: string } | { mode: "rename"; path: string; type: "file" | "folder" };

type ExplorerProps = {
    rows: TreeRow[];
    filter: string;
    activePath: string;
    focusedPath: string;
    dirtyPaths: Set<string>;
    readOnly: boolean;
    input: ExplorerInput | null;
    fileCount: number;
    onFilterChange: (value: string) => void;
    onFocusPath: (path: string) => void;
    onToggleFolder: (path: string, expanded?: boolean) => void;
    onOpenFile: (path: string, options?: { preview?: boolean }) => void;
    onCollapseAll: () => void;
    onStartInput: (input: ExplorerInput) => void;
    onCancelInput: () => void;
    onSubmitInput: (value: string) => string | null;
    onDelete: (row: Pick<TreeRow, "path" | "type">) => void;
    onRevert: (path: string) => void;
};

export function fileIconFor(path: string, className = "size-4"): ReactNode {
    if (path === SKILL_ENTRY_PATH) return <BookOpen aria-hidden="true" className={`${className} skill-wb-icon-entry`} />;
    const extension = fileExtension(path);
    if (["md", "mdx", "markdown", "txt", "csv"].includes(extension)) return <FileText aria-hidden="true" className={`${className} skill-wb-icon-text`} />;
    if (["json", "yaml", "yml", "toml"].includes(extension)) return <FileBraces aria-hidden="true" className={`${className} skill-wb-icon-data`} />;
    if (["py", "js", "jsx", "ts", "tsx", "go", "sh", "html", "css"].includes(extension)) return <FileCode2 aria-hidden="true" className={`${className} skill-wb-icon-code`} />;
    if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension)) return <FileImage aria-hidden="true" className={`${className} skill-wb-icon-media`} />;
    if (["mp4", "webm", "mov"].includes(extension)) return <FileVideo aria-hidden="true" className={`${className} skill-wb-icon-media`} />;
    if (["mp3", "wav", "m4a", "ogg"].includes(extension)) return <FileAudio aria-hidden="true" className={`${className} skill-wb-icon-media`} />;
    if (["zip", "gz", "tar"].includes(extension)) return <FileArchive aria-hidden="true" className={className} />;
    return <File aria-hidden="true" className={className} />;
}

const ROW_INDENT = 12;

export function SkillWorkbenchExplorer(props: ExplorerProps) {
    const { rows, filter, activePath, focusedPath, dirtyPaths, readOnly, input, fileCount, onFilterChange, onFocusPath, onToggleFolder, onOpenFile, onCollapseAll, onStartInput, onCancelInput, onSubmitInput, onDelete, onRevert } = props;
    const { t } = useTranslation();
    const treeRef = useRef<HTMLDivElement | null>(null);
    const filterRef = useRef<HTMLInputElement | null>(null);

    // 焦点行滚动到可见区域；只在树本身拥有焦点时移动 DOM 焦点，避免抢走编辑器焦点。
    useEffect(() => {
        const tree = treeRef.current;
        if (!tree || !focusedPath) return;
        const row = tree.querySelector<HTMLElement>(`[data-path="${CSS.escape(focusedPath)}"]`);
        if (!row) return;
        row.scrollIntoView({ block: "nearest" });
        if (tree.contains(document.activeElement) && document.activeElement !== row && !(document.activeElement instanceof HTMLInputElement)) row.focus({ preventScroll: true });
    }, [focusedPath, rows]);

    const focusedIndex = rows.findIndex((row) => row.path === focusedPath);
    const focusedRow = focusedIndex >= 0 ? rows[focusedIndex] : undefined;

    const moveFocus = (index: number) => {
        const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
        if (row) onFocusPath(row.path);
    };

    const handleTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.target instanceof HTMLInputElement) return;
        const row = focusedRow;
        switch (event.key) {
            case "ArrowDown":
                event.preventDefault();
                moveFocus(focusedIndex < 0 ? 0 : focusedIndex + 1);
                return;
            case "ArrowUp":
                event.preventDefault();
                moveFocus(focusedIndex < 0 ? 0 : focusedIndex - 1);
                return;
            case "Home":
                event.preventDefault();
                moveFocus(0);
                return;
            case "End":
                event.preventDefault();
                moveFocus(rows.length - 1);
                return;
            case "ArrowRight":
                if (!row || row.type !== "folder") return;
                event.preventDefault();
                if (!row.expanded) onToggleFolder(row.path, true);
                else if (rows[focusedIndex + 1]?.parent === row.path) moveFocus(focusedIndex + 1);
                return;
            case "ArrowLeft":
                if (!row) return;
                event.preventDefault();
                if (row.type === "folder" && row.expanded) onToggleFolder(row.path, false);
                else if (row.parent) onFocusPath(row.parent);
                return;
            case "Enter":
            case " ":
                if (!row) return;
                event.preventDefault();
                if (row.type === "folder") onToggleFolder(row.path);
                else onOpenFile(row.path);
                return;
            case "F2":
                if (!row || readOnly || row.path === SKILL_ENTRY_PATH) return;
                event.preventDefault();
                onStartInput({ mode: "rename", path: row.path, type: row.type });
                return;
            case "Delete":
                if (!row || readOnly || row.path === SKILL_ENTRY_PATH) return;
                event.preventDefault();
                onDelete(row);
                return;
            case "Backspace":
                if (!row || readOnly || row.path === SKILL_ENTRY_PATH || !(event.metaKey || event.ctrlKey)) return;
                event.preventDefault();
                onDelete(row);
                return;
            default:
                if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && /\S/.test(event.key)) {
                    // 直接输入字符即跳到筛选框，和 VS Code 资源管理器的类型筛选一致。
                    filterRef.current?.focus();
                }
        }
    };

    const menuFor = (row: TreeRow): MenuProps => {
        const parent = row.type === "folder" ? row.path : row.parent;
        const entry = row.path === SKILL_ENTRY_PATH;
        const items: NonNullable<MenuProps["items"]> = [];
        if (row.type === "file") items.push({ key: "open", label: t("library.workbench.explorer.open") });
        if (!readOnly) {
            items.push({ key: "new-file", label: t("library.workbench.explorer.newFile"), icon: <FilePlus className="size-3.5" /> }, { key: "new-folder", label: t("library.workbench.explorer.newFolder"), icon: <FolderPlus className="size-3.5" /> });
            if (row.type === "file" && dirtyPaths.has(row.path)) items.push({ key: "revert", label: t("library.workbench.explorer.revert"), icon: <Undo2 className="size-3.5" /> });
            if (!entry)
                items.push(
                    { type: "divider" },
                    { key: "rename", label: t("library.workbench.explorer.rename"), icon: <PencilLine className="size-3.5" />, extra: "F2" },
                    { key: "delete", label: t("common.delete"), danger: true, icon: <Trash2 className="size-3.5" />, extra: "Del" },
                );
        }
        return {
            items,
            onClick: ({ key, domEvent }) => {
                domEvent.stopPropagation();
                switch (key) {
                    case "open":
                        onOpenFile(row.path);
                        break;
                    case "new-file":
                        onStartInput({ mode: "new-file", parent });
                        break;
                    case "new-folder":
                        onStartInput({ mode: "new-folder", parent });
                        break;
                    case "revert":
                        onRevert(row.path);
                        break;
                    case "rename":
                        onStartInput({ mode: "rename", path: row.path, type: row.type });
                        break;
                    case "delete":
                        onDelete(row);
                        break;
                }
            },
        };
    };

    const newInputParent = input && input.mode !== "rename" ? input.parent : null;
    const newInputDepth = newInputParent === null ? 0 : newInputParent === "" ? 0 : (rows.find((row) => row.path === newInputParent)?.depth ?? -1) + 1;
    const newInputRow =
        input && input.mode !== "rename" ? (
            <InlineNameInput
                key={`new-${input.mode}-${input.parent}`}
                depth={newInputDepth}
                icon={input.mode === "new-folder" ? <Folder aria-hidden="true" className="size-4" /> : <File aria-hidden="true" className="size-4" />}
                initial=""
                ariaLabel={input.mode === "new-folder" ? t("library.workbench.explorer.newFolderName") : t("library.workbench.explorer.newFileName")}
                onCancel={onCancelInput}
                onSubmit={onSubmitInput}
            />
        ) : null;

    return (
        <div className="skill-wb-explorer" aria-label={t("library.workbench.explorer.title")}>
            <div className="skill-wb-explorer-head">
                <span className="skill-wb-explorer-title">{t("library.workbench.explorer.title")}</span>
                <span className="skill-wb-explorer-count">{t("library.workbench.explorer.fileCount", { count: fileCount })}</span>
                <div className="skill-wb-explorer-tools">
                    {!readOnly ? (
                        <>
                            <button
                                type="button"
                                className="skill-wb-icon-button"
                                aria-label={t("library.workbench.explorer.newFile")}
                                title={t("library.workbench.explorer.newFile")}
                                onClick={() => onStartInput({ mode: "new-file", parent: focusedRow ? (focusedRow.type === "folder" ? focusedRow.path : focusedRow.parent) : "" })}
                            >
                                <FilePlus className="size-4" />
                            </button>
                            <button
                                type="button"
                                className="skill-wb-icon-button"
                                aria-label={t("library.workbench.explorer.newFolder")}
                                title={t("library.workbench.explorer.newFolder")}
                                onClick={() => onStartInput({ mode: "new-folder", parent: focusedRow ? (focusedRow.type === "folder" ? focusedRow.path : focusedRow.parent) : "" })}
                            >
                                <FolderPlus className="size-4" />
                            </button>
                        </>
                    ) : null}
                    <button type="button" className="skill-wb-icon-button" aria-label={t("library.workbench.explorer.collapseAll")} title={t("library.workbench.explorer.collapseAll")} onClick={onCollapseAll}>
                        <ChevronsDownUp className="size-4" />
                    </button>
                </div>
            </div>
            <label className="skill-wb-filter">
                <Search aria-hidden="true" className="size-3.5" />
                <input
                    ref={filterRef}
                    value={filter}
                    placeholder={t("library.workbench.explorer.filter")}
                    aria-label={t("library.workbench.explorer.filter")}
                    spellCheck={false}
                    onChange={(event) => onFilterChange(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") {
                            event.preventDefault();
                            onFilterChange("");
                            treeRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
                        } else if (event.key === "ArrowDown") {
                            event.preventDefault();
                            if (rows[0]) onFocusPath(rows[0].path);
                            requestAnimationFrame(() => treeRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus());
                        } else if (event.key === "Enter") {
                            const first = rows.find((row) => row.type === "file");
                            if (first) onOpenFile(first.path);
                        }
                    }}
                />
                {filter ? (
                    <button type="button" className="skill-wb-filter-clear" aria-label={t("library.workbench.explorer.clearFilter")} onClick={() => onFilterChange("")}>
                        <X className="size-3" />
                    </button>
                ) : null}
            </label>
            <div ref={treeRef} className="skill-wb-tree thin-scrollbar" role="tree" aria-label={t("library.workbench.explorer.tree")} onKeyDown={handleTreeKeyDown}>
                {newInputParent === "" ? newInputRow : null}
                {rows.map((row, index) => {
                    const renaming = input?.mode === "rename" && input.path === row.path;
                    const isFocused = row.path === focusedPath || (focusedIndex < 0 && index === 0);
                    const dirty = row.type === "file" ? dirtyPaths.has(row.path) : [...dirtyPaths].some((path) => path.startsWith(`${row.path}/`));
                    const icon = row.type === "folder" ? row.expanded ? <FolderOpen aria-hidden="true" className="size-4 skill-wb-icon-folder" /> : <Folder aria-hidden="true" className="size-4 skill-wb-icon-folder" /> : fileIconFor(row.path);
                    const content = renaming ? (
                        <InlineNameInput key={`rename-${row.path}`} depth={row.depth} icon={icon} initial={row.name} ariaLabel={t("library.workbench.explorer.renameItem", { name: row.name })} onCancel={onCancelInput} onSubmit={onSubmitInput} />
                    ) : (
                        <Dropdown trigger={["contextMenu"]} menu={menuFor(row)}>
                            <div
                                role="treeitem"
                                data-path={row.path}
                                aria-level={row.depth + 1}
                                aria-selected={row.path === activePath}
                                aria-expanded={row.type === "folder" ? row.expanded : undefined}
                                tabIndex={isFocused ? 0 : -1}
                                className={`skill-wb-row${row.path === activePath ? " is-active" : ""}${row.path === focusedPath ? " is-focused" : ""}`}
                                style={{ paddingInlineStart: 8 + row.depth * ROW_INDENT }}
                                onClick={() => {
                                    onFocusPath(row.path);
                                    if (row.type === "folder") onToggleFolder(row.path);
                                    else onOpenFile(row.path, { preview: true });
                                }}
                                onDoubleClick={() => {
                                    if (row.type === "file") onOpenFile(row.path);
                                }}
                                onFocus={() => {
                                    if (row.path !== focusedPath) onFocusPath(row.path);
                                }}
                            >
                                <span className={`skill-wb-chevron${row.type === "folder" ? "" : " is-hidden"}${row.expanded ? " is-expanded" : ""}`} aria-hidden="true">
                                    <ChevronRight className="size-3.5" />
                                </span>
                                <span className="skill-wb-row-icon">{icon}</span>
                                <span className={`skill-wb-row-name${dirty ? " is-dirty" : ""}`}>{row.name}</span>
                                {dirty && row.type === "file" ? <span className="skill-wb-dirty-dot" aria-label={t("library.workbench.explorer.unsaved")} /> : null}
                                {!readOnly ? (
                                    <span className="skill-wb-row-actions">
                                        {row.path !== SKILL_ENTRY_PATH ? (
                                            <button
                                                type="button"
                                                tabIndex={-1}
                                                className="skill-wb-row-action"
                                                aria-label={t("library.workbench.explorer.renameItem", { name: row.name })}
                                                title={t("library.workbench.explorer.renameShortcut")}
                                                onClick={(event: MouseEvent) => {
                                                    event.stopPropagation();
                                                    onStartInput({ mode: "rename", path: row.path, type: row.type });
                                                }}
                                            >
                                                <PencilLine className="size-3.5" />
                                            </button>
                                        ) : null}
                                        <Dropdown trigger={["click"]} menu={menuFor(row)}>
                                            <button
                                                type="button"
                                                tabIndex={-1}
                                                className="skill-wb-row-action"
                                                aria-label={t("library.workbench.explorer.moreActionsFor", { name: row.name })}
                                                title={t("library.workbench.explorer.moreActions")}
                                                onClick={(event: MouseEvent) => event.stopPropagation()}
                                            >
                                                <MoreHorizontal className="size-3.5" />
                                            </button>
                                        </Dropdown>
                                    </span>
                                ) : null}
                            </div>
                        </Dropdown>
                    );
                    return (
                        <div key={row.path} role="none">
                            {content}
                            {newInputParent === row.path && row.type === "folder" ? newInputRow : null}
                        </div>
                    );
                })}
                {!rows.length && !newInputRow ? <div className="skill-wb-tree-empty">{filter ? t("library.workbench.quickOpen.empty") : t("library.workbench.explorer.emptyPackage")}</div> : null}
            </div>
        </div>
    );
}

function InlineNameInput({ depth, icon, initial, ariaLabel, onSubmit, onCancel }: { depth: number; icon: ReactNode; initial: string; ariaLabel: string; onSubmit: (value: string) => string | null; onCancel: () => void }) {
    const [value, setValue] = useState(initial);
    const [error, setError] = useState("");
    const inputRef = useRef<HTMLInputElement | null>(null);
    const doneRef = useRef(false);

    useEffect(() => {
        const element = inputRef.current;
        if (!element) return;
        element.focus();
        // 重命名时只选中文件名主体，保留扩展名，和 VS Code 一致。
        const dot = initial.lastIndexOf(".");
        element.setSelectionRange(0, dot > 0 ? dot : initial.length);
    }, [initial]);

    const commit = () => {
        if (doneRef.current) return;
        const trimmed = value.trim();
        if (!trimmed || trimmed === initial) {
            doneRef.current = true;
            onCancel();
            return;
        }
        const failure = onSubmit(trimmed);
        if (failure) {
            setError(failure);
            inputRef.current?.focus();
            return;
        }
        doneRef.current = true;
    };

    return (
        <div className="skill-wb-row is-editing" style={{ paddingInlineStart: 8 + depth * ROW_INDENT }}>
            <span className="skill-wb-chevron is-hidden" aria-hidden="true" />
            <span className="skill-wb-row-icon">{icon}</span>
            <span className="skill-wb-name-input-wrap">
                <input
                    ref={inputRef}
                    className={`skill-wb-name-input${error ? " is-invalid" : ""}`}
                    value={value}
                    aria-label={ariaLabel}
                    aria-invalid={Boolean(error)}
                    spellCheck={false}
                    onChange={(event) => {
                        setValue(event.target.value);
                        setError("");
                    }}
                    onBlur={() => {
                        if (!error) commit();
                        else {
                            doneRef.current = true;
                            onCancel();
                        }
                    }}
                    onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Enter") {
                            event.preventDefault();
                            commit();
                        } else if (event.key === "Escape") {
                            event.preventDefault();
                            doneRef.current = true;
                            onCancel();
                        }
                    }}
                />
                {error ? (
                    <span className="skill-wb-name-error" role="alert">
                        {error}
                    </span>
                ) : null}
            </span>
        </div>
    );
}
