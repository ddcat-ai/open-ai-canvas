import { App, Button, Modal } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { deleteCanvasProjectsWithRemoteSync } from "@/services/user-data-sync";

export function CanvasDeleteProjectsDialog() {
    const { t } = useTranslation();
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
            void cleanupImages();
            removeSelectedIds(ids);
            setDeleteIds([]);
        } catch (error) {
            message.error(error instanceof Error ? t("canvasA.deleteProjects.failedWithReason", { reason: error.message }) : t("canvasA.deleteProjects.failed"));
        } finally {
            setDeleting(false);
        }
    };

    return (
        <Modal
            title={t("canvasA.deleteProjects.title")}
            open={ids.length > 0}
            centered
            onCancel={() => setDeleteIds([])}
            footer={
                <>
                    <Button onClick={() => setDeleteIds([])}>{t("common.cancel")}</Button>
                    <Button danger type="primary" loading={deleting} onClick={() => void confirm()}>
                        {t("common.delete")}
                    </Button>
                </>
            }
        >
            <p className="text-sm text-stone-500">{t("canvasA.deleteProjects.body", { count: ids.length })}</p>
        </Modal>
    );
}
