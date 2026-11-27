import { useEffect, useState } from "react";
import { Button, Segmented } from "antd";
import { Eye, Image, Info, Type, Video } from "lucide-react";
import { refreshSystemChannels } from "@/lib/user-session";
import { CreationModelPicker } from "@/pages/create/creation-model-picker";
import type { CreationMode } from "@/pages/create/creation-types";
import { AdminModal } from "@/pages/admin/ui/overlays";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { useModelCatalogStore } from "@/stores/use-model-catalog-store";
import "./creation-model-catalog-dialog.css";

const catalogModes = {
    video: { label: "视频", icon: Video },
    image: { label: "图片", icon: Image },
    text: { label: "文本", icon: Type },
} satisfies Record<CreationMode, { label: string; icon: typeof Video }>;

const catalogOptions = (Object.keys(catalogModes) as CreationMode[]).map((value) => {
    const { label, icon: Icon } = catalogModes[value];
    return { label, value, icon: <Icon aria-hidden="true" /> };
});

function reloadCatalog() {
    void refreshSystemChannels().catch(() => {});
}

export function CreationModelCatalogDialog({ onClose }: { onClose: () => void }) {
    const [mode, setMode] = useState<CreationMode>("video");
    const [selection, setSelection] = useState<Partial<Record<CreationMode, string>>>({});
    const config = useEffectiveConfig();
    const status = useModelCatalogStore((state) => state.status);
    const [hasOpened, setHasOpened] = useState(false);
    useEffect(() => {
        reloadCatalog();
        setHasOpened(true);
    }, []);
    const ready = hasOpened && status === "ready";
    const failed = hasOpened && status === "error";

    return (
        <AdminModal
            open
            flush
            width={560}
            className="admin-creation-catalog-dialog"
            title={
                <div className="admin-creation-catalog-title">
                    <span className="admin-creation-catalog-title-icon">
                        <Eye aria-hidden="true" />
                    </span>
                    <div>创作端模型预览</div>
                </div>
            }
            onCancel={onClose}
            footer={null}
        >
            <div className="admin-creation-catalog-body">
                <Segmented className="admin-creation-catalog-modes" block aria-label="创作模型分类" options={catalogOptions} value={mode} onChange={setMode} />
                <section className="admin-creation-catalog-panel" aria-label={`${catalogModes[mode].label}模型`} aria-busy={!ready && !failed}>
                    <div>
                        <h2>{catalogModes[mode].label}模型</h2>
                        <p>按当前账号在创作首页的可见范围展示。</p>
                    </div>
                    {ready ? (
                        <CreationModelPicker
                            key={mode}
                            config={config}
                            value={selection[mode]}
                            onChange={(model) => setSelection((current) => ({ ...current, [mode]: model }))}
                            mode={mode}
                            fullWidth
                            placeholder={`选择${catalogModes[mode].label}模型`}
                            popoverClassName="admin-creation-catalog-popover"
                        />
                    ) : (
                        <div className="admin-creation-catalog-placeholder" aria-hidden="true">
                            {failed ? "暂无法预览模型" : "正在读取目录…"}
                        </div>
                    )}
                </section>
            </div>
            <div className="admin-creation-catalog-footer">
                <div className="admin-creation-catalog-state" data-state={ready ? "ready" : failed ? "error" : "loading"}>
                    <span role="status">{ready ? "目录已加载" : failed ? "读取创作端模型失败，当前列表无法确认。" : "正在加载模型…"}</span>
                    {failed ? (
                        <Button size="small" onClick={reloadCatalog}>
                            重试
                        </Button>
                    ) : null}
                </div>
                <p className="admin-creation-catalog-note">
                    <Info aria-hidden="true" />
                    不指定参考素材，不发送生成请求。
                </p>
            </div>
        </AdminModal>
    );
}
