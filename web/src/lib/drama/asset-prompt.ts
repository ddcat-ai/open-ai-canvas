// 参考图提示词预览：与后端 production.renderAssetTemplate 同一规则，只用于展示“实际发送的内容”。

export const CHARACTER_VARIABLES = ["{{角色名称}}", "{{角色设定}}", "{{项目画风}}", "{{画面规则}}"] as const;
export const SCENE_VARIABLES = ["{{场景名称}}", "{{场景设定}}", "{{项目画风}}", "{{画面规则}}"] as const;
export const PROP_VARIABLES = ["{{道具名称}}", "{{道具设定}}", "{{项目画风}}", "{{画面规则}}"] as const;

export function renderAssetPrompt(template: string, values: Record<string, string>) {
    let rendered = template;
    for (const [key, value] of Object.entries(values)) rendered = rendered.split(`{{${key}}}`).join(value.trim());
    return rendered.replaceAll("。。", "。").replaceAll("：。", "。").trim();
}

/** 返回模板里不在白名单中的变量，用于输入时即时提示。 */
export function unknownAssetVariables(template: string, allowed: readonly string[]) {
    const known = new Set(allowed);
    return [...new Set(template.match(/\{\{[^{}]+\}\}/g) || [])].filter((item) => !known.has(item));
}
