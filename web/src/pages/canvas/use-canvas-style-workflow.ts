import { useCallback, type Dispatch, type SetStateAction } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";

import type { CanvasStylePreset } from "@/components/canvas/canvas-style-picker-modal";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { createStyleProfileSnapshot, serializeStyleProfile } from "@/lib/canvas/style-profile";
import { updateProject as updateDomainProject } from "@/services/api/projects";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata, type Position } from "@/types/canvas";
import { useTranslation } from "react-i18next";

type UseCanvasStyleWorkflowOptions = {
    domainProjectId?: string;
    nodesRef: { current: CanvasNodeData[] };
    selectedNodeIdsRef: { current: Set<string> };
    getCanvasCenter: () => Position;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setDialogNodeId: Dispatch<SetStateAction<string | null>>;
    setStylePickerOpen: Dispatch<SetStateAction<boolean>>;
};

export function useCanvasStyleWorkflow({ domainProjectId, nodesRef, selectedNodeIdsRef, getCanvasCenter, setNodes, setSelectedNodeIds, setSelectedConnectionId, setDialogNodeId, setStylePickerOpen }: UseCanvasStyleWorkflowOptions) {
    const { t } = useTranslation("canvas");
    const { message } = App.useApp();
    const queryClient = useQueryClient();

    const applyCanvasStyle = useCallback(
        (preset: CanvasStylePreset, profileJson: string) => {
            const current = nodesRef.current.find((node) => node.type === CanvasNodeType.Text && node.metadata?.workflowKind === "styleboard");
            const metadata: CanvasNodeMetadata = {
                content: preset.prompt,
                prompt: preset.prompt,
                status: "success",
                workflowKind: "styleboard",
                workflowTitle: t("canvas:project-style"),
                workflowDescription: preset.description,
                stylePresetId: preset.id,
                styleProfileJson: profileJson,
                fontSize: 14,
            };
            let styleNode: CanvasNodeData;
            if (current) {
                styleNode = { ...current, title: t("canvas:style-param", { title: preset.title }), metadata: { ...current.metadata, ...metadata } };
                nodesRef.current = nodesRef.current.map((node) => (node.id === current.id ? styleNode : node));
            } else {
                styleNode = createCanvasNode(CanvasNodeType.Text, getCanvasCenter(), metadata);
                styleNode.title = t("canvas:style-param", { title: preset.title });
                styleNode.width = 420;
                styleNode.height = 240;
                nodesRef.current = [...nodesRef.current, styleNode];
            }
            setNodes(nodesRef.current);
            const selection = new Set([styleNode.id]);
            selectedNodeIdsRef.current = selection;
            setSelectedNodeIds(selection);
            setSelectedConnectionId(null);
            setDialogNodeId(null);
            setStylePickerOpen(false);
            message.success(t("canvas:applied-style-param", { title: preset.title }));
        },
        [getCanvasCenter, message, nodesRef, selectedNodeIdsRef, setDialogNodeId, setNodes, setSelectedConnectionId, setSelectedNodeIds, setStylePickerOpen],
    );

    const persistStyleMutation = useMutation({
        mutationFn: ({ preset, profileJson }: { preset: CanvasStylePreset; profileJson: string }) => {
            if (!domainProjectId) throw new Error(t("canvas:canvas-is-not-linked-to-a-project-yet"));
            return updateDomainProject(domainProjectId, { stylePresetId: preset.id, styleProfileJson: profileJson });
        },
        onSuccess: (_project, { preset, profileJson }) => {
            applyCanvasStyle(preset, profileJson);
            void queryClient.invalidateQueries({ queryKey: ["project", domainProjectId] });
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t("canvas:failed-to-save-project-style")),
    });

    const selectCanvasStyle = useCallback(
        (preset: CanvasStylePreset) => {
            if (persistStyleMutation.isPending) return;
            const profileJson = serializeStyleProfile(preset.profile || createStyleProfileSnapshot(preset));
            if (!domainProjectId) {
                applyCanvasStyle(preset, profileJson);
                return;
            }
            persistStyleMutation.mutate({ preset, profileJson });
        },
        [applyCanvasStyle, domainProjectId, persistStyleMutation],
    );

    return { selectCanvasStyle, styleApplying: persistStyleMutation.isPending };
}
