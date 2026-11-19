import { useCallback, useState } from "react";
import { App } from "antd";
import { nanoid } from "nanoid";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { ll2CanvasUpscaleTargets, ll2CanvasUpscaleSourceUrl, ll2CanvasVideoSeconds } from "@/lib/ll2-canvas-upscale";
import { ll2UpscaleEstimate, ll2UpscaleTargetLabel, type LL2UpscaleTarget } from "@/lib/ll2-upscale";
import { ll2FetchHdBlob, ll2RunHd } from "@/services/ll2/ll2-hd";
import { uploadMediaFile } from "@/services/file-storage";
import { useLL2Store } from "@/stores/use-ll2-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

type StateWriter<T> = (updater: T | ((current: T) => T)) => void;

type Args = {
    projectId: string;
    setNodes: StateWriter<CanvasNodeData[]>;
    setConnections: StateWriter<Array<{ id: string; fromNodeId: string; toNodeId: string }>>;
    setSelectedNodeIds: (updater: Set<string> | ((current: Set<string>) => Set<string>)) => void;
    setSelectedConnectionId: (updater: string | null | ((current: string | null) => string | null)) => void;
};

export function useLL2CanvasUpscale({ projectId, setNodes, setConnections, setSelectedNodeIds, setSelectedConnectionId }: Args) {
    void projectId;
    const apiKey = useLL2Store((state) => state.apiKey);
    const { message } = App.useApp();
    const [upscaleNodeId, setUpscaleNodeId] = useState<string | null>(null);

    const openUpscale = useCallback(
        (node: CanvasNodeData) => {
            if (!apiKey.trim()) {
                message.warning("先连接 LL2 Key，超分才用得上");
                return;
            }
            if (!ll2CanvasUpscaleSourceUrl(node)) {
                message.warning("这条视频只存在本机，超分要用云端生成的视频；本机文件传不上去");
                return;
            }
            if (!ll2CanvasUpscaleTargets(node).length) {
                message.info("这条视频已经是 4K，不需要再超分");
                return;
            }
            setUpscaleNodeId(node.id);
        },
        [apiKey, message],
    );

    const closeUpscale = useCallback(() => setUpscaleNodeId(null), []);

    const confirmUpscale = useCallback(
        async (node: CanvasNodeData, target: LL2UpscaleTarget) => {
            setUpscaleNodeId(null);
            const videoUrl = ll2CanvasUpscaleSourceUrl(node);
            if (!videoUrl) {
                message.warning("这条视频只存在本机，无法超分");
                return;
            }
            const seconds = ll2CanvasVideoSeconds(node);
            const childId = nanoid();
            const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
            const label = ll2UpscaleTargetLabel(target);
            const estimate = ll2UpscaleEstimate(seconds, target);

            setNodes((current) => [
                ...current,
                {
                    id: childId,
                    type: CanvasNodeType.Video,
                    title: `${label} 超分版`,
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: spec.width,
                    height: spec.height,
                    metadata: {
                        prompt: `LL2 超分（${label}）`,
                        status: "loading",
                        generationMode: "video",
                        model: "auto-hd",
                        vquality: target,
                        taskCreatedAt: new Date().toISOString(),
                        ll2Upscale: { sourceNodeId: node.id, target },
                    },
                },
            ]);
            setConnections((current) => [...current, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setSelectedConnectionId(null);

            try {
                const result = await ll2RunHd({ apiKey, videoUrl, resolution: target, duration: seconds });
                const blob = await ll2FetchHdBlob(result.url, apiKey);
                const uploaded = await uploadMediaFile(blob, "ll2-hd");
                setNodes((current) =>
                    current.map((item) =>
                        item.id === childId
                            ? {
                                  ...item,
                                  title: `${label} 超分版`,
                                  metadata: {
                                      ...item.metadata,
                                      content: uploaded.url,
                                      storageKey: uploaded.storageKey,
                                      bytes: uploaded.bytes,
                                      mimeType: uploaded.mimeType,
                                      durationMs: uploaded.durationMs,
                                      hasAudio: uploaded.hasAudio,
                                      naturalWidth: uploaded.width,
                                      naturalHeight: uploaded.height,
                                      status: "success",
                                      errorDetails: undefined,
                                  },
                              }
                            : item,
                    ),
                );
                message.success(`超分完成：${label} 版已放到右边（${estimate.label}，按成片秒数计费）`);
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                setNodes((current) => current.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: "error", errorDetails: reason } } : item)));
                message.error(reason);
            }
        },
        [apiKey, message, setConnections, setNodes, setSelectedConnectionId, setSelectedNodeIds],
    );

    return { upscaleNodeId, openUpscale, closeUpscale, confirmUpscale };
}
