import { createCanvasNode, createStoryboardRow } from "@/lib/canvas/canvas-project-domain";
import type { ProjectShot, ProjectUnit } from "@/services/api/projects";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type StoryboardData, type StoryboardRow } from "@/types/canvas";

type ProjectChapterStoryboardInput = {
    unit: Pick<ProjectUnit, "id" | "title">;
    shots: ProjectShot[];
};

export function upsertProjectChapterStoryboard(
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
    { unit, shots }: ProjectChapterStoryboardInput,
) {
    const existing = nodes.find((node) => node.type === CanvasNodeType.Script && node.metadata?.chapterId === unit.id);
    const currentRows = new Map((existing?.metadata?.storyboard?.rows || []).map((row) => [row.id, row]));
    const rows = shots
        .filter((shot) => shot.unitId === unit.id)
        .slice()
        .sort((left, right) => left.position - right.position)
        .map((shot, index) => projectShotRow(shot, index, currentRows));

    const storyboard: StoryboardData = {
        rows,
        visibleColumns: existing?.metadata?.storyboard?.visibleColumns || ["shotNumber", "durationSeconds", "videoMotionPrompt", "dialogue", "assets"],
        referenceNodeIds: existing?.metadata?.storyboard?.referenceNodeIds || [],
    };
    const scriptNode: CanvasNodeData = existing
        ? {
              ...existing,
              title: `分镜脚本 · ${unit.title}`,
              metadata: {
                  ...existing.metadata,
                  status: "idle" as const,
                  workflowKind: "storyboard" as const,
                  workflowTitle: "章节分镜",
                  workflowDescription: `已导入 ${rows.length} 个镜头`,
                  chapterId: unit.id,
                  chapterTitle: unit.title,
                  storyboard,
              },
          }
        : createChapterStoryboardNode(nodes, unit, rows);
    const nextNodes = existing ? nodes.map((node) => node.id === existing.id ? scriptNode : node) : [...nodes, scriptNode];
    const validRowHandles = new Set(rows.map((row) => `row:${row.id}`));
    const nextConnections = existing
        ? connections
              .filter((connection) => connection.fromNodeId !== existing.id || validStoryboardHandle(connection.fromHandleId, validRowHandles))
              .filter((connection) => connection.toNodeId !== existing.id || validStoryboardHandle(connection.toHandleId, validRowHandles))
        : connections;
    return { nodes: nextNodes, connections: nextConnections, scriptNodeId: scriptNode.id, rowCount: rows.length };
}

function projectShotRow(shot: ProjectShot, index: number, currentRows: Map<string, StoryboardRow>) {
    const id = `project-shot:${shot.id}`;
    const current = currentRows.get(id);
    return createStoryboardRow(index + 1, {
        ...current,
        id,
        shotNumber: index + 1,
        durationSeconds: Math.max(1, Math.round(shot.durationMs / 1000) || 1),
        plotDescription: shot.description.trim() || shot.title.trim(),
        status: current?.status || "idle",
    });
}

function createChapterStoryboardNode(nodes: CanvasNodeData[], unit: Pick<ProjectUnit, "id" | "title">, rows: StoryboardRow[]) {
    const rightEdge = nodes.reduce((value, node) => Math.max(value, node.position.x + node.width), 0);
    const node = createCanvasNode(CanvasNodeType.Script, { x: rightEdge + 540, y: 340 }, {
        status: "idle",
        workflowKind: "storyboard",
        workflowTitle: "章节分镜",
        workflowDescription: `已导入 ${rows.length} 个镜头`,
        chapterId: unit.id,
        chapterTitle: unit.title,
        storyboard: {
            rows,
            visibleColumns: ["shotNumber", "durationSeconds", "videoMotionPrompt", "dialogue", "assets"],
            referenceNodeIds: [],
        },
    });
    node.title = `分镜脚本 · ${unit.title}`;
    return node;
}

function validStoryboardHandle(handleId: string | undefined, validRowHandles: Set<string>) {
    return !handleId || handleId === "storyboard:context" || validRowHandles.has(handleId);
}
