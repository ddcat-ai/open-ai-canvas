import { useState, useMemo } from "react";
import { Modal, Input, Button, Tabs, Tag } from "antd";
import { Search, Sparkles, Camera, MoveUpRight, Check } from "lucide-react";
import { 
    getImagePresets, 
    getVideoPresets, 
    loadCustomPrompts, 
    type PromptPresetItem 
} from "@/pages/prompts/prompt-data";

export function PromptSelectDialog({ 
    open, 
    onOpenChange, 
    onSelect 
}: { 
    open: boolean; 
    onOpenChange: (open: boolean) => void; 
    onSelect: (prompt: string, item?: PromptPresetItem) => void; 
}) {
    const [keyword, setKeyword] = useState("");
    const [customPrompt, setCustomPrompt] = useState("");
    const [activeTab, setActiveTab] = useState("image");

    const customList = useMemo(() => (open ? loadCustomPrompts() : []), [open]);

    const presets = useMemo(() => {
        if (!open) return [];
        let list: PromptPresetItem[] = [];
        if (activeTab === "image") list = getImagePresets();
        else if (activeTab === "video") list = getVideoPresets();
        else list = customList;

        if (!keyword.trim()) return list;
        const q = keyword.toLowerCase().trim();
        return list.filter(
            (p) =>
                p.title.toLowerCase().includes(q) ||
                p.category.toLowerCase().includes(q) ||
                p.crossCategories?.some((c) => c.toLowerCase().includes(q)) ||
                p.positivePrompt.toLowerCase().includes(q) ||
                p.tags.some((t) => t.toLowerCase().includes(q)),
        );
    }, [activeTab, keyword, customList, open]);

    const handleSelect = (text: string, item?: PromptPresetItem) => {
        onSelect(text, item);
        onOpenChange(false);
    };

    return (
        <Modal
            title={
                <div className="flex items-center gap-2 text-base font-semibold">
                    <Sparkles className="size-4 text-amber-500" />
                    <span>创作灵感快速选用</span>
                </div>
            }
            open={open}
            onCancel={() => onOpenChange(false)}
            footer={null}
            width={720}
            destroyOnClose
            centered
        >
            <div className="flex flex-col gap-3 py-1">
                <Input
                    prefix={<Search className="size-4 opacity-50" />}
                    placeholder="搜索灵感预设、专题分类或标签..."
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    allowClear
                />

                <Tabs
                    activeKey={activeTab}
                    onChange={setActiveTab}
                    size="small"
                    items={[
                        {
                            key: "image",
                            label: (
                                <span className="flex items-center gap-1.5 text-xs">
                                    <Camera className="size-3.5 text-amber-500" />
                                    <span>生图灵感</span>
                                </span>
                            ),
                        },
                        {
                            key: "video",
                            label: (
                                <span className="flex items-center gap-1.5 text-xs">
                                    <MoveUpRight className="size-3.5 text-indigo-500" />
                                    <span>生视频灵感</span>
                                </span>
                            ),
                        },
                        {
                            key: "custom",
                            label: (
                                <span className="flex items-center gap-1.5 text-xs">
                                    <Sparkles className="size-3.5 text-emerald-500" />
                                    <span>我的自建 ({customList.length})</span>
                                </span>
                            ),
                        },
                    ]}
                />

                <div className="flex flex-col gap-2.5 max-h-[340px] overflow-y-auto thin-scrollbar pr-1">
                    {presets.length === 0 ? (
                        <div className="py-8 text-center text-xs text-stone-400">
                            没有找到匹配的创作灵感预设
                        </div>
                    ) : (
                        presets.map((item) => (
                            <div
                                key={item.id}
                                className="group flex gap-3 rounded-xl border border-black/[0.06] dark:border-white/[0.08] bg-stone-50/70 dark:bg-[#202023] p-3 hover:border-amber-500/40 hover:bg-stone-100 dark:hover:bg-[#28282c] transition-all"
                            >
                                {item.previewImage && (
                                    <div className="shrink-0 size-16 rounded-lg overflow-hidden bg-black/20 border border-black/5 dark:border-white/10">
                                        <img
                                            src={item.previewImage}
                                            alt={item.title}
                                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                        />
                                    </div>
                                )}
                                <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-xs font-semibold text-stone-900 dark:text-stone-100">
                                                {item.title}
                                            </span>
                                            <Tag className="!m-0 text-[10px] leading-tight px-1.5 py-0.5 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                                                {item.category}
                                            </Tag>
                                            {item.crossCategories && item.crossCategories.map((cc) => (
                                                <Tag key={cc} className="!m-0 text-[10px] leading-tight px-1.5 py-0.5 border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-400">
                                                    {cc}
                                                </Tag>
                                            ))}
                                        </div>
                                        <Button
                                            size="small"
                                            type="primary"
                                            ghost
                                            onClick={() => handleSelect(item.positivePrompt, item)}
                                            className="!h-6 !text-xs !px-2.5 !border-amber-500 !text-amber-600 hover:!bg-amber-50 dark:hover:!bg-amber-950/20 shrink-0 cursor-pointer"
                                        >
                                            选用
                                        </Button>
                                    </div>
                                    <p className="text-[11px] text-stone-500 dark:text-stone-400 line-clamp-1">
                                        {item.description}
                                    </p>
                                    <div className="text-[11px] font-mono text-stone-600 dark:text-stone-300 bg-white dark:bg-[#18181b] p-2 rounded-md border border-black/[0.04] dark:border-white/[0.04] line-clamp-2 select-all">
                                        {item.positivePrompt}
                                    </div>
                                    {item.tags && item.tags.length > 0 && (
                                        <div className="flex items-center gap-1 flex-wrap pt-0.5">
                                            {item.tags.slice(0, 5).map((t) => (
                                                <span key={t} className="text-[10px] text-stone-400 dark:text-stone-500 bg-black/[0.03] dark:bg-white/[0.05] px-1.5 py-0.5 rounded">
                                                    #{t}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div className="mt-2 pt-3 border-t border-black/[0.06] dark:border-white/[0.08]">
                    <div className="text-xs text-stone-500 dark:text-stone-400 mb-1.5">或手动输入自定义灵感词：</div>
                    <Input.TextArea
                        rows={2}
                        placeholder="粘贴或编写特定提示词..."
                        value={customPrompt}
                        onChange={(e) => setCustomPrompt(e.target.value)}
                    />
                    <div className="flex justify-end gap-2 mt-2">
                        <Button onClick={() => onOpenChange(false)}>取消</Button>
                        <Button type="primary" disabled={!customPrompt.trim()} onClick={() => handleSelect(customPrompt.trim())}>
                            确认填入
                        </Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
