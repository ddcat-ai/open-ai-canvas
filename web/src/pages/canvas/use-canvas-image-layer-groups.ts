import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { experimentalLayerSignature, imageLayerCompositeSignature } from "@/lib/canvas/canvas-image-layers";
import { buildExperimentalImageLayerResult, imageMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { composeCanvasImageLayerGroup } from "@/services/canvas-image-layer-compositor";
import { uploadImage } from "@/services/image-storage";
import { prepareCanvasMediaNodeAsset } from "@/services/canvas-generation-consumer";
import { runGenerationConsumer } from "@/services/generation-consumer-lifecycle";
import type { CanvasNodeData } from "@/types/canvas";

/** 只观察合成参数和媒体身份；拖动画布或展开/收起不会重建或请求模型。 */
export function useCanvasImageLayerGroups({
    projectId,
    enabled,
    nodes,
    nodesRef,
    setNodes,
    runningNodeId,
    activeLayerGroupIds,
}: {
    projectId: string;
    enabled: boolean;
    nodes: CanvasNodeData[];
    nodesRef: { current: CanvasNodeData[] };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    runningNodeId?: string | null;
    activeLayerGroupIds?: ReadonlySet<string>;
}) {
    const jobs = useRef(new Map<string, string>());
    const failed = useRef(new Map<string, string>());
    const scope = useRef(0);
    const consumerController = useRef(new AbortController());
    useEffect(() => {
        const controller = new AbortController();
        consumerController.current = controller;
        scope.current += 1;
        jobs.current.clear();
        failed.current.clear();
        return () => {
            controller.abort();
            scope.current += 1;
        };
    }, [projectId]);
    useEffect(() => {
        if (!enabled) return;
        for (const root of nodes) {
            if (root.metadata?.status === "loading" && root.metadata.imageLayerWorkflow?.stage === "planning" && !activeLayerGroupIds?.has(root.id)) {
                setNodes((current) => current.map((node) => (node.id === root.id ? { ...node, metadata: { ...node.metadata, status: "error", errorDetails: "拆解规划等待已中断，未自动提交拆图任务；请重新发起拆分。" } } : node)));
                continue;
            }
            const plan = root.metadata?.experimentalLayerPlan;
            if (!plan || jobs.current.has(root.id)) continue;
            const children = plan.requests.map((request) => nodes.find((node) => node.id === request.nodeId));
            const ready = children.filter((node) => node?.metadata?.content && node.metadata.status === "success" && (!node.metadata.layerExtraction?.phase || node.metadata.layerExtraction.phase === "complete"));
            if (ready.length !== children.length && (activeLayerGroupIds?.has(root.id) || runningNodeId === root.id || children.some((node) => node?.metadata?.status === "loading" && node.metadata.taskId))) continue;
            if (!ready.length) {
                if (root.metadata?.status !== "error") {
                    setNodes((current) => current.map((node) => (node.id === root.id ? { ...node, metadata: { ...node.metadata, status: "error", errorDetails: "拆层未完成：没有已验收图层；不会自动继续扣费。请展开检查并单独重试失败层。" } } : node)));
                }
                continue;
            }
            const signature = experimentalLayerSignature(root, nodes);
            if (plan.errorSignature === signature || plan.composedSignature === signature) continue;
            const editSignature = root.metadata?.imageLayerGroup ? imageLayerCompositeSignature(root.metadata.imageLayerGroup, nodes) : undefined;
            const epoch = scope.current;
            jobs.current.set(root.id, signature);
            void runGenerationConsumer(consumerController.current.signal, async (signal) => {
                const result = await buildExperimentalImageLayerResult(root, nodes);
                if (scope.current !== epoch || signal.aborted) return;
                const preparedNode = await prepareCanvasMediaNodeAsset(projectId, result.node, signal);
                result.additionalNodes = await Promise.all(result.additionalNodes.map((node) => prepareCanvasMediaNodeAsset(projectId, node, signal)));
                if (scope.current !== epoch || signal.aborted) return;
                setNodes((current) => {
                    const live = current.find((node) => node.id === root.id);
                    if (
                        !live?.metadata?.experimentalLayerPlan ||
                        experimentalLayerSignature(live, current) !== signature ||
                        (live.metadata.imageLayerGroup ? imageLayerCompositeSignature(live.metadata.imageLayerGroup, current) : undefined) !== editSignature
                    )
                        return current;
                    const byId = new Map(result.additionalNodes.map((node) => [node.id, node]));
                    return current.map((node) =>
                        node.id === root.id
                            ? {
                                  ...preparedNode,
                                  title: node.title,
                                  position: node.position,
                                  ...(node.width !== root.width || node.height !== root.height ? { width: node.width, height: node.height } : {}),
                                  metadata: { ...preparedNode.metadata, imageBatchExpanded: node.metadata?.imageBatchExpanded ?? false },
                              }
                            : byId.has(node.id)
                              ? { ...node, title: byId.get(node.id)!.title, metadata: { ...node.metadata, ...byId.get(node.id)!.metadata, batchRootId: root.id } }
                              : node,
                    );
                });
            })
                .catch((error) => {
                    if (scope.current !== epoch || (error instanceof Error && error.name === "AbortError")) return;
                    setNodes((current) =>
                        current.map((node) =>
                            node.id === root.id &&
                            experimentalLayerSignature(node, current) === signature &&
                            node.metadata?.experimentalLayerPlan &&
                            (node.metadata.imageLayerGroup ? imageLayerCompositeSignature(node.metadata.imageLayerGroup, current) : undefined) === editSignature
                                ? {
                                      ...node,
                                      metadata: {
                                          ...node.metadata,
                                          status: node.metadata.content ? node.metadata.status : "error",
                                          errorDetails: error instanceof Error ? error.message : "实验拆层合成失败",
                                          imageLayerGroup: node.metadata.imageLayerGroup ? { ...node.metadata.imageLayerGroup, compositeStatus: "error", compositeError: error instanceof Error ? error.message : "实验拆层合成失败" } : undefined,
                                          experimentalLayerPlan: { ...node.metadata.experimentalLayerPlan, errorSignature: signature },
                                      },
                                  }
                                : node,
                        ),
                    );
                })
                .finally(() => {
                    if (scope.current === epoch) {
                        jobs.current.delete(root.id);
                        setNodes((current) => [...current]);
                    }
                });
        }
    }, [enabled, nodes, runningNodeId, activeLayerGroupIds, projectId, setNodes]);
    useEffect(() => {
        if (!enabled) return;
        for (const root of nodes) {
            const group = root.metadata?.imageLayerGroup;
            if (!group || root.metadata?.status === "loading") continue;
            const signature = imageLayerCompositeSignature(group, nodes);
            if (group.compositeSignature === signature) {
                if (group.compositeStatus !== "ready")
                    setNodes((current) =>
                        current.map((node) => {
                            const live = node.metadata?.imageLayerGroup;
                            return node.id === root.id && live && imageLayerCompositeSignature(live, current) === live.compositeSignature
                                ? { ...node, metadata: { ...node.metadata, imageLayerGroup: { ...live, compositeStatus: "ready", compositeError: undefined } } }
                                : node;
                        }),
                    );
                continue;
            }
            if (jobs.current.has(root.id) || (group.compositeStatus === "error" && failed.current.get(root.id) === signature)) continue;
            const epoch = scope.current;
            jobs.current.set(root.id, signature);
            setNodes((current) =>
                current.map((node) =>
                    node.id === root.id && node.metadata?.imageLayerGroup
                        ? {
                              ...node,
                              metadata: { ...node.metadata, imageLayerGroup: { ...node.metadata.imageLayerGroup, compositeStatus: "updating", compositeError: undefined } },
                          }
                        : node,
                ),
            );
            void runGenerationConsumer(consumerController.current.signal, async (signal) => {
                const blob = await composeCanvasImageLayerGroup(group, nodes);
                const liveGroup = nodesRef.current.find((node) => node.id === root.id)?.metadata?.imageLayerGroup;
                if (scope.current !== epoch || signal.aborted || !liveGroup || imageLayerCompositeSignature(liveGroup, nodesRef.current) !== signature) return;
                const uploaded = await uploadImage(blob);
                if (uploaded.pendingRemoteUpload) throw new Error("合成图尚未保存到服务端，请重试");
                if (scope.current !== epoch || signal.aborted) return;
                const prepared = await prepareCanvasMediaNodeAsset(projectId, { ...root, metadata: { ...root.metadata, ...imageMetadata(uploaded), assetId: undefined } }, signal);
                if (scope.current !== epoch || signal.aborted) return;
                setNodes((current) =>
                    current.map((node) => {
                        const liveGroup = node.metadata?.imageLayerGroup;
                        if (node.id !== root.id || !liveGroup || imageLayerCompositeSignature(liveGroup, current) !== signature) return node;
                        return {
                            ...node,
                            metadata: { ...node.metadata, ...imageMetadata(uploaded), assetId: prepared.metadata?.assetId, imageLayerGroup: { ...liveGroup, compositeSignature: signature, compositeStatus: "ready", compositeError: undefined } },
                        };
                    }),
                );
                failed.current.delete(root.id);
            })
                .catch((error) => {
                    if (scope.current !== epoch || (error instanceof Error && error.name === "AbortError")) return;
                    failed.current.set(root.id, signature);
                    setNodes((current) =>
                        current.map((node) => {
                            const liveGroup = node.metadata?.imageLayerGroup;
                            if (node.id !== root.id || !liveGroup || imageLayerCompositeSignature(liveGroup, current) !== signature) return node;
                            return { ...node, metadata: { ...node.metadata, imageLayerGroup: { ...liveGroup, compositeStatus: "error", compositeError: error instanceof Error ? error.message : "合成图更新失败" } } };
                        }),
                    );
                })
                .finally(() => {
                    if (scope.current === epoch) {
                        jobs.current.delete(root.id);
                        // 期间若有新编辑，再触发一次观察，旧异步结果不会覆盖新版本。
                        setNodes((current) => [...current]);
                    }
                });
        }
    }, [enabled, nodes, nodesRef, projectId, setNodes]);
}
