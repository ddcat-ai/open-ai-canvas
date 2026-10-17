import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { App } from "antd";

import { applyCanvasImageRotation, commitCanvasImageRotation, canRotateCanvasImage, imageRotationSourceKey, type ImageRotationDirection } from "@/lib/canvas/canvas-image-rotation";
import { createCanvasImageEditCopy } from "@/lib/canvas/canvas-image-edit-copy";
import { getActiveUserScope } from "@/lib/user-scope";
import { prepareCanvasImageRotation } from "@/services/canvas-image-rotation";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

export function useCanvasImageRotation({
    projectId,
    nodesRef,
    setNodes,
    setConnections,
    setSelectedNodeIds,
    readOnly,
}: {
    projectId: string;
    nodesRef: { current: CanvasNodeData[] };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    readOnly: boolean;
}) {
    const { message } = App.useApp();
    const [rotatingNodeId, setRotatingNodeId] = useState<string | null>(null);
    const busyRef = useRef(false);
    const lifetimeRef = useRef(0);
    const writableRef = useRef(!readOnly);
    writableRef.current = !readOnly;
    useEffect(() => {
        lifetimeRef.current += 1;
        return () => {
            lifetimeRef.current += 1;
        };
    }, [projectId]);

    const rotateImageNode = useCallback(
        async (nodeId: string, direction: ImageRotationDirection) => {
            const node = nodesRef.current.find((candidate) => candidate.id === nodeId);
            if (!writableRef.current || !node || !canRotateCanvasImage(node) || busyRef.current) return;
            busyRef.current = true;
            setRotatingNodeId(nodeId);
            const lifetime = lifetimeRef.current;
            const scope = getActiveUserScope();
            const sourceKey = imageRotationSourceKey(node);
            const valid = () => lifetime === lifetimeRef.current && scope === getActiveUserScope() && writableRef.current;
            const hide = message.loading({ content: "正在校正图片方向…", duration: 0 });
            try {
                const needsCopy = !node.metadata?.imageEditSourceNodeId && direction !== 0;
                // A new copy starts from the current visible orientation, including older rotated nodes.
                const input = needsCopy ? { ...node, metadata: { ...node.metadata, imageRotation: undefined } } : node;
                const result = await prepareCanvasImageRotation(input, direction, valid);
                if (!result || !valid()) return;
                const latest = nodesRef.current.find((candidate) => candidate.id === nodeId);
                if (!latest || !canRotateCanvasImage(latest) || imageRotationSourceKey(latest) !== sourceKey) {
                    message.info("图片已发生变化，本次旋转未覆盖新的内容");
                    return;
                }
                if (needsCopy) {
                    const copy = createCanvasImageEditCopy(latest, nodesRef.current);
                    if (!copy) return;
                    setNodes((current) => [...current, applyCanvasImageRotation(copy.node, result.rotation)]);
                    setConnections((current) => [...current, copy.connection]);
                    setSelectedNodeIds(new Set([copy.node.id]));
                } else setNodes((current) => commitCanvasImageRotation(current, nodeId, sourceKey, result.rotation));
                if (result.pendingRemoteUpload) message.warning("方向已校正，图片暂存本机；恢复网络后会继续同步");
                else message.success(needsCopy ? "已创建旋转副本，原图保留" : direction === 0 ? "已恢复副本的初始方向" : "已调整编辑副本的方向");
            } catch (error) {
                if (valid()) message.error(error instanceof Error ? error.message : "图片旋转失败");
            } finally {
                hide();
                busyRef.current = false;
                setRotatingNodeId(null);
            }
        },
        [message, nodesRef, setNodes, setConnections, setSelectedNodeIds],
    );
    return { rotateImageNode, rotatingNodeId };
}
