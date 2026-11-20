// 刷新恢复：LL2 直连任务存在节点 metadata.ll2TaskId 里，页面重载后用它在后台继续查询，
// 把已经生成好的片子补回节点，避免用户以为白花钱又要重新生成。
import { useEffect, useRef } from "react";

import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { useLL2Store } from "@/stores/use-ll2-store";
import { resumeLL2CanvasVideo } from "./canvas-ll2-video-execution";

export function useCanvasLL2Recovery({
    nodes,
    setNodes,
    enabled,
}: {
    nodes: CanvasNodeData[];
    setNodes: (updater: (current: CanvasNodeData[]) => CanvasNodeData[]) => void;
    enabled: boolean;
}) {
    const runningRef = useRef(new Set<string>());
    // 只恢复「页面打开时就已经在 loading」的节点；本轮新发起的任务交给正常轮询，避免重复查询/重复落盘。
    const bootRef = useRef<Set<string> | null>(null);
    if (bootRef.current === null && enabled) {
        bootRef.current = new Set(
            nodes.filter((node) => node.type === CanvasNodeType.Video && node.metadata?.status === "loading" && node.metadata.ll2Direct && node.metadata.ll2TaskId).map((node) => node.id),
        );
    }

    useEffect(() => {
        if (!enabled || !useLL2Store.getState().apiKey.trim()) return;
        for (const node of nodes) {
            const metadata = node.metadata;
            if (node.type !== CanvasNodeType.Video) continue;
            if (metadata?.status !== "loading" || !metadata.ll2Direct || !metadata.ll2TaskId) continue;
            if (!bootRef.current?.has(node.id)) continue;
            if (runningRef.current.has(node.id)) continue;
            // 刚开始的任务可能还在正常轮询，别去抢它的结果；只恢复明显被刷新打断的。
            const createdAt = metadata.taskCreatedAt ? new Date(metadata.taskCreatedAt).getTime() : 0;
            if (!createdAt || Date.now() - createdAt < 15000) continue;
            runningRef.current.add(node.id);
            const taskId = metadata.ll2TaskId;
            const nodeId = node.id;
            void (async () => {
                try {
                    const result = await resumeLL2CanvasVideo({
                        model: metadata.model || "",
                        taskId,
                        prompt: metadata.prompt || "",
                        seconds: Number(metadata.seconds) || 4,
                        resolution: metadata.vquality,
                        ratio: metadata.size,
                        upscaleTarget: metadata.ll2UpscaleTarget,
                        // 超分阶段刷新过：按已有 hdTaskId 续查，不再新建超分任务。
                        hdTaskId: metadata.ll2HdTaskId,
                        onHdTaskId: (hdTaskId) => setNodes((current) => current.map((item) => (item.id === nodeId ? { ...item, metadata: { ...item.metadata, ll2HdTaskId: hdTaskId } } : item))),
                        onStage: (stage) => setNodes((current) => current.map((item) => (item.id === nodeId ? { ...item, metadata: { ...item.metadata, ll2Stage: stage } } : item))),
                    });
                    setNodes((current) =>
                        current.map((item) =>
                            item.id === nodeId
                                ? {
                                      ...item,
                                      metadata: {
                                          ...item.metadata,
                                          status: "success",
                                          content: result.content,
                                          storageKey: result.storageKey,
                                          ...(result.posterUrl
                                              ? { videoPreview: { content: result.posterUrl, width: result.width || 1280, height: result.height || 720 } }
                                              : {}),
                                          durationMs: result.durationMs,
                                          naturalWidth: result.width,
                                          naturalHeight: result.height,
                                          bytes: result.bytes,
                                          mimeType: result.mimeType,
                                          seconds: String(Math.max(1, Math.round(result.seconds))),
                                          vquality: result.resolution,
                                          requiresAuth: result.requiresAuth,
                                          ll2Stage: undefined,
                                          ll2HdTaskId: undefined,
                                          errorDetails: undefined,
                                      },
                                  }
                                : item,
                        ),
                    );
                } catch (error) {
                    const reason = error instanceof Error ? error.message : String(error);
                    setNodes((current) => current.map((item) => (item.id === nodeId ? { ...item, metadata: { ...item.metadata, ll2Stage: `恢复失败：${reason}` } } : item)));
                } finally {
                    runningRef.current.delete(nodeId);
                }
            })();
        }
    }, [enabled, nodes, setNodes]);
}
