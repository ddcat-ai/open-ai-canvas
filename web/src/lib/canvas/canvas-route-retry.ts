import { synchronizeGenerationSpec } from "@/lib/canvas/generation-contract";
import { encodeChannelModel } from "@/stores/use-config-store";
import type { TaskRetryRoute } from "@/services/api/task-center";
import type { CanvasNodeData } from "@/types/canvas";

export function selectRetriedNodeRoute(node: CanvasNodeData, route: Pick<TaskRetryRoute, "channelId" | "modelKey">) {
    const model = encodeChannelModel(route.channelId, route.modelKey);
    return synchronizeGenerationSpec(node, { model, producedModelCandidate: model, imageParameters: node.metadata?.imageParameters });
}
