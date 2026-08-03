import { Clapperboard, FolderOpen, Image as ImageIcon, Layers3, Music2, Palette, PanelTop, Pencil, Type, UploadCloud, UserRound, Video } from "lucide-react";

import { registerAddNodeMenuCommands, type AddNodeMenuCommand } from "@/lib/canvas/tool-registry";

export const addNodeMenuCommands: AddNodeMenuCommand[] = [
    // 创作节点
    { id: "text", label: "文本", icon: <Type />, section: "node", defaultOrder: 10, run: (ctx) => ctx.handlers.onAddText() },
    { id: "style", label: "项目画风", icon: <Palette />, section: "node", defaultOrder: 20, applicable: (ctx) => !ctx.isProjectLinked, run: (ctx) => ctx.handlers.onChooseStyle() },
    { id: "script", label: "分镜脚本", icon: <Clapperboard />, badge: "核心", section: "node", defaultOrder: 30, run: (ctx) => ctx.handlers.onAddScript() },
    { id: "frame", label: "背板", icon: <PanelTop />, section: "node", defaultOrder: 40, applicable: (ctx) => ctx.workspaceMode !== "simple", run: (ctx) => ctx.handlers.onAddFrame() },
    { id: "drawing", label: "绘图", icon: <Pencil />, section: "node", defaultOrder: 50, run: (ctx) => ctx.handlers.onAddDrawing() },
    { id: "image", label: "图片", icon: <ImageIcon />, section: "node", defaultOrder: 60, run: (ctx) => ctx.handlers.onAddImage() },
    { id: "video", label: "视频", icon: <Video />, section: "node", defaultOrder: 70, run: (ctx) => ctx.handlers.onAddVideo() },
    { id: "director", label: "导演台", icon: <Layers3 />, badge: "3D", section: "node", defaultOrder: 80, applicable: (ctx) => ctx.workspaceMode !== "simple", run: (ctx) => ctx.handlers.onOpenDirector() },
    { id: "audio", label: "音频", icon: <Music2 />, section: "node", defaultOrder: 90, applicable: (ctx) => ctx.workspaceMode !== "simple", run: (ctx) => ctx.handlers.onAddAudio() },
    // 导入资源
    { id: "upload", label: "上传文件", icon: <UploadCloud />, section: "resource", defaultOrder: 10, run: (ctx) => ctx.handlers.onUpload() },
    { id: "project-character", label: "添加角色卡", icon: <UserRound />, section: "resource", defaultOrder: 20, applicable: (ctx) => ctx.isProjectLinked, run: (ctx) => ctx.handlers.onOpenProjectCharacters() },
    { id: "assets", label: "素材库", icon: <FolderOpen />, section: "resource", defaultOrder: 30, applicable: (ctx) => !ctx.isProjectLinked, run: (ctx) => ctx.handlers.onOpenMyAssets() },
];

registerAddNodeMenuCommands(addNodeMenuCommands);
