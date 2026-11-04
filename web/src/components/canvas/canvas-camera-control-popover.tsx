import { useState } from "react";
import { Camera } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CameraControlOptions } from "@/lib/canvas/camera-prompt-library";
import { CanvasNodeCameraPanel } from "./canvas-node-camera-dialog";

type CanvasCameraControlPopoverProps = {
    cameraControl?: CameraControlOptions;
    onCameraControlChange: (options: CameraControlOptions) => void;
    theme: CanvasTheme;
    compact?: boolean;
};

export function CanvasCameraControlPopover({ cameraControl, onCameraControlChange, theme, compact = false }: CanvasCameraControlPopoverProps) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const cameraEnabled = cameraControl?.enabled === true;
    return (
        <>
            <button
                type="button"
                className={`canvas-node-composer-camera-tools-trigger inline-flex shrink-0 items-center gap-1 rounded-full px-2 text-[var(--fs-tiny)] transition-colors ${compact ? "is-compact size-8 justify-center" : "h-8"}`}
                style={{
                    background: cameraEnabled ? `${theme.node.activeStroke}66` : theme.node.fill,
                    color: cameraEnabled ? theme.node.panel : theme.node.text,
                }}
                aria-pressed={cameraEnabled}
                aria-label={t("canvasA.camera.label")}
                title={cameraEnabled ? t("canvasA.camera.labelEnabled") : t("canvasA.camera.label")}
                onClick={() => setOpen(true)}
            >
                <Camera className="size-3.5" />
                {!compact ? <span>{t("canvasA.camera.short")}</span> : null}
            </button>
            {open ? (
                <AppModal title={null} closable={false} open centered footer={null} width={780} flush onCancel={() => setOpen(false)}>
                    <CanvasNodeCameraPanel
                        cameraControl={cameraControl}
                        onClose={() => setOpen(false)}
                        onConfirm={(options) => {
                            onCameraControlChange(options);
                            setOpen(false);
                        }}
                    />
                </AppModal>
            ) : null}
        </>
    );
}
