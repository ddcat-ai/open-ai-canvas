import type { CanvasNodeData, StoryboardRow } from "@/types/canvas";

/** 动作板一键视频默认画幅：横屏 480p（避免落到全局 1:1 / 720p）。 */
export const ACTION_BOARD_VIDEO_DEFAULT_SIZE = "854x480";
export const ACTION_BOARD_VIDEO_DEFAULT_VQUALITY = "480";

export type ActionBoardPromptMention = {
    nodeId: string;
    kind: "character" | "style" | "scene" | "image" | "other";
    title: string;
};

/**
 * 12 宫格动作板出图 prompt：必须吃进分镜行的运镜 / 时间节拍 / 表演调度等字段，
 * 不能只丢 plotDescription（否则格子只剩剧情摘要，动作拆分无时间轴）。
 * 画风/角色正文不 bake 进这里——生成时靠连线再收集，避免重复。
 */
export function buildActionBoardImagePrompt(row: Pick<StoryboardRow,
    | "shotNumber"
    | "durationSeconds"
    | "plotDescription"
    | "dialogue"
    | "characters"
    | "narrativeIntent"
    | "viewerPOV"
    | "performanceBlocking"
    | "shotSize"
    | "emotion"
    | "lightingAndAtmosphere"
    | "audioEffects"
    | "camera"
    | "motion"
    | "timeBeats"
    | "imageGenerationPrompt"
    | "videoMotionPrompt"
    | "mustHave"
    | "optionalDetails"
    | "continuityOut"
    | "negativePrompt"
>) {
    const shotHead = row.durationSeconds > 0
        ? `镜头 ${row.shotNumber} · ${row.durationSeconds}s`
        : `镜头 ${row.shotNumber}`;
    const plot = (row.plotDescription || row.videoMotionPrompt || row.imageGenerationPrompt || "").trim()
        || "根据镜头剧情补全动作";

    const lines: string[] = [
        "生成一张电影动作拆分 12 宫格参考图，严格 3 列 4 行，12 个格子清晰分隔，保持同一角色、服装、场景和光线连续。",
        `${shotHead}：${plot}`,
    ];

    const push = (label: string, value?: string | string[]) => {
        if (Array.isArray(value)) {
            const joined = value.map((item) => String(item || "").trim()).filter(Boolean).join("、");
            if (joined) lines.push(`${label}：${joined}`);
            return;
        }
        const text = String(value || "").trim();
        if (text) lines.push(`${label}：${text}`);
    };

    push("镜头意图", row.narrativeIntent);
    push("观众视点", row.viewerPOV);
    push("表演调度", row.performanceBlocking);
    push("景别", row.shotSize);
    push("情绪", row.emotion);
    push("光影氛围", row.lightingAndAtmosphere);
    push("镜头设计", row.camera);
    push("运镜", row.motion);
    push("时间节拍", row.timeBeats);
    // 运动/首帧提示若与 plot 不同源，再补一段，避免只剩剧情句
    if (row.videoMotionPrompt?.trim() && row.videoMotionPrompt.trim() !== plot) {
        push("运动描述", row.videoMotionPrompt);
    }
    if (row.imageGenerationPrompt?.trim() && row.imageGenerationPrompt.trim() !== plot) {
        push("画面关键帧", row.imageGenerationPrompt);
    }
    push("台词/旁白", row.dialogue);
    push("音效（仅作节奏参考，画面不写字）", row.audioEffects);
    push("出场角色", row.characters.map((item) => item.characterName).filter(Boolean));
    push("必须包含", row.mustHave);
    push("可选细节", row.optionalDetails);
    push("连续性出口", row.continuityOut);
    push("负面要求", row.negativePrompt);

    lines.push(
        "把上述时间节拍、运镜与表演调度落实到 12 格时间轴：从起势、推进、转折、落点到结束姿态按顺序展开；相邻格只推进一小步，机位/构图变化要能看出运镜方向；不要添加文字、边框标题、分格编号或额外画面。",
    );
    return lines.join("\n");
}

/**
 * 分区写 prompt（给视频模型看的自然语言，禁止 @[node:…] UI token）：
 * - 12 宫格：图1
 * - 角色：单独一节，名称列表；脸/服装一致性靠连线角色卡+参考图
 * - 风格/场景：单独一节，名称列表；正文靠连线文本自动并入
 */
export function buildActionBoardVideoPrompt(board: CanvasNodeData, mentions: ActionBoardPromptMention[] = []) {
    const raw = (board.metadata?.composerContent || board.metadata?.prompt || "").trim();
    const body = raw
        .replace(/^生成一张电影动作拆分\s*12\s*宫格参考图[^\n]*\n?/u, "")
        .replace(/^按时间顺序展示动作起势[^\n]*\n?/gmu, "")
        .replace(/^把上述时间节拍、运镜与表演调度落实到[^\n]*\n?/gmu, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    const shotLabel = board.metadata?.shotIndex ? `镜头 ${board.metadata.shotIndex}` : (board.title || "动作板");

    const characters = uniqueMentions(mentions.filter((item) => item.kind === "character"));
    const styles = uniqueMentions(mentions.filter((item) => item.kind === "style" || item.kind === "scene"));
    const extraImages = uniqueMentions(mentions.filter((item) => item.kind === "image" && item.nodeId !== board.id));

    const sections = [
        "【12 宫格动作参考】",
        `以参考图「图1」（12 宫格动作拆分）生成一段连贯视频（${shotLabel}）。`,
        "图1 是动作分镜时间轴参考，不是单帧首尾图：严格按格子顺序演绎起势、推进、转折、落点与结束姿态；保持同一角色、服装、场景和光线连续；不要文字、边框或分格线。",
        body,
    ];

    if (characters.length) {
        sections.push("", "【角色】");
        characters.forEach((item, index) => {
            sections.push(`角色${index + 1}：${item.title}`);
        });
        sections.push("请严格保持以上角色的脸、发型、体态与服装一致（以角色参考图与角色卡为准）。");
    }

    if (styles.length || extraImages.length) {
        sections.push("", "【风格与场景】");
        styles.forEach((item) => sections.push(`${item.kind === "style" ? "画风" : "场景"}：${item.title}`));
        extraImages.forEach((item) => sections.push(`参考图：${item.title}`));
        sections.push("请遵循以上画风与场景设定。");
    }

    return sections.filter((line, index, arr) => !(line === "" && arr[index - 1] === "")).join("\n");
}

function uniqueMentions(items: ActionBoardPromptMention[]) {
    const seen = new Set<string>();
    return items.filter((item) => {
        if (!item.nodeId || seen.has(item.nodeId)) return false;
        seen.add(item.nodeId);
        return true;
    });
}

export function classifyActionBoardMention(node: CanvasNodeData): ActionBoardPromptMention["kind"] {
    if (node.metadata?.workflowKind === "character" || node.metadata?.characterAssetId) return "character";
    if (node.metadata?.workflowKind === "styleboard") return "style";
    if (node.type === "image" || node.type === "drawing") return "image";
    if (node.metadata?.workflowKind === "free" || node.metadata?.workflowKind === "story_input" || node.type === "text") return "scene";
    return "other";
}
