import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { Button, ColorPicker, Tooltip } from "antd";
import { Eraser, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
    BannerAnnouncementLinkHint,
    BannerAnnouncementTitle,
    bannerAnnouncementBarStyle,
} from "@/components/layout/banner-announcement-content";
import { readBannerNoticeSurface, bannerNoticeTypeLabel } from "@/lib/announcements/banner-notice";
import { BannerNoticeEmojiPopover } from "./banner-notice-emoji-picker";
import { Select } from "@/components/ui/base/select";
import {
    BANNER_TITLE_DEFAULT_FONT_SIZE,
    BANNER_TITLE_DEFAULT_FONT_WEIGHT,
    BANNER_TITLE_FONT_FAMILIES,
    BANNER_TITLE_FONT_SIZES,
    BANNER_TITLE_FONT_WEIGHTS,
    BANNER_TITLE_MAX_CHARS,
    bannerTitleCharCount,
    lowContrastBannerTitleColors,
    type BannerTitleRun,
} from "@/lib/announcements/banner-title";
import {
    applyBannerTitleStyle,
    bannerDocToRuns,
    bannerTitleRunsToDoc,
    bannerTitleSelectionStyle,
    clearBannerTitleStyle,
    createBannerTitleExtensions,
    type BannerTitleSelectionStyle,
    type BannerTitleStylePatch,
} from "@/lib/announcements/banner-title-rich-text";

const DEFAULT_OPTION = "default";

/** 一次性读出编辑器当前的分段与光标处样式，供受控渲染和回调共用。 */
function readEditorTitle(instance: Editor) {
    const runs = bannerDocToRuns(instance.getJSON());
    return { runs, selection: bannerTitleSelectionStyle(instance) };
}

/**
 * 通知标题编辑区：文字按选区设置字号 / 字重 / 字体 / 颜色。
 * 组件只把 title 分段当初始值，切换编辑对象时由调用方通过 key 重建实例。
 */
export function BannerTitleEditor({ value, onChange }: { value: BannerTitleRun[]; onChange: (runs: BannerTitleRun[]) => void }) {
    const [selectionStyle, setSelectionStyle] = useState<BannerTitleSelectionStyle>({});
    const [charCount, setCharCount] = useState(() => bannerTitleCharCount(value));

    const editor = useEditor({
        immediatelyRender: false,
        extensions: createBannerTitleExtensions("输入首页顶部展示的通知标题"),
        content: bannerTitleRunsToDoc(value),
        editorProps: {
            attributes: { class: "outline-none", "aria-label": "通知标题编辑区" },
            handleKeyDown: (_view, event) => {
                // 通知条标题是单行语义，Enter 不产生新段落。
                return event.key === "Enter";
            },
        },
        onUpdate: ({ editor: instance }) => {
            const { runs, selection } = readEditorTitle(instance);
            setSelectionStyle(selection);
            setCharCount(bannerTitleCharCount(runs));
            onChange(runs);
        },
    });

    const applyStyle = (patch: BannerTitleStylePatch) => {
        if (!editor) return;
        editor.view.focus();
        applyBannerTitleStyle(editor, patch);
        const { runs, selection } = readEditorTitle(editor);
        setSelectionStyle(selection);
        setCharCount(bannerTitleCharCount(runs));
        onChange(runs);
    };

    const tooLong = charCount > BANNER_TITLE_MAX_CHARS;

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
                <Select
                    size="small"
                    className="w-[104px]"
                    aria-label="标题字号"
                    value={selectionStyle.fontSize ?? DEFAULT_OPTION}
                    onChange={(next) => applyStyle({ fontSize: next === DEFAULT_OPTION ? null : Number(next) })}
                    options={[
                        { value: DEFAULT_OPTION, label: `默认（${BANNER_TITLE_DEFAULT_FONT_SIZE}px）` },
                        ...BANNER_TITLE_FONT_SIZES.map((size) => ({ value: size, label: `${size}px` })),
                    ]}
                />
                <Select
                    size="small"
                    className="w-[92px]"
                    aria-label="标题字重"
                    value={selectionStyle.fontWeight ?? DEFAULT_OPTION}
                    onChange={(next) => applyStyle({ fontWeight: next === DEFAULT_OPTION ? null : Number(next) })}
                    options={[
                        { value: DEFAULT_OPTION, label: "默认字重" },
                        ...BANNER_TITLE_FONT_WEIGHTS.map((item) => ({ value: item.value, label: `${item.label} ${item.value}` })),
                    ]}
                />
                <Select
                    size="small"
                    className="w-[92px]"
                    aria-label="标题字体"
                    value={selectionStyle.fontFamily ?? DEFAULT_OPTION}
                    onChange={(next) => applyStyle({ fontFamily: next === DEFAULT_OPTION ? null : (next as BannerTitleRun["fontFamily"]) })}
                    options={[{ value: DEFAULT_OPTION, label: "默认字体" }, ...BANNER_TITLE_FONT_FAMILIES.map((item) => ({ value: item.key, label: item.label }))]}
                />
                <ColorPicker
                    size="small"
                    aria-label="标题颜色"
                    value={selectionStyle.color || "#FFFFFF"}
                    onChange={(color) => applyStyle({ color: color.toHexString().toUpperCase() })}
                    presets={[{ label: "通知条常用", colors: ["#FFFFFF", "#FFE58F", "#FFB37B", "#FF9AA2", "#B7EB8F", "#8FD3FF", "#D3ADF7", "#1F1F1F"] }]}
                />
                {/* 不能用 Tooltip 包住 EmojiPopover：Tooltip 会向 Popover 要 ref，嵌套弹层行为不可靠。 */}
                <BannerNoticeEmojiPopover
                    onPick={(emoji) => {
                        if (!editor) return;
                        // emoji 是普通文本：插进光标处，跟随当前选区的字号 / 颜色样式，可连续插入。
                        editor.chain().focus().insertContent(emoji).run();
                    }}
                />
                <Tooltip title="清除所选文字的样式">
                    <Button
                        size="small"
                        type="text"
                        icon={<Eraser className="size-3.5" />}
                        aria-label="清除样式"
                        onClick={() => {
                            if (!editor) return;
                            clearBannerTitleStyle(editor);
                            const { runs, selection } = readEditorTitle(editor);
                            setSelectionStyle(selection);
                            setCharCount(bannerTitleCharCount(runs));
                            onChange(runs);
                        }}
                    />
                </Tooltip>
                <span className={`ml-auto font-mono text-[var(--fs-label)] ${tooLong ? "text-[var(--admin-status-error)]" : "text-foreground/45"}`}>
                    {charCount}/{BANNER_TITLE_MAX_CHARS}
                </span>
            </div>

            <div className="admin-banner-title-editor" onClick={() => editor?.view.focus()}>
                <EditorContent editor={editor} />
            </div>

            <p className="text-[var(--fs-label)] text-foreground/45">
                选中文字后调整样式；未选中时设置后续输入的文字样式。「图标」可在光标处插入 emoji 素材，位置与个数不限。默认字号 {BANNER_TITLE_DEFAULT_FONT_SIZE}px、字重 {BANNER_TITLE_DEFAULT_FONT_WEIGHT}，与通知条一致。
            </p>
        </div>
    );
}

/**
 * 前台效果预览：明暗两态各一条，按当前通知类型取各自主题下的真实底色。
 * 标题分段全部走前台同一份展示单元，因此预览即前台结果。
 */
export function BannerNoticePreview({ runs, hasLink, noticeType }: { runs: BannerTitleRun[]; hasLink: boolean; noticeType: string }) {
    const lightRef = useRef<HTMLDivElement | null>(null);
    const darkRef = useRef<HTMLDivElement | null>(null);
    const [backgrounds, setBackgrounds] = useState({ light: "", dark: "" });

    useEffect(() => {
        // 底色由类型决定，切换类型后需要重新解析两个预览容器里的实际取值。
        setBackgrounds({
            light: readBannerNoticeSurface(noticeType, lightRef.current),
            dark: readBannerNoticeSurface(noticeType, darkRef.current),
        });
    }, [noticeType]);

    const themes = [
        { key: "light", label: "浅色主题", background: backgrounds.light, ref: lightRef, className: "admin-banner-title-preview-light" },
        { key: "dark", label: "深色主题", background: backgrounds.dark, ref: darkRef, className: "admin-banner-title-preview-dark" },
    ] as const;

    return (
        <div className="space-y-2">
            {themes.map((theme) => {
                const lowContrast = lowContrastBannerTitleColors(runs, theme.background);
                return (
                    <div key={theme.key} className="space-y-1">
                        <div
                            ref={theme.ref}
                            className={`relative flex min-h-10 w-full items-center justify-center px-4 py-2 text-white ${theme.className}`}
                            style={bannerAnnouncementBarStyle(noticeType)}
                        >
                            <span className="flex w-full min-w-0 items-center justify-center gap-2.5 px-8">
                                <span className="min-w-0 truncate font-semibold">
                                    <BannerAnnouncementTitle runs={runs} fallbackText="通知标题预览" />
                                </span>
                                {hasLink ? <BannerAnnouncementLinkHint /> : null}
                            </span>
                            <X className="absolute right-4 size-3.5 shrink-0 text-white" aria-hidden="true" />
                        </div>
                        <p className="text-[var(--fs-label)] text-foreground/45">
                            {theme.label} · {bannerNoticeTypeLabel(noticeType)}
                            {lowContrast.length ? ` · ${lowContrast.join("、")} 在该底色上对比度不足 4.5:1，建议调亮或调暗` : " · 对比度达标"}
                        </p>
                    </div>
                );
            })}
        </div>
    );
}
