import { useEffect, useState } from "react";
import { Alert, Button, Input, Modal, Spin } from "antd";
import { FileText, RefreshCw, WandSparkles, X } from "lucide-react";

export type CanvasImageTextLine = { original: string; text: string; location: string };
export type CanvasImageTextEditPayload = { lines: CanvasImageTextLine[] };

export function buildCanvasTextEditPrompt(lines: CanvasImageTextLine[]) {
    const changed = lines.filter((line) => line.text.trim() && line.text !== line.original);
    return `编辑提供的原图，仅修改指定位置的文字。保持原图构图、字体风格、字号、颜色、排版、材质和其他画面细节不变，不要新增水印或其他文字。${changed.map((line) => `在“${line.location}”位置，将“${line.original}”改为“${line.text}”。`).join("\n")}`;
}

export function CanvasNodeTextEditDialog({
    dataUrl,
    open,
    onClose,
    onDetect,
    onConfirm,
}: {
    dataUrl: string;
    open: boolean;
    onClose: () => void;
    onDetect: () => Promise<CanvasImageTextLine[]>;
    onConfirm: (payload: CanvasImageTextEditPayload) => void;
}) {
    const [lines, setLines] = useState<CanvasImageTextLine[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const detect = async () => {
        setLoading(true);
        setError("");
        try {
            const detected = await onDetect();
            setLines(detected.map((line) => ({ ...line, text: line.text || line.original })));
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "文字识别失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!open) return;
        setLines([]);
        void detect();
        // 只在打开或切换源图时识别，避免输入文字触发重复识别。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dataUrl, open]);

    const changed = lines.some((line) => line.text.trim() && line.text !== line.original);

    return (
        <Modal open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} centered destroyOnHidden width={980} title="图片文字编辑">
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_390px]">
                <div className="grid min-h-[360px] place-items-center overflow-hidden rounded-xl bg-black/5 p-3 dark:bg-white/[0.04]">
                    <img src={dataUrl} alt="待编辑图片" className="max-h-[64vh] max-w-full object-contain" draggable={false} />
                </div>
                <div className="flex min-h-[360px] flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <h3 className="text-lg font-semibold">识别图片文字</h3>
                            <p className="mt-1 text-sm opacity-60">逐行修改文字，位置描述只用于帮助模型定位。</p>
                        </div>
                        <Button size="small" icon={<RefreshCw className="size-3.5" />} onClick={() => void detect()} disabled={loading}>重新识别</Button>
                    </div>
                    {loading ? <div className="flex flex-1 items-center justify-center gap-2 text-sm opacity-65"><Spin size="small" />正在识别图片文字…</div> : error ? <div className="space-y-3"><Alert type="error" showIcon message={error} /><Button onClick={() => void detect()}>重试</Button></div> : lines.length ? <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">{lines.map((line, index) => <div key={`${line.original}-${index}`} className="rounded-xl border p-3"><div className="mb-2 flex items-center gap-2 text-xs opacity-60"><FileText className="size-3.5" /><span>第 {index + 1} 行 · {line.location}</span></div><Input value={line.text} placeholder={line.original} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item))} /></div>)}</div> : <div className="flex flex-1 items-center justify-center text-sm opacity-55">没有识别到可编辑文字</div>}
                    <div className="mt-auto flex justify-end gap-2 border-t pt-3"><Button icon={<X className="size-4" />} onClick={onClose}>取消</Button><Button type="primary" icon={<WandSparkles className="size-4" />} disabled={!changed || loading} onClick={() => onConfirm({ lines })}>生成修改结果</Button></div>
                </div>
            </div>
        </Modal>
    );
}
