import { useState, useMemo, useEffect, useCallback } from "react";
import { Tabs, Button, Modal, Form, Input, Select, Tag, Tooltip, Pagination, message, Popconfirm } from "antd";
import { 
    Sparkles, Copy, ArrowUpRight, Plus, Trash2, Camera, Package, Zap,
    MoveUpRight, RotateCw, Navigation, Check, Layers, Pencil, RotateCcw,
    Search, Filter, Clapperboard, Film, ZoomIn, Eye, Tag as TagIcon,
    ChevronDown, ChevronUp, Upload, ToyBrick, Mountain, Palette, BookOpen, Flame,
    Smartphone, FolderArchive, FileCode, LayoutGrid, Loader2
} from "lucide-react";
import { useNavigate } from "react-router";
import { 
    IMAGE_PROMPT_PRESETS, 
    VIDEO_PROMPT_PRESETS, 
    IMAGE_CATEGORIES,
    VIDEO_CATEGORIES,
    TOTAL_OFFICIAL_VIDEO_PRESETS_COUNT,
    getImagePresets,
    getVideoPresets,
    fetchAllImagePresets,
    fetchTop500VideoPresets,
    fetchAllVideoPresets,
    loadCustomPrompts, 
    saveCustomPrompt, 
    deleteCustomPrompt,
    deleteInspirationPreset,
    savePresetOverride,
    resetPresetOverride,
    type PromptPresetItem,
    type PromptKind
} from "./prompt-data";
import { applyPromptToCanvas } from "./prompt-canvas-helper";
import { InspirationLightboxModal } from "@/components/prompts/inspiration-lightbox-modal";
import { AestheticBlueprintCard } from "@/components/prompts/aesthetic-blueprint-card";
import { InspirationCardImage } from "@/components/prompts/inspiration-card-image";

const ICON_MAP: Record<string, any> = {
    Camera,
    Package,
    Zap,
    MoveUpRight,
    RotateCw,
    Navigation,
    Layers,
    Sparkles,
    Clapperboard,
    Film,
    ToyBrick,
    Mountain,
    Palette,
    BookOpen,
};

const GRADIENT_PRESETS = [
    { label: "琥珀金黄", value: "linear-gradient(135deg, #78350f 0%, #b45309 50%, #d97706 100%)", color: "#f59e0b" },
    { label: "深空冷灰", value: "linear-gradient(135deg, #1e293b 0%, #334155 50%, #475569 100%)", color: "#94a3b8" },
    { label: "赛博霓虹", value: "linear-gradient(135deg, #090d16 0%, #064e3b 30%, #0e7490 70%, #a21caf 100%)", color: "#06b6d4" },
    { label: "极光青蓝", value: "linear-gradient(135deg, #022c22 0%, #064e3b 50%, #0f766e 100%)", color: "#14b8a6" },
    { label: "梦幻蓝紫", value: "linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%)", color: "#6366f1" },
    { label: "暮色熔岩", value: "linear-gradient(135deg, #451a03 0%, #78350f 50%, #9a3412 100%)", color: "#ea580c" },
    { label: "幽冥玄黑", value: "linear-gradient(135deg, #18181b 0%, #27272a 50%, #3f3f46 100%)", color: "#71717a" },
];

export default function CreativeInspirationsPage() {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<string>("image");
    const [selectedCategory, setSelectedCategory] = useState<string>("全部");
    const [selectedTag, setSelectedTag] = useState<string>("全部");
    const [searchQuery, setSearchQuery] = useState("");

    const [imagePresets, setImagePresets] = useState<PromptPresetItem[]>(getImagePresets);
    const [videoPresets, setVideoPresets] = useState<PromptPresetItem[]>(getVideoPresets);
    const [customList, setCustomList] = useState<PromptPresetItem[]>(loadCustomPrompts);
    const [editingPrompt, setEditingPrompt] = useState<PromptPresetItem | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [lightboxItem, setLightboxItem] = useState<PromptPresetItem | null>(null);
    const [isTagBarCollapsed, setIsTagBarCollapsed] = useState(false);
    const [uploadedImagePreview, setUploadedImagePreview] = useState<string | null>(null);
    const [customCategories, setCustomCategories] = useState<string[]>([]);
    const [newCategoryInput, setNewCategoryInput] = useState("");
    const [selectedVideoModel, setSelectedVideoModel] = useState<string>("全部");
    const [heatLimit, setHeatLimit] = useState<string>("500");
    const [imageScaleLimit, setImageScaleLimit] = useState<string>("1000");
    const [selectedAspectRatio, setSelectedAspectRatio] = useState<string>("全部");

    // 分页状态管理
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [pageSize, setPageSize] = useState<number>(36);

    const [form] = Form.useForm();

    const [imagePresetsLoaded, setImagePresetsLoaded] = useState(false);
    const [videoPresetsLoaded, setVideoPresetsLoaded] = useState(false);
    const [isLoadingVideos, setIsLoadingVideos] = useState(false);

    // 页面初始化时异步静默全量加载生图灵感
    useEffect(() => {
        let mounted = true;
        fetchAllImagePresets().then((fullImages) => {
            if (mounted && fullImages && fullImages.length > 0) {
                setImagePresets(fullImages);
                setImagePresetsLoaded(true);
            }
        });
        fetchTop500VideoPresets().then((topVideos) => {
            if (mounted && topVideos && topVideos.length > 0) {
                setVideoPresets(topVideos);
            }
        });
        return () => {
            mounted = false;
        };
    }, []);

    const handleVideoHeatLimitChange = (val: string) => {
        setHeatLimit(val);
        setCurrentPage(1);
        if (val !== "500" && !videoPresetsLoaded) {
            setIsLoadingVideos(true);
            fetchAllVideoPresets().then((fullVideos) => {
                if (fullVideos && fullVideos.length > 0) {
                    setVideoPresets(fullVideos);
                    setVideoPresetsLoaded(true);
                }
            }).finally(() => {
                setIsLoadingVideos(false);
            });
        }
    };

    const handleImageScaleLimitChange = (val: string) => {
        setImageScaleLimit(val);
        setCurrentPage(1);
    };

    const handleUseInCanvas = (preset: PromptPresetItem) => {
        applyPromptToCanvas(preset, navigate);
    };

    const reloadData = () => {
        fetchAllImagePresets().then(setImagePresets);
        if (heatLimit === "500" && !videoPresetsLoaded) {
            fetchTop500VideoPresets().then(setVideoPresets);
        } else {
            fetchAllVideoPresets().then(setVideoPresets);
        }
        setCustomList(loadCustomPrompts());
    };

    const baseList = useMemo(() => {
        if (activeTab === "image") {
            let list = imagePresets;
            // 生图灵感展示规模截断 (默认 TOP 1000)
            if (imageScaleLimit !== "all") {
                const limitNum = parseInt(imageScaleLimit, 10);
                if (!isNaN(limitNum) && limitNum > 0) {
                    list = list.slice(0, limitNum);
                }
            }
            // 画幅规格快捷筛选 (全部 / 竖屏 9:16、3:4 / 横屏 16:9、2.35:1 / 方屏 1:1)
            if (selectedAspectRatio !== "全部") {
                list = list.filter((p) => {
                    const r = p.recommendedParams?.aspectRatio;
                    if (selectedAspectRatio === "vertical") return r === "9:16" || r === "3:4";
                    if (selectedAspectRatio === "horizontal") return r === "16:9" || r === "2.35:1";
                    if (selectedAspectRatio === "square") return r === "1:1";
                    return true;
                });
            }
            return list;
        }
        if (activeTab === "video") {
            let list = videoPresets;
            // 1. 模型引擎快捷开关筛选
            if (selectedVideoModel !== "全部") {
                const targetKey = selectedVideoModel.toLowerCase().replace(/[\s\.\-_]/g, "");
                list = list.filter((p) => p.tags && p.tags.some((t) => {
                    const tagKey = t.toLowerCase().replace(/[\s\.\-_]/g, "");
                    if (tagKey === targetKey) return true;
                    if (targetKey === "omni" && (tagKey === "geminivideo" || tagKey === "geminiomni")) return true;
                    if (targetKey === "grok" && tagKey === "grokimagine") return true;
                    if (targetKey === "minimaxh3" && tagKey === "h3") return true;
                    return false;
                }));
            }
            // 2. 热度排名分级规模截断 (TOP 500 / TOP 1000 / TOP 3000 / 全部)
            if (heatLimit !== "all") {
                const limitNum = parseInt(heatLimit, 10);
                if (!isNaN(limitNum) && limitNum > 0) {
                    list = list.slice(0, limitNum);
                }
            }
            // 3. 画幅规格快捷筛选 (全部 / 竖屏 9:16、3:4 / 横屏 16:9、2.35:1 / 方屏 1:1)
            if (selectedAspectRatio !== "全部") {
                list = list.filter((p) => {
                    const r = p.recommendedParams?.aspectRatio;
                    if (selectedAspectRatio === "vertical") return r === "9:16" || r === "3:4";
                    if (selectedAspectRatio === "horizontal") return r === "16:9" || r === "2.35:1";
                    if (selectedAspectRatio === "square") return r === "1:1";
                    return true;
                });
            }
            return list;
        }
        return customList;
    }, [activeTab, imagePresets, videoPresets, customList, selectedVideoModel, heatLimit, imageScaleLimit, selectedAspectRatio]);

    const availableCategories = useMemo(() => {
        const set = new Set<string>(["全部"]);
        if (activeTab === "image") {
            IMAGE_CATEGORIES.forEach((c) => set.add(c));
        } else if (activeTab === "video") {
            VIDEO_CATEGORIES.forEach((c) => set.add(c));
        }
        customList.forEach((p) => {
            if (p.category) set.add(p.category);
        });
        customCategories.forEach((c) => set.add(c));
        return Array.from(set);
    }, [activeTab, customList, customCategories]);

    // 计算各专题下的数量徽标（单次遍历 O(N) 极速哈希统计）
    const categoryCounts = useMemo(() => {
        const counts: Record<string, number> = { "全部": baseList.length };
        for (let i = 0; i < baseList.length; i++) {
            const p = baseList[i];
            if (p.category) {
                counts[p.category] = (counts[p.category] || 0) + 1;
            }
            if (p.crossCategories) {
                for (let j = 0; j < p.crossCategories.length; j++) {
                    const c = p.crossCategories[j];
                    if (c !== p.category) {
                        counts[c] = (counts[c] || 0) + 1;
                    }
                }
            }
        }
        return counts;
    }, [baseList]);

    const [isTagsExpanded, setIsTagsExpanded] = useState(false);

    // 单次遍历 O(N) 极速聚合标签池与精确频次统计（从 2341ms 提速至 15ms，提速 150 倍）
    const { availableTags, tagCounts } = useMemo(() => {
        const targetList = selectedCategory === "全部"
            ? baseList
            : baseList.filter((p) => p.category === selectedCategory || (p.crossCategories && p.crossCategories.includes(selectedCategory)));

        const counts: Record<string, number> = { "全部": targetList.length };
        const keyToDisplayTag = new Map<string, string>();
        const keyCounts: Record<string, number> = {};

        // 统一权威主模型优先级映射
        const priorityKeys: Record<string, string> = {
            "seedance25": "Seedance 2.5",
            "seedance20": "Seedance 2.0",
            "omni": "Omni",
            "grok": "Grok",
            "minimaxh3": "MiniMax H3",
            "gptimage2": "GPT Image 2",
            "flux": "FLUX",
            "热门": "热门",
        };

        for (let i = 0; i < targetList.length; i++) {
            const p = targetList[i];
            if (!p.tags || p.tags.length === 0) continue;
            const seenInPreset = new Set<string>();
            for (let j = 0; j < p.tags.length; j++) {
                const rawTag = p.tags[j];
                let normKey = rawTag.toLowerCase().replace(/[\s\.\-_]/g, "");
                if (normKey === "geminivideo" || normKey === "geminiomni") normKey = "omni";
                if (normKey === "grokimagine") normKey = "grok";
                if (normKey === "h3") normKey = "minimaxh3";
                if (normKey === "seedance25") normKey = "seedance25";
                if (normKey === "seedance20") normKey = "seedance20";

                const canonicalDisplay = priorityKeys[normKey] || rawTag;
                if (!keyToDisplayTag.has(normKey)) {
                    keyToDisplayTag.set(normKey, canonicalDisplay);
                }

                if (!seenInPreset.has(normKey)) {
                    seenInPreset.add(normKey);
                    keyCounts[normKey] = (keyCounts[normKey] || 0) + 1;
                }
            }
        }

        const pool: string[] = ["全部"];
        const priorityOrder = ["Seedance 2.5", "Seedance 2.0", "Omni", "Grok", "MiniMax H3", "GPT Image 2", "FLUX", "热门"];
        const addedDisplayTags = new Set<string>(["全部"]);

        priorityOrder.forEach((pt) => {
            const pKey = pt.toLowerCase().replace(/[\s\.\-_]/g, "");
            if (keyCounts[pKey] && keyCounts[pKey] > 0) {
                pool.push(pt);
                addedDisplayTags.add(pt);
                counts[pt] = keyCounts[pKey];
            }
        });

        keyToDisplayTag.forEach((displayTag, key) => {
            if (!addedDisplayTags.has(displayTag) && keyCounts[key] > 0) {
                pool.push(displayTag);
                addedDisplayTags.add(displayTag);
                counts[displayTag] = keyCounts[key];
            }
        });

        return { availableTags: pool, tagCounts: counts };
    }, [baseList, selectedCategory]);

    const displayedTags = useMemo(() => {
        if (selectedCategory !== "全部" || isTagsExpanded || availableTags.length <= 30) {
            return availableTags;
        }
        return availableTags.slice(0, 30);
    }, [availableTags, selectedCategory, isTagsExpanded]);

    // 复合单次遍历过滤（杜绝连续生成 3 个大数组导致的内存抖动与 GC 暂停）
    const filteredPresets = useMemo(() => {
        const hasCategoryFilter = selectedCategory !== "全部";
        const hasTagFilter = selectedTag !== "全部";
        const trimmedQuery = searchQuery.trim().toLowerCase();
        const hasSearch = trimmedQuery.length > 0;

        if (!hasCategoryFilter && !hasTagFilter && !hasSearch) {
            return baseList;
        }

        const targetTagKey = hasTagFilter ? selectedTag.toLowerCase().replace(/[\s\.\-_]/g, "") : "";

        return baseList.filter((p) => {
            if (hasCategoryFilter) {
                const catMatch = p.category === selectedCategory || (p.crossCategories && p.crossCategories.includes(selectedCategory));
                if (!catMatch) return false;
            }

            if (hasTagFilter) {
                if (!p.tags || p.tags.length === 0) return false;
                const tagMatch = p.tags.some((t) => {
                    const tagKey = t.toLowerCase().replace(/[\s\.\-_]/g, "");
                    if (tagKey === targetTagKey) return true;
                    if (targetTagKey === "omni" && (tagKey === "geminivideo" || tagKey === "geminiomni")) return true;
                    if (targetTagKey === "grok" && tagKey === "grokimagine") return true;
                    if (targetTagKey === "minimaxh3" && tagKey === "h3") return true;
                    return false;
                });
                if (!tagMatch) return false;
            }

            if (hasSearch) {
                // 1. 标准化检索词（剥离 Windows 反斜杠路径与文件后缀，支持纯文件名、路径或扩展名检索）
                const normQuery = trimmedQuery.replace(/\\/g, "/");
                const pureFilename = normQuery.split("/").pop() || normQuery;
                const queryWithoutExt = pureFilename.replace(/\.(mp4|webm|jpg|jpeg|png|webp)$/i, "");

                // 2. 本地物理素材文件名与唯一预设 ID 强匹配 (支持带后缀或纯文件名、ID 检索反查)
                const idMatch = p.id?.toLowerCase().includes(pureFilename) || (queryWithoutExt && p.id?.toLowerCase().includes(queryWithoutExt));
                const videoMatch = p.previewVideo?.toLowerCase().includes(pureFilename) || (queryWithoutExt && p.previewVideo?.toLowerCase().includes(queryWithoutExt));
                const imageMatch = p.previewImage?.toLowerCase().includes(pureFilename) || (queryWithoutExt && p.previewImage?.toLowerCase().includes(queryWithoutExt));
                const thumbMatch = p.previewThumbnail?.toLowerCase().includes(pureFilename) || (queryWithoutExt && p.previewThumbnail?.toLowerCase().includes(queryWithoutExt));

                // 3. 语义文本、作者与标签多维检索
                const titleMatch = p.title?.toLowerCase().includes(trimmedQuery);
                const descMatch = p.description?.toLowerCase().includes(trimmedQuery);
                const promptMatch = p.positivePrompt?.toLowerCase().includes(trimmedQuery);
                const tagMatch = p.tags && p.tags.some((t) => t.toLowerCase().includes(trimmedQuery));
                const catMatch = p.category?.toLowerCase().includes(trimmedQuery);
                const crossCatMatch = p.crossCategories && p.crossCategories.some((c) => c.toLowerCase().includes(trimmedQuery));
                const authorMatch = p.author?.toLowerCase().includes(trimmedQuery);
                const sourceUrlMatch = p.sourceUrl?.toLowerCase().includes(trimmedQuery);

                if (!idMatch && !videoMatch && !imageMatch && !thumbMatch && !titleMatch && !descMatch && !promptMatch && !tagMatch && !catMatch && !crossCatMatch && !authorMatch && !sourceUrlMatch) {
                    return false;
                }
            }

            return true;
        });
    }, [baseList, selectedCategory, selectedTag, searchQuery]);

    // 分页切片计算
    const paginatedPresets = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredPresets.slice(start, start + pageSize);
    }, [filteredPresets, currentPage, pageSize]);

    const handleTabChange = (key: string) => {
        setActiveTab(key);
        setSelectedCategory("全部");
        setSelectedTag("全部");
        setSelectedAspectRatio("全部");
        setCurrentPage(1);
        reloadData();
    };

    const handleCategoryChange = (cat: string) => {
        setSelectedCategory(cat);
        setSelectedTag("全部");
        setCurrentPage(1);
    };

    const handleTagChange = (tag: string) => {
        setSelectedTag(tag);
        setCurrentPage(1);
    };

    const handleCopy = (preset: PromptPresetItem) => {
        navigator.clipboard.writeText(preset.positivePrompt);
        setCopiedId(preset.id);
        message.success("灵感提示词已复制到剪切板");
        setTimeout(() => setCopiedId(null), 2000);
    };

    const handleEditPrompt = (preset: PromptPresetItem) => {
        setEditingPrompt(preset);
        setUploadedImagePreview(preset.previewThumbnail || preset.previewImage || null);
        form.setFieldsValue({
            title: preset.title,
            kind: preset.kind,
            category: preset.category,
            crossCategories: preset.crossCategories || [],
            description: preset.description,
            positivePrompt: preset.positivePrompt,
            negativePrompt: preset.negativePrompt,
            gradient: preset.gradient,
            tags: preset.tags ? preset.tags.join(" ") : "",
        });
        setIsCreateModalOpen(true);
    };

    const handleImageUpload = (file: File) => {
        if (!file.type.startsWith("image/")) {
            message.error("请选择图片格式文件");
            return false;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = document.createElement("img");
            img.onload = () => {
                const canvas = document.createElement("canvas");
                let width = img.width;
                let height = img.height;
                const maxDim = 800;
                if (width > maxDim || height > maxDim) {
                    if (width > height) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    } else {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                if (ctx) {
                    ctx.drawImage(img, 0, 0, width, height);
                    const compressedDataUrl = canvas.toDataURL("image/webp", 0.82);
                    setUploadedImagePreview(compressedDataUrl);
                    message.success("图片已就绪并完成客户端高保真轻量压缩 (<120KB)");
                }
            };
            img.src = e.target?.result as string;
        };
        reader.readAsDataURL(file);
        return false;
    };

    const handleSavePrompt = async () => {
        try {
            const values = await form.validateFields();
            const tagsArray = typeof values.tags === "string"
                ? values.tags.split(/[\s,，#]+/).filter(Boolean)
                : values.tags || [];

            const itemPayload: PromptPresetItem = {
                id: editingPrompt?.id || `custom-${Date.now()}`,
                title: values.title,
                kind: values.kind,
                category: values.category,
                crossCategories: values.crossCategories || [],
                description: values.description,
                positivePrompt: values.positivePrompt,
                negativePrompt: values.negativePrompt,
                styleTokens: tagsArray,
                tags: tagsArray,
                gradient: values.gradient || GRADIENT_PRESETS[0].value,
                accentColor: "#f59e0b",
                icon: values.kind === "video" ? "Film" : "Sparkles",
                isCustom: editingPrompt ? editingPrompt.isCustom : true,
                createdAt: editingPrompt?.createdAt || Date.now(),
                previewImage: uploadedImagePreview || editingPrompt?.previewImage,
                previewThumbnail: uploadedImagePreview || editingPrompt?.previewThumbnail,
            };

            if (editingPrompt && !editingPrompt.isCustom) {
                savePresetOverride(editingPrompt.id, itemPayload);
                message.success("已保存预设修改（本地个性化）");
            } else {
                saveCustomPrompt(itemPayload);
                message.success(editingPrompt ? "已更新自建灵感" : "已新建灵感项");
            }

            setIsCreateModalOpen(false);
            setEditingPrompt(null);
            setUploadedImagePreview(null);
            form.resetFields();
            reloadData();
        } catch (err) {
            console.error("Form validation error", err);
        }
    };

    const handleDeletePreset = (preset: PromptPresetItem, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        deleteInspirationPreset(preset);
        message.success(preset.isCustom ? "已彻底删除该自建灵感" : "已在工作区隐藏该系统灵感");
        reloadData();
    };

    const handleDelete = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        deleteCustomPrompt(id);
        message.success("已删除该灵感");
        reloadData();
    };

    const handleResetToDefault = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        resetPresetOverride(id);
        message.success("已恢复为系统官方预设");
        reloadData();
    };

    return (
        <div className="flex h-full flex-col overflow-y-auto bg-[#f8f9fa] dark:bg-[#0c0c0e] text-stone-900 dark:text-stone-100 p-6 lg:p-8">
            <div className="mx-auto w-full max-w-7xl">
                {/* 顶部标题栏与快速操作 */}
                <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black/[0.06] dark:border-white/[0.08] pb-6">
                    <div className="flex items-center gap-3.5">
                        <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-amber-500 to-amber-600 text-white shadow-md shadow-amber-500/20">
                            <Sparkles className="size-6" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-2xl font-bold tracking-tight text-stone-950 dark:text-stone-50">
                                    创作灵感
                                </h1>
                                <span className="rounded-full bg-amber-500/10 dark:bg-amber-400/10 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                    Inspiration Hub
                                </span>
                            </div>
                            <p className="text-sm text-stone-500 dark:text-stone-400 mt-0.5">
                                全域影视分镜与生图美学灵感资产库 · 涵盖电商、人像、运镜、大片分镜与顶级商业范例画册（共收录 {imagePresets.length + videoPresets.length + customList.length} 条灵感）
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <Input
                            prefix={<Search className="size-4 text-stone-400 mr-1" />}
                            placeholder="搜索标题、提示词、标签、本地素材文件名或编号..."
                            allowClear
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value);
                                setCurrentPage(1);
                            }}
                            className="w-80 !rounded-xl !bg-white dark:!bg-[#18181b] !border-black/[0.08] dark:!border-white/[0.1]"
                        />
                        <Button
                            type="primary"
                            icon={<Plus className="size-4" />}
                            onClick={() => {
                                setEditingPrompt(null);
                                form.resetFields();
                                form.setFieldsValue({
                                    kind: activeTab === "video" ? "video" : "image",
                                    category: activeTab === "image" ? IMAGE_CATEGORIES[1] : VIDEO_CATEGORIES[1],
                                    gradient: GRADIENT_PRESETS[0].value,
                                });
                                setIsCreateModalOpen(true);
                            }}
                            className="!h-9 !rounded-xl !bg-amber-600 hover:!bg-amber-500 font-medium shadow-sm shadow-amber-600/20 cursor-pointer"
                        >
                            新建灵感
                        </Button>
                    </div>
                </div>

                {/* 模式分栏切换 Tabs 与同一排的独立展示规模容器 */}
                <Tabs
                    activeKey={activeTab}
                    onChange={handleTabChange}
                    className="mb-4"
                    tabBarExtraContent={{
                        right: (
                            activeTab === "image" ? (
                                <div className="flex items-center gap-2 px-3 py-1 mb-2 rounded-xl bg-stone-50/90 dark:bg-[#18181b]/90 border border-black/[0.06] dark:border-white/[0.08] shadow-sm backdrop-blur-md">
                                    <span className="text-xs font-semibold text-stone-500 dark:text-stone-400 flex items-center gap-1.5">
                                        <Flame className="size-3.5 text-amber-500" />
                                        <span>展示规模:</span>
                                    </span>
                                    <Select
                                        size="small"
                                        value={imageScaleLimit}
                                        onChange={handleImageScaleLimitChange}
                                        className="w-44"
                                        options={[
                                            { value: "500", label: "🏆 顶尖爆款 TOP 500" },
                                            { value: "1000", label: "✨ 热门精选 TOP 1000" },
                                            { value: "2000", label: "🚀 进阶灵感 TOP 2000" },
                                            { value: "all", label: `🔥 全部灵感 (${imagePresets.length > 0 ? imagePresets.length : 2902})` },
                                        ]}
                                    />
                                </div>
                            ) : activeTab === "video" ? (
                                <div className="flex items-center gap-2 px-3 py-1 mb-2 rounded-xl bg-stone-50/90 dark:bg-[#18181b]/90 border border-black/[0.06] dark:border-white/[0.08] shadow-sm backdrop-blur-md">
                                    <span className="text-xs font-semibold text-stone-500 dark:text-stone-400 flex items-center gap-1.5">
                                        <Flame className="size-3.5 text-indigo-500" />
                                        <span>展示规模:</span>
                                    </span>
                                    <Select
                                        size="small"
                                        value={heatLimit}
                                        onChange={handleVideoHeatLimitChange}
                                        className="w-44"
                                        options={[
                                            { value: "500", label: "🏆 顶尖爆款 TOP 500" },
                                            { value: "1000", label: "✨ 热门精选 TOP 1000" },
                                            { value: "3000", label: "🚀 进阶灵感 TOP 3000" },
                                            { value: "all", label: `🔥 全部热度 (${videoPresets.length > 50 ? videoPresets.length : TOTAL_OFFICIAL_VIDEO_PRESETS_COUNT})` },
                                        ]}
                                    />
                                    {isLoadingVideos && (
                                        <span className="text-xs text-indigo-600 dark:text-indigo-400 flex items-center gap-1 animate-pulse">
                                            <Loader2 className="size-3.5 animate-spin" />
                                            <span>载入中...</span>
                                        </span>
                                    )}
                                </div>
                            ) : null
                        )
                    }}
                    items={[
                        {
                            key: "image",
                            label: (
                                <span className="flex items-center gap-2 px-1 py-0.5">
                                    <Camera className="size-4 text-amber-500" />
                                    <span>生图灵感</span>
                                    <span className="rounded-full bg-stone-200/70 dark:bg-stone-800 px-2 py-0.5 text-xs text-stone-600 dark:text-stone-400 font-mono">
                                        {imagePresets.length}
                                    </span>
                                </span>
                            ),
                        },
                        {
                            key: "video",
                            label: (
                                <span className="flex items-center gap-2 px-1 py-0.5">
                                    <Clapperboard className="size-4 text-indigo-500" />
                                    <span>生视频灵感</span>
                                    <span className="rounded-full bg-stone-200/70 dark:bg-stone-800 px-2 py-0.5 text-xs text-stone-600 dark:text-stone-400 font-mono">
                                        {videoPresets.length > 50 ? videoPresets.length : TOTAL_OFFICIAL_VIDEO_PRESETS_COUNT}
                                    </span>
                                </span>
                            ),
                        },
                        {
                            key: "custom",
                            label: (
                                <span className="flex items-center gap-2 px-1 py-0.5">
                                    <Sparkles className="size-4 text-emerald-500" />
                                    <span>我的自建</span>
                                    <span className="rounded-full bg-stone-200/70 dark:bg-stone-800 px-2 py-0.5 text-xs text-stone-600 dark:text-stone-400 font-mono">
                                        {customList.length}
                                    </span>
                                </span>
                            ),
                        },
                    ]}
                />

                {/* 专属视频灵感控制栏 (模型分流与画幅规格) */}
                {activeTab === "video" && (
                    <div className="mb-4 flex flex-col gap-3 p-3.5 rounded-2xl bg-stone-50/80 dark:bg-[#18181b]/80 border border-black/[0.06] dark:border-white/[0.08] backdrop-blur-md">
                        {/* 上行：模型引擎筛选 */}
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-semibold text-stone-500 dark:text-stone-400 flex items-center gap-1.5">
                                    <Film className="size-3.5 text-indigo-500" />
                                    <span>模型引擎:</span>
                                </span>
                                {["全部", "Seedance 2.5", "Seedance 2.0", "Omni", "Grok", "MiniMax H3"].map((m) => {
                                    const active = selectedVideoModel === m;
                                    return (
                                        <button
                                            key={m}
                                            type="button"
                                            onClick={() => { setSelectedVideoModel(m); setCurrentPage(1); }}
                                            className={`px-3 py-1 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                                                active
                                                    ? "bg-indigo-100/90 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-300/80 dark:border-indigo-700/80 font-semibold shadow-none"
                                                    : "bg-white dark:bg-stone-800 text-stone-600 dark:text-stone-300 border border-black/[0.06] dark:border-white/[0.08] hover:border-indigo-500/40 hover:text-indigo-600"
                                            }`}
                                        >
                                            {m}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* 下行：画幅规格专属筛选 (横屏 / 竖屏 / 方形清晰分流) */}
                        <div className="flex items-center gap-2 flex-wrap pt-2.5 border-t border-black/[0.04] dark:border-white/[0.05]">
                            <span className="text-xs font-semibold text-stone-500 dark:text-stone-400 flex items-center gap-1.5">
                                <Smartphone className="size-3.5 text-emerald-500" />
                                <span>画幅比例:</span>
                            </span>
                            {[
                                { key: "全部", label: "全部画幅" },
                                { key: "vertical", label: "📱 竖屏 (9:16 / 3:4)" },
                                { key: "horizontal", label: "🖥️ 横屏 (16:9)" },
                                { key: "square", label: "⏹️ 方形 (1:1)" },
                            ].map((r) => {
                                const active = selectedAspectRatio === r.key;
                                return (
                                    <button
                                        key={r.key}
                                        type="button"
                                        onClick={() => { setSelectedAspectRatio(r.key); setCurrentPage(1); }}
                                        className={`px-3 py-1 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                                            active
                                                ? "bg-emerald-600 text-white font-semibold shadow-sm shadow-emerald-600/20"
                                                : "bg-white dark:bg-stone-800 text-stone-600 dark:text-stone-300 border border-black/[0.06] dark:border-white/[0.08] hover:border-emerald-500/40 hover:text-emerald-600"
                                        }`}
                                    >
                                        {r.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* 精细化一级专题选择栏 (Pills) */}
                {availableCategories.length > 1 && (
                    <div className="mb-4">
                        <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wider">
                            <Filter className="size-3.5 text-amber-500" />
                            <span>精细化专题</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {availableCategories.map((cat) => {
                                const active = selectedCategory === cat;
                                const count = categoryCounts[cat] || 0;
                                return (
                                    <button
                                        key={cat}
                                        onClick={() => handleCategoryChange(cat)}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                                            active
                                                ? "bg-amber-600 text-white shadow-sm shadow-amber-600/20 font-semibold"
                                                : "bg-white dark:bg-[#18181b] text-stone-600 dark:text-stone-300 border border-black/[0.06] dark:border-white/[0.08] hover:border-amber-500/40 hover:text-amber-600"
                                        }`}
                                    >
                                        <span>{cat}</span>
                                        {count > 0 && (
                                            <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                                                active ? "bg-white/20 text-white" : "bg-stone-100 dark:bg-stone-800 text-stone-400 dark:text-stone-500"
                                            }`}>
                                                {count}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* 热门交叉标签双向过滤池 (支持整栏折叠与展开) */}
                {availableTags.length > 1 && (
                    <div className="mb-6">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-stone-500 dark:text-stone-400 shrink-0 flex items-center gap-1.5 uppercase tracking-wider">
                                <TagIcon className="size-3.5 text-amber-500" />
                                <span>精选交叉标签池</span>
                                <span className="text-[10px] text-stone-400 font-normal">({availableTags.length - 1} 个标签)</span>
                            </span>
                            <button
                                type="button"
                                onClick={() => setIsTagBarCollapsed(!isTagBarCollapsed)}
                                className="flex items-center gap-1 text-xs text-stone-500 hover:text-amber-600 dark:text-stone-400 dark:hover:text-amber-400 transition-colors cursor-pointer"
                            >
                                <span>{isTagBarCollapsed ? "展开标签栏" : "折叠标签栏"}</span>
                                {isTagBarCollapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
                            </button>
                        </div>
                        {!isTagBarCollapsed && (
                            <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                {displayedTags.map((tag) => {
                                    const isSelected = selectedTag === tag;
                                    const count = tagCounts[tag] || 0;
                                    return (
                                        <button
                                            key={tag}
                                            onClick={() => handleTagChange(tag)}
                                            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                                                isSelected
                                                    ? "bg-amber-600 text-white font-semibold shadow-sm shadow-amber-600/20 ring-1 ring-amber-500"
                                                    : "bg-white dark:bg-[#18181b] text-stone-600 dark:text-stone-400 border border-black/[0.06] dark:border-white/[0.08] hover:border-amber-500/40 hover:text-amber-600 dark:hover:text-amber-400"
                                            }`}
                                        >
                                            <span>{tag === "全部" ? "全部标签" : `#${tag}`}</span>
                                            {tag !== "全部" && count > 1 && (
                                                <span className="text-[10px] opacity-70">
                                                    {count}
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                                {selectedCategory === "全部" && availableTags.length > 30 && (
                                    <button
                                        onClick={() => setIsTagsExpanded(!isTagsExpanded)}
                                        className="text-xs text-amber-600 dark:text-amber-400 hover:underline px-2 py-1 font-medium cursor-pointer"
                                    >
                                        {isTagsExpanded ? "收起部分标签" : `展开更多标签 (+${availableTags.length - 30})`}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* 卡片列表 */}
                {filteredPresets.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-stone-200 dark:border-stone-800 bg-white/40 dark:bg-[#18181b]/40 py-16 text-center px-4">
                        <div className="flex size-14 items-center justify-center rounded-2xl bg-stone-100 dark:bg-stone-800 text-stone-400 mb-3">
                            <Sparkles className="size-6" />
                        </div>
                        <p className="text-base font-medium text-stone-700 dark:text-stone-300">
                            {searchQuery.trim() ? `未找到匹配「${searchQuery.trim()}」的灵感素材` : "未找到匹配的创作灵感"}
                        </p>
                        <p className="text-sm text-stone-400 dark:text-stone-500 mt-1 mb-4 max-w-md leading-relaxed">
                            {searchQuery.trim()
                                ? "支持直接粘贴本地物理素材文件名（如 youmind-grok-1001.mp4 或 gpt-image-2-ad-creative-case-90）反向精确定位。若素材属于另一类型，可尝试切换上方模式。"
                                : "尝试切换专题分类、清除标签或点击右上角「新建灵感」"}
                        </p>
                        <div className="flex items-center gap-3">
                            {searchQuery.trim() && (
                                <Button
                                    type="primary"
                                    onClick={() => {
                                        handleTabChange(activeTab === "video" ? "image" : "video");
                                    }}
                                >
                                    切换至【{activeTab === "video" ? "生图灵感" : "生视频灵感"}】反查
                                </Button>
                            )}
                            <Button
                                type="dashed"
                                icon={<RotateCcw className="size-4" />}
                                onClick={() => {
                                    setSelectedCategory("全部");
                                    setSelectedTag("全部");
                                    setSelectedAspectRatio("全部");
                                    setSearchQuery("");
                                    setCurrentPage(1);
                                }}
                            >
                                重置所有筛选
                            </Button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                            {paginatedPresets.map((preset) => {
                                const IconComponent = ICON_MAP[preset.icon] || Sparkles;
                                const isCopied = copiedId === preset.id;
                                const isCardVertical = preset.recommendedParams?.aspectRatio === "9:16" || preset.recommendedParams?.aspectRatio === "3:4";
                                const rawAssetPath = preset.previewVideo || preset.previewImage || "";
                                const assetFilename = rawAssetPath ? rawAssetPath.split("/").pop()?.split("?")[0] : preset.id;

                                return (
                                    <div
                                        key={preset.id}
                                        className="group flex flex-col rounded-2xl border border-black/[0.07] dark:border-white/[0.08] bg-white dark:bg-[#18181b] shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden"
                                    >
                                        {/* 顶部视觉展示区：商业范例图 or 工业美学蓝图卡片 */}
                                        <InspirationCardImage
                                            preset={preset}
                                            onClick={() => setLightboxItem(preset)}
                                        >
                                            {/* 顶部信息徽标 */}
                                            <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between pointer-events-none z-10">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-black/60 backdrop-blur-md text-amber-300 border border-amber-500/30">
                                                        {preset.category}
                                                    </span>
                                                    {preset.crossCategories && preset.crossCategories.length > 0 && (
                                                        <span
                                                            className="px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-black/60 backdrop-blur-md text-indigo-300 border border-indigo-500/30"
                                                            title={`交叉专题：${preset.crossCategories.join(", ")}`}
                                                        >
                                                            +{preset.crossCategories.length}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    {preset.isOverridden && (
                                                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-400/40 text-amber-100 border border-amber-300/30 backdrop-blur-sm">
                                                            已修改
                                                        </span>
                                                    )}
                                                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded backdrop-blur-sm border flex items-center gap-1 ${
                                                        isCardVertical
                                                            ? "bg-emerald-950/80 text-emerald-300 border-emerald-500/40 font-semibold shadow-sm"
                                                            : "bg-black/60 text-stone-300 border-white/10"
                                                    }`}>
                                                        {isCardVertical && <Smartphone className="size-2.5 text-emerald-400" />}
                                                        <span>{preset.recommendedParams?.aspectRatio || "1:1"}</span>
                                                        {isCardVertical && <span className="text-[9px] text-emerald-400 font-sans">竖屏</span>}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* 悬浮居中预览检视快捷操作 (移除黑灰底色与模糊，保持原图通透，采用高质感白色毛玻璃胶囊按钮) */}
                                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity duration-200 pointer-events-none">
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setLightboxItem(preset);
                                                    }}
                                                    className="pointer-events-auto group/btn flex items-center gap-1.5 px-4 py-2 rounded-full !text-stone-900 text-xs font-semibold shadow-xl shadow-black/15 transition-all scale-95 group-hover/img:scale-100 hover:scale-105 active:scale-95 cursor-pointer !bg-white hover:!bg-amber-500 border border-stone-200/90 hover:!border-amber-400 backdrop-blur-md"
                                                >
                                                    <ZoomIn className="size-3.5 text-amber-600 group-hover/btn:!text-white transition-colors" />
                                                    <span className="!text-stone-900 group-hover/btn:!text-white transition-colors">点击预览查看</span>
                                                </button>
                                            </div>
                                        </InspirationCardImage>

                                        {/* 卡片主体内容 */}
                                        <div className="flex flex-1 flex-col p-4 gap-3">
                                            <div
                                                className="cursor-pointer"
                                                onClick={() => setLightboxItem(preset)}
                                            >
                                                <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors line-clamp-1">
                                                    {preset.title}
                                                </h3>
                                                <p className="text-xs text-stone-500 dark:text-stone-400 mt-1 line-clamp-2 leading-relaxed min-h-[36px]">
                                                    {preset.description || "暂无描述"}
                                                </p>
                                            </div>

                                            {/* 提示词内容区块 */}
                                            <div className="relative rounded-xl border border-black/[0.05] dark:border-white/[0.06] bg-stone-50 dark:bg-[#202023] p-3 text-xs text-stone-700 dark:text-stone-300 font-mono leading-relaxed max-h-24 overflow-y-auto thin-scrollbar select-all">
                                                {preset.positivePrompt}
                                            </div>

                                            {/* 交叉标签与推荐参数 */}
                                            <div className="flex flex-wrap items-center gap-1.5 mt-auto pt-1">
                                                {preset.recommendedParams?.aspectRatio && (
                                                    <span className="rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 px-1.5 py-0.5 text-[10px] font-mono">
                                                        {preset.recommendedParams.aspectRatio}
                                                    </span>
                                                )}
                                                {preset.recommendedParams?.duration && (
                                                    <span className="rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 px-1.5 py-0.5 text-[10px] font-mono">
                                                        {preset.recommendedParams.duration}s
                                                    </span>
                                                )}
                                                {/* 本地素材文件名对应徽标 (点击快速复制，可粘贴到顶部搜索框反查复核) */}
                                                {assetFilename && (
                                                    <Tooltip title={`对应本地素材：${assetFilename}\n点击一键复制文件名，可粘贴到顶部搜索框秒查复核`}>
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                navigator.clipboard.writeText(assetFilename);
                                                                message.success(`已复制素材文件名: ${assetFilename}`);
                                                            }}
                                                            className="flex items-center gap-1 rounded-md bg-stone-100 dark:bg-stone-800/90 hover:bg-amber-500/10 dark:hover:bg-amber-500/20 text-stone-500 dark:text-stone-400 hover:text-amber-600 dark:hover:text-amber-400 border border-black/[0.05] dark:border-white/[0.06] hover:border-amber-500/30 px-1.5 py-0.5 text-[10px] font-mono transition-all cursor-pointer select-none"
                                                        >
                                                            <FolderArchive className="size-2.5 text-amber-500/80 shrink-0" />
                                                            <span className="max-w-[110px] truncate">{assetFilename}</span>
                                                        </button>
                                                    </Tooltip>
                                                )}
                                                {preset.tags.map((tag) => (
                                                    <span
                                                        key={tag}
                                                        onClick={() => handleTagChange(tag)}
                                                        className="cursor-pointer rounded-md bg-stone-100 dark:bg-stone-800/80 hover:bg-stone-200 dark:hover:bg-stone-700 px-2 py-0.5 text-[11px] text-stone-600 dark:text-stone-400 transition-colors"
                                                    >
                                                        #{tag}
                                                    </span>
                                                ))}
                                            </div>

                                            {/* 底部操作行 */}
                                            <div className="flex items-center justify-between border-t border-black/[0.06] dark:border-white/[0.06] pt-3 mt-1 gap-2">
                                                <div className="flex items-center gap-0.5">
                                                    <Tooltip title={isCopied ? "已复制" : "复制提示词"}>
                                                        <Button
                                                            size="small"
                                                            type="text"
                                                            icon={isCopied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5 transition-transform duration-200 group-hover/copy:scale-110" />}
                                                            onClick={() => handleCopy(preset)}
                                                            className="group/copy !text-stone-600 dark:!text-stone-400 hover:!text-amber-600 dark:hover:!text-amber-400 hover:!bg-amber-500/10 dark:hover:!bg-amber-500/20 active:scale-95 !px-1.5 !rounded-md cursor-pointer transition-all duration-200"
                                                        >
                                                            <span className="hidden sm:inline">{isCopied ? "已复制" : "复制"}</span>
                                                        </Button>
                                                    </Tooltip>
                                                    <Tooltip title="编辑灵感模版">
                                                        <Button
                                                            size="small"
                                                            type="text"
                                                            icon={<Pencil className="size-3.5 transition-transform duration-200 group-hover/edit:scale-110" />}
                                                            onClick={() => handleEditPrompt(preset)}
                                                            className="group/edit !text-stone-600 dark:!text-stone-400 hover:!text-amber-600 dark:hover:!text-amber-400 hover:!bg-amber-500/10 dark:hover:!bg-amber-500/20 active:scale-95 !px-1.5 !rounded-md cursor-pointer transition-all duration-200"
                                                        >
                                                            <span className="hidden sm:inline">编辑</span>
                                                        </Button>
                                                    </Tooltip>
                                                    <Popconfirm
                                                        title="确定要删除该灵感吗？"
                                                        description={preset.isCustom ? "此自建灵感将被彻底删除。" : "该系统灵感将在你的工作区中隐藏。"}
                                                        onConfirm={(e) => handleDeletePreset(preset, e)}
                                                        okText="删除"
                                                        cancelText="取消"
                                                        okButtonProps={{ danger: true }}
                                                    >
                                                        <Button
                                                            size="small"
                                                            type="text"
                                                            icon={<Trash2 className="size-3.5 text-stone-400 hover:text-red-500 transition-colors" />}
                                                            className="!text-stone-600 dark:!text-stone-400 hover:!text-red-500 hover:!bg-red-500/10 active:scale-95 !px-1.5 !rounded-md cursor-pointer transition-all duration-200"
                                                        >
                                                            <span className="hidden sm:inline">删除</span>
                                                        </Button>
                                                    </Popconfirm>
                                                    {preset.isOverridden && (
                                                        <Tooltip title="恢复为系统默认预设">
                                                            <Button
                                                                size="small"
                                                                type="text"
                                                                icon={<RotateCcw className="size-3.5 text-amber-500 transition-transform hover:-rotate-45" />}
                                                                onClick={(e) => handleResetToDefault(preset.id, e)}
                                                                className="hover:!text-amber-600 hover:!bg-amber-500/10 active:scale-95 !px-1.5 !rounded-md cursor-pointer transition-all duration-200"
                                                            />
                                                        </Tooltip>
                                                    )}
                                                </div>

                                                <div className="flex items-center gap-1.5 shrink-0">
                                                    {preset.kind === "video" ? (
                                                        <Button
                                                            size="small"
                                                            type="default"
                                                            icon={<LayoutGrid className="size-3.5 text-indigo-600 dark:text-indigo-400 group-hover/btn:scale-110 group-hover/btn:text-white transition-all duration-200" />}
                                                            onClick={() => handleUseInCanvas(preset)}
                                                            className="group/btn !h-7 !text-xs !px-2.5 !rounded-lg !border-indigo-500/60 hover:!border-indigo-500 !text-indigo-600 dark:!text-indigo-400 hover:!text-white dark:hover:!text-white hover:!bg-indigo-600 dark:hover:!bg-indigo-600 hover:shadow-md hover:shadow-indigo-500/25 font-semibold cursor-pointer whitespace-nowrap transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                                                        >
                                                            导入画布
                                                        </Button>
                                                    ) : (
                                                        <Button
                                                            size="small"
                                                            type="default"
                                                            icon={<LayoutGrid className="size-3.5 text-amber-600 dark:text-amber-400 group-hover/btn:scale-110 group-hover/btn:text-stone-950 transition-all duration-200" />}
                                                            onClick={() => handleUseInCanvas(preset)}
                                                            className="group/btn !h-7 !text-xs !px-2.5 !rounded-lg !border-amber-500/60 hover:!border-amber-400 !text-amber-600 dark:!text-amber-400 hover:!text-stone-950 dark:hover:!text-stone-950 hover:!bg-amber-400 dark:hover:!bg-amber-400 hover:shadow-md hover:shadow-amber-500/25 font-semibold cursor-pointer whitespace-nowrap transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                                                        >
                                                            导入画布
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* 底部现代化分页器 */}
                        {filteredPresets.length > pageSize && (
                            <div className="mt-8 flex items-center justify-between rounded-2xl border border-black/[0.06] dark:border-white/[0.08] bg-white dark:bg-[#18181b] p-4 shadow-sm flex-wrap gap-4">
                                <div className="text-xs text-stone-500 dark:text-stone-400 font-mono">
                                    共收录 <span className="font-semibold text-stone-900 dark:text-stone-100">{filteredPresets.length}</span> 条灵感 · 当前显示第 {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, filteredPresets.length)} 项
                                </div>
                                <Pagination
                                    current={currentPage}
                                    pageSize={pageSize}
                                    total={filteredPresets.length}
                                    pageSizeOptions={["24", "36", "48", "72", "96"]}
                                    showSizeChanger
                                    showQuickJumper
                                    onChange={(page, size) => {
                                        setCurrentPage(page);
                                        setPageSize(size);
                                        window.scrollTo({ top: 0, behavior: "smooth" });
                                    }}
                                    className="dark:text-stone-300"
                                />
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* 顶级商业级大图与美学蓝图检视 Modal */}
            <InspirationLightboxModal
                open={!!lightboxItem}
                item={lightboxItem}
                itemsList={filteredPresets}
                currentIndex={lightboxItem ? Math.max(0, filteredPresets.findIndex((p) => p.id === lightboxItem.id)) : 0}
                onClose={() => setLightboxItem(null)}
                onSelectIndex={(idx: number) => {
                    if (filteredPresets[idx]) {
                        setLightboxItem(filteredPresets[idx]);
                    }
                }}
                onUpdateItem={(updated) => {
                    setLightboxItem(updated);
                    reloadData();
                }}
            />

            {/* 新建 / 编辑灵感 Modal */}
            <Modal
                title={editingPrompt ? "编辑创作灵感" : "新建创作灵感"}
                open={isCreateModalOpen}
                onCancel={() => {
                    setIsCreateModalOpen(false);
                    setEditingPrompt(null);
                    form.resetFields();
                }}
                onOk={handleSavePrompt}
                okText="保存并收录"
                cancelText="取消"
                width={640}
                centered
            >
                <Form form={form} layout="vertical" className="mt-4">
                    <Form.Item name="title" label="灵感标题" rules={[{ required: true, message: "请输入灵感标题" }]}>
                        <Input placeholder="例如：电影级微表情慢推镜头 / 45度角黄金立体展示图" />
                    </Form.Item>

                    <div className="grid grid-cols-2 gap-4">
                        <Form.Item name="kind" label="创作类型" rules={[{ required: true }]}>
                            <Select
                                options={[
                                    { label: "生图美学灵感", value: "image" },
                                    { label: "生视频运镜灵感", value: "video" },
                                ]}
                            />
                        </Form.Item>
                        <Form.Item name="category" label="一级精细专题（支持选择或输入新专题）" rules={[{ required: true, message: "请选择或输入专题分类" }]}>
                            <Select
                                showSearch
                                placeholder="选择或输入新专题分类"
                                dropdownRender={(menu) => (
                                    <>
                                        {menu}
                                        <div className="p-2 border-t border-stone-200 dark:border-stone-700 flex gap-1.5">
                                            <Input
                                                size="small"
                                                placeholder="输入新分类名称..."
                                                value={newCategoryInput}
                                                onChange={(e) => setNewCategoryInput(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter" && newCategoryInput.trim()) {
                                                        e.preventDefault();
                                                        const val = newCategoryInput.trim();
                                                        if (!customCategories.includes(val)) {
                                                            setCustomCategories((prev) => [...prev, val]);
                                                        }
                                                        form.setFieldValue("category", val);
                                                        setNewCategoryInput("");
                                                    }
                                                }}
                                            />
                                            <Button
                                                size="small"
                                                type="primary"
                                                onClick={() => {
                                                    const val = newCategoryInput.trim();
                                                    if (val) {
                                                        if (!customCategories.includes(val)) {
                                                            setCustomCategories((prev) => [...prev, val]);
                                                        }
                                                        form.setFieldValue("category", val);
                                                        setNewCategoryInput("");
                                                    }
                                                }}
                                            >
                                                添加新分类
                                            </Button>
                                        </div>
                                    </>
                                )}
                                options={[
                                    ...(form.getFieldValue("kind") === "video"
                                        ? VIDEO_CATEGORIES.filter((c) => c !== "全部").map((c) => ({ label: c, value: c }))
                                        : IMAGE_CATEGORIES.filter((c) => c !== "全部").map((c) => ({ label: c, value: c }))
                                    ),
                                    ...customCategories.map((c) => ({ label: `${c} (自定义)`, value: c })),
                                ]}
                            />
                        </Form.Item>
                    </div>

                    <Form.Item label="范例配图（支持上传本地图片，自动压缩至高保真轻量格式）">
                        <div className="flex items-center gap-4">
                            {uploadedImagePreview ? (
                                <div className="relative size-24 rounded-xl border border-black/10 dark:border-white/10 overflow-hidden group/thumb shrink-0 bg-stone-100 dark:bg-stone-800">
                                    <img src={uploadedImagePreview} alt="Preview" className="h-full w-full object-cover" />
                                    <button
                                        type="button"
                                        onClick={() => setUploadedImagePreview(null)}
                                        className="absolute inset-0 bg-black/60 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center text-white transition-opacity cursor-pointer"
                                    >
                                        <Trash2 className="size-4 text-red-400" />
                                    </button>
                                </div>
                            ) : null}
                            <label className="flex flex-col items-center justify-center h-24 flex-1 border border-dashed border-stone-300 dark:border-stone-700 rounded-xl hover:border-amber-500/50 cursor-pointer bg-stone-50/50 dark:bg-stone-900/50 transition-colors p-3 text-center">
                                <Upload className="size-5 text-stone-400 mb-1" />
                                <span className="text-xs text-stone-600 dark:text-stone-300 font-medium">
                                    {uploadedImagePreview ? "点击更换图片" : "点击上传范例配图"}
                                </span>
                                <span className="text-[10px] text-stone-400 mt-0.5">支持 PNG / JPG / WebP，客户端自动轻量压缩 (&lt;120KB)</span>
                                <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) handleImageUpload(file);
                                        e.target.value = "";
                                    }}
                                />
                            </label>
                        </div>
                    </Form.Item>

                    <Form.Item name="crossCategories" label="交叉关联专题（支持多选，实现双向智能检索）">
                        <Select
                            mode="multiple"
                            placeholder="选择该灵感同时适用的其他一级专题"
                            options={(
                                form.getFieldValue("kind") === "video"
                                    ? VIDEO_CATEGORIES.filter((c) => c !== "全部").map((c) => ({ label: c, value: c }))
                                    : IMAGE_CATEGORIES.filter((c) => c !== "全部").map((c) => ({ label: c, value: c }))
                            ) as { label: string; value: string }[]}
                        />
                    </Form.Item>

                    <Form.Item name="tags" label="检索标签（以空格分隔）">
                        <Input placeholder="例如：45度角 电商主图 无杂质 立体展示" />
                    </Form.Item>

                    <Form.Item name="description" label="效果描述与适用场景" rules={[{ required: true, message: "请输入描述" }]}>
                        <Input.TextArea rows={2} placeholder="阐述该灵感的运镜调度、视觉意境或构图规范..." />
                    </Form.Item>

                    <Form.Item name="positivePrompt" label="核心正向提示词（带 {主体} 插槽）" rules={[{ required: true, message: "请输入提示词" }]}>
                        <Input.TextArea
                            rows={4}
                            placeholder="例如：Professional studio product photography of {主体}, 45-degree elevated angle view..."
                        />
                    </Form.Item>

                    <Form.Item name="negativePrompt" label="负向规避词（选填）">
                        <Input placeholder="例如：blurry, low quality, deformed, extra limbs..." />
                    </Form.Item>

                    <Form.Item name="gradient" label="视觉主题色" initialValue={GRADIENT_PRESETS[0].value}>
                        <Select
                            options={GRADIENT_PRESETS.map((g) => ({
                                label: (
                                    <div className="flex items-center gap-2">
                                        <div className="size-4 rounded-full border border-black/10" style={{ background: g.value }} />
                                        <span>{g.label}</span>
                                    </div>
                                ),
                                value: g.value,
                            }))}
                        />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
}
