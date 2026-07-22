import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { App } from "antd";

import type { CanvasStylePreset } from "@/components/canvas/canvas-style-picker-modal";
import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { parseDocumentCharacterBreakdown, partitionCharacterBreakdowns, upsertCharacterReferenceBoard } from "@/lib/canvas/canvas-character-reference";
import { createDocumentChapter } from "@/lib/canvas/canvas-document";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { backendProviderConfig, buildGenerationConfig, runBackendCanvasGenerationTask } from "@/lib/canvas/canvas-project-generation";
import { agentSessionFailureMessage, createAgentSession, queryAgentSession } from "@/services/api/task-center";
import { resolveModelRequestConfig, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasDocumentChapter, type CanvasNodeData, type CanvasNodeMetadata, type CanvasRichDocument, type Position, type ViewportTransform } from "@/types/canvas";

type UseCanvasDocumentWorkflowOptions = {
    projectId: string;
    agentSnapshot: CanvasAgentSnapshot;
    applyAgentOps: (ops?: CanvasAgentOp[]) => unknown;
    nodesRef: { current: CanvasNodeData[] };
    connectionsRef: { current: CanvasConnection[] };
    selectedNodeIdsRef: { current: Set<string> };
    getCanvasCenter: () => Position;
    viewportSize: { width: number; height: number };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setDialogNodeId: Dispatch<SetStateAction<string | null>>;
    setDocumentEditorNodeId: Dispatch<SetStateAction<string | null>>;
    setStylePickerOpen: Dispatch<SetStateAction<boolean>>;
    setViewport: (viewport: ViewportTransform) => void;
};

const NODE_STATUS_SUCCESS = "success" as const;

export function useCanvasDocumentWorkflow({
    projectId,
    agentSnapshot,
    applyAgentOps,
    nodesRef,
    connectionsRef,
    selectedNodeIdsRef,
    getCanvasCenter,
    viewportSize,
    setNodes,
    setConnections,
    setSelectedNodeIds,
    setSelectedConnectionId,
    setDialogNodeId,
    setDocumentEditorNodeId,
    setStylePickerOpen,
    setViewport,
}: UseCanvasDocumentWorkflowOptions) {
    const { message, modal } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const [documentSaving, setDocumentSaving] = useState(false);
    const [documentAnalyzing, setDocumentAnalyzing] = useState(false);
    const [documentCharacterAnalyzing, setDocumentCharacterAnalyzing] = useState(false);

    const commitNodes = useCallback((nodes: CanvasNodeData[]) => {
        nodesRef.current = nodes;
        setNodes(nodes);
    }, [nodesRef, setNodes]);

    const selectNode = useCallback((nodeId: string) => {
        const selection = new Set([nodeId]);
        selectedNodeIdsRef.current = selection;
        setSelectedNodeIds(selection);
        setSelectedConnectionId(null);
    }, [selectedNodeIdsRef, setSelectedConnectionId, setSelectedNodeIds]);

    const persistDocumentNode = useCallback((node: CanvasNodeData, document: CanvasRichDocument, title: string) => {
        const persisted = { ...node, title: title || node.title, metadata: { ...node.metadata, content: document.plainText, document, status: NODE_STATUS_SUCCESS, errorDetails: undefined } };
        commitNodes(nodesRef.current.map((item) => item.id === node.id ? persisted : item));
        return persisted;
    }, [commitNodes, nodesRef]);

    const createNovelNode = useCallback((position?: Position) => {
        const firstChapter = createDocumentChapter("第 1 章");
        const node = createCanvasNode(CanvasNodeType.Text, position || getCanvasCenter(), {
            content: "",
            status: NODE_STATUS_SUCCESS,
            document: {
                kind: "novel",
                format: "tiptap-json",
                json: firstChapter.json,
                plainText: "",
                characterCount: 0,
                chapters: [firstChapter],
                activeChapterId: firstChapter.id,
                updatedAt: new Date().toISOString(),
            },
            fontSize: 13,
        });
        node.title = "小说 · 未命名";
        node.width = 460;
        node.height = 300;
        commitNodes([...nodesRef.current, node]);
        selectNode(node.id);
        setDialogNodeId(null);
    }, [commitNodes, getCanvasCenter, nodesRef, selectNode, setDialogNodeId]);

    const selectCanvasStyle = useCallback((preset: CanvasStylePreset) => {
        const current = nodesRef.current.find((node) => node.type === CanvasNodeType.Text && node.metadata?.workflowKind === "styleboard");
        const styleMetadata: CanvasNodeMetadata = {
            content: preset.prompt,
            prompt: preset.prompt,
            status: NODE_STATUS_SUCCESS,
            workflowKind: "styleboard",
            workflowTitle: "项目画风",
            workflowDescription: preset.description,
            stylePresetId: preset.id,
            fontSize: 14,
        };
        let styleNode: CanvasNodeData;
        if (current) {
            styleNode = { ...current, title: `画风 · ${preset.title}`, metadata: { ...current.metadata, ...styleMetadata } };
            commitNodes(nodesRef.current.map((node) => node.id === current.id ? styleNode : node));
        } else {
            styleNode = createCanvasNode(CanvasNodeType.Text, getCanvasCenter(), styleMetadata);
            styleNode.title = `画风 · ${preset.title}`;
            styleNode.width = 420;
            styleNode.height = 240;
            commitNodes([...nodesRef.current, styleNode]);
        }
        selectNode(styleNode.id);
        setDialogNodeId(null);
        setStylePickerOpen(false);
        message.success(`已应用“${preset.title}”画风`);
    }, [commitNodes, getCanvasCenter, message, nodesRef, selectNode, setDialogNodeId, setStylePickerOpen]);

    const saveDocumentNode = useCallback(async (node: CanvasNodeData, document: CanvasRichDocument, title: string) => {
        setDocumentSaving(true);
        try {
            persistDocumentNode(node, document, title);
        } finally {
            setDocumentSaving(false);
        }
    }, [persistDocumentNode]);

    const analyzeDocumentNode = useCallback(async (node: CanvasNodeData, document: CanvasRichDocument, title: string) => {
        if (!document.plainText.trim()) return;
        persistDocumentNode(node, document, title);
        if (!isAiConfigReady(effectiveConfig, effectiveConfig.textModel || effectiveConfig.model)) {
            openConfigDialog(true);
            return;
        }
        setDocumentAnalyzing(true);
        try {
            const textModel = effectiveConfig.textModel || effectiveConfig.model;
            const requestConfig = resolveModelRequestConfig(effectiveConfig, textModel);
            const prompt = [
                "请把下面的小说整理成可直接回写无限画布的影视项目工作流。",
                "必须生成剧本、场景、风格板、参考素材组、结构化分镜、镜头配置和成片节点；场景名称和镜头顺序要稳定，分镜要能直接用于图片和视频生成。角色视觉资产由小说编辑器中的“角色拆解”单独生成，本工作流不得创建角色卡或角色文本节点。",
                "如果当前画布已有 metadata.workflowKind=styleboard 的项目画风节点，必须复用该画风并连接到分镜或生成节点，不要重复创建风格板。",
                `项目标题：${title}`,
                "小说正文：",
                document.plainText,
            ].join("\n\n");
            const created = await createAgentSession({
                projectId,
                prompt,
                canvasSnapshot: { ...agentSnapshot, nodes: nodesRef.current.map((item) => ({ ...item, metadata: { ...item.metadata, content: String(item.metadata?.content || "").slice(0, 500) } })) } as unknown as Record<string, unknown>,
                config: backendProviderConfig({ ...effectiveConfig, model: requestConfig.model }),
            });
            let detail = created;
            for (let attempt = 0; attempt < 120; attempt += 1) {
                if (detail.session.status === "completed") break;
                if (detail.session.status === "failed") throw new Error(agentSessionFailureMessage(detail));
                await new Promise<void>((resolve) => window.setTimeout(resolve, 2000));
                detail = await queryAgentSession(created.session.id);
            }
            if (detail.session.status !== "completed") throw new Error("小说拆解超时，请到任务中心查看状态");
            if (!detail.session.canvasOpsJson) throw new Error("小说拆解没有返回画布操作");
            const parsed = JSON.parse(detail.session.canvasOpsJson) as unknown;
            const ops = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray((parsed as { ops?: unknown }).ops) ? (parsed as { ops: CanvasAgentOp[] }).ops : null;
            if (!ops) throw new Error("小说拆解结果格式不正确");
            applyAgentOps(ops);
            message.success("小说已拆解，剧本、场景和分镜已回写画布；角色视觉资产请使用“角色拆解”生成");
            setDocumentEditorNodeId(null);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "小说拆解失败");
        } finally {
            setDocumentAnalyzing(false);
        }
    }, [agentSnapshot, applyAgentOps, effectiveConfig, isAiConfigReady, message, nodesRef, openConfigDialog, persistDocumentNode, projectId, setDocumentEditorNodeId]);

    const analyzeDocumentCharacters = useCallback(async (node: CanvasNodeData, document: CanvasRichDocument, title: string, chapter?: CanvasDocumentChapter) => {
        const sourceText = (chapter?.plainText || document.plainText).trim();
        if (!sourceText) return;
        persistDocumentNode(node, document, title);
        const styleNode = nodesRef.current.find((item) => item.metadata?.workflowKind === "styleboard" && item.metadata?.stylePresetId) || nodesRef.current.find((item) => item.metadata?.workflowKind === "styleboard");
        const projectStyle = (styleNode?.metadata?.content || styleNode?.metadata?.prompt || "").trim();
        if (!projectStyle) {
            message.warning("请先选择项目画风，再拆解角色");
            setStylePickerOpen(true);
            return;
        }
        const generationConfig = buildGenerationConfig(effectiveConfig, node, "text");
        if (!isAiConfigReady(generationConfig, generationConfig.model)) {
            openConfigDialog(true);
            return;
        }
        setDocumentCharacterAnalyzing(true);
        try {
            const sourceLabel = chapter ? `“${chapter.title}”` : "整本小说";
            const prompt = [
                `请从短剧项目《${title}》的${sourceLabel}中拆解需要建立视觉资产的角色，忽略只出现一次且不影响剧情的路人。`,
                "合并同一角色的姓名、专属称谓和别名，角色名称必须简短稳定；aliases 只填写能唯一指向该角色的别名，不要填写爸爸、妈妈、姐姐、师父等可能指向多人的泛称。人物身份、年龄、外貌、服装、体态和道具优先依据正文，正文未明确时只能结合身份做克制补全。",
                "下面的项目画风是全项目美术规范。角色外貌、服装材质、色彩、时代、渲染媒介和禁止项必须遵守它，但不要把项目画风误写成人物身份或剧情信息。",
                `【项目画风】\n${projectStyle}`,
                "为每个角色给出一条单张多视角转面参考图的补充提示词。转面图在同一画面依次展示正面全身、严格左侧面全身、严格背面全身，必须是同一角色、同一服装版本、同一发型、同一体型和同一道具，不设计剧情动作或镜头场景。",
                "只返回 JSON，不要 Markdown 代码块、解释或其他文字。JSON 结构必须严格为：",
                '{"characters":[{"name":"角色名","aliases":["别名或称谓"],"role":"剧情定位与人物关系","appearance":"年龄、脸型、五官、肤色、发型等稳定外貌","clothing":"固定服装版型、颜色、纹样和材质","physique":"身高、头身、体型和体态","personality":"稳定气质与表演基线","props":"固定道具及佩戴位置，没有则为空字符串","consistencyPrompt":"跨图片和镜头必须保持不变的角色约束","multiViewPrompt":"正面、侧面、背面转面展示需要强调的角色结构细节"}]}',
                `${sourceLabel}正文：`,
                sourceText,
            ].join("\n\n");
            const result = await runBackendCanvasGenerationTask({
                projectId,
                nodeId: `character-breakdown:${node.id}:${chapter?.id || "document"}`,
                mode: "text",
                prompt,
                config: generationConfig,
                metadata: { sourceNodeId: node.id, chapterId: chapter?.id, operation: "character_breakdown" },
            });
            const characters = parseDocumentCharacterBreakdown(result.text || "");
            const partitioned = partitionCharacterBreakdowns(characters, nodesRef.current);
            let updateExisting = true;
            if (partitioned.existing.length) {
                updateExisting = await new Promise<boolean>((resolve) => {
                    modal.confirm({
                        title: `发现 ${partitioned.existing.length} 个已有角色`,
                        content: `画布中已存在：${partitioned.existing.map((character) => character.name).join("、")}。更新会保留已经生成的图片，只刷新角色提示词和背板归组。`,
                        okText: "更新已有角色",
                        cancelText: "仅创建新角色",
                        maskClosable: false,
                        onOk: () => resolve(true),
                        onCancel: () => resolve(false),
                    });
                });
            }
            const processedCharacters = updateExisting ? characters : partitioned.newCharacters;
            if (!processedCharacters.length) {
                message.info("拆解出的角色在画布中均已存在，未创建重复角色");
                return;
            }
            const upserted = upsertCharacterReferenceBoard({ nodes: nodesRef.current, connections: connectionsRef.current, documentNode: node, documentTitle: title, chapter, characters: processedCharacters, projectStyle });
            nodesRef.current = upserted.nodes;
            connectionsRef.current = upserted.connections;
            setNodes(upserted.nodes);
            setConnections(upserted.connections);
            selectNode(upserted.frameId);
            setDialogNodeId(null);
            setDocumentEditorNodeId(null);
            const frame = upserted.nodes.find((item) => item.id === upserted.frameId);
            if (frame) {
                const scale = Math.min(1, Math.max(0.45, Math.min((viewportSize.width - 120) / Math.max(1, frame.width), (viewportSize.height - 120) / Math.max(1, frame.height))));
                setViewport({ x: viewportSize.width / 2 - (frame.position.x + frame.width / 2) * scale, y: viewportSize.height / 2 - (frame.position.y + frame.height / 2) * scale, k: scale });
            }
            message.success(`角色拆解完成：新建 ${upserted.createdCount} 个、更新 ${upserted.updatedCount} 个角色多视角待生成图片节点，已统一放入背板`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "角色拆解失败");
        } finally {
            setDocumentCharacterAnalyzing(false);
        }
    }, [connectionsRef, effectiveConfig, isAiConfigReady, message, modal, nodesRef, openConfigDialog, persistDocumentNode, projectId, selectNode, setConnections, setDialogNodeId, setDocumentEditorNodeId, setNodes, setStylePickerOpen, setViewport, viewportSize.height, viewportSize.width]);

    return {
        analyzeDocumentCharacters,
        analyzeDocumentNode,
        createNovelNode,
        documentAnalyzing,
        documentCharacterAnalyzing,
        documentSaving,
        saveDocumentNode,
        selectCanvasStyle,
    };
}
