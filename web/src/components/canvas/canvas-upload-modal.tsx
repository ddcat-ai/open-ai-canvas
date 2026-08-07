import { useEffect, useState } from "react";
import { App, Button, Modal, Upload, type UploadFile } from "antd";
import { FileImage, Film, Music2, UploadCloud } from "lucide-react";

import { isAudioFile } from "@/lib/canvas/canvas-project-generation";

const CANVAS_UPLOAD_ACCEPT = "image/*,video/*,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav";

type CanvasUploadModalProps = {
    open: boolean;
    onClose: () => void;
    onUpload: (files: File[]) => Promise<boolean>;
};

export function CanvasUploadModal({ open, onClose, onUpload }: CanvasUploadModalProps) {
    const { message } = App.useApp();
    const [fileList, setFileList] = useState<UploadFile[]>([]);
    const [uploading, setUploading] = useState(false);

    useEffect(() => {
        if (!open) {
            setFileList([]);
            setUploading(false);
        }
    }, [open]);

    const submit = async () => {
        const files = fileList.flatMap((item) => item.originFileObj ? [item.originFileObj] : []);
        if (!files.length) return;
        setUploading(true);
        try {
            if (await onUpload(files)) onClose();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "文件上传失败，请稍后重试");
        } finally {
            setUploading(false);
        }
    };

    return (
        <Modal
            open={open}
            title={null}
            footer={null}
            width="min(720px, calc(100vw - 24px))"
            destroyOnHidden
            closable={!uploading}
            keyboard={!uploading}
            maskClosable={!uploading}
            onCancel={onClose}
            styles={{ container: { padding: 0, overflow: "hidden" }, body: { padding: 0 } }}
        >
            <div className="flex min-h-96 flex-col overflow-hidden">
                <header className="flex h-14 shrink-0 items-center justify-between border-b border-border py-0 pl-5 pr-12">
                    <div className="min-w-0">
                        <div role="heading" aria-level={2} className="text-sm font-semibold leading-5">上传文件</div>
                        <div className="mt-0.5 text-[var(--fs-label)] leading-4 text-foreground/45">批量导入图片、视频和音频到当前画布</div>
                    </div>
                    <span className="shrink-0 text-[var(--fs-label)] text-foreground/45">已选 {fileList.length} 项</span>
                </header>

                <section className="min-h-0 flex-1 overflow-y-auto p-4">
                    <Upload.Dragger
                        accept={CANVAS_UPLOAD_ACCEPT}
                        multiple
                        disabled={uploading}
                        fileList={fileList}
                        beforeUpload={(file) => {
                            if (isCanvasUploadFile(file)) return false;
                            message.warning(`“${file.name}”不是支持的图片、视频或音频文件`);
                            return Upload.LIST_IGNORE;
                        }}
                        onChange={({ fileList: nextFileList }) => setFileList(nextFileList)}
                        onRemove={() => !uploading}
                        showUploadList={{ showPreviewIcon: false, showDownloadIcon: false, showRemoveIcon: !uploading }}
                        classNames={{ list: "thin-scrollbar" }}
                        styles={{
                            root: { display: "block", width: "100%" },
                            trigger: { borderColor: "var(--border)", borderRadius: "var(--r-lg)", background: "var(--workspace-surface)" },
                            list: { maxHeight: 184, overflowY: "auto" },
                        }}
                    >
                        <div className="flex min-h-48 flex-col items-center justify-center px-6 py-8 text-center">
                            <span className="grid size-12 place-items-center rounded-lg bg-foreground/[.06] text-foreground/70">
                                <UploadCloud className="size-6" aria-hidden="true" />
                            </span>
                            <p className="mt-4 text-sm font-medium">拖动文件到这里，或点击选择</p>
                            <p className="mt-1 text-xs text-foreground/45">支持同时选择多个文件</p>
                            <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-[var(--fs-label)] text-foreground/45" aria-label="支持的文件类型">
                                <span className="inline-flex items-center gap-1"><FileImage className="size-3.5" aria-hidden="true" />图片</span>
                                <span className="inline-flex items-center gap-1"><Film className="size-3.5" aria-hidden="true" />视频</span>
                                <span className="inline-flex items-center gap-1"><Music2 className="size-3.5" aria-hidden="true" />MP3 / WAV</span>
                            </div>
                        </div>
                    </Upload.Dragger>
                </section>

                <footer className="flex h-14 shrink-0 items-center justify-between border-t border-border px-4">
                    <span className="hidden text-[var(--fs-label)] text-foreground/45 sm:inline">文件将在确认后按顺序添加到画布</span>
                    <div className="ml-auto flex gap-2">
                        <Button disabled={uploading} onClick={onClose}>取消</Button>
                        <Button type="primary" icon={<UploadCloud className="size-4" />} disabled={!fileList.length} loading={uploading} onClick={() => void submit()}>
                            添加到画布{fileList.length ? `（${fileList.length}）` : ""}
                        </Button>
                    </div>
                </footer>
            </div>
        </Modal>
    );
}

function isCanvasUploadFile(file: File) {
    return file.type.startsWith("image/") || file.type.startsWith("video/") || isAudioFile(file);
}
