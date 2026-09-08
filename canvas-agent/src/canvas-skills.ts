import { assertCanvasSkill, type CanvasSkillDefinition } from "./orchestration.js";

export const canvasSkills: readonly CanvasSkillDefinition[] = [
    { name: "script-to-scenes", version: "1.0.0", description: "将剧本或文本节点拆分为有序场景节点并建立连接。", allowedTools: ["canvas_get_context", "canvas_get_node", "canvas_prepare_scene_plan", "canvas_apply_scene_plan"], risk: "write", requiresSelection: true, allowReferences: true },
    { name: "script-to-characters", version: "1.0.0", description: "从剧本节点提取主要角色并规划角色卡节点。", allowedTools: ["canvas_get_context", "canvas_get_node", "canvas_create_workflow"], risk: "write", requiresSelection: true, allowReferences: true },
    { name: "storyboard", version: "1.0.0", description: "根据场景文本规划分镜节点和镜头顺序。", allowedTools: ["canvas_get_context", "canvas_find_nodes", "canvas_create_workflow"], risk: "write", requiresSelection: true, allowReferences: true },
    { name: "image-prompt", version: "1.0.0", description: "将创作意图整理为可用于画布生图节点的提示词。", allowedTools: ["canvas_get_context", "canvas_get_node", "canvas_create_image_prompt_flow"], risk: "generation", requiresSelection: true, allowReferences: true, allowGeneration: true },
];

for (const skill of canvasSkills) assertCanvasSkill(skill);

export function getCanvasSkill(name: string) {
    return canvasSkills.find((skill) => skill.name === name);
}

export function serializeCanvasSkill(skill: CanvasSkillDefinition) {
    return { ...skill, allowedTools: [...skill.allowedTools] };
}
