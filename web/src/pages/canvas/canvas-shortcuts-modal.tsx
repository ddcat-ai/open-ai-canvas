import { useEffect, useMemo, useRef, useState } from "react";
import { Command, Search } from "lucide-react";
import { Modal } from "antd";

import {
    CANVAS_SHORTCUT_CATEGORIES,
    CANVAS_SHORTCUTS,
    filterCanvasShortcuts,
    type CanvasShortcutCategoryId,
    type CanvasShortcutItem,
} from "@/lib/canvas/canvas-shortcuts";

type ShortcutCategoryFilter = CanvasShortcutCategoryId | "all";

export function CanvasShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState<ShortcutCategoryFilter>("all");

    useEffect(() => {
        if (!open) return;
        setQuery("");
        setCategory("all");
    }, [open]);

    const results = useMemo(() => filterCanvasShortcuts(query, category), [category, query]);
    const categoryCounts = useMemo(
        () => new Map(CANVAS_SHORTCUT_CATEGORIES.map((entry) => [entry.id, CANVAS_SHORTCUTS.filter((shortcut) => shortcut.category === entry.id).length])),
        [],
    );

    return (
        <Modal
            className="workspace-modal workspace-modal-wide canvas-shortcuts-modal"
            open={open}
            onCancel={onClose}
            footer={null}
            title={null}
            centered
            keyboard
            width="min(860px, calc(100vw - 24px))"
            styles={{ container: { padding: 0 }, body: { padding: 0 } }}
            afterOpenChange={(visible) => {
                if (visible) window.requestAnimationFrame(() => inputRef.current?.focus());
            }}
        >
            <div className="canvas-shortcuts-shell">
                <header className="canvas-shortcuts-header">
                    <div className="canvas-shortcuts-heading">
                        <span className="canvas-shortcuts-heading-icon" aria-hidden>
                            <Command />
                        </span>
                        <span>
                            <strong>画布快捷键</strong>
                            <small>快速找到键盘、鼠标和视图操作</small>
                        </span>
                    </div>
                    <label className="canvas-shortcuts-search">
                        <Search aria-hidden />
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="搜索按键或操作…"
                            aria-label="搜索画布快捷键"
                        />
                        {query ? (
                            <button type="button" onClick={() => setQuery("")} aria-label="清空搜索">
                                清除
                            </button>
                        ) : null}
                    </label>
                </header>

                <div className="canvas-shortcuts-body">
                    <nav className="canvas-shortcuts-categories" aria-label="快捷键分类">
                        <CategoryButton label="全部" count={CANVAS_SHORTCUTS.length} active={category === "all"} onClick={() => setCategory("all")} />
                        {CANVAS_SHORTCUT_CATEGORIES.map((entry) => (
                            <CategoryButton
                                key={entry.id}
                                label={entry.label}
                                count={categoryCounts.get(entry.id) || 0}
                                active={category === entry.id}
                                onClick={() => setCategory(entry.id)}
                            />
                        ))}
                    </nav>

                    <main className="canvas-shortcuts-results" aria-live="polite">
                        {results.length ? (
                            <div className="canvas-shortcuts-list">
                                {results.map((shortcut) => (
                                    <ShortcutRow key={shortcut.id} shortcut={shortcut} showCategory={category === "all" || Boolean(query)} />
                                ))}
                            </div>
                        ) : (
                            <div className="canvas-shortcuts-empty">
                                <Search aria-hidden />
                                <strong>没有找到相关操作</strong>
                                <span>试试搜索“粘贴”“缩放”或按键名称</span>
                            </div>
                        )}
                    </main>
                </div>

                <footer className="canvas-shortcuts-footer">
                    <span>共 {results.length} 个快捷键</span>
                    <span className="canvas-shortcuts-close-hint"><kbd>Esc</kbd> 关闭</span>
                </footer>
            </div>
        </Modal>
    );
}

function CategoryButton({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
    return (
        <button type="button" className={active ? "is-active" : undefined} aria-pressed={active} onClick={onClick}>
            <span>{label}</span>
            <small>{count}</small>
        </button>
    );
}

function ShortcutRow({ shortcut, showCategory }: { shortcut: CanvasShortcutItem; showCategory: boolean }) {
    const categoryLabel = CANVAS_SHORTCUT_CATEGORIES.find((entry) => entry.id === shortcut.category)?.label;

    return (
        <article className="canvas-shortcuts-row">
            <div className="canvas-shortcuts-row-copy">
                <span className="canvas-shortcuts-row-title">
                    <strong>{shortcut.title}</strong>
                    {showCategory ? <small>{categoryLabel}</small> : null}
                </span>
                <p>{shortcut.description}</p>
            </div>
            <div className="canvas-shortcuts-keys" aria-label={shortcut.keys.map((combination) => combination.join(" 加 ")).join(" 或 ")}>
                {shortcut.keys.map((combination, combinationIndex) => (
                    <span key={`${shortcut.id}-${combination.join("-")}`} className="canvas-shortcuts-combination">
                        {combinationIndex ? <em>或</em> : null}
                        {combination.map((key, keyIndex) => (
                            <span key={`${key}-${keyIndex}`} className="canvas-shortcuts-key-part">
                                {keyIndex ? <i>+</i> : null}
                                <kbd>{key}</kbd>
                            </span>
                        ))}
                    </span>
                ))}
            </div>
        </article>
    );
}
