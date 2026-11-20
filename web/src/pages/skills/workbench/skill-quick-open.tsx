import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AppModal } from "@/components/ui/product/app-modal";
import { Kbd } from "@/components/ui/base/kbd";
import { baseName, fuzzyScore, parentPath } from "@/lib/skills/skill-workbench-model";
import { fileIconFor } from "@/pages/skills/workbench/skill-workbench-explorer";

/** Cmd/Ctrl+P 快速打开：子序列模糊匹配文件路径，方向键选择，回车打开。 */
export function SkillQuickOpen({ open, paths, onClose, onPick }: { open: boolean; paths: string[]; onClose: () => void; onPick: (path: string) => void }) {
    const { t } = useTranslation();
    const [query, setQuery] = useState("");
    const [index, setIndex] = useState(0);
    const listRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (open) {
            setQuery("");
            setIndex(0);
        }
    }, [open]);

    const results = useMemo(
        () =>
            paths
                .map((path) => ({ path, score: fuzzyScore(path, query) }))
                .filter((item) => item.score >= 0)
                .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
                .slice(0, 60),
        [paths, query],
    );

    useEffect(() => {
        listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
    }, [index]);

    const pick = (path: string | undefined) => {
        if (!path) return;
        onPick(path);
        onClose();
    };

    return (
        <AppModal open={open} flush footer={null} closable={false} width="min(560px, calc(100vw - 32px))" style={{ top: 72 }} className="skill-wb-quick-open-modal" onCancel={onClose} destroyOnHidden>
            <div className="skill-wb-quick-open">
                <label className="skill-wb-quick-open-input">
                    <Search aria-hidden="true" className="size-4" />
                    <input
                        autoFocus
                        value={query}
                        placeholder={t("library.workbench.quickOpen.placeholder")}
                        aria-label={t("library.workbench.quickOpen.placeholder")}
                        role="combobox"
                        aria-expanded="true"
                        aria-controls="skill-wb-quick-open-list"
                        aria-activedescendant={results[index] ? `skill-wb-quick-open-${index}` : undefined}
                        spellCheck={false}
                        onChange={(event) => {
                            setQuery(event.target.value);
                            setIndex(0);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === "ArrowDown") {
                                event.preventDefault();
                                setIndex((value) => Math.min(results.length - 1, value + 1));
                            } else if (event.key === "ArrowUp") {
                                event.preventDefault();
                                setIndex((value) => Math.max(0, value - 1));
                            } else if (event.key === "Enter") {
                                event.preventDefault();
                                pick(results[index]?.path);
                            }
                        }}
                    />
                    <Kbd>Esc</Kbd>
                </label>
                <div id="skill-wb-quick-open-list" ref={listRef} className="skill-wb-quick-open-list thin-scrollbar" role="listbox" aria-label={t("library.workbench.quickOpen.results")}>
                    {results.length ? (
                        results.map((item, itemIndex) => (
                            <div
                                key={item.path}
                                id={`skill-wb-quick-open-${itemIndex}`}
                                data-index={itemIndex}
                                role="option"
                                aria-selected={itemIndex === index}
                                className={`skill-wb-quick-open-item${itemIndex === index ? " is-active" : ""}`}
                                onMouseMove={() => setIndex(itemIndex)}
                                onClick={() => pick(item.path)}
                            >
                                {fileIconFor(item.path)}
                                <span className="skill-wb-quick-open-name">{baseName(item.path)}</span>
                                <span className="skill-wb-quick-open-dir">{parentPath(item.path)}</span>
                            </div>
                        ))
                    ) : (
                        <div className="skill-wb-quick-open-empty">{t("library.workbench.quickOpen.empty")}</div>
                    )}
                </div>
            </div>
        </AppModal>
    );
}
