import { nanoid } from "nanoid";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { mediaAspectRatioLabel } from "@/lib/media-spec";
import { modelCapabilityConfigFor, videoDurationAllowed } from "@/lib/model-capabilities";
import { modelCompatibilityError } from "@/lib/model-selection";
import { buildVideoRemakePrompt } from "@/lib/prompts/video-remake";
import { resolveModelChannel, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type Position } from "@/types/canvas";
import { storyboardRowsFromBatchTable } from "./canvas-batch-storyboard";
import { findAvailableGenerationGroupPosition } from "./canvas-generation-layout";
import { declaredCanvasNodeAssetCategory } from "./canvas-node-asset";
import { createCanvasNode } from "./canvas-project-domain";
import { nodeReferenceImage } from "./canvas-project-generation";
import { buildOrderedCanvasResourceReferences, canvasPromptSummaryText, getContextResourceNodes } from "./canvas-resource-references";
import { canRemakeCanvasVideo } from "./canvas-video-regeneration";

function sourceShotNotes(source: CanvasNodeData, nodeById: Map<string, CanvasNodeData>, connections: CanvasConnection[]) {
    const destinations = new Set(connections.filter((edge) => edge.fromNodeId === source.id).map((edge) => edge.toNodeId));
    const tables = Array.from(destinations).flatMap((id) => {
        const table = nodeById.get(id)?.metadata?.batchTable;
        const sources = table?.storyboardSourceNodeIds;
        return table?.contentKind === "storyboard" && sources?.includes(source.id) && sources.every((input) => input === source.id || nodeById.get(input)?.type === CanvasNodeType.Image) ? [table] : [];
    });
    if (tables.length !== 1) return [];
    const duration = source.metadata?.durationMs;
    return storyboardRowsFromBatchTable(tables[0])
        .flatMap(({ sourceStartMs: start, sourceEndMs: end, shotSize, camera, motion, performanceBlocking, plotDescription, timeBeats, continuityOut }) => {
            if (start === undefined || end === undefined || !(start >= 0 && end > start) || (duration && end > duration)) return [];
            const details = [shotSize, camera, motion, performanceBlocking || plotDescription, timeBeats, continuityOut].map((value) => canvasPromptSummaryText(value).replaceAll("@", "")).filter(Boolean);
            return details.length ? [{ start, line: `${start / 1000}–${end / 1000} 秒｜${[...new Set(details)].join("，")}` }] : [];
        })
        .sort((left, right) => left.start - right.start)
        .map((note) => note.line);
}

export function buildVideoRemakeDraft(sourceId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], config: AiConfig) {
    const source = nodes.find((node) => node.id === sourceId);
    if (!canRemakeCanvasVideo(source)) {
        throw new Error("原视频尚不可用，无法创建复刻草稿");
    }

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const images = new Map<string, CanvasNodeData>();
    for (const edge of connections) {
        if (edge.toNodeId !== source.id) continue;
        const parent = nodeById.get(edge.fromNodeId);
        if (!parent) continue;
        const inputs = parent.type === CanvasNodeType.Config ? getContextResourceNodes(parent.id, nodes, connections) : [parent];
        for (const input of inputs) {
            if (input.type === CanvasNodeType.Image && !input.metadata?.fileUpload && nodeReferenceImage(input)) images.set(input.id, input);
        }
    }
    const additions: CanvasNodeData[] = [];
    const placeNode = (type: typeof CanvasNodeType.Image | typeof CanvasNodeType.Video, preferred: Position) => {
        const size = NODE_DEFAULT_SIZE[type];
        const position = findAvailableGenerationGroupPosition([...nodes, ...additions], preferred, size);
        const node = createCanvasNode(type, { x: position.x + size.width / 2, y: position.y + size.height / 2 });
        additions.push(node);
        return node;
    };
    if (!images.size) {
        const slot = placeNode(CanvasNodeType.Image, { x: source.position.x, y: source.position.y + source.height + 96 });
        slot.title = "复刻参考图";
        images.set(slot.id, slot);
    }

    const target = placeNode(CanvasNodeType.Video, { x: source.position.x + source.width + 96, y: source.position.y });
    target.title = `视频复刻 · ${source.title || "视频"}`;
    const references = buildOrderedCanvasResourceReferences([...images.values()]);
    const prompt = buildVideoRemakePrompt(
        references.length
            ? references.map((ref) => {
                  const node = images.get(ref.nodeId)!;
                  const category = declaredCanvasNodeAssetCategory(node);
                  return { label: `@${ref.label}`, role: node.metadata?.workflowKind === "styleboard" ? "style" : category === "character" || category === "environment" || category === "prop" ? category : undefined };
              })
            : [{ label: "@图片1" }],
        sourceShotNotes(source, nodeById, connections),
    );
    const input = { textCount: 1, imageCount: images.size, videoCount: 1, audioCount: 0, characterCount: 0 };
    const models = selectableModelsByCapability(config, "video").filter((model) => resolveModelChannel(config, model).enabled !== false && !modelCompatibilityError(config, model, { capability: "video", input, videoOperation: "reference_to_video" }));
    const model = models.includes(config.videoModel) ? config.videoModel : models[0];
    const profile = model ? modelCapabilityConfigFor(config, model).video : undefined;
    const seconds = source.metadata.durationMs ? Math.round(source.metadata.durationMs / 1000) : undefined;
    const ratio = mediaAspectRatioLabel(source.metadata.naturalWidth, source.metadata.naturalHeight);
    target.metadata = {
        ...target.metadata,
        generationMode: "video",
        videoReferenceMode: "all",
        videoEditOperation: "reference_to_video",
        videoRemake: true,
        composerContent: prompt,
        prompt,
        model,
        seconds: seconds && profile && videoDurationAllowed(profile, seconds) ? String(seconds) : undefined,
        size: profile?.ratios.includes(ratio) ? ratio : undefined,
    };
    const links = [source.id, ...images.keys()].map((fromNodeId) => ({ id: nanoid(), fromNodeId, toNodeId: target.id }));
    return { nodes: [...nodes, ...additions], connections: [...connections, ...links], target };
}
