import { message } from "antd";
import type { NavigateFunction } from "react-router";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { CanvasNodeType } from "@/types/canvas";
import type { PromptPresetItem } from "./prompt-data";

/**
 * 将灵感预设一键导入至自由画布
 * 1. 查找或创建画布项目
 * 2. 创建图片/视频节点，自动注入灵感提示词与推荐画幅
 * 3. 即时持久化并跳转至画布工作区
 */
export function applyPromptToCanvas(preset: PromptPresetItem, navigate: NavigateFunction) {
    try {
        const store = useCanvasStore.getState();
        let targetProjectId = store.projects[0]?.id;
        if (!targetProjectId) {
            targetProjectId = store.createProject("灵感创作画布");
        }

        const project = store.projects.find((p) => p.id === targetProjectId) || store.projects[0];
        const existingNodes = project?.nodes || [];

        const offsetIndex = existingNodes.length % 6;
        const basePosition = {
            x: 400 + (offsetIndex % 3) * 360,
            y: 260 + Math.floor(offsetIndex / 3) * 320,
        };

        const isVideo = preset.kind === "video";
        const nodeType = isVideo ? CanvasNodeType.Video : CanvasNodeType.Image;
        const coverUrl = preset.previewImage || preset.previewThumbnail || "";
        const videoUrl = preset.previewVideo || "";
        const contentUrl = isVideo ? (videoUrl || coverUrl) : coverUrl;

        const newNode = createCanvasNode(nodeType, basePosition, {
            content: contentUrl,
            prompt: preset.positivePrompt,
            composerContent: preset.positivePrompt,
            status: "idle",
            size: preset.recommendedParams?.aspectRatio || (isVideo ? "16:9" : "1:1"),
            ...(isVideo ? {
                videoPreview: coverUrl ? { content: coverUrl } : undefined,
                previewContent: coverUrl || undefined,
                seconds: String(preset.recommendedParams?.duration || 5),
            } : {
                generationType: "generation",
            }),
        });

        newNode.title = preset.title;

        store.updateProject(targetProjectId, {
            nodes: [...existingNodes, newNode],
        });

        message.success(`已将灵感「${preset.title}」添加到画布`);
        navigate(`/canvas/${targetProjectId}`);
    } catch (error) {
        console.error("添加灵感到画布失败:", error);
        message.error("添加到画布失败，请重试");
    }
}
