import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Checkbox, Input } from "antd";
import { AlertTriangle, FileUp, X } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal";
import { decodeNovelText } from "@/lib/canvas/canvas-document";
import { EPISODE_SOURCE_CHARS, sourceChars } from "@/lib/drama/novel-parse";
import { addDramaEpisode, getDramaChapter, updateDramaChapter, updateDramaEpisode, type DramaChapterRef, type DramaSourceFormat } from "@/services/api/drama";

import { formatCount, SOURCE_FORMAT_LABEL, SourceFormatPicker } from "../drama-shared";

// 逐集制作：在作品末尾追加一集，或修改某一集的原文与素材类型。原文修改后需要重新改编才会重写剧本。

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const TEXT_FILE = /\.(txt|md|markdown|csv|tsv)$/i;

function useTextFile(onText: (text: string, fileName: string) => void) {
    const { message } = App.useApp();
    const inputRef = useRef<HTMLInputElement>(null);
    const read = async (file: File) => {
        if (!TEXT_FILE.test(file.name)) {
            message.warning("支持 TXT、Markdown、CSV、TSV 文本文件");
            return;
        }
        if (file.size > MAX_FILE_BYTES) {
            message.warning("单集文件不超过 2MB");
            return;
        }
        onText(decodeNovelText(await file.arrayBuffer()), file.name);
    };
    const input = (
        <input
            ref={inputRef}
            type="file"
            accept=".txt,.md,.markdown,.csv,.tsv,text/plain,text/markdown"
            className="hidden"
            onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void read(file);
            }}
        />
    );
    return { input, open: () => inputRef.current?.click(), read };
}

function CharCounter({ chars, limit }: { chars: number; limit: number }) {
    const over = chars > limit;
    return (
        <span className={`drama-composer-count ${over ? "is-over" : ""}`}>
            {formatCount(chars)} / {formatCount(limit)} 字{over ? " · 超出部分会丢台词，请拆成多集" : ""}
        </span>
    );
}

/** 原文编辑弹窗外壳：左栏放标题、素材类型和格式说明，右侧整块是原文编辑区，可直接拖入文件。 */
function SourceComposer({
    open,
    title,
    subtitle,
    format,
    onFormat,
    side,
    text,
    onText,
    loading,
    notice,
    footer,
    onClose,
}: {
    open: boolean;
    title: string;
    subtitle: string;
    format: DramaSourceFormat;
    onFormat: (format: DramaSourceFormat) => void;
    side?: ReactNode;
    text: string;
    onText: (text: string, fileName?: string) => void;
    loading?: boolean;
    notice?: ReactNode;
    footer: ReactNode;
    onClose: () => void;
}) {
    const [dragOver, setDragOver] = useState(false);
    const file = useTextFile(onText);
    const onDrop = (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        setDragOver(false);
        const dropped = event.dataTransfer.files?.[0];
        if (dropped) void file.read(dropped);
    };
    return (
        <AppModal open={open} onCancel={onClose} footer={null} title={null} closable={false} flush centered width="min(1120px, calc(100vw - 48px))" rootClassName="drama-root" aria-label={title}>
            <div className="drama-composer">
                <header className="drama-composer-head">
                    <div className="min-w-0">
                        <strong>{title}</strong>
                        <span>{subtitle}</span>
                    </div>
                    <Button type="text" icon={<X className="size-4" />} aria-label="关闭" onClick={onClose} />
                </header>
                <div className="drama-composer-body">
                    <aside className="drama-composer-side thin-scrollbar">
                        {side}
                        <div className="drama-composer-field">
                            <span className="drama-composer-label">素材类型</span>
                            <SourceFormatPicker value={format} onChange={onFormat} />
                        </div>
                        <div className="drama-composer-guide">
                            <span className="drama-composer-label">{SOURCE_FORMAT_LABEL[format].title}怎么写</span>
                            <ul>
                                {SOURCE_FORMAT_LABEL[format].guide.map((line) => (
                                    <li key={line}>{line}</li>
                                ))}
                            </ul>
                        </div>
                        <Button block icon={<FileUp className="size-4" />} onClick={file.open}>
                            从文件导入
                        </Button>
                        {file.input}
                    </aside>
                    <section
                        className={`drama-composer-editor ${dragOver ? "is-over" : ""}`}
                        onDragOver={(event) => {
                            event.preventDefault();
                            setDragOver(true);
                        }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={onDrop}
                    >
                        {notice}
                        <Input.TextArea
                            className="drama-composer-text thin-scrollbar"
                            value={loading ? "" : text}
                            disabled={loading}
                            placeholder={loading ? "正在读取原文…" : `${SOURCE_FORMAT_LABEL[format].placeholder}\n\n也可以把 TXT / Markdown 文件拖到这里。`}
                            aria-label="本集原文"
                            onChange={(event) => onText(event.target.value)}
                        />
                    </section>
                </div>
                <footer className="drama-composer-foot">{footer}</footer>
            </div>
        </AppModal>
    );
}

export function AddEpisodeModal({
    open,
    projectId,
    nextNumber,
    defaultFormat,
    blockedReason,
    onClose,
    onAdded,
}: {
    open: boolean;
    projectId: string;
    nextNumber: number;
    defaultFormat: DramaSourceFormat;
    blockedReason?: string;
    onClose: () => void;
    onAdded: (episodeId: string) => void;
}) {
    const { message } = App.useApp();
    const [title, setTitle] = useState("");
    const [format, setFormat] = useState<DramaSourceFormat>(defaultFormat);
    const [text, setText] = useState("");
    useEffect(() => {
        if (!open) return;
        setTitle("");
        setText("");
        setFormat(defaultFormat);
    }, [defaultFormat, open]);
    const chars = sourceChars(text);
    const add = useMutation({
        mutationFn: () => addDramaEpisode(projectId, { title: title.trim(), text, sourceFormat: format }),
        onSuccess: (detail) => {
            message.success(`已添加第 ${detail.episode.number} 集，开始${format === "novel" ? "改编" : "拆镜"}`);
            onAdded(detail.episode.id);
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "添加失败"),
    });
    return (
        <SourceComposer
            open={open}
            title={`添加第 ${nextNumber} 集`}
            subtitle="一次只放这一集的内容，前面已做好的集不会受影响"
            format={format}
            onFormat={setFormat}
            text={text}
            onText={(value, fileName) => {
                setText(value);
                if (fileName && !title) setTitle(fileName.replace(/\.[^.]+$/, "").slice(0, 60));
            }}
            onClose={onClose}
            side={
                <label className="drama-composer-field">
                    <span className="drama-composer-label">集标题</span>
                    <Input value={title} maxLength={60} placeholder={`留空为“第 ${nextNumber} 集”`} aria-label="集标题" onChange={(event) => setTitle(event.target.value)} />
                </label>
            }
            notice={
                blockedReason ? (
                    <div className="drama-composer-notice">
                        <AlertTriangle className="size-4 shrink-0" />
                        {blockedReason}
                    </div>
                ) : null
            }
            footer={
                <>
                    <CharCounter chars={chars} limit={EPISODE_SOURCE_CHARS} />
                    <span className="flex-1" />
                    <Button onClick={onClose}>取消</Button>
                    <Button type="primary" loading={add.isPending} disabled={Boolean(blockedReason) || !chars || chars > EPISODE_SOURCE_CHARS} onClick={() => add.mutate()}>
                        {format === "storyboard" ? "导入这一集" : "添加并开始拆镜"}
                    </Button>
                </>
            }
        />
    );
}

export function SourceEditModal({
    open,
    projectId,
    episodeId,
    episodeFormat,
    chapter,
    onClose,
    onSaved,
}: {
    open: boolean;
    projectId: string;
    episodeId: string;
    episodeFormat: DramaSourceFormat;
    chapter?: DramaChapterRef;
    onClose: () => void;
    onSaved: (rescript: boolean) => void;
}) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const queryKey = ["drama", projectId, "chapter", chapter?.id || ""];
    const query = useQuery({ queryKey, queryFn: ({ signal }) => getDramaChapter(projectId, chapter!.id, signal), enabled: open && Boolean(chapter), staleTime: 300_000 });
    const original = query.data?.chapter.sourceText || "";
    const [text, setText] = useState("");
    const [format, setFormat] = useState<DramaSourceFormat>(episodeFormat);
    const [rescript, setRescript] = useState(true);
    useEffect(() => {
        if (!open) return;
        setText(original);
        setFormat(episodeFormat);
        setRescript(true);
    }, [episodeFormat, open, original]);
    const limit = Math.max(EPISODE_SOURCE_CHARS, sourceChars(original));
    const chars = sourceChars(text);
    const changed = text !== original || format !== episodeFormat;
    const save = useMutation({
        mutationFn: async () => {
            if (chapter && text !== original) await updateDramaChapter(projectId, chapter.id, { text });
            if (format !== episodeFormat) await updateDramaEpisode(projectId, episodeId, { sourceFormat: format });
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey });
            message.success(rescript ? "原文已保存，正在按新原文重新改编" : "原文已保存，点“重新改编”后生效");
            onSaved(rescript);
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "保存失败"),
    });
    return (
        <SourceComposer
            open={open}
            title={chapter ? `编辑原文 · ${chapter.title}` : "编辑原文"}
            subtitle="改的是这一章的原文；已写好的剧本保持不变，重新改编后才按新原文重写"
            format={format}
            onFormat={setFormat}
            text={text}
            onText={(value) => setText(value)}
            loading={query.isLoading}
            onClose={onClose}
            footer={
                <>
                    <Checkbox checked={rescript} onChange={(event) => setRescript(event.target.checked)}>
                        保存后重新改编本集
                    </Checkbox>
                    <CharCounter chars={chars} limit={limit} />
                    <span className="flex-1" />
                    <Button onClick={onClose}>取消</Button>
                    <Button type="primary" loading={save.isPending} disabled={!changed || !chars || chars > limit || query.isLoading} onClick={() => save.mutate()}>
                        {rescript ? "保存并重新改编" : "保存原文"}
                    </Button>
                </>
            }
        />
    );
}
