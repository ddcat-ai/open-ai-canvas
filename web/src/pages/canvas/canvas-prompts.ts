/**
 * 画布侧送模型的 prompt 与协议串：协议词汇，不是界面文案。
 * 禁止翻译、禁止迁移进 catalog——跟随界面语言会改变生成效果或破坏 @[node:] 协议
 * （见仓库 AGENTS 红线、i18n-codemod 的 SKIP_FILE_RE 与守护探针黑名单）。
 */

/** 文本节点的指令改写指令模板 */
export function textEditInstruction(sourceTextContent: string, prompt: string): string {
    return `请根据要求修改以下文本。\n\n原文：\n${sourceTextContent}\n\n修改要求：\n${prompt}`;
}

/** 反推提示词任务的 composer 协议内容（@[node:] 是画布引用协议） */
export function referencePromptComposerContent(imageNodeId: string, textNodeId: string): string {
    return `参考图片：@[node:${imageNodeId}]\n任务说明：@[node:${textNodeId}]`;
}

/** 局部编辑（蒙版）的 prompt 前缀 */
export function maskEditPrompt(userPrompt: string): string {
    return `只修改蒙版透明区域，其他区域保持不变。${userPrompt}`;
}

/** 动作拆分板（12 宫格）prompt 组装 */
export function buildActionBoardPrompt(input: { shotNumber: number | string; plotDescription: string; videoMotionPrompt: string; characterNames: string }): string[] {
    return [
        "生成一张电影动作拆分 12 宫格参考图，严格 3 列 4 行，12 个格子清晰分隔，保持同一角色、服装、场景和光线连续。",
        `镜头 ${input.shotNumber}：${input.plotDescription || input.videoMotionPrompt || ACTION_BOARD_FALLBACK_MOTION}`,
        input.characterNames ? `角色：${input.characterNames}` : "",
        "按时间顺序展示动作起势、推进、转折、落点和结束姿态，不要添加文字、边框标题或额外画面。",
    ];
}

export const ACTION_BOARD_FALLBACK_MOTION = "根据镜头剧情补全动作";

/** 反推提示词的指令预设（作为节点 content/prompt 送模型） */
export const IMAGE_PROMPT_REVERSE_PRESET = `请根据参考图片反推一段适合用于 AI 生图的提示词。

要求：
1. 只输出提示词正文，不要解释。
2. 覆盖主体、构图、风格、光线、色彩、材质、镜头和氛围。
3. 尽量写成可直接用于生图模型的完整提示词。`;

/**
 * 历史版本的落盘错误文案：用于识别旧会话里已被中断的节点（持久化数据保持写入时刻的语言，
 * 该字面量是兼容判据，禁止翻译或迁移进 catalog）。
 */
export const LEGACY_PERSISTED_INTERRUPTED_ERROR = "页面刷新后生成已中断，请重新生成。";

// ---- 节点标题 / 元数据 prompt 构造器（写入画布文档的落盘数据，同样不跟随界面语言）----

export function annotateNodeTitle(base: string): string {
    return `标注 · ${base}`;
}

export function lastFrameNodeTitle(base: string): string {
    return `尾帧 · ${base}`;
}

export function extractedAudioPrompt(base: string): string {
    return `从「${base}」提取的声音`;
}

export function audioNodeTitle(base: string): string {
    return `声音 · ${base}`;
}

export function segmentNodeTitle(index: number, base: string): string {
    return `片段 ${index} · ${base}`;
}

export function segmentPrompt(index: number, base: string): string {
    return `从「${base}」截取的片段 ${index}`;
}

export function regenerateNodeTitle(index: number, base: string): string {
    return `重生成 ${index} · ${base}`;
}

export function chapterWorkflowDescription(position: number): string {
    return `第 ${position} 章`;
}

export function drawingNodeTitle(base: string): string {
    return `${base} · 绘图`;
}
