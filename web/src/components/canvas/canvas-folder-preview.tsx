import React, { useEffect, useMemo, useState } from "react";
import { Dropdown } from "antd";
import { FileAudio, FileText, MoreHorizontal, Pencil, Plus, SlidersHorizontal, Sparkles, Video } from "lucide-react";

import { formatLocale } from "@/lib/format-locale";
import { CANVAS_FOLDER_THEME_OPTIONS, resolveCanvasFolderTheme, resolveCanvasFolderThemeCover } from "@/lib/canvas/canvas-folder-theme";
import type { CanvasFolderStyle, CanvasFolderTheme, CanvasNodeData } from "@/types/canvas";
import { CanvasNodeType } from "@/types/canvas";
import { t } from "@/i18n";

const FOLDER_STYLE_OPTIONS: Array<{ key: CanvasFolderStyle; label: string }> = [
    { key: "glass", label: t("canvas:glass-sheen") },
    { key: "stacked", label: t("canvas:showcase") },
    { key: "midnight", label: t("canvas:midnight-cover") },
    { key: "paper", label: t("canvas:paper-collection") },
    { key: "cinema", label: t("canvas:film-strip") },
    { key: "compact", label: t("canvas:compact-dossier") },
];

export const CanvasFolderPreview = React.memo(function CanvasFolderPreview({
    data,
    childNodes,
    active,
    isDropTarget,
    readOnly,
    onToggleCollapsed,
    onTitleChange,
    onStyleChange,
    onThemeChange,
}: {
    data: CanvasNodeData;
    childNodes: CanvasNodeData[];
    active: boolean;
    isDropTarget: boolean;
    readOnly: boolean;
    onToggleCollapsed: (nodeId: string) => void;
    onTitleChange: (nodeId: string, title: string) => void;
    onStyleChange: (nodeId: string, style: CanvasFolderStyle) => void;
    onThemeChange: (nodeId: string, theme: CanvasFolderTheme) => void;
}) {
    const style = data.metadata?.folder?.style || "glass";
    const theme = resolveCanvasFolderTheme(data.metadata?.folder?.theme);
    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState(data.title);
    const previewNodes = useMemo(() => childNodes.filter(canPreviewFolderNode).slice(0, 3), [childNodes]);
    const themeCover = resolveCanvasFolderThemeCover(theme, data.metadata?.folder?.themeCover);
    const showAdd = style === "glass" || childNodes.length === 0;
    const folderMenu = {
        selectedKeys: [`style:${style}`, `theme:${theme}`],
        items: [
            {
                key: "styles",
                label: t("domain:folder-styles"),
                children: FOLDER_STYLE_OPTIONS.map((item) => ({ key: `style:${item.key}`, label: item.label })),
            },
            {
                key: "themes",
                label: t("domain:theme-skin"),
                children: CANVAS_FOLDER_THEME_OPTIONS.map((item) => ({ key: `theme:${item.key}`, label: item.label })),
            },
        ],
        onClick: ({ key }: { key: string }) => {
            if (key.startsWith("style:")) onStyleChange(data.id, key.slice(6) as CanvasFolderStyle);
            if (key.startsWith("theme:")) onThemeChange(data.id, key.slice(6) as CanvasFolderTheme);
        },
    };

    useEffect(() => setTitle(data.title), [data.title]);

    const commitTitle = () => {
        const next = title.trim() || t("domain:untitled-folder");
        setTitle(next);
        setEditing(false);
        onTitleChange(data.id, next);
    };

    return (
        <div className={`canvas-folder-preview canvas-folder-preview-${style}${active ? " is-active" : ""}${isDropTarget ? " is-drop-target" : ""}`}>
            <div className="canvas-folder-back" aria-hidden>
                <FolderThemeMedia source={themeCover} />
            </div>

            <div className="canvas-folder-paper-sheet" aria-hidden />

            <div className="canvas-folder-preview-stack" aria-hidden>
                {(previewNodes.length ? previewNodes : [undefined, undefined]).map((node, index) => (
                    <div key={node?.id || `folder-placeholder-${index}`} className={`canvas-folder-preview-card canvas-folder-preview-card-${index + 1}`}>
                        <FolderNodeMedia node={node} />
                    </div>
                ))}
            </div>

            <div className="canvas-folder-front">
                <div className="canvas-folder-front-media" aria-hidden>
                    <FolderThemeMedia source={themeCover} />
                </div>
                <div className="canvas-folder-front-tint" aria-hidden />

                <div className="canvas-folder-copy">
                    {editing ? (
                        <input
                            autoFocus
                            className="canvas-folder-title-input"
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                            onBlur={commitTitle}
                            onMouseDown={(event) => event.stopPropagation()}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") commitTitle();
                                if (event.key === "Escape") {
                                    setTitle(data.title);
                                    setEditing(false);
                                }
                            }}
                        />
                    ) : (
                        <button
                            type="button"
                            className="canvas-folder-title"
                            title={readOnly ? data.title : t("domain:param-click-to-rename", { title: data.title })}
                            onClick={(event) => {
                                event.stopPropagation();
                                if (!readOnly) setEditing(true);
                            }}
                            onDoubleClick={(event) => {
                                event.stopPropagation();
                                if (!readOnly) setEditing(true);
                            }}
                        >
                            <span>{data.title}</span>
                            {!readOnly ? <Pencil aria-hidden /> : null}
                        </button>
                    )}
                    <span className="canvas-folder-meta">{style === "midnight" ? formatFolderDate(data.metadata?.folder?.createdAt) : t("domain:param-items", { length: childNodes.length })}</span>
                </div>

                {!readOnly ? (
                    showAdd ? (
                        <button
                            type="button"
                            className="canvas-folder-action canvas-folder-add"
                            aria-label={t("domain:expand-the-folder-and-add-content")}
                            title={t("domain:expand-the-folder-and-add-content")}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                                event.stopPropagation();
                                onToggleCollapsed(data.id);
                            }}
                        >
                            <Plus />
                        </button>
                    ) : (
                        <Dropdown trigger={["click"]} menu={folderMenu}>
                            <button
                                type="button"
                                className="canvas-folder-action canvas-folder-options"
                                aria-label={t("domain:folder-options-param-items", { length: childNodes.length })}
                                title={t("domain:switch-folder-style-and-theme")}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={(event) => event.stopPropagation()}
                            >
                                <MoreHorizontal />
                            </button>
                        </Dropdown>
                    )
                ) : null}

                {!readOnly && showAdd ? (
                    <Dropdown trigger={["click"]} menu={folderMenu}>
                        <button
                            type="button"
                            className="canvas-folder-style-trigger"
                            aria-label={t("domain:switch-folder-style-and-theme")}
                            title={t("domain:switch-folder-style-and-theme")}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                        >
                            <MoreHorizontal />
                        </button>
                    </Dropdown>
                ) : null}

                {readOnly && childNodes.length > 0 ? <span className="canvas-folder-count">{childNodes.length}</span> : null}
            </div>
        </div>
    );
});

function canPreviewFolderNode(node: CanvasNodeData) {
    return node.type !== CanvasNodeType.Frame;
}

function FolderThemeMedia({ source }: { source: string }) {
    return <img src={source} alt="" loading="eager" decoding="async" draggable={false} />;
}

function FolderNodeMedia({ node }: { node?: CanvasNodeData }) {
    if (node?.type === CanvasNodeType.Image && node.metadata?.content) {
        return <img src={node.metadata.content} alt="" loading="lazy" decoding="async" draggable={false} />;
    }
    if (node?.type === CanvasNodeType.Video && node.metadata?.content) {
        return <video src={node.metadata.content} muted playsInline preload="metadata" />;
    }
    if (node?.type === CanvasNodeType.Drawing && (node.metadata?.drawingPreviewUrl || node.metadata?.content)) {
        return <img src={node.metadata.drawingPreviewUrl || node.metadata.content} alt="" loading="lazy" decoding="async" draggable={false} />;
    }
    if (node?.type === CanvasNodeType.Video) return <Video className="canvas-folder-file-icon" />;
    if (node?.type === CanvasNodeType.Audio) return <FileAudio className="canvas-folder-file-icon" />;
    if (node?.type === CanvasNodeType.Skill) return <Sparkles className="canvas-folder-file-icon" />;
    if (node?.type === CanvasNodeType.Config) return <SlidersHorizontal className="canvas-folder-file-icon" />;
    if (node?.type === CanvasNodeType.Text || node?.type === CanvasNodeType.Script) {
        return <span className="canvas-folder-text-preview">{node.metadata?.content || node.title}</span>;
    }
    if (node) return <FileText className="canvas-folder-file-icon" />;
    return <span className="canvas-folder-file-sheet" />;
}

function formatFolderDate(value?: string) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return t("domain:created-just-now");
    return new Intl.DateTimeFormat(formatLocale(), { month: "short", day: "numeric" }).format(date);
}
