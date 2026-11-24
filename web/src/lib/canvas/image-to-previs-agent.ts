import { canvasResourceMentionToken, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { resolveModelChannel, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";

export const IMAGE_TO_PREVIS_AGENT_INSTRUCTION = [
    "请把这张画布图片复现为世界引擎里可编辑的 3D 场景，而不是把图片放进世界引擎。",
    "先调用 canvas_inspect_image 读取该图片的真实画面，不能根据节点标题、提示词或文件名猜测内容。",
    "如果工具列表中没有 canvas_inspect_image，立即停止并报告当前模型不支持图片输入；不要改用 image_text_detect，因为它只准备文字识别请求，不会把画面交给模型。",
    "然后调用 canvas_get_state 和 previs_scene_read 读取画布及世界引擎状态：如果已有对应世界引擎场景就更新它，否则调用 previs_scene_create 创建一个空场景。写入前用 previs_scene_read 的 manual=rules、manual=setup、manual=actors 读世界引擎说明书。",
    "根据实际观察，用 previs_apply_patch 建立可移动的语义对象：逐个还原人物数量、人物/道具/环境的前后景关系、站位、朝向、相对尺度、姿态和动作；用相机、镜头构图、灯光和环境设置还原画面视角与氛围。",
    "人物必须使用 actor，对象必须能在世界引擎中单独移动、旋转和调整姿态；不要只写一段描述，也不要把原图作为 billboard、背景板、参考平面或任何图片对象加入场景。",
    "普通图片中的人物不是角色卡：使用 actor 的 name、archetype、pose 和 position 描述即可，禁止传 characterName、characterAssetId、characterVersionId 或 referenceNodeId。只有 canvas_get_state 明确返回 workflowKind=character 且三个角色卡 ID 完整匹配时，才允许角色绑定。",
    "完成后重新读取世界引擎场景确认对象数量、空间布局和镜头设置，并明确说明无法从图片确认的部分。",
].join("\n");

export function buildImageToPrevisAgentPrompt(reference: CanvasResourceReference) {
    return `${canvasResourceMentionToken(reference)}\n${IMAGE_TO_PREVIS_AGENT_INSTRUCTION}`;
}

export function buildImageToPrevisDisplayText() {
    return "根据此图生成世界引擎场景";
}

export function modelSupportsImageInspection(config: AiConfig, model: string) {
    return (modelCapabilityConfigFor(config, model).text?.references.maxImages || 0) > 0;
}

/** 图片复现必须在真正支持图片输入的文本模型上运行。 */
export function selectImageInspectionModel(config: AiConfig, preferredModel: string) {
    const textModels = selectableModelsByCapability(config, "text");
    const canCloudAgentUse = (model: string) => resolveModelChannel(config, model).scope === "system" && modelSupportsImageInspection(config, model);
    if (preferredModel && canCloudAgentUse(preferredModel)) return preferredModel;
    return textModels.find(canCloudAgentUse) || "";
}
