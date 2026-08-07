import { Tooltip } from "antd";
import { Bone, Box, Camera, Crosshair, Lightbulb, Move3D, Palette, Rotate3D, Scaling, UserRound } from "lucide-react";
import type { ReactNode } from "react";

import type { DirectorRenderMode } from "@/types/director";

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
    return (
        <nav className="director-viewport-dock" aria-label="导演台视口工具">
            <DockButton label="移动对象" active={transformMode === "translate"} onClick={() => onTransformModeChange("translate")}><Move3D /></DockButton>
            <DockButton label="旋转对象" active={transformMode === "rotate"} onClick={() => onTransformModeChange("rotate")}><Rotate3D /></DockButton>
            <DockButton label="缩放对象" active={transformMode === "scale"} onClick={() => onTransformModeChange("scale")}><Scaling /></DockButton>
            <DockDivider />
            <DockButton label="添加演员" onClick={onAddActor}><UserRound /></DockButton>
            <DockButton label="添加立方体" onClick={onAddBox}><Box /></DockButton>
            <DockButton label="添加灯光" onClick={onAddLight}><Lightbulb /></DockButton>
            <DockButton label="添加摄影机" onClick={onAddCamera}><Camera /></DockButton>
            <DockButton label="摄影机对齐当前视图" onClick={onAlignCamera}><Crosshair /></DockButton>
            <DockDivider />
            <DockButton label="构图预览" active={renderMode === "beauty"} onClick={() => onRenderModeChange("beauty")}><Camera /></DockButton>
            <DockButton label="彩色白膜" active={renderMode === "clay"} onClick={() => onRenderModeChange("clay")}><Palette /></DockButton>
            <DockButton label="骨骼视图" active={renderMode === "pose"} onClick={() => onRenderModeChange("pose")}><Bone /></DockButton>
        </nav>
    );
}

function DockButton({ label, active, children, onClick }: { label: string; active?: boolean; children: ReactNode; onClick: () => void }) {
    return (
        <Tooltip title={label} placement="top">
            <button type="button" className={`director-viewport-dock-button ${active ? "is-active" : ""}`} aria-label={label} aria-pressed={active} onClick={onClick}>{children}</button>
        </Tooltip>
    );
}

function DockDivider() {
    return <span className="director-viewport-dock-divider" aria-hidden />;
}
