import { z } from "zod";

const recordSchema = z.record(z.unknown());
const positionSchema = z.object({ x: z.number(), y: z.number() });
const viewportSchema = z.object({ x: z.number(), y: z.number(), k: z.number() });
const nodeTypeSchema = z.enum(["image", "text", "script", "config", "video", "audio", "frame"]);
const generationModeSchema = z.enum(["text", "image", "video", "audio"]);
const projectIdSchema = z.string().min(1).optional();
const projectCandidateSchema = z.object({ unitId: z.string().optional(), shotId: z.string().optional(), name: z.string().min(1), category: z.string().min(1), details: recordSchema.optional() });
const projectShotSchema = z.object({ id: z.string().optional(), unitId: z.string().optional(), title: z.string().min(1), description: z.string().optional(), position: z.number().int().min(0).optional(), durationMs: z.number().int().min(0).optional(), status: z.string().optional() });

export const toolNames = [
    "canvas_get_state",
    "canvas_get_selection",
    "canvas_export_snapshot",
    "canvas_apply_ops",
    "canvas_create_node",
    "canvas_create_text_node",
    "canvas_create_text_nodes",
    "canvas_create_config_node",
    "canvas_create_image_prompt_flow",
    "canvas_create_generation_flow",
    "canvas_generate_text",
    "canvas_generate_image",
    "canvas_generate_video",
    "canvas_generate_audio",
    "canvas_update_node",
    "canvas_update_node_text",
    "canvas_move_nodes",
    "canvas_resize_node",
    "canvas_delete_nodes",
    "canvas_connect_nodes",
    "canvas_select_nodes",
    "canvas_set_viewport",
    "canvas_run_generation",
    "project_get_context",
    "project_list_units",
    "project_extract_asset_candidates",
    "project_confirm_asset_candidate",
    "project_create_or_update_shots",
    "project_link_shot_asset",
    "project_start_workflow_step",
    "project_link_asset",
    "project_upsert_asset_version",
    "project_register_task_output",
] as const;
export type ToolName = (typeof toolNames)[number];

export const canvasOpSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("add_node"), nodeType: nodeTypeSchema.optional(), id: z.string().optional(), title: z.string().optional(), x: z.number().optional(), y: z.number().optional(), width: z.number().optional(), height: z.number().optional(), position: positionSchema.optional(), metadata: recordSchema.optional() }).passthrough(),
    z.object({ type: z.literal("update_node"), id: z.string(), patch: recordSchema.optional(), metadata: recordSchema.optional() }).passthrough(),
    z.object({ type: z.literal("delete_node"), id: z.string().optional(), ids: z.array(z.string()).optional() }).passthrough(),
    z.object({ type: z.literal("delete_connections"), id: z.string().optional(), ids: z.array(z.string()).optional(), all: z.boolean().optional() }).passthrough(),
    z.object({ type: z.literal("connect_nodes"), id: z.string().optional(), fromNodeId: z.string(), toNodeId: z.string(), fromHandleId: z.string().optional(), toHandleId: z.string().optional() }).passthrough(),
    z.object({ type: z.literal("set_viewport"), viewport: viewportSchema }).passthrough(),
    z.object({ type: z.literal("select_nodes"), ids: z.array(z.string()) }).passthrough(),
    z.object({ type: z.literal("run_generation"), nodeId: z.string(), mode: generationModeSchema.optional(), prompt: z.string().optional() }).passthrough(),
]);

const textNodeSchema = z.object({
    text: z.string(),
    title: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
});

const generationOptionsSchema = z.object({
    model: z.string().optional(),
    size: z.string().optional(),
    quality: z.string().optional(),
    count: z.number().optional(),
    seconds: z.string().optional(),
    vquality: z.string().optional(),
    generateAudio: z.string().optional(),
    watermark: z.string().optional(),
    audioVoice: z.string().optional(),
    audioFormat: z.string().optional(),
    audioSpeed: z.string().optional(),
    audioInstructions: z.string().optional(),
});

const generationFlowSchema = z.object({
    prompt: z.string(),
    title: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    referenceNodeIds: z.array(z.string()).optional(),
});

export const toolInputSchemas = {
    canvas_get_state: z.object({}).passthrough(),
    canvas_get_selection: z.object({}).passthrough(),
    canvas_export_snapshot: z.object({}).passthrough(),
    canvas_apply_ops: z.object({ ops: z.array(canvasOpSchema) }),
    canvas_create_node: z.object({ nodeType: nodeTypeSchema, title: z.string().optional(), x: z.number().optional(), y: z.number().optional(), width: z.number().optional(), height: z.number().optional(), metadata: recordSchema.optional() }),
    canvas_create_text_node: z.object({ text: z.string().optional(), x: z.number().optional(), y: z.number().optional(), title: z.string().optional(), width: z.number().optional(), height: z.number().optional() }),
    canvas_create_text_nodes: z.object({ items: z.array(textNodeSchema).min(1), x: z.number().optional(), y: z.number().optional(), gap: z.number().optional(), direction: z.enum(["row", "column"]).optional() }),
    canvas_create_config_node: z.object({ prompt: z.string().optional(), mode: generationModeSchema.optional(), title: z.string().optional(), x: z.number().optional(), y: z.number().optional(), width: z.number().optional(), height: z.number().optional(), autoRun: z.boolean().optional() }).merge(generationOptionsSchema),
    canvas_create_image_prompt_flow: z.object({ prompt: z.string(), x: z.number().optional(), y: z.number().optional(), autoRun: z.boolean().optional() }).merge(generationOptionsSchema),
    canvas_create_generation_flow: generationFlowSchema.extend({ mode: generationModeSchema.optional(), autoRun: z.boolean().optional() }).merge(generationOptionsSchema),
    canvas_generate_text: generationFlowSchema.merge(generationOptionsSchema),
    canvas_generate_image: generationFlowSchema.merge(generationOptionsSchema),
    canvas_generate_video: generationFlowSchema.merge(generationOptionsSchema),
    canvas_generate_audio: generationFlowSchema.merge(generationOptionsSchema),
    canvas_update_node: z.object({ id: z.string(), patch: recordSchema.optional(), metadata: recordSchema.optional() }),
    canvas_update_node_text: z.object({ id: z.string(), text: z.string(), title: z.string().optional() }),
    canvas_move_nodes: z.object({ items: z.array(z.object({ id: z.string(), x: z.number().optional(), y: z.number().optional(), dx: z.number().optional(), dy: z.number().optional() })).min(1) }),
    canvas_resize_node: z.object({ id: z.string(), width: z.number(), height: z.number(), freeResize: z.boolean().optional() }),
    canvas_delete_nodes: z.object({ ids: z.array(z.string()).min(1) }),
    canvas_connect_nodes: z.object({ connections: z.array(z.object({ fromNodeId: z.string(), toNodeId: z.string(), fromHandleId: z.string().optional(), toHandleId: z.string().optional() })).min(1) }),
    canvas_select_nodes: z.object({ ids: z.array(z.string()) }),
    canvas_set_viewport: z.object({ viewport: viewportSchema }),
    canvas_run_generation: z.object({ nodeId: z.string(), mode: generationModeSchema.optional(), prompt: z.string().optional() }),
    project_get_context: z.object({ projectId: projectIdSchema }),
    project_list_units: z.object({ projectId: projectIdSchema, kind: z.string().optional(), status: z.string().optional() }),
    project_extract_asset_candidates: z.object({ projectId: projectIdSchema, candidates: z.array(projectCandidateSchema).min(1).max(100) }),
    project_confirm_asset_candidate: z.object({ projectId: projectIdSchema, candidateId: z.string().min(1), assetId: z.string().optional() }),
    project_create_or_update_shots: z.object({ projectId: projectIdSchema, shots: z.array(projectShotSchema).min(1).max(100) }),
    project_link_shot_asset: z.object({ projectId: projectIdSchema, shotId: z.string().min(1), assetVersionId: z.string().min(1), role: z.enum(["reference", "start_frame", "end_frame", "keyframe", "storyboard", "output"]) }),
    project_start_workflow_step: z.object({ projectId: projectIdSchema, stepId: z.string().min(1) }),
    project_link_asset: z.object({ projectId: projectIdSchema, assetId: z.string().min(1), category: z.string().min(1) }),
    project_upsert_asset_version: z.object({ projectId: projectIdSchema, assetId: z.string().min(1), prompt: z.string().optional(), definitionJson: z.string().optional(), note: z.string().optional() }),
    project_register_task_output: z.object({ projectId: projectIdSchema, stepId: z.string().min(1), taskId: z.string().min(1), assetVersionId: z.string().optional(), resourceId: z.string().optional(), mediaType: z.string().optional(), role: z.enum(["reference", "start_frame", "end_frame", "keyframe", "storyboard", "output"]).optional(), metadataJson: z.string().optional(), outputJson: z.string().optional() }),
} satisfies Record<ToolName, z.AnyZodObject>;

export const toolDescriptions: Record<ToolName, string> = {
    canvas_get_state: "读取当前网页画布的节点、连线、选区和视口。",
    canvas_get_selection: "读取当前网页画布选中的节点。",
    canvas_export_snapshot: "导出当前画布快照，用于理解布局。",
    canvas_apply_ops: "批量操作当前网页画布。ops 支持 add_node、update_node、delete_node、delete_connections、connect_nodes、set_viewport、select_nodes、run_generation。",
    canvas_create_node: "创建任意类型节点：text、script、image、config、video、audio、frame。适合创建脚本、媒体占位、配置节点、背板或自定义 metadata 节点。",
    canvas_create_text_node: "在当前画布创建单个文本节点。",
    canvas_create_text_nodes: "批量创建文本节点，适合生成标题、段落、脚本、说明等内容块。",
    canvas_create_config_node: "创建生成配置节点，可指定 text/image/video/audio 模式和生成参数，可选择立即触发生成。",
    canvas_create_image_prompt_flow: "创建提示词文本节点和图片生成配置节点，并自动连线，可选择立即触发生图。",
    canvas_create_generation_flow: "创建通用生成流程：提示词文本节点、生成配置节点、参考节点连线，可用于文案、生图、视频或音频。",
    canvas_generate_text: "创建通用文本生成流程并立即触发生成。",
    canvas_generate_image: "创建通用图片生成流程并立即触发生成。",
    canvas_generate_video: "创建通用视频生成流程并立即触发生成。",
    canvas_generate_audio: "创建通用音频生成流程并立即触发生成。",
    canvas_update_node: "更新节点基础字段或 metadata。",
    canvas_update_node_text: "更新文本节点内容和标题。",
    canvas_move_nodes: "移动一个或多个节点，支持绝对坐标或 dx/dy 偏移。",
    canvas_resize_node: "调整节点尺寸。",
    canvas_delete_nodes: "删除指定节点及相关连线。",
    canvas_connect_nodes: "批量连接节点。",
    canvas_select_nodes: "设置当前选中节点。",
    canvas_set_viewport: "调整画布视口。",
    canvas_run_generation: "触发指定节点生成，通常用于配置节点或文本/图片/视频/音频节点。",
    project_get_context: "读取当前短剧项目的章节、画布、资产、镜头、候选和工作流事实。",
    project_list_units: "按类型或状态筛选当前短剧项目的章节/项目单元。",
    project_extract_asset_candidates: "将分镜识别出的角色、场景、服饰、道具或武器需求登记为待确认资产候选。",
    project_confirm_asset_candidate: "确认一个资产候选，创建正式资产或关联已有个人资产。",
    project_create_or_update_shots: "创建或更新项目镜头业务数据，不把镜头状态写进画布 metadata。",
    project_link_shot_asset: "将具体资产版本按首帧、尾帧或参考等用途关联到镜头。",
    project_start_workflow_step: "启动项目或章节制作流程中的一个步骤。",
    project_link_asset: "将个人资产引用到当前短剧项目，不复制媒体文件。",
    project_upsert_asset_version: "为项目资产创建新的设定和提示词版本，保留历史版本。",
    project_register_task_output: "将成功生成任务挂到流程步骤，并登记到具体资产版本和资源表示。",
};
