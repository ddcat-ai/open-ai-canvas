import { Tooltip } from "antd";
import { Bone, Box, Camera, Crosshair, Lightbulb, Move3D, Palette, Rotate3D, Scaling, UserRound } from "lucide-react";
import type { ReactNode } from "react";

import type { DirectorRenderMode } from "@/types/director";
import { useTranslation } from "react-i18next";

type DirectorViewportDockProps = {
    transformMode: "translate" | "rotate" | "scale";
    renderMode: DirectorRenderMode;
    onTransformModeChange: (mode: DirectorViewportDockProps["transformMode"]) => void;
    onRenderModeChange: (mode: DirectorRenderMode) => void;
    onAddActor: () => void;
    onAddBox: () => void;
    onAddLight: () => void;
    onAddCamera: () => void;
    onAlignCamera: () => void;
};

export function DirectorViewportDock({ transformMode, renderMode, onTransformModeChange, onRenderModeChange, onAddActor, onAddBox, onAddLight, onAddCamera, onAlignCamera }: DirectorViewportDockProps) {
    const { t } = useTranslation("canvas");
    return (
        <nav className="director-viewport-dock" aria-label={t("domain:director-stage-viewport-tools")}>
            <DockButton label={t("domain:move-objects")} active={transformMode === "translate"} onClick={() => onTransformModeChange("translate")}>
                <Move3D />
            </DockButton>
            <DockButton label={t("domain:rotate-objects")} active={transformMode === "rotate"} onClick={() => onTransformModeChange("rotate")}>
                <Rotate3D />
            </DockButton>
            <DockButton label={t("domain:scale-objects")} active={transformMode === "scale"} onClick={() => onTransformModeChange("scale")}>
                <Scaling />
            </DockButton>
            <DockDivider />
            <DockButton label={t("domain:add-actor")} onClick={onAddActor}>
                <UserRound />
            </DockButton>
            <DockButton label={t("domain:add-cube")} onClick={onAddBox}>
                <Box />
            </DockButton>
            <DockButton label={t("canvas:add-lights")} onClick={onAddLight}>
                <Lightbulb />
            </DockButton>
            <DockButton label={t("canvas:add-camera")} onClick={onAddCamera}>
                <Camera />
            </DockButton>
            <DockButton label={t("canvas:align-camera-to-current-view-2")} onClick={onAlignCamera}>
                <Crosshair />
            </DockButton>
            <DockDivider />
            <DockButton label={t("domain:composition-preview")} active={renderMode === "beauty"} onClick={() => onRenderModeChange("beauty")}>
                <Camera />
            </DockButton>
            <DockButton label={t("canvas:colored-clay")} active={renderMode === "clay"} onClick={() => onRenderModeChange("clay")}>
                <Palette />
            </DockButton>
            <DockButton label={t("domain:bones-view")} active={renderMode === "pose"} onClick={() => onRenderModeChange("pose")}>
                <Bone />
            </DockButton>
        </nav>
    );
}

function DockButton({ label, active, children, onClick }: { label: string; active?: boolean; children: ReactNode; onClick: () => void }) {
    return (
        <Tooltip title={label} placement="top">
            <button type="button" className={`director-viewport-dock-button ${active ? "is-active" : ""}`} aria-label={label} aria-pressed={active} onClick={onClick}>
                {children}
            </button>
        </Tooltip>
    );
}

function DockDivider() {
    return <span className="director-viewport-dock-divider" aria-hidden />;
}
