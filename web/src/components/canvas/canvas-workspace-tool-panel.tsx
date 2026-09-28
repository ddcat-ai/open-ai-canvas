import { useUserStore } from "@/stores/use-user-store";
import { FEED_TABS, SUB_TAB_TAGS, toAbsoluteUrl } from "@/lib/canvas/canvas-tool-presentation";
type FeedTab = ToolScope;
import { memo, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, Loader2, MoreHorizontal, Plus, Star, Trash2, Upload, Wrench, X } from "lucide-react";
import { App, Button, Dropdown, Form, Input, Radio, Space, type MenuProps } from "antd";

import { CanvasImagePreview } from "@/components/canvas/canvas-image-preview";
import { AppModal } from "@/components/ui/product/app-modal";
import { VideoPlayer } from "@/components/video-player";
import { WorkspaceErrorState, WorkspaceState } from "@/components/layout/workspace-state";
import { uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { createTool, deleteTool, listTools, setToolFavorite, type ToolScope, type ToolSummary, type ToolType, type ToolVisibility } from "@/services/api/tools";
import { Select } from "@/components/ui/base/select";

type ToolSubTab = "style" | "effect" | "motion" | "nine_grid";

// 工具类型与后端一致。
const TOOL_SUB_TABS: Array<{ id: ToolSubTab; type: ToolType; label: string }> = [
    { id: "style", type: "style", label: "风格" },
    { id: "nine_grid", type: "nine_grid", label: "九宫格" },
    { id: "effect", type: "effect", label: "特效" },
    { id: "motion", type: "motion", label: "运镜" },
];

const TOOL_PAGE_SIZE = 40;
const TOOL_SEARCH_DEBOUNCE_MS = 250;

const VIDEO_URL_RE = /\.(mp4|webm|mov|m4v)(?:$|[?#])/i;
// 上传到资源服务的文件 URL（/api/resources/:id/file）没有扩展名，按路径形态识别。
const RESOURCE_FILE_URL_RE = /\/resources\/[^/?#]+\/file(?:[?#]|$)/i;

function isVideoUrl(url: string) {
    return VIDEO_URL_RE.test(url) || RESOURCE_FILE_URL_RE.test(url);
}

// 悬停播放预览视频的工具类型：运镜、特效
const HOVER_VIDEO_TYPES = new Set(["motion", "effect"]);

type CreateToolFormValues = {
    label: string;
    tag?: string;
    visibility: ToolVisibility;
    desc?: string;
    prompt: string;
    cover?: string;
    mediaUrl?: string;
    ratio?: string;
};

export type CanvasWorkspaceToolPanelProps = {
    onInsert?: (tool: ToolSummary) => void;
};

// 种子数据的 mediaUrl 多为相对路径（如 "period_idol/cover.webp"），无法直接预览；
// 绝对 http(s) URL 原样保留，站内资源路径（/api/resources/…）按当前 origin 绝对化。

function resolveToolPreview(tool: ToolSummary): { kind: "video" | "image"; src: string } | null {
    const media = toAbsoluteUrl(tool.mediaUrl);
    if (media && isVideoUrl(media)) return { kind: "video", src: media };
    const cover = toAbsoluteUrl(tool.cover) || media;
    return cover ? { kind: "image", src: cover } : null;
}

export function CanvasWorkspaceToolPanel({ onInsert }: CanvasWorkspaceToolPanelProps) {
    const userId = useUserStore((s) => s.user?.id);
    const { message, modal } = App.useApp();
    const queryClient = useQueryClient();
    const [subTab, setSubTab] = useState<ToolSubTab>("style");
    const [feedTab, setFeedTab] = useState<FeedTab>("public");
    const [tagFilter, setTagFilter] = useState("");
    const [searchInput, setSearchInput] = useState("");
    const [searchText, setSearchText] = useState("");
    const [previewTool, setPreviewTool] = useState<ToolSummary | null>(null);
    const [createOpen, setCreateOpen] = useState(false);
    const [createForm] = Form.useForm<CreateToolFormValues>();
    const [coverUploading, setCoverUploading] = useState(false);
    const [mediaUploading, setMediaUploading] = useState(false);
    const coverInputRef = useRef<HTMLInputElement>(null);
    const mediaInputRef = useRef<HTMLInputElement>(null);

    // 上传成功才回填表单；本地降级（pendingRemoteUpload）拿到的是页面级 objectURL，
    // 刷新即失效，绝不能写进工具数据。
    async function handleCoverUpload(file: File) {
        setCoverUploading(true);
        try {
            const image = await uploadImage(file);
            if (image.pendingRemoteUpload) throw new Error(image.remoteUploadError || "图片暂存本机，尚未上传到云端，请稍后重试");
            createForm.setFieldValue("cover", toAbsoluteUrl(image.url));
            message.success("封面已上传");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "封面上传失败");
        } finally {
            setCoverUploading(false);
        }
    }

    async function handleMediaUpload(file: File) {
        setMediaUploading(true);
        try {
            const uploaded = await uploadMediaFile(file, "video");
            if (uploaded.pendingRemoteUpload) throw new Error(uploaded.remoteUploadError || "视频暂存本机，尚未上传到云端，请稍后重试");
            createForm.setFieldValue("mediaUrl", toAbsoluteUrl(uploaded.url));
            message.success("演示视频已上传");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "视频上传失败");
        } finally {
            setMediaUploading(false);
        }
    }

    useEffect(() => {
        const timer = window.setTimeout(() => setSearchText(searchInput.trim()), TOOL_SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [searchInput]);

    const activeType = TOOL_SUB_TABS.find((tab) => tab.id === subTab)?.type ?? "style";
    const subTabLabel = TOOL_SUB_TABS.find((tab) => tab.id === subTab)?.label || "";
    const feedTabLabel = FEED_TABS.find((tab) => tab.id === feedTab)?.label || "";

    const tagChips = useMemo(() => {
        const tags = subTab === "style" ? SUB_TAB_TAGS.style : subTab === "motion" ? SUB_TAB_TAGS.motion : [];
        return [{ id: "", label: "全部" }, ...tags];
    }, [subTab]);

    const tagOptions = useMemo(() => {
        const tags = subTab === "style" ? SUB_TAB_TAGS.style : subTab === "motion" ? SUB_TAB_TAGS.motion : [];
        return tags.map((tag) => ({ value: tag.id, label: tag.label }));
    }, [subTab]);

    const toolsQuery = useInfiniteQuery({
        queryKey: ["canvas-tools", userId, feedTab, activeType, tagFilter, searchText],
        queryFn: ({ pageParam, signal }) =>
            listTools(
                {
                    page: pageParam as number,
                    pageSize: TOOL_PAGE_SIZE,
                    scope: feedTab,
                    type: activeType,
                    tag: tagFilter || undefined,
                    search: searchText || undefined,
                },
                { signal },
            ),
        initialPageParam: 1,
        getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
        enabled: Boolean(userId),
    });

    const tools = useMemo(() => toolsQuery.data?.pages.flatMap((page) => page.tools) ?? [], [toolsQuery.data]);
    const totalCount = toolsQuery.data?.pages[0]?.totalCount ?? 0;

    const invalidateTools = () => queryClient.invalidateQueries({ queryKey: ["canvas-tools"] });

    const favoriteMutation = useMutation({
        mutationFn: ({ id, favorite }: { id: number; favorite: boolean }) => setToolFavorite(id, favorite),
        onSuccess: () => void invalidateTools(),
        onError: (error) => message.error(error instanceof Error ? error.message : "收藏状态更新失败"),
    });

    const deleteMutation = useMutation({
        mutationFn: deleteTool,
        onSuccess: () => {
            void invalidateTools();
            message.success("工具已删除");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "工具删除失败"),
    });

    const createMutation = useMutation({
        mutationFn: (values: CreateToolFormValues) =>
            createTool({
                type: activeType,
                label: values.label.trim(),
                desc: values.desc?.trim() || undefined,
                tag: values.tag?.trim() || undefined,
                cover: values.cover?.trim() || undefined,
                prompt: values.prompt.trim(),
                ratio: values.ratio?.trim() || undefined,
                mediaUrl: values.mediaUrl?.trim() || undefined,
                visibility: values.visibility,
            }),
        onSuccess: () => {
            message.success("工具已创建");
            setCreateOpen(false);
            setFeedTab("custom");
            void invalidateTools();
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "工具创建失败"),
    });

    function confirmDelete(tool: ToolSummary) {
        modal.confirm({
            title: `删除“${tool.label}”？`,
            content: "删除后不可恢复，该工具的收藏记录也会一同移除。",
            okText: "删除",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: () => deleteMutation.mutateAsync(tool.id),
        });
    }

    function handleScroll(event: UIEvent<HTMLDivElement>) {
        const el = event.currentTarget;
        if (el.scrollHeight - el.scrollTop - el.clientHeight > 120) return;
        if (toolsQuery.hasNextPage && !toolsQuery.isFetchingNextPage) void toolsQuery.fetchNextPage();
    }

    const emptyTitle = feedTab === "favorites" ? "还没有收藏工具" : feedTab === "custom" ? "还没有自定义工具" : "没有匹配工具";
    const emptyDescription = feedTab === "custom" ? "点击右上角“+”新建一个工具。" : "换一个分类或关键词继续搜索。";
    const preview = previewTool ? resolveToolPreview(previewTool) : null;

    return (
        <>
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2.5">
                <Wrench className="size-3.5 shrink-0" />
                <span className="truncate text-xs font-semibold">工具</span>
                <span className="tabular-nums text-foreground/32">{totalCount.toLocaleString("zh-CN")}</span>
            </header>

            <div className="sidebar-subtabs shrink-0 border-b border-border/70">
                {TOOL_SUB_TABS.map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        className={subTab === tab.id ? "active" : ""}
                        aria-pressed={subTab === tab.id}
                        onClick={() => {
                            setSubTab(tab.id);
                            setTagFilter("");
                        }}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            <div className="asset-filters shrink-0 border-b border-border/70 px-2 py-1.5">
                <div className="col-feed-tabs">
                    {FEED_TABS.map((tab) => (
                        <button key={tab.id} type="button" className={`col-feed-tab${feedTab === tab.id ? " on" : ""}`} aria-pressed={feedTab === tab.id} onClick={() => setFeedTab(tab.id)}>
                            {tab.label}
                        </button>
                    ))}
                    <span className="asset-head-actions">
                        <button type="button" className="icon-btn tip-down" data-tip={`新建${subTabLabel}`} aria-label={`新建${subTabLabel}`} onClick={() => setCreateOpen(true)}>
                            <Plus className="size-3.5" />
                        </button>
                    </span>
                </div>
                <div className="asset-filter-row mt-1.5">
                    <input className="asset-search" placeholder="搜索名称/标签" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} aria-label="搜索工具" />
                    {searchInput ? (
                        <button type="button" className="grid size-5 shrink-0 place-items-center rounded text-foreground/32 hover:bg-surface-hover hover:text-foreground" onClick={() => setSearchInput("")} aria-label="清空搜索">
                            <X className="size-3" />
                        </button>
                    ) : null}
                </div>
                <div className="col-tag-filter mt-1.5">
                    {tagChips.map((tag) => (
                        <button key={tag.id || "all"} type="button" className={`col-tag-chip${tagFilter === tag.id ? " on" : ""}`} aria-pressed={tagFilter === tag.id} onClick={() => setTagFilter(tag.id)}>
                            {tag.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain p-2" onScroll={handleScroll}>
                {toolsQuery.isLoading ? (
                    <ToolGridSkeleton />
                ) : toolsQuery.isError ? (
                    <WorkspaceErrorState compact description={toolsQuery.error instanceof Error ? toolsQuery.error.message : undefined} onRetry={() => void toolsQuery.refetch()} />
                ) : tools.length ? (
                    <>
                        <div className="grid grid-cols-2 gap-1.5">
                            {tools.map((tool) => (
                                <ToolPresetCard
                                    key={tool.id}
                                    tool={tool}
                                    feedTabLabel={feedTabLabel}
                                    favoritePending={favoriteMutation.isPending}
                                    onInsert={onInsert}
                                    onView={setPreviewTool}
                                    onToggleFavorite={(item) => favoriteMutation.mutate({ id: item.id, favorite: !item.favorited })}
                                    onDelete={confirmDelete}
                                />
                            ))}
                        </div>
                        {toolsQuery.isFetchingNextPage ? (
                            <div className="flex items-center justify-center gap-1.5 py-3 text-[11px] text-foreground/45">
                                <Loader2 className="size-3.5 animate-spin" />
                                正在加载…
                            </div>
                        ) : null}
                    </>
                ) : (
                    <WorkspaceState icon="canvas" compact title={emptyTitle} description={emptyDescription} />
                )}
            </div>

            {previewTool && preview ? (
                preview.kind === "video" ? (
                    <AppModal flush open title={previewTool.label} onCancel={() => setPreviewTool(null)} footer={null} width="min(1200px, calc(100vw - 32px))">
                        <VideoPlayer src={preview.src} title={previewTool.label || "视频预览"} className="max-h-[84vh] max-w-full bg-black" />
                    </AppModal>
                ) : (
                    <CanvasImagePreview src={preview.src} alt={previewTool.label} onClose={() => setPreviewTool(null)} />
                )
            ) : null}

            <AppModal
                open={createOpen}
                title={`新建${subTabLabel}`}
                okText="创建"
                cancelText="取消"
                confirmLoading={createMutation.isPending}
                onCancel={() => setCreateOpen(false)}
                onOk={() => createForm.submit()}
                afterClose={() => createForm.resetFields()}
            >
                <Form<CreateToolFormValues> form={createForm} layout="vertical" requiredMark={false} initialValues={{ visibility: "private" }} onFinish={(values) => createMutation.mutate(values)} className="max-h-[72vh] overflow-y-auto p-6 px-8">
                    <Form.Item name="label" label="名称" rules={[{ required: true, whitespace: true, message: "请输入工具名称" }, { max: 120 }]}>
                        <Input maxLength={120} showCount placeholder="例如：电影感胶片" />
                    </Form.Item>
                    <div className="grid grid-cols-2 gap-3">
                        <Form.Item name="tag" label="标签">
                            {tagOptions.length ? <Select allowClear showSearch options={tagOptions} placeholder="选择标签" /> : <Input maxLength={64} placeholder="可选" />}
                        </Form.Item>
                        <p className="text-xs text-muted-foreground">预览仅支持本人上传的资源；公开工具请移除私人预览。</p>
                        <Form.Item name="visibility" label="可见性">
                            <Radio.Group
                                optionType="button"
                                buttonStyle="solid"
                                options={[
                                    { label: "私有", value: "private" },
                                    { label: "公开", value: "public" },
                                ]}
                            />
                        </Form.Item>
                    </div>
                    <Form.Item name="desc" label="描述" rules={[{ max: 500 }]}>
                        <Input.TextArea rows={2} maxLength={500} showCount autoSize={{ minRows: 2, maxRows: 4 }} />
                    </Form.Item>
                    <Form.Item name="prompt" label="提示词" rules={[{ required: true, whitespace: true, message: "请输入提示词" }, { max: 8000 }]}>
                        <Input.TextArea rows={5} maxLength={8000} showCount placeholder="该工具应用到生成节点时使用的提示词" />
                    </Form.Item>
                    <Form.Item label="封面图">
                        <Space.Compact block>
                            <Form.Item name="cover" noStyle className="flex-1 min-w-0" rules={[{ type: "url", message: "请输入合法 URL" }]}>
                                <Input placeholder="上传图片或粘贴 URL" allowClear disabled={coverUploading} />
                            </Form.Item>
                            <Button icon={<Upload className="size-3.5" />} loading={coverUploading} onClick={() => coverInputRef.current?.click()}>
                                上传
                            </Button>
                        </Space.Compact>
                    </Form.Item>
                    {HOVER_VIDEO_TYPES.has(activeType) ? (
                        <Form.Item label="演示视频">
                            <Space.Compact block>
                                <Form.Item name="mediaUrl" noStyle className="flex-1 min-w-0" rules={[{ type: "url", message: "请输入合法 URL" }]}>
                                    <Input placeholder="上传视频或粘贴 URL" allowClear disabled={mediaUploading} />
                                </Form.Item>
                                <Button icon={<Upload className="size-3.5" />} loading={mediaUploading} onClick={() => mediaInputRef.current?.click()}>
                                    上传
                                </Button>
                            </Space.Compact>
                        </Form.Item>
                    ) : null}
                    <input
                        ref={coverInputRef}
                        type="file"
                        accept="image/*"
                        style={{ display: "none" }}
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = "";
                            if (file) void handleCoverUpload(file);
                        }}
                    />
                    {HOVER_VIDEO_TYPES.has(activeType) ? (
                        <input
                            ref={mediaInputRef}
                            type="file"
                            accept="video/*"
                            style={{ display: "none" }}
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.target.value = "";
                                if (file) void handleMediaUpload(file);
                            }}
                        />
                    ) : null}
                    {/* <Form.Item name="ratio" label="比例" rules={[{ max: 32 }]}>
                        <Input placeholder="可选，例如 original、16:9" />
                    </Form.Item> */}
                </Form>
            </AppModal>
        </>
    );
}

const ToolGridSkeleton = memo(function ToolGridSkeleton() {
    return (
        <div className="grid grid-cols-2 gap-1.5" aria-busy="true" aria-live="polite">
            {Array.from({ length: 8 }, (_, index) => (
                <div key={index} className="flex flex-col gap-1 p-1.5">
                    <div className="aspect-[4/3] w-full animate-pulse rounded-[var(--r-sm)] bg-surface-active" />
                    <div className="h-3 w-3/4 animate-pulse rounded bg-surface-active" />
                </div>
            ))}
        </div>
    );
});

const ToolPresetCard = memo(function ToolPresetCard({
    tool,
    feedTabLabel,
    favoritePending,
    onInsert,
    onView,
    onToggleFavorite,
    onDelete,
}: {
    tool: ToolSummary;
    feedTabLabel: string;
    favoritePending: boolean;
    onInsert?: (tool: ToolSummary) => void;
    onView?: (tool: ToolSummary) => void;
    onToggleFavorite?: (tool: ToolSummary) => void;
    onDelete?: (tool: ToolSummary) => void;
}) {
    const [failed, setFailed] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [hovered, setHovered] = useState(false);
    const [videoReady, setVideoReady] = useState(false);
    const [videoFailed, setVideoFailed] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const commonStyle = { borderColor: "color-mix(in srgb, var(--foreground) 9%, transparent)", background: "color-mix(in srgb, var(--foreground) 5%, transparent)" };
    const coverUrl = toAbsoluteUrl(tool.cover);
    const reduceMotion = useMemo(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
    const mediaAbsoluteUrl = toAbsoluteUrl(tool.mediaUrl);
    const hoverVideoUrl = mediaAbsoluteUrl && isVideoUrl(mediaAbsoluteUrl) ? mediaAbsoluteUrl : "";
    const showHoverVideo = !reduceMotion && HOVER_VIDEO_TYPES.has(tool.type) && Boolean(hoverVideoUrl) && !videoFailed;

    useEffect(() => {
        if (!menuOpen) return;
        const handler = (e: PointerEvent) => {
            const target = e.target instanceof Element ? e.target : null;
            if (target && !rootRef.current?.contains(target) && !target.closest(".ant-dropdown")) {
                setMenuOpen(false);
            }
        };
        document.addEventListener("pointerdown", handler, true);
        return () => document.removeEventListener("pointerdown", handler, true);
    }, [menuOpen]);

    // 视频只在悬停时挂载；浏览器自动播放策略要求静音，React 首次渲染的 muted 属性不一定写入 DOM 属性，需手动赋值后再 play。
    useEffect(() => {
        if (!hovered || !showHoverVideo) {
            setVideoReady(false);
            return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.muted = true;
        // 缓存命中时 canplay 可能已派发，直接按 readyState 标记可淡入。
        if (video.readyState >= 3) setVideoReady(true);
        const handle = window.setTimeout(() => {
            void video.play().catch(() => {});
        }, 0);
        return () => window.clearTimeout(handle);
    }, [hovered, showHoverVideo]);

    const menuItems: MenuProps["items"] = useMemo(() => {
        const items: NonNullable<MenuProps["items"]> = [];
        items.push({ key: "insert", icon: <Plus className="size-3.5" />, label: "插入画布", onClick: () => onInsert?.(tool) });
        items.push({ key: "view", icon: <Eye className="size-3.5" />, label: "查看", onClick: () => onView?.(tool) });
        items.push({ type: "divider" as const });
        items.push({
            key: "favorite",
            icon: <Star className={tool.favorited ? "size-3.5 fill-current" : "size-3.5"} />,
            label: tool.favorited ? "取消收藏" : "收藏",
            onClick: () => onToggleFavorite?.(tool),
        });
        if (tool.source === "user" && tool.ownerId === useUserStore.getState().user?.id) {
            items.push({ type: "divider" as const });
            items.push({ key: "delete", danger: true, icon: <Trash2 className="size-3.5" />, label: "删除", onClick: () => onDelete?.(tool) });
        }
        return items;
    }, [tool, onInsert, onView, onToggleFavorite, onDelete]);

    return (
        <div
            ref={rootRef}
            className="group relative flex flex-col gap-1 rounded-[var(--r-md)] border p-1.5 text-left transition-[background-color] hover:bg-[var(--surface-hover)] focus-within:ring-2 focus-within:ring-primary/35"
            style={commonStyle}
            onMouseEnter={() => {
                if (showHoverVideo) setHovered(true);
            }}
            onMouseLeave={() => setHovered(false)}
            onContextMenu={(e) => {
                e.preventDefault();
                setMenuOpen(true);
            }}
        >
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[var(--r-sm)] border" style={commonStyle}>
                {coverUrl && !failed ? (
                    <img src={coverUrl} alt="" loading="lazy" decoding="async" className="asset-thumb h-full w-full object-cover" onError={() => setFailed(true)} />
                ) : (
                    <div className="grid h-full w-full place-items-center text-foreground/30">
                        <Wrench className="size-4" />
                    </div>
                )}
                {/* 悬停播放的预览视频：仅 hover 时挂载，静音/循环/内联满足各浏览器自动播放策略，首帧就绪后淡入覆盖封面 */}
                {showHoverVideo && hovered ? (
                    <video
                        ref={videoRef}
                        src={hoverVideoUrl}
                        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ease-out ${videoReady ? "opacity-100" : "opacity-0"}`}
                        muted
                        playsInline
                        loop
                        autoPlay
                        preload="auto"
                        aria-hidden="true"
                        onCanPlay={() => setVideoReady(true)}
                        onError={() => setVideoFailed(true)}
                    />
                ) : null}
                {/* 左上角标签 */}
                <span className="absolute left-1 top-1 rounded-[var(--r-sm)] bg-black/40 px-1.5 py-0.5 text-[9px] font-medium leading-3 text-white backdrop-blur-sm">{feedTabLabel}</span>
                {/* 右上角操作按钮 */}
                <span className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                        type="button"
                        className="grid size-5 place-items-center rounded-[var(--r-sm)] bg-black/40 text-white backdrop-blur-sm hover:bg-black/55"
                        aria-label="查看"
                        title="查看"
                        onClick={(e) => {
                            e.stopPropagation();
                            onView?.(tool);
                        }}
                    >
                        <Eye className="size-3" />
                    </button>
                    <button
                        type="button"
                        disabled={favoritePending}
                        className="grid size-5 place-items-center rounded-[var(--r-sm)] bg-black/40 text-white backdrop-blur-sm hover:bg-black/55 disabled:opacity-60"
                        aria-label={tool.favorited ? "取消收藏" : "收藏"}
                        title={tool.favorited ? "取消收藏" : "收藏"}
                        aria-pressed={tool.favorited}
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleFavorite?.(tool);
                        }}
                    >
                        <Star className={tool.favorited ? "size-3 fill-current text-amber-300" : "size-3"} />
                    </button>
                    <Dropdown trigger={["click"]} menu={{ items: menuItems }} open={menuOpen} onOpenChange={setMenuOpen} autoAdjustOverflow>
                        <button
                            type="button"
                            className="grid size-5 place-items-center rounded-[var(--r-sm)] bg-black/40 text-white backdrop-blur-sm hover:bg-black/55"
                            aria-label="更多操作"
                            title="更多"
                            onClick={(e) => {
                                e.stopPropagation();
                            }}
                        >
                            <MoreHorizontal className="size-3" />
                        </button>
                    </Dropdown>
                </span>
            </div>
            <span className="truncate text-[11px] font-medium leading-4 text-foreground">{tool.label}</span>
            {tool.desc ? <span className="truncate text-[10px] leading-3 text-foreground/40">{tool.desc}</span> : null}
        </div>
    );
});
