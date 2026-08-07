import { useCallback, type Dispatch, type SetStateAction } from "react";
import { App } from "antd";
import { nanoid } from "nanoid";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import {
    backendProviderConfig,
    buildGenerationConfig,
    generationTaskMetadata,
    resetGenerationTaskMetadata,
} from "@/lib/canvas/canvas-project-generation";
import {
    cinematicStoryboardColumns,
    createCanvasNode,
    createStoryboardRow,
    expandStoryboardTextMentions,
    storyboardRowsFromTask,
    storyboardPromptTemplateMetadata,
} from "@/lib/canvas/canvas-project-domain";
import { ACTION_BOARD_VIDEO_DEFAULT_SIZE, ACTION_BOARD_VIDEO_DEFAULT_VQUALITY, buildActionBoardImagePrompt, buildActionBoardVideoPrompt, classifyActionBoardMention, type ActionBoardPromptMention } from "@/lib/canvas/action-board-video";
import { buildNodeMentionReferences } from "@/lib/canvas/canvas-resource-references";
import { resolveStoryboardGenerationContext } from "@/lib/canvas/canvas-storyboard-context";
import {
    collectStoryboardInputSlots,
    migrateStoryboardContextConnections,
    resolveStoryboardDownstreamRefs,
    storyboardPlanAssetNodes,
} from "@/lib/canvas/storyboard-input-slots";
import { generationErrorMessage } from "@/lib/generation-error";
import { navigateToSettings } from "@/lib/settings-navigation";
import { previewStoryboardPlannerPrompt, type StoryboardPromptPreview } from "@/services/api/auth";
import { createGenerationTask, waitForGenerationTask } from "@/services/api/task-center";
import { modelDisplayName, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import {
    CanvasNodeType,
    type CanvasConnection,
    type CanvasGenerationBatchMode,
    type CanvasNodeData,
    type StoryboardRow,
} from "@/types/canvas";

type UseCanvasStoryboardOptions = {
    projectId: string;
    nodesRef: { current: CanvasNodeData[] };
    connectionsRef: { current: CanvasConnection[] };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    enqueueGenerationBatch: (sourceNodeId: string, mode: CanvasGenerationBatchMode, targets: Array<{ rowId: string; nodeId: string }>) => string | undefined;
};

const NODE_STATUS_IDLE = "idle" as const;
const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_ERROR = "error" as const;

export function useCanvasStoryboard({
    projectId,
    nodesRef,
    connectionsRef,
    setNodes,
    setConnections,
    setSelectedNodeIds,
    enqueueGenerationBatch,
}: UseCanvasStoryboardOptions) {
    const { message, modal } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);

    const confirmGenerationSubmission = useCallback((count: number, model: string, taskLabel: string) => new Promise<boolean>((resolve) => {
        if (!count) return resolve(false);
        modal.confirm({
            title: `确认提交 ${count} 个${taskLabel}任务`,
            content: `任务数：${count}；模型：${modelDisplayName(effectiveConfig, model)}。当前没有可用价格数据，将提交 ${count} 个外部模型任务。`,
            okText: "确认生成",
            cancelText: "取消",
            centered: true,
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
        });
    }), [effectiveConfig, modal]);

    const updateScriptRows = useCallback((nodeId: string, updater: (rows: StoryboardRow[]) => StoryboardRow[]) => {
        setNodes((current) => current.map((node) => node.id === nodeId ? {
            ...node,
            metadata: {
                ...node.metadata,
                storyboard: {
                    rows: updater(node.metadata?.storyboard?.rows || []),
                    visibleColumns: node.metadata?.storyboard?.visibleColumns || ["shotNumber", "durationSeconds", "plotDescription", "dialogue"],
                    referenceNodeIds: node.metadata?.storyboard?.referenceNodeIds || [],
                },
            },
        } : node));
    }, [setNodes]);

    const replaceScriptRows = useCallback((nodeId: string, rows: StoryboardRow[]) => {
        const rowIds = new Set(rows.map((row) => `row:${row.id}`));
        // 仅清理已删除「镜头行」上的 row: 句柄连线。
        // storyboard:context / 无 handle 的入边（文本设定 @ 源）必须保留，否则自动分镜后用户会感觉“线没了、@ 也没了”。
        const isRowHandle = (handleId?: string) => Boolean(handleId?.startsWith("row:"));
        const previousRows = new Map((nodesRef.current.find((node) => node.id === nodeId)?.metadata?.storyboard?.rows || []).map((row) => [row.id, row]));
        const nextRows = rows.map((row) => invalidateEditedPromptVariables(previousRows.get(row.id), row));
        setConnections((current) => current.filter((connection) => {
            if (connection.fromNodeId === nodeId && isRowHandle(connection.fromHandleId) && !rowIds.has(connection.fromHandleId!)) return false;
            if (connection.toNodeId === nodeId && isRowHandle(connection.toHandleId) && !rowIds.has(connection.toHandleId!)) return false;
            return true;
        }));
        updateScriptRows(nodeId, () => nextRows);
    }, [nodesRef, setConnections, updateScriptRows]);

    const addScriptRow = useCallback((nodeId: string) => {
        updateScriptRows(nodeId, (rows) => [...rows, createStoryboardRow(rows.length + 1)]);
    }, [updateScriptRows]);

    const updateScriptRow = useCallback((nodeId: string, rowId: string, patch: Partial<StoryboardRow>) => {
        updateScriptRows(nodeId, (rows) => rows.map((row) => row.id === rowId ? invalidateEditedPromptVariables(row, { ...row, ...patch }) : row));
    }, [updateScriptRows]);

    const removeScriptRow = useCallback((nodeId: string, rowId: string) => {
        const node = nodesRef.current.find((item) => item.id === nodeId);
        const rows = (node?.metadata?.storyboard?.rows || []).filter((row) => row.id !== rowId).map((row, index) => ({ ...row, shotNumber: index + 1 }));
        replaceScriptRows(nodeId, rows);
    }, [nodesRef, replaceScriptRows]);

    const generateScriptRows = useCallback(async (nodeId: string, prompt: string) => {
        const scriptNode = nodesRef.current.find((node) => node.id === nodeId && node.type === CanvasNodeType.Script);
        if (!scriptNode || !prompt.trim()) return;
        // 旧 context 连接迁移到五槽 handle，保证后续白盒
        const migrated = migrateStoryboardContextConnections(nodeId, nodesRef.current, connectionsRef.current);
        if (migrated !== connectionsRef.current) {
            connectionsRef.current = migrated;
            setConnections(migrated);
        }
        let storyboardContext: ReturnType<typeof resolveStoryboardGenerationContext>;
        try {
            storyboardContext = resolveStoryboardGenerationContext(nodesRef.current, {
                scriptNodeId: nodeId,
                connections: connectionsRef.current,
            });
        } catch (error) {
            message.warning(error instanceof Error ? error.message : "分镜上下文不完整");
            return;
        }
        const shotDuration = scriptNode.metadata?.storyboardShotDuration || "auto";
        const shotDurationSeconds = shotDuration === "auto" ? 0 : Number(shotDuration);
        const shotCount = scriptNode.metadata?.storyboardShotCount || "auto";
        const requestedShotCount = shotCount === "auto" ? 0 : Number(shotCount);
        const mentionReferences = buildNodeMentionReferences(scriptNode, nodesRef.current, connectionsRef.current);
        const expandedPrompt = expandStoryboardTextMentions(prompt, mentionReferences);
        const generationConfig = buildGenerationConfig(effectiveConfig, scriptNode, "text");
        if (!isAiConfigReady(generationConfig, generationConfig.model)) {
            navigateToSettings({ continueCreation: true });
            return;
        }
        // 五槽入边资产（正文/角色/背景/画风/道具），不再一锅端全画布
        const slots = collectStoryboardInputSlots(nodeId, nodesRef.current, connectionsRef.current);
        const canvasAssets = storyboardPlanAssetNodes(slots).map((item) => {
            const kind = item.metadata?.workflowKind === "character" ? "character"
                : item.metadata?.workflowKind === "styleboard" ? "style"
                : item.type === CanvasNodeType.Image || item.type === CanvasNodeType.Drawing ? "image"
                : item.type === CanvasNodeType.Skill ? "skill"
                : "text";
            const text = item.metadata?.workflowKind === "character"
                ? (item.metadata.characterPrompt || item.title)
                : (item.metadata?.content || item.metadata?.prompt || item.title);
            return {
                id: item.id,
                title: item.metadata?.characterName || item.title || kind,
                type: kind,
                tags: [kind, item.metadata?.workflowKind || ""].filter(Boolean),
                prompt: text || item.title,
            };
        });
        const submissionPreview = {
            userPrompt: prompt,
            effectivePrompt: expandedPrompt,
            mentionCount: mentionReferences.filter((item) => item.active).length,
            createdAt: new Date().toISOString(),
        };
        setNodes((current) => current.map((node) => node.id === nodeId ? {
            ...node,
            metadata: {
                ...node.metadata,
                composerContent: prompt,
                lastStoryboardSubmissionPrompt: expandedPrompt,
                lastStoryboardSubmissionAt: submissionPreview.createdAt,
                status: NODE_STATUS_LOADING,
                taskStage: "正在创建任务",
                taskProgress: 0,
                errorDetails: undefined,
            },
        } : node));
        try {
            const task = await createGenerationTask({
                projectId,
                type: "agent_storyboard_rows",
                operation: "storyboard_rows",
                prompt: expandedPrompt,
                model: generationConfig.model,
                input: {
                    canvasSnapshot: { nodes: nodesRef.current, connections: connectionsRef.current },
                    canvasAssets,
                    requirements: "输出可直接编辑并用于批量生成图片和视频的分镜表。必须优先遵循用户 brief 中【文本参考】【角色参考】给出的设定，不得忽略已引用文本另起炉灶。",
                    projectStyle: storyboardContext.projectStyle,
                    characters: storyboardContext.characters,
                    shotDurationSeconds,
                    shotCount: requestedShotCount,
                    config: backendProviderConfig(generationConfig),
                    metadata: { nodeId, submissionPreview },
                },
            });
            setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...generationTaskMetadata(task), status: NODE_STATUS_LOADING } } : node));
            const completed = await waitForGenerationTask(task.id, {
                initialTask: task,
                onTaskUpdate: (next) => setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...generationTaskMetadata(next), status: NODE_STATUS_LOADING } } : node)),
            });
            const result = storyboardRowsFromTask(completed);
            // 自动分镜换行 ID 后：保留 context 入边，并按现存连线回填 referenceNodeIds
            const preservedReferenceIds = Array.from(new Set([
                ...(scriptNode.metadata?.storyboard?.referenceNodeIds || []),
                ...connectionsRef.current
                    .filter((connection) => connection.toNodeId === nodeId && (!connection.toHandleId || connection.toHandleId === "storyboard:context" || !connection.toHandleId.startsWith("row:")))
                    .map((connection) => connection.fromNodeId),
            ]));
            setNodes((current) => current.map((node) => node.id === nodeId ? {
                ...node,
                title: result.title || node.title,
                metadata: {
                    ...node.metadata,
                    status: NODE_STATUS_SUCCESS,
                    errorDetails: undefined,
                    lastStoryboardSubmissionPrompt: expandedPrompt,
                    lastStoryboardSubmissionAt: submissionPreview.createdAt,
                    ...generationTaskMetadata(completed),
                    storyboard: {
                        rows: result.rows,
                        visibleColumns: cinematicStoryboardColumns(node.metadata?.storyboard?.visibleColumns),
                        referenceNodeIds: preservedReferenceIds,
                    },
                },
            } : node));
            message.success(`已生成 ${result.rows.length} 个镜头`);
            return true;
        } catch (error) {
            const details = generationErrorMessage(error);
            setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails: details } } : node));
            message.error(details);
            return false;
        }
    }, [connectionsRef, effectiveConfig, isAiConfigReady, message, nodesRef, projectId, setConnections, setNodes]);

    /** 与 generateScriptRows 同一上下文，调用后端 compile 预览完整规划 Prompt。 */
    const previewScriptPlannerPrompt = useCallback(async (nodeId: string, prompt: string): Promise<StoryboardPromptPreview> => {
        const scriptNode = nodesRef.current.find((node) => node.id === nodeId && node.type === CanvasNodeType.Script);
        if (!scriptNode || !prompt.trim()) {
            throw new Error("请先填写 brief");
        }
        const migrated = migrateStoryboardContextConnections(nodeId, nodesRef.current, connectionsRef.current);
        if (migrated !== connectionsRef.current) {
            connectionsRef.current = migrated;
            setConnections(migrated);
        }
        const storyboardContext = resolveStoryboardGenerationContext(nodesRef.current, {
            scriptNodeId: nodeId,
            connections: connectionsRef.current,
        });
        const shotDuration = scriptNode.metadata?.storyboardShotDuration || "auto";
        const shotDurationSeconds = shotDuration === "auto" ? 0 : Number(shotDuration);
        const shotCount = scriptNode.metadata?.storyboardShotCount || "auto";
        const requestedShotCount = shotCount === "auto" ? 0 : Number(shotCount);
        const mentionReferences = buildNodeMentionReferences(scriptNode, nodesRef.current, connectionsRef.current);
        const expandedPrompt = expandStoryboardTextMentions(prompt, mentionReferences);
        const slots = collectStoryboardInputSlots(nodeId, nodesRef.current, connectionsRef.current);
        const canvasAssets = storyboardPlanAssetNodes(slots).map((item) => {
            const kind = item.metadata?.workflowKind === "character" ? "character"
                : item.metadata?.workflowKind === "styleboard" ? "style"
                : item.type === CanvasNodeType.Image || item.type === CanvasNodeType.Drawing ? "image"
                : item.type === CanvasNodeType.Skill ? "skill"
                : "text";
            const text = item.metadata?.workflowKind === "character"
                ? (item.metadata.characterPrompt || item.title)
                : (item.metadata?.content || item.metadata?.prompt || item.title);
            return {
                id: item.id,
                title: item.metadata?.characterName || item.title || kind,
                type: kind,
                tags: [kind, item.metadata?.workflowKind || ""].filter(Boolean),
                prompt: text || item.title,
            };
        });
        const { preview } = await previewStoryboardPlannerPrompt({
            prompt: expandedPrompt,
            requirements: "输出可直接编辑并用于批量生成图片和视频的分镜表。必须优先遵循用户 brief 中【文本参考】【角色参考】给出的设定，不得忽略已引用文本另起炉灶。",
            canvasAssets,
            projectStyle: storyboardContext.projectStyle,
            characters: storyboardContext.characters,
            shotDurationSeconds,
            shotCount: requestedShotCount,
        });
        return preview;
    }, [connectionsRef, nodesRef, setConnections]);

    const ensureScriptImageNodes = useCallback((nodeId: string, rowIds: string[]) => {
        const scriptNode = nodesRef.current.find((node) => node.id === nodeId && node.type === CanvasNodeType.Script);
        const rows = (scriptNode?.metadata?.storyboard?.rows || []).filter((row) => rowIds.includes(row.id));
        if (!scriptNode || !rows.length) return [];
        const imageSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
        const startX = scriptNode.position.x + scriptNode.width + 120;
        const nextNodes = [...nodesRef.current];
        const nextConnections = [...connectionsRef.current];
        const targets: Array<{ row: StoryboardRow; node: CanvasNodeData; prompt: string }> = [];
        rows.forEach((row, index) => {
            const prompt = (row.imageGenerationPrompt || row.plotDescription).trim();
            const existing = row.imageNodeId ? nextNodes.find((node) => node.id === row.imageNodeId && node.type === CanvasNodeType.Image) : undefined;
            const existingMetadata = existing?.metadata?.content ? existing.metadata : resetGenerationTaskMetadata(existing?.metadata);
            const imageNode = existing
                ? { ...existing, metadata: { ...existingMetadata, prompt, composerContent: existingMetadata?.composerContent || prompt, ...storyboardPromptTemplateMetadata(row, "image"), workflowKind: "shot" as const, workflowTitle: `镜头 ${row.shotNumber} 分镜图`, shotIndex: row.shotNumber } }
                : createCanvasNode(CanvasNodeType.Image, { x: startX + imageSpec.width / 2, y: scriptNode.position.y + index * (imageSpec.height + 36) + imageSpec.height / 2 }, { prompt, composerContent: prompt, ...storyboardPromptTemplateMetadata(row, "image"), workflowKind: "shot", workflowTitle: `镜头 ${row.shotNumber} 分镜图`, shotIndex: row.shotNumber, status: NODE_STATUS_IDLE });
            if (!existing) {
                imageNode.title = `镜头 ${row.shotNumber} · 分镜图`;
                nextNodes.push(imageNode);
                nextConnections.push({ id: nanoid(), fromNodeId: scriptNode.id, toNodeId: imageNode.id, fromHandleId: `row:${row.id}` });
            } else {
                const existingIndex = nextNodes.findIndex((node) => node.id === existing.id);
                nextNodes[existingIndex] = imageNode;
            }
            resolveStoryboardDownstreamRefs({
                stage: "image",
                scriptNode,
                row,
                nodes: nextNodes,
                connections: nextConnections,
                includeFirstFrame: false,
            }).forEach((referenceId) => {
                if (referenceId !== imageNode.id && !nextConnections.some((connection) => connection.fromNodeId === referenceId && connection.toNodeId === imageNode.id)) nextConnections.push({ id: nanoid(), fromNodeId: referenceId, toNodeId: imageNode.id });
            });
            targets.push({ row, node: imageNode, prompt });
        });
        const imageNodeByRowId = new Map(targets.map((target) => [target.row.id, target.node.id]));
        const promptByRowId = new Map(targets.map((target) => [target.row.id, target.prompt]));
        const scriptIndex = nextNodes.findIndex((node) => node.id === scriptNode.id);
        nextNodes[scriptIndex] = {
            ...scriptNode,
            metadata: {
                ...scriptNode.metadata,
                storyboard: {
                    rows: (scriptNode.metadata?.storyboard?.rows || []).map((row) => ({
                        ...row,
                        imageNodeId: imageNodeByRowId.get(row.id) || row.imageNodeId,
                        lastImageSubmissionPrompt: promptByRowId.get(row.id) || row.lastImageSubmissionPrompt,
                    })),
                    visibleColumns: scriptNode.metadata?.storyboard?.visibleColumns || ["shotNumber", "durationSeconds", "plotDescription", "dialogue"],
                    referenceNodeIds: scriptNode.metadata?.storyboard?.referenceNodeIds || [],
                },
            },
        };
        nodesRef.current = nextNodes;
        connectionsRef.current = nextConnections;
        setNodes(nextNodes);
        setConnections(nextConnections);
        return targets;
    }, [connectionsRef, nodesRef, setConnections, setNodes]);

    const createScriptImageNodes = useCallback((nodeId: string, rowIds?: string[]) => {
        const scriptNode = nodesRef.current.find((node) => node.id === nodeId && node.type === CanvasNodeType.Script);
        const rows = scriptNode?.metadata?.storyboard?.rows || [];
        const selectedRows = rowIds?.length ? rows.filter((row) => rowIds.includes(row.id)) : rows;
        if (!scriptNode || !selectedRows.length) return;
        const missing = selectedRows.filter((row) => !(row.imageGenerationPrompt || row.plotDescription).trim());
        if (missing.length) return message.warning(`有 ${missing.length} 个镜头缺少画面描述或图片提示词`);
        const createdCount = selectedRows.filter((row) => !row.imageNodeId || !nodesRef.current.some((node) => node.id === row.imageNodeId && node.type === CanvasNodeType.Image)).length;
        ensureScriptImageNodes(nodeId, selectedRows.map((row) => row.id));
        message.success(createdCount ? `已创建 ${createdCount} 个图片节点` : "已同步现有图片节点的提示词");
    }, [ensureScriptImageNodes, message, nodesRef]);

    const generateScriptImages = useCallback(async (nodeId: string, rowIds: string[]) => {
        const scriptNode = nodesRef.current.find((node) => node.id === nodeId && node.type === CanvasNodeType.Script);
        const rows = (scriptNode?.metadata?.storyboard?.rows || []).filter((row) => rowIds.includes(row.id));
        if (!scriptNode || !rows.length) return;
        const missing = rows.filter((row) => !(row.imageGenerationPrompt || row.plotDescription).trim());
        if (missing.length) return message.warning(`有 ${missing.length} 个镜头缺少画面描述或图片提示词`);
        const imageModel = effectiveConfig.imageModel || effectiveConfig.model;
        if (!isAiConfigReady(effectiveConfig, imageModel)) {
            navigateToSettings({ continueCreation: true });
            return;
        }
        const activeNodeIds = activeGenerationBatchNodeIds(scriptNode, "storyboard_image");
        const targetRows = rows.filter((row) => {
            const imageNode = row.imageNodeId ? nodesRef.current.find((node) => node.id === row.imageNodeId && node.type === CanvasNodeType.Image) : undefined;
            return !imageNode?.metadata?.content && (!imageNode || !activeNodeIds.has(imageNode.id));
        });
        if (!targetRows.length) return message.info("所选分镜图已生成或正在生成");
        if (!await confirmGenerationSubmission(targetRows.length, imageModel, "图片生成")) return;
        const targets = ensureScriptImageNodes(nodeId, targetRows.map((row) => row.id));
        if (enqueueGenerationBatch(nodeId, "storyboard_image", targets.map((target) => ({ rowId: target.row.id, nodeId: target.node.id })))) message.success("分镜图已加入生成队列");
    }, [effectiveConfig, enqueueGenerationBatch, ensureScriptImageNodes, confirmGenerationSubmission, isAiConfigReady, message, nodesRef]);

    const createScriptVideoNodes = useCallback((nodeId: string, silent = false, rowIds?: string[]) => {
        const scriptNode = nodesRef.current.find((node) => node.id === nodeId && node.type === CanvasNodeType.Script);
        const allRows = scriptNode?.metadata?.storyboard?.rows || [];
        const rows = rowIds?.length ? allRows.filter((row) => rowIds.includes(row.id)) : allRows;
        if (!scriptNode || !rows.length) return;
        const videoSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
        const startLeft = scriptNode.position.x + scriptNode.width + 120;
        const nextNodes = [...nodesRef.current];
        const nextConnections = [...connectionsRef.current];
        const videoNodeByRowId = new Map<string, string>();
        let createdCount = 0;
        rows.forEach((row, index) => {
            const prompt = (row.videoMotionPrompt || row.plotDescription).trim();
            const existingIndex = row.videoNodeId ? nextNodes.findIndex((node) => node.id === row.videoNodeId && node.type === CanvasNodeType.Video) : -1;
            if (existingIndex >= 0) {
                const existing = nextNodes[existingIndex];
                const existingMetadata = existing.metadata?.content ? existing.metadata : resetGenerationTaskMetadata(existing.metadata);
                nextNodes[existingIndex] = { ...existing, metadata: { ...existingMetadata, prompt, composerContent: prompt, ...storyboardPromptTemplateMetadata(row, "video"), seconds: String(row.durationSeconds), shotIndex: row.shotNumber, workflowKind: "shot", workflowTitle: `镜头 ${row.shotNumber} 视频`, generationMode: "video", videoEditOperation: existing.metadata?.videoEditOperation || "text_to_video" } };
                resolveStoryboardDownstreamRefs({
                    stage: "video",
                    scriptNode,
                    row,
                    nodes: nextNodes,
                    connections: nextConnections,
                    includeFirstFrame: false,
                }).forEach((referenceId) => {
                    if (!nextConnections.some((connection) => connection.fromNodeId === referenceId && connection.toNodeId === existing.id)) nextConnections.push({ id: nanoid(), fromNodeId: referenceId, toNodeId: existing.id });
                });
                videoNodeByRowId.set(row.id, existing.id);
                return;
            }
            const videoNode = createCanvasNode(CanvasNodeType.Video, { x: startLeft + videoSpec.width / 2, y: scriptNode.position.y + index * (videoSpec.height + 36) + videoSpec.height / 2 }, { prompt, composerContent: prompt, ...storyboardPromptTemplateMetadata(row, "video"), workflowKind: "shot", workflowTitle: `镜头 ${row.shotNumber} 视频`, shotIndex: row.shotNumber, generationMode: "video", videoEditOperation: "text_to_video", status: NODE_STATUS_IDLE, seconds: String(row.durationSeconds) });
            videoNode.title = `镜头 ${row.shotNumber} · 视频`;
            nextNodes.push(videoNode);
            nextConnections.push({ id: nanoid(), fromNodeId: scriptNode.id, toNodeId: videoNode.id, fromHandleId: `row:${row.id}` });
            resolveStoryboardDownstreamRefs({
                stage: "video",
                scriptNode,
                row,
                nodes: nextNodes,
                connections: nextConnections,
                includeFirstFrame: false,
            }).forEach((referenceId) => {
                if (!nextConnections.some((connection) => connection.fromNodeId === referenceId && connection.toNodeId === videoNode.id)) nextConnections.push({ id: nanoid(), fromNodeId: referenceId, toNodeId: videoNode.id });
            });
            videoNodeByRowId.set(row.id, videoNode.id);
            createdCount += 1;
        });
        const scriptIndex = nextNodes.findIndex((node) => node.id === scriptNode.id);
        nextNodes[scriptIndex] = {
            ...scriptNode,
            metadata: {
                ...scriptNode.metadata,
                storyboard: {
                    rows: allRows.map((row) => {
                        const videoNodeId = videoNodeByRowId.get(row.id) || row.videoNodeId;
                        const prompt = (row.videoMotionPrompt || row.plotDescription).trim();
                        return {
                            ...row,
                            videoNodeId,
                            lastVideoSubmissionPrompt: videoNodeByRowId.has(row.id) && prompt ? prompt : row.lastVideoSubmissionPrompt,
                        };
                    }),
                    visibleColumns: scriptNode.metadata?.storyboard?.visibleColumns || ["shotNumber", "durationSeconds", "plotDescription", "dialogue"],
                    referenceNodeIds: scriptNode.metadata?.storyboard?.referenceNodeIds || [],
                },
            },
        };
        nodesRef.current = nextNodes;
        connectionsRef.current = nextConnections;
        setNodes(nextNodes);
        setConnections(nextConnections);
        if (!silent) message.success(createdCount ? `已创建 ${createdCount} 个视频节点` : "已同步现有视频节点的提示词");
    }, [connectionsRef, message, nodesRef, setConnections, setNodes]);

    const createAndGenerateScriptVideos = useCallback(async (nodeId: string, rowIds?: string[]) => {
        const videoModel = effectiveConfig.videoModel || effectiveConfig.model;
        if (!isAiConfigReady(effectiveConfig, videoModel)) {
            navigateToSettings({ continueCreation: true });
            return;
        }
        let scriptNode = nodesRef.current.find((node) => node.id === nodeId && node.type === CanvasNodeType.Script);
        const allRows = scriptNode?.metadata?.storyboard?.rows || [];
        const rows = rowIds?.length ? allRows.filter((row) => rowIds.includes(row.id)) : allRows;
        const describedRows = rows.filter((row) => Boolean((row.videoMotionPrompt || row.plotDescription).trim()));
        const activeNodeIds = scriptNode ? activeGenerationBatchNodeIds(scriptNode, "storyboard_video") : new Set<string>();
        const targetRows = describedRows.filter((row) => {
            const videoNode = row.videoNodeId ? nodesRef.current.find((node) => node.id === row.videoNodeId && node.type === CanvasNodeType.Video) : undefined;
            return !videoNode?.metadata?.content && (!videoNode || !activeNodeIds.has(videoNode.id));
        });
        if (!targetRows.length) {
            if (describedRows.some((row) => row.videoNodeId && nodesRef.current.some((node) => node.id === row.videoNodeId && Boolean(node.metadata?.content)))) message.info("镜头视频已存在");
            else message.warning("请先补充镜头画面描述");
            return;
        }
        if (!await confirmGenerationSubmission(targetRows.length, videoModel, "视频生成")) return;
        createScriptVideoNodes(nodeId, true, targetRows.map((row) => row.id));
        scriptNode = nodesRef.current.find((node) => node.id === nodeId && node.type === CanvasNodeType.Script);
        const targetRowIds = new Set(targetRows.map((row) => row.id));
        const targets = rows.flatMap((row) => {
            if (!targetRowIds.has(row.id)) return [];
            const currentRow = scriptNode?.metadata?.storyboard?.rows.find((item) => item.id === row.id) || row;
            const videoNode = currentRow.videoNodeId ? nodesRef.current.find((node) => node.id === currentRow.videoNodeId && node.type === CanvasNodeType.Video) : undefined;
            if (!videoNode || videoNode.metadata?.content) return [];
            const prompt = (currentRow.videoMotionPrompt || currentRow.plotDescription).trim();
            if (!prompt) return [];
            return [{ row: currentRow, videoNode, prompt }];
        });
        const targetById = new Map(targets.map((target) => [target.videoNode.id, target]));
        const nextNodes = nodesRef.current.map((node) => {
            const target = targetById.get(node.id);
            return target ? { ...node, metadata: { ...node.metadata, prompt: target.prompt, composerContent: target.prompt, ...storyboardPromptTemplateMetadata(target.row, "video"), generationMode: "video" as const, videoEditOperation: "text_to_video" as const, videoStartFrameNodeId: undefined } } : node;
        });
        const dedicatedFirstFrameConnections = new Set(targets
            .filter((target) => Boolean(target.row.imageNodeId))
            .map((target) => `${target.row.imageNodeId}:${target.videoNode.id}`));
        const nextConnections = connectionsRef.current.filter((connection) => !dedicatedFirstFrameConnections.has(`${connection.fromNodeId}:${connection.toNodeId}`));
        nodesRef.current = nextNodes;
        connectionsRef.current = nextConnections;
        setNodes(nextNodes);
        setConnections(nextConnections);
        setSelectedNodeIds(new Set(targets.map((target) => target.videoNode.id)));
        if (enqueueGenerationBatch(nodeId, "storyboard_video", targets.map((target) => ({ rowId: target.row.id, nodeId: target.videoNode.id })))) message.success("镜头视频已加入生成队列");
    }, [connectionsRef, confirmGenerationSubmission, createScriptVideoNodes, effectiveConfig, enqueueGenerationBatch, isAiConfigReady, message, nodesRef, setConnections, setNodes, setSelectedNodeIds]);

    const createScriptActionBoards = useCallback(async (nodeId: string) => {
        const scriptNode = nodesRef.current.find((node) => node.id === nodeId && node.type === CanvasNodeType.Script);
        const rows = scriptNode?.metadata?.storyboard?.rows || [];
        if (!scriptNode || !rows.length) return;
        const imageModel = effectiveConfig.imageModel || effectiveConfig.model;
        if (!isAiConfigReady(effectiveConfig, imageModel)) {
            navigateToSettings({ continueCreation: true });
            return;
        }
        const actionBoardRows = rows.filter((row) => !nodesRef.current.some((node) => node.type === CanvasNodeType.Image && node.metadata?.workflowKind === "action_board" && node.metadata.shotIndex === row.shotNumber && Boolean(node.metadata.content)));
        if (!actionBoardRows.length) {
            message.info("动作拆分板已存在");
            return;
        }
        if (!await confirmGenerationSubmission(actionBoardRows.length, imageModel, "动作板生成")) return;
        const imageSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
        const startX = scriptNode.position.x + scriptNode.width + 120;
        const nextNodes = [...nodesRef.current];
        const nextConnections = [...connectionsRef.current];
        const targets: Array<{ row: StoryboardRow; node: CanvasNodeData; prompt: string }> = [];
        // 画风/章节/角色卡不要 bake 进动作板 prompt：生成时会按连线再收集一次，预写会导致最终 prompt 重复 2～3 遍。
        // 角色一致性靠 reference 连线 + 角色三视图；镜头侧必须带上运镜/时间节拍/表演调度等分镜字段。
        actionBoardRows.forEach((row, index) => {
            const prompt = buildActionBoardImagePrompt(row);
            const existingIndex = nextNodes.findIndex((node) => node.type === CanvasNodeType.Image && node.metadata?.workflowKind === "action_board" && node.metadata.shotIndex === row.shotNumber);
            if (existingIndex >= 0 && nextNodes[existingIndex].metadata?.content) return;
            const imageNode = existingIndex >= 0
                ? { ...nextNodes[existingIndex], metadata: { ...resetGenerationTaskMetadata(nextNodes[existingIndex].metadata), prompt, composerContent: prompt, lastImageSubmissionPrompt: prompt } }
                : createCanvasNode(CanvasNodeType.Image, { x: startX + imageSpec.width / 2, y: scriptNode.position.y + index * (imageSpec.height + 36) + imageSpec.height / 2 }, { prompt, composerContent: prompt, lastImageSubmissionPrompt: prompt, workflowKind: "action_board", workflowTitle: `镜头 ${row.shotNumber} 动作板`, shotIndex: row.shotNumber, actionBoardRows: 4, actionBoardColumns: 3, status: NODE_STATUS_IDLE });
            imageNode.title = `镜头 ${row.shotNumber} · 动作板`;
            if (existingIndex >= 0) nextNodes[existingIndex] = imageNode;
            else {
                nextNodes.push(imageNode);
                nextConnections.push({ id: nanoid(), fromNodeId: scriptNode.id, toNodeId: imageNode.id, fromHandleId: `row:${row.id}` });
            }
            // 五槽白盒：角色必送；背景/画风/道具按 policy；正文不送
            resolveStoryboardDownstreamRefs({
                stage: "action_board",
                scriptNode,
                row,
                nodes: nextNodes,
                connections: nextConnections,
                includeFirstFrame: false,
            }).forEach((referenceId) => {
                if (referenceId !== imageNode.id && !nextConnections.some((connection) => connection.fromNodeId === referenceId && connection.toNodeId === imageNode.id)) {
                    nextConnections.push({ id: nanoid(), fromNodeId: referenceId, toNodeId: imageNode.id });
                }
            });
            targets.push({ row, node: imageNode, prompt });
        });
        nodesRef.current = nextNodes;
        connectionsRef.current = nextConnections;
        setNodes(nextNodes);
        setConnections(nextConnections);
        if (enqueueGenerationBatch(nodeId, "action_board", targets.map((target) => ({ rowId: target.row.id, nodeId: target.node.id })))) message.success("动作拆分板已加入生成队列");
    }, [connectionsRef, confirmGenerationSubmission, effectiveConfig, enqueueGenerationBatch, isAiConfigReady, message, nodesRef, setConnections, setNodes]);

    const generateScriptVideos = useCallback(async (nodeId: string, rowIds: string[]) => {
        let scriptNode = nodesRef.current.find((node) => node.id === nodeId && node.type === CanvasNodeType.Script);
        const rows = (scriptNode?.metadata?.storyboard?.rows || []).filter((row) => rowIds.includes(row.id));
        if (!scriptNode || !rows.length) return;
        const readyRows = rows.filter((row) => row.imageNodeId && nodesRef.current.some((node) => node.id === row.imageNodeId && node.type === CanvasNodeType.Image && node.metadata?.content));
        if (!readyRows.length) return message.warning("请先生成并检查选中镜头的首帧");
        if (readyRows.length !== rows.length) return message.warning(`${rows.length - readyRows.length} 个选中镜头还没有可用首帧，请全部生成并检查后再确认`);
        const videoModel = effectiveConfig.videoModel || effectiveConfig.model;
        if (!isAiConfigReady(effectiveConfig, videoModel)) {
            navigateToSettings({ continueCreation: true });
            return;
        }
        const activeNodeIds = activeGenerationBatchNodeIds(scriptNode, "storyboard_video");
        const targetRows = readyRows.filter((row) => {
            const videoNode = row.videoNodeId ? nodesRef.current.find((node) => node.id === row.videoNodeId && node.type === CanvasNodeType.Video) : undefined;
            return !videoNode?.metadata?.content && (!videoNode || !activeNodeIds.has(videoNode.id));
        });
        if (!targetRows.length) return message.info("所选镜头视频已生成或正在生成");
        if (!await confirmGenerationSubmission(targetRows.length, videoModel, "视频生成")) return;
        createScriptVideoNodes(nodeId, true, targetRows.map((row) => row.id));
        scriptNode = nodesRef.current.find((node) => node.id === nodeId && node.type === CanvasNodeType.Script);
        if (!scriptNode) return;
        const currentScriptNode = scriptNode;
        const videoSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
        const currentRows = targetRows.map((row) => currentScriptNode.metadata?.storyboard?.rows.find((item) => item.id === row.id) || row);
        const startX = Math.max(...currentRows.map((row) => nodesRef.current.find((node) => node.id === row.imageNodeId)?.position.x || currentScriptNode.position.x + currentScriptNode.width)) + videoSpec.width + 120;
        const nextNodes = [...nodesRef.current];
        const nextConnections = [...connectionsRef.current];
        const targets: Array<{ row: StoryboardRow; node: CanvasNodeData; prompt: string }> = [];
        currentRows.forEach((row, index) => {
            const prompt = (row.videoMotionPrompt || row.plotDescription).trim();
            const existing = row.videoNodeId ? nextNodes.find((node) => node.id === row.videoNodeId && node.type === CanvasNodeType.Video) : undefined;
            const existingMetadata = existing?.metadata?.content ? existing.metadata : resetGenerationTaskMetadata(existing?.metadata);
            const videoNode = existing
                ? { ...existing, metadata: { ...existingMetadata, prompt, composerContent: prompt, ...storyboardPromptTemplateMetadata(row, "video"), workflowKind: "shot" as const, workflowTitle: `镜头 ${row.shotNumber} 视频`, shotIndex: row.shotNumber, generationMode: "video" as const, videoEditOperation: "image_to_video" as const, videoStartFrameNodeId: row.imageNodeId, seconds: String(row.durationSeconds) } }
                : createCanvasNode(CanvasNodeType.Video, { x: startX, y: currentScriptNode.position.y + index * (videoSpec.height + 36) + videoSpec.height / 2 }, { prompt, ...storyboardPromptTemplateMetadata(row, "video"), workflowKind: "shot", workflowTitle: `镜头 ${row.shotNumber} 视频`, shotIndex: row.shotNumber, generationMode: "video", videoEditOperation: "image_to_video", videoStartFrameNodeId: row.imageNodeId, status: NODE_STATUS_IDLE, seconds: String(row.durationSeconds) });
            if (!existing) {
                videoNode.title = `镜头 ${row.shotNumber} · 视频`;
                nextNodes.push(videoNode);
                nextConnections.push({ id: nanoid(), fromNodeId: currentScriptNode.id, toNodeId: videoNode.id, fromHandleId: `row:${row.id}` });
            } else {
                const existingIndex = nextNodes.findIndex((node) => node.id === existing.id);
                nextNodes[existingIndex] = videoNode;
            }
            resolveStoryboardDownstreamRefs({
                stage: "video",
                scriptNode: currentScriptNode,
                row,
                nodes: nextNodes,
                connections: nextConnections,
                includeFirstFrame: true,
            }).forEach((referenceId) => {
                if (!nextConnections.some((connection) => connection.fromNodeId === referenceId && connection.toNodeId === videoNode.id)) nextConnections.push({ id: nanoid(), fromNodeId: referenceId, toNodeId: videoNode.id });
            });
            targets.push({ row, node: videoNode, prompt });
        });
        const promptByRowId = new Map(targets.map((target) => [target.row.id, target.prompt]));
        const videoNodeByRowId = new Map(targets.map((target) => [target.row.id, target.node.id]));
        const scriptIndex = nextNodes.findIndex((node) => node.id === currentScriptNode.id);
        if (scriptIndex >= 0) {
            const script = nextNodes[scriptIndex];
            nextNodes[scriptIndex] = {
                ...script,
                metadata: {
                    ...script.metadata,
                    storyboard: {
                        rows: (script.metadata?.storyboard?.rows || []).map((row) => ({
                            ...row,
                            videoNodeId: videoNodeByRowId.get(row.id) || row.videoNodeId,
                            lastVideoSubmissionPrompt: promptByRowId.get(row.id) || row.lastVideoSubmissionPrompt,
                        })),
                        visibleColumns: script.metadata?.storyboard?.visibleColumns || ["shotNumber", "durationSeconds", "plotDescription", "dialogue"],
                        referenceNodeIds: script.metadata?.storyboard?.referenceNodeIds || [],
                    },
                },
            };
        }
        nodesRef.current = nextNodes;
        connectionsRef.current = nextConnections;
        setNodes(nextNodes);
        setConnections(nextConnections);
        if (enqueueGenerationBatch(nodeId, "storyboard_video", targets.map((target) => ({ rowId: target.row.id, nodeId: target.node.id })))) message.success("镜头视频已加入生成队列");
    }, [connectionsRef, confirmGenerationSubmission, createScriptVideoNodes, effectiveConfig, enqueueGenerationBatch, isAiConfigReady, message, nodesRef, setConnections, setNodes]);

    /** 从已生成的 12 宫格动作板只创建视频节点：写 prompt、复制入边参考与动作板真引用；不入队生成。 */
    const generateVideoFromActionBoard = useCallback((actionBoardNodeId: string) => {
        const board = nodesRef.current.find((node) => node.id === actionBoardNodeId && node.type === CanvasNodeType.Image && node.metadata?.workflowKind === "action_board");
        if (!board) return;
        if (!board.metadata?.content) {
            message.warning("请先生成动作板图片，再创建视频节点");
            return;
        }
        const existingVideo = nodesRef.current.find((node) => node.type === CanvasNodeType.Video && node.metadata?.actionBoardNodeId === board.id);
        if (existingVideo?.metadata?.content) {
            message.info("该动作板已有成片视频，已选中现有节点");
            setSelectedNodeIds(new Set([existingVideo.id]));
            return;
        }
        if (existingVideo && (existingVideo.metadata?.status === "loading" || Boolean(existingVideo.metadata?.taskId))) {
            message.info("该动作板视频正在生成中，已选中现有节点");
            setSelectedNodeIds(new Set([existingVideo.id]));
            return;
        }

        const shotIndex = board.metadata?.shotIndex;
        const nextNodes = [...nodesRef.current];
        const nextConnections = [...connectionsRef.current];

        // 先收集动作板入边：分区写进 prompt（自然语言，无 @ token），并复制到视频入边。
        const boardIncoming = nextConnections.filter((connection) => connection.toNodeId === board.id);
        const mentions: ActionBoardPromptMention[] = boardIncoming
            .map((connection) => nextNodes.find((node) => node.id === connection.fromNodeId))
            .filter((node): node is CanvasNodeData => Boolean(node))
            .filter((node) => node.type !== CanvasNodeType.Script)
            .map((node) => ({
                nodeId: node.id,
                kind: classifyActionBoardMention(node),
                title: node.metadata?.characterName || node.title || node.id,
            }));

        const matchedScript = shotIndex
            ? nextNodes.find((node) => node.type === CanvasNodeType.Script && (node.metadata?.storyboard?.rows || []).some((row) => row.shotNumber === shotIndex))
            : undefined;
        const matchedRow = matchedScript?.metadata?.storyboard?.rows.find((row) => row.shotNumber === shotIndex);
        const seconds = String(Math.max(1, Math.floor(Number(matchedRow?.durationSeconds) || 5)));
        const prompt = buildActionBoardVideoPrompt(board, mentions);

        const videoSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
        let videoNode: CanvasNodeData;
        let created = false;
        const videoMetadata = {
            prompt,
            composerContent: prompt,
            generationMode: "video" as const,
            // 多参考图生视频：动作板走 subject_ref（自然语言「图1」），不要写成首帧。
            videoEditOperation: "image_to_video" as const,
            videoStartFrameNodeId: undefined,
            videoEndFrameNodeId: undefined,
            actionBoardNodeId: board.id,
            workflowKind: "shot" as const,
            workflowTitle: shotIndex ? `镜头 ${shotIndex} 视频` : "动作板视频",
            shotIndex,
            status: NODE_STATUS_IDLE,
            seconds,
            size: ACTION_BOARD_VIDEO_DEFAULT_SIZE,
            vquality: ACTION_BOARD_VIDEO_DEFAULT_VQUALITY,
        };
        if (existingVideo) {
            const index = nextNodes.findIndex((node) => node.id === existingVideo.id);
            videoNode = {
                ...existingVideo,
                title: shotIndex ? `镜头 ${shotIndex} · 视频` : existingVideo.title || "动作板视频",
                metadata: {
                    ...resetGenerationTaskMetadata(existingVideo.metadata),
                    ...videoMetadata,
                    // 显式清掉可能残留的首尾帧，避免再次被当成首帧。
                    videoStartFrameNodeId: undefined,
                    videoEndFrameNodeId: undefined,
                },
            };
            nextNodes[index] = videoNode;
        } else {
            videoNode = createCanvasNode(
                CanvasNodeType.Video,
                {
                    x: board.position.x + board.width + 96 + videoSpec.width / 2,
                    y: board.position.y + board.height / 2,
                },
                videoMetadata,
            );
            videoNode.title = shotIndex ? `镜头 ${shotIndex} · 视频` : "动作板视频";
            nextNodes.push(videoNode);
            created = true;
        }

        const ensureEdge = (fromNodeId: string, toNodeId: string, role?: CanvasConnection["role"]) => {
            if (fromNodeId === toNodeId) return;
            if (nextConnections.some((connection) => connection.fromNodeId === fromNodeId && connection.toNodeId === toNodeId)) return;
            nextConnections.push({ id: nanoid(), fromNodeId, toNodeId, ...(role ? { role } : {}) });
        };
        // 动作板图：主体参考，不是首帧。
        ensureEdge(board.id, videoNode.id, "subject_ref");
        boardIncoming.forEach((connection) => ensureEdge(connection.fromNodeId, videoNode.id, connection.role));

        if (matchedScript && matchedRow && shotIndex) {
            const scriptIndex = nextNodes.findIndex((node) => node.id === matchedScript.id);
            const rows = matchedScript.metadata?.storyboard?.rows || [];
            nextNodes[scriptIndex] = {
                ...matchedScript,
                metadata: {
                    ...matchedScript.metadata,
                    storyboard: {
                        rows: rows.map((row) => row.shotNumber === shotIndex
                            ? { ...row, videoNodeId: videoNode.id, lastVideoSubmissionPrompt: prompt }
                            : row),
                        visibleColumns: matchedScript.metadata?.storyboard?.visibleColumns || ["shotNumber", "durationSeconds", "plotDescription", "dialogue"],
                        referenceNodeIds: matchedScript.metadata?.storyboard?.referenceNodeIds || [],
                    },
                },
            };
            ensureEdge(matchedScript.id, videoNode.id);
        }

        nodesRef.current = nextNodes;
        connectionsRef.current = nextConnections;
        setNodes(nextNodes);
        setConnections(nextConnections);
        setSelectedNodeIds(new Set([videoNode.id]));
        message.success(created
            ? `已创建视频节点（图1=动作板 · ${seconds}s · 横屏480p）`
            : `已同步视频节点提示词/连线（图1=动作板 · ${seconds}s · 横屏480p）`);
    }, [connectionsRef, message, nodesRef, setConnections, setNodes, setSelectedNodeIds]);

    return {
        addScriptRow,
        createAndGenerateScriptVideos,
        createScriptActionBoards,
        createScriptImageNodes,
        createScriptVideoNodes,
        generateScriptImages,
        generateScriptRows,
        generateScriptVideos,
        generateVideoFromActionBoard,
        previewScriptPlannerPrompt,
        removeScriptRow,
        replaceScriptRows,
        updateScriptRow,
        updateScriptRows,
    };
}

function invalidateEditedPromptVariables(previous: StoryboardRow | undefined, next: StoryboardRow) {
    if (!previous) return next;
    return {
        ...next,
        imagePromptTemplateVariables: next.imageGenerationPrompt === previous.imageGenerationPrompt ? next.imagePromptTemplateVariables : undefined,
        videoPromptTemplateVariables: next.videoMotionPrompt === previous.videoMotionPrompt ? next.videoPromptTemplateVariables : undefined,
    };
}

function activeGenerationBatchNodeIds(node: CanvasNodeData, mode: CanvasGenerationBatchMode) {
    return new Set((node.metadata?.generationBatches || [])
        .filter((batch) => batch.mode === mode)
        .flatMap((batch) => batch.items
            .filter((item) => item.status === "waiting" || item.status === "submitting" || item.status === "queued" || item.status === "running")
            .map((item) => item.nodeId)));
}
