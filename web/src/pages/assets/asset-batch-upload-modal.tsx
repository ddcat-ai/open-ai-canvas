import { useMemo, useRef, useState } from "react";
import { App, Button, Modal, Progress } from "antd";
import { StatusBadge } from "@/components/ui/base/badges";
import { FileImage, UploadCloud, X } from "lucide-react";

import { ASSET_CATEGORY_OPTIONS, type AssetCategory } from "@/lib/asset-category";
import { uploadImage } from "@/services/image-storage";
import { localSavedRemotePendingMessage, saveRemoteUserDataNow } from "@/services/user-data-sync";
import { flushAssetStorePersistence, useAssetStore } from "@/stores/use-asset-store";
import type { AssetFolder } from "@/services/api/user-data";
import { Select } from "@/components/ui/base/select";

type BatchItem = { id: string; file: File; status: "queued" | "uploading" | "done" | "error"; error?: string; percent?: number };

export function AssetBatchUploadModal({ open, defaultFolderId, folders, onClose, onComplete }: { open: boolean; defaultFolderId: string; folders: AssetFolder[]; onClose: () => void; onComplete: () => Promise<void> }) {
    const { message } = App.useApp();
    const addAsset = useAssetStore((state) => state.addAsset);
    const [items, setItems] = useState<BatchItem[]>([]);
    const [category, setCategory] = useState<AssetCategory>("material");
    const [folderId, setFolderId] = useState(defaultFolderId);
    const [tags, setTags] = useState<string[]>([]);
    const [uploading, setUploading] = useState(false);
    const [dragging, setDragging] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const doneCount = items.filter((item) => item.status === "done").length;
    const failedItems = items.filter((item) => item.status === "error");
    const hasFiles = items.length > 0;
    const folderOptions = useMemo(() => [{ label: "未分类", value: "" }, ...folders.map((folder) => ({ label: folder.name, value: folder.id }))], [folders]);

    const chooseFiles = (files: File[]) => {
        const images = files.filter((file) => file.type.startsWith("image/"));
        if (!images.length) {
            message.warning("请选择图片文件");
            return;
        }
        setItems((current) => [...current, ...images.map((file) => ({ id: `${file.name}-${file.lastModified}-${Math.random()}`, file, status: "queued" as const }))]);
    };

    const uploadBatch = async () => {
        const pending = items.filter((item) => item.status === "queued" || item.status === "error");
        if (!pending.length) return;
        setUploading(true);
        let cursor = 0;
        const worker = async () => {
            while (cursor < pending.length) {
                const item = pending[cursor++];
                setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "uploading", percent: 10, error: undefined } : entry));
                try {
                    // uploadImage 已从本地文件读取尺寸，不再回读远端地址。
                    const uploaded = await uploadImage(item.file, (loaded, total) => {
                        const percent = total > 0 ? Math.min(95, Math.max(10, Math.round((loaded / total) * 95))) : 10;
                        setItems((current) => current.map((entry) => entry.id === item.id && entry.status === "uploading" ? { ...entry, percent } : entry));
                    });
                    addAsset({ kind: "image", title: item.file.name.replace(/\.[^.]+$/, ""), category, folderId: folderId || undefined, coverUrl: uploaded.url, tags, source: "批量上传", metadata: { source: "manual-batch" }, data: { dataUrl: uploaded.url, storageKey: uploaded.storageKey, width: uploaded.width, height: uploaded.height, bytes: uploaded.bytes, mimeType: uploaded.mimeType } });
                    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "done", percent: 100 } : entry));
                    succeeded++;
                } catch (error) {
                    failed++;
                    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "error", error: error instanceof Error ? error.message : "上传失败" } : entry));
                }
            }
        };
        let succeeded = 0;
        let failed = 0;
        let syncError: unknown = null;
        try {
            await Promise.all(Array.from({ length: Math.min(4, pending.length) }, () => worker()));
            if (succeeded) {
                // flush 可能抛出此前其他生成任务遗留的写入失败，不能让它卡住本次上传的收尾。
                await flushAssetStorePersistence().catch((error) => { syncError = error; });
                await saveRemoteUserDataNow([]).catch((error) => { syncError ??= error; });
            }
        } finally {
            setUploading(false);
        }
        if (syncError) message.warning(localSavedRemotePendingMessage("部分素材已保存在本地", syncError));
        // 有失败项时保留弹窗，失败标记与「重试失败项」仍可见；关闭时再刷新列表。
        if (!failed) await onComplete();
    };

    const close = () => {
        if (uploading) return;
        const hasUploaded = items.some((item) => item.status === "done");
        setItems([]);
        setTags([]);
        setFolderId(defaultFolderId);
        if (hasUploaded) void onComplete();
        else onClose();
    };

    return <Modal className="library-modal library-batch-upload-modal" title="批量上传图片" open={open} onCancel={close} footer={null} destroyOnHidden>
        <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-xs font-medium text-foreground/65">业务分类<Select className="mt-1 w-full" value={category} options={ASSET_CATEGORY_OPTIONS} onChange={(value) => setCategory(value)} /></label>
                <label className="text-xs font-medium text-foreground/65">自定义分类<Select className="mt-1 w-full" value={folderId} options={folderOptions} onChange={setFolderId} /></label>
                <label className="text-xs font-medium text-foreground/65">公共标签<Select mode="tags" className="mt-1 w-full" value={tags} tokenSeparators={[",", "，"]} onChange={setTags} placeholder="输入后回车" /></label>
            </div>
            <button
                type="button"
                className={dragging ? "batch-upload-dropzone is-dragging" : "batch-upload-dropzone"}
                onClick={() => inputRef.current?.click()}
                onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
                onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
                onDrop={(event) => { event.preventDefault(); setDragging(false); if (!uploading) chooseFiles(Array.from(event.dataTransfer.files)); }}
            >
                <UploadCloud className="size-7" /><strong>选择多张图片</strong><span>支持拖拽或多选上传，标题默认取文件名</span>
            </button>
            <input ref={inputRef} type="file" hidden accept="image/*" multiple onChange={(event) => { chooseFiles(Array.from(event.target.files || [])); event.currentTarget.value = ""; }} />
            {hasFiles ? <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-foreground/55"><span>已选择 {items.length} 张 · 成功 {doneCount} 张</span><button type="button" className="text-foreground/45 hover:text-foreground" onClick={() => setItems([])} disabled={uploading}>清空</button></div>
                <div className="batch-upload-list">{items.map((item) => <div key={item.id} className="batch-upload-item"><FileImage className="size-4 shrink-0 text-foreground/45" /><span className="min-w-0 flex-1"><span className="block truncate" title={item.file.name}>{item.file.name}</span>{item.status === "error" && item.error ? <span className="block truncate text-[11px] text-red-500" title={item.error}>{item.error}</span> : null}</span>{item.status === "uploading" ? <div className="w-20 shrink-0"><Progress percent={item.percent || 10} size="small" showInfo={false} /></div> : item.status === "done" ? <StatusBadge tone="success" size="sm" label="完成" /> : item.status === "error" ? <StatusBadge tone="error" size="sm" label="失败" title={item.error} /> : <StatusBadge tone="neutral" size="sm" label="待上传" />}<button type="button" aria-label={`移除 ${item.file.name}`} title="移除" className="batch-upload-remove" onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))} disabled={uploading}><X className="size-3.5" /></button></div>)}</div>
            </div> : null}
            <div className="flex justify-end gap-2"><Button onClick={close} disabled={uploading}>取消</Button><Button type="primary" icon={<UploadCloud className="size-4" />} onClick={() => void uploadBatch()} disabled={!items.some((item) => item.status === "queued" || item.status === "error")} loading={uploading}>{failedItems.length ? `重试失败项 (${failedItems.length})` : "开始上传"}</Button></div>
        </div>
    </Modal>;
}
