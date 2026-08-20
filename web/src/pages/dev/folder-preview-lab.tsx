import { useMemo, useState } from "react";
import { ChevronLeft, FolderOpen, ImagePlus, MousePointer2 } from "lucide-react";

import { CanvasFolderPreview } from "@/components/canvas/canvas-folder-preview";
import type { CanvasFolderStyle, CanvasNodeData } from "@/types/canvas";
import { CanvasNodeType } from "@/types/canvas";

import "./folder-preview-lab.css";

const STYLE_PRESETS: Array<{ style: CanvasFolderStyle; name: string; hint: string }> = [
    { style: "glass", name: "流光玻璃", hint: "复刻参考 · 加号入口" },
    { style: "stacked", name: "内容陈列", hint: "复刻参考 · 文件预览" },
    { style: "midnight", name: "午夜封面", hint: "复刻参考 · 深色标签" },
    { style: "paper", name: "纸感收藏", hint: "衍生 · 轻量资料" },
    { style: "cinema", name: "电影胶片", hint: "衍生 · 影像项目" },
    { style: "compact", name: "紧凑资料", hint: "衍生 · 高频调用" },
];

const SAMPLE_MEDIA = [
    "/short-drama-styles/fantasy-3d.jpg",
    "/short-drama-styles/suspense-noir.jpg",
    "/short-drama-styles/cyberpunk-neon.jpg",
    "/short-drama-styles/ink-narrative.jpg",
    "/short-drama-styles/space-opera.jpg",
];

function makeMediaNode(id: string, title: string, content: string, index: number): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title,
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: { content, mimeType: "image/jpeg", count: index + 1 },
    };
}

function makeFolderNode(style: CanvasFolderStyle, index: number): CanvasNodeData {
    return {
        id: `folder-${style}`,
        type: CanvasNodeType.Frame,
        title: ["我的素材", "项目资料", "视觉档案", "灵感收藏", "影像资产", "快速调用"][index],
        position: { x: 0, y: 0 },
        width: 360,
        height: 280,
        metadata: {
            folder: { style, createdAt: new Date(2026, 7, 19 + index).toISOString() },
            frame: { collapsed: true, expandedWidth: 760, expandedHeight: 520 },
        },
    };
}

const INITIAL_FOLDERS = STYLE_PRESETS.map((preset, index) => makeFolderNode(preset.style, index));

const INITIAL_CHILDREN = Object.fromEntries(
    INITIAL_FOLDERS.map((folder, folderIndex) => [
        folder.id,
        SAMPLE_MEDIA.slice(0, 3 + (folderIndex % 3)).map((source, childIndex) =>
            makeMediaNode(`${folder.id}-asset-${childIndex}`, ["主视觉", "氛围参考", "场景草图", "色彩方案", "镜头灵感"][childIndex], source, childIndex),
        ),
    ]),
) as Record<string, CanvasNodeData[]>;

export default function FolderPreviewLab() {
    const [folders, setFolders] = useState(INITIAL_FOLDERS);
    const [childrenByFolder, setChildrenByFolder] = useState(INITIAL_CHILDREN);
    const [selectedId, setSelectedId] = useState(INITIAL_FOLDERS[0].id);
    const [openedId, setOpenedId] = useState<string | null>(null);
    const openedFolder = useMemo(() => folders.find((folder) => folder.id === openedId), [folders, openedId]);
    const openedChildren = openedId ? childrenByFolder[openedId] || [] : [];

    const updateFolder = (nodeId: string, patch: (folder: CanvasNodeData) => CanvasNodeData) => {
        setFolders((current) => current.map((folder) => (folder.id === nodeId ? patch(folder) : folder)));
    };

    const addSampleContent = () => {
        if (!openedId) return;
        setChildrenByFolder((current) => {
            const previous = current[openedId] || [];
            const index = previous.length;
            const next = makeMediaNode(
                `${openedId}-asset-${Date.now()}`,
                `新素材 ${index + 1}`,
                SAMPLE_MEDIA[index % SAMPLE_MEDIA.length],
                index,
            );
            return { ...current, [openedId]: [...previous, next] };
        });
    };

    return (
        <main className="folder-preview-lab">
            <header className="folder-preview-lab-header">
                <div>
                    <span className="folder-preview-lab-kicker">DEV · INTERACTIVE FOLDER LAB</span>
                    <h1>通用素材文件夹</h1>
                    <p>悬停查看动效，单击选中，双击打开；标题和右上角菜单都可以直接操作。</p>
                </div>
                <div className="folder-preview-lab-guide">
                    <MousePointer2 aria-hidden />
                    <span>试试 hover、双击与样式切换</span>
                </div>
            </header>

            <section className="folder-preview-lab-grid" aria-label="文件夹样式预览">
                {folders.map((folder, index) => {
                    const preset = STYLE_PRESETS[index];
                    const childNodes = childrenByFolder[folder.id] || [];
                    return (
                        <article key={folder.id} className="folder-preview-lab-item">
                            <div className="folder-preview-lab-item-copy">
                                <strong>{preset.name}</strong>
                                <span>{preset.hint}</span>
                            </div>
                            <div
                                className="folder-preview-lab-folder"
                                role="button"
                                tabIndex={0}
                                aria-label={`打开 ${folder.title}`}
                                onClick={() => setSelectedId(folder.id)}
                                onDoubleClick={() => setOpenedId(folder.id)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        setOpenedId(folder.id);
                                    }
                                }}
                            >
                                <CanvasFolderPreview
                                    data={folder}
                                    childNodes={childNodes}
                                    active={selectedId === folder.id}
                                    isDropTarget={false}
                                    readOnly={false}
                                    onToggleCollapsed={setOpenedId}
                                    onTitleChange={(nodeId, title) => updateFolder(nodeId, (current) => ({ ...current, title }))}
                                    onStyleChange={(nodeId, style) =>
                                        updateFolder(nodeId, (current) => ({
                                            ...current,
                                            metadata: {
                                                ...current.metadata,
                                                folder: { ...current.metadata!.folder!, style },
                                            },
                                        }))
                                    }
                                />
                            </div>
                            <button type="button" className="folder-preview-lab-open" onClick={() => setOpenedId(folder.id)}>
                                <FolderOpen aria-hidden /> 打开文件夹
                            </button>
                        </article>
                    );
                })}
            </section>

            {openedFolder ? (
                <section className="folder-preview-lab-drawer" aria-label={`${openedFolder.title} 内容`}>
                    <div className="folder-preview-lab-drawer-header">
                        <button type="button" onClick={() => setOpenedId(null)}>
                            <ChevronLeft aria-hidden /> 返回
                        </button>
                        <div>
                            <span>已打开</span>
                            <h2>{openedFolder.title}</h2>
                        </div>
                        <button type="button" onClick={addSampleContent}>
                            <ImagePlus aria-hidden /> 添加示例内容
                        </button>
                    </div>
                    <div className="folder-preview-lab-assets">
                        {openedChildren.map((node) => (
                            <article key={node.id} className="folder-preview-lab-asset">
                                <img src={node.metadata?.content} alt="" draggable={false} />
                                <div>
                                    <strong>{node.title}</strong>
                                    <span>图片素材</span>
                                </div>
                            </article>
                        ))}
                    </div>
                </section>
            ) : null}
        </main>
    );
}
