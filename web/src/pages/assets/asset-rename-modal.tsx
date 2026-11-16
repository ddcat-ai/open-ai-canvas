import { App, Input } from "antd";
import { useState } from "react";
import { AppModal } from "@/components/ui/product/app-modal";
import { upsertRemoteAsset } from "@/services/api/user-data";
import { loadAssetsForUse } from "@/services/user-data-sync";
import { flushAssetStorePersistence, useAssetStore } from "@/stores/use-asset-store";
import type { LibraryAsset } from "./asset-library-format";

export function AssetRenameModal({ asset, onClose, onSaved }: { asset: LibraryAsset; onClose: () => void; onSaved: (id: string, title: string) => Promise<void> }) {
    const { message } = App.useApp();
    const [title, setTitle] = useState(asset.title);
    const [saving, setSaving] = useState(false);
    const save = async () => {
        const name = title.trim();
        if (!name || saving) return;
        setSaving(true);
        try {
            // 分页卡片只含展示字段；重命名前读取完整最新素材，保留媒体、认证与业务引用。
            await loadAssetsForUse([asset.id], { refresh: true });
            const current = useAssetStore.getState().assets.find((item) => item.id === asset.id);
            if (!current) throw new Error("素材不存在，请刷新后重试");
            await upsertRemoteAsset({ ...current, title: name, updatedAt: new Date().toISOString() });
            useAssetStore.getState().updateAsset(asset.id, { title: name });
            await flushAssetStorePersistence();
            await onSaved(asset.id, name);
            message.success("素材名称已保存");
            onClose();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存素材名称失败");
        } finally {
            setSaving(false);
        }
    };
    return (
        <AppModal
            open
            title="修改素材名称"
            onCancel={() => {
                if (!saving) onClose();
            }}
            onOk={() => void save()}
            confirmLoading={saving}
            okButtonProps={{ disabled: !title.trim() || title.trim() === asset.title }}
        >
            <label htmlFor="asset-rename-title">素材名称</label>
            <Input id="asset-rename-title" autoFocus value={title} maxLength={200} disabled={saving} onChange={(event) => setTitle(event.target.value)} onPressEnter={() => void save()} />
        </AppModal>
    );
}
