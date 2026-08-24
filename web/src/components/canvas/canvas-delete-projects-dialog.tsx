import { App, Button, Modal } from "antd";
import { useState } from "react";

import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { deleteCanvasProjectsWithRemoteSync } from "@/services/user-data-sync";
import { useTranslation } from "react-i18next";

export function CanvasDeleteProjectsDialog() {
    const { t } = useTranslation("canvas");
    const { message } = App.useApp();
    const ids = useCanvasUiStore((state) => state.deleteProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const removeSelectedIds = useCanvasUiStore((state) => state.removeSelectedProjectIds);
    const cleanupImages = useAssetStore((state) => state.cleanupImages);
    const [deleting, setDeleting] = useState(false);
    const confirm = async () => {
        setDeleting(true);
        try {
            await deleteCanvasProjectsWithRemoteSync(ids);
            cleanupImages();
            removeSelectedIds(ids);
            setDeleteIds([]);
        } catch (error) {
            message.error(error instanceof Error ? t("canvas:failed-to-delete-canvas-param", { message: error.message }) : t("canvas:failed-to-delete-canvas-try-again-later"));
        } finally {
            setDeleting(false);
        }
    };

    return (
        <Modal
            title={t("domain:delete-canvases")}
            open={ids.length > 0}
            centered
            onCancel={() => setDeleteIds([])}
            footer={
                <>
                    <Button onClick={() => setDeleteIds([])}>{t("canvas:cancel-11")}</Button>
                    <Button danger type="primary" loading={deleting} onClick={() => void confirm()}>
                        {t("canvas:delete-5")}
                    </Button>
                </>
            }
        >
            <p className="text-sm text-stone-500">
                {t("domain:will-be-deleted-2")} {ids.length} {t("domain:canvases-their-nodes-and-connections-will-be-removed-too")}
            </p>
        </Modal>
    );
}
