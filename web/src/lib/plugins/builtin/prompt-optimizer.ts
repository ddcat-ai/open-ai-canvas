import { registerPlugin } from "../plugin-registry";
import type {
    PluginManifest,
    PluginTextContentPart,
    PluginTextMessage,
    PluginTextTool,
    PromptOptimizationInput,
    PromptOptimizationMode,
    PromptOptimizationResult,
    PromptOptimizationVariant,
    PromptOptimizerProvider,
    RegisteredPlugin,
} from "../plugin-types";

export const PROMPT_OPTIMIZER_PLUGIN_ID = "prompt-optimizer";

const modeLabels: Record<PromptOptimizationMode, string> = {
    expand: "扩展想法",
    refine: "精修已有提示词",
    style: "强化视觉风格",
    "model-adapt": "适配当前模型",
    reference: "结合参考素材",
};

const optimizerTool: PluginTextTool = {
    type: "function",
    function: {
        name: "optimize_prompt",
        description: "返回结构化的 AI 生图或生视频提示词优化结果。",
        strict: true,
        parameters: {
            type: "object",
            additionalProperties: false,
            required: ["optimizedPrompt", "negativePrompt", "changes", "assumptions", "variants"],
            properties: {
                optimizedPrompt: { type: "string", description: "可直接用于生成的正向提示词。" },
                negativePrompt: { type: "string", description: "需要规避的内容；没有时返回空字符串。" },
                changes: { type: "array", items: { type: "string" }, description: "相较输入提示词做出的关键变化。" },
                assumptions: { type: "array", items: { type: "string" }, description: "对模糊需求做出的假设；没有时返回空数组。" },
                variants: {
                    type: "array",
                    items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["label", "prompt"],
                        properties: {
                            label: { type: "string" },
                            prompt: { type: "string" },
                        },
                    },
                    description: "最多两个可选的提示词版本。",
                },
            },
        },
    },
};

const manifest: PluginManifest = {
    id: PROMPT_OPTIMIZER_PLUGIN_ID,
    name: "AI 提示词优化器",
    version: "0.3.0",
    apiVersion: "yingce.plugin/v1",
    description: "把模糊的生图想法整理成可执行、可比较、适配当前模型的提示词。",
    author: "影策团队",
    permissions: ["canvas.read", "canvas.write", "ai.text"],
    trusted: true,
    runtime: { web: "trusted-backend" },
    contributes: { aiCapabilities: ["prompt-optimizer"] },
};

const systemPrompt = [
    "你是影策工作台里的提示词导演，负责把用户模糊的视觉想法整理成可以直接交给生成模型的提示词。",
    "只优化表达和可执行性，不擅自改变用户明确写出的主体、身份、动作、数量、时代、地点、画幅比例或安全边界。",
    "优先使用具体可视化语言：主体与关系、构图与景别、动作、环境、材质、光线、色彩、镜头和风格。",
    "如果输入已经足够明确，保持原意并做克制的精修；如果信息不足，把不确定项写入 assumptions，不要假装知道。",
    "根据 generationMode 选择表达：图片侧重静态画面、构图和材质，视频侧重动作连续性、时长感、镜头运动和首尾衔接。",
    "当优化模式是适配当前模型时，先结合 targetProtocol 和 targetModel 判断模型族，再严格执行模型适配策略；不要编造不存在的参数、权重语法或模型能力。",
    "最终必须调用 optimize_prompt 工具，不要输出 Markdown，不要在工具调用之外解释。",
].join("\n");

type ModelAdaptationProfile = {
    id: string;
    label: string;
    promptShape: string;
    rules: string[];
    avoid: string[];
};

const genericImageProfile: ModelAdaptationProfile = {
    id: "generic-image",
    label: "通用图片模型",
    promptShape: "自然语言描述，按主体与动作 → 环境 → 构图 → 光线与材质 → 风格排列。",
    rules: ["先锁定主体、数量、身份和动作，再补充可见的画面细节。", "把重要的比例、文字、位置和一致性要求写明确。"],
    avoid: ["不要臆造供应商参数或控制语法。", "关键规避项不要只放在 negativePrompt 中，正向提示词也要表达清楚。"],
};

const genericVideoProfile: ModelAdaptationProfile = {
    id: "generic-video",
    label: "通用视频模型",
    promptShape: "单镜头时序描述，按起始画面 → 主体动作 → 镜头运动 → 环境变化 → 结尾状态排列。",
    rules: ["每个动作使用可观察、连续的动词，避免一段话塞入互不相连的多个镜头。", "明确主体、镜头和环境谁在运动，并保持角色、服装和场景一致。"],
    avoid: ["不要把静态摄影参数堆成关键词列表。", "不要新增用户未要求的转场、角色或剧情。"],
};

function containsAny(value: string, keywords: string[]) {
    return keywords.some((keyword) => value.includes(keyword));
}

function resolveModelAdaptationProfile(input: PromptOptimizationInput): ModelAdaptationProfile {
    const model = `${input.targetModel || ""} ${input.targetProtocol || ""}`.toLowerCase();
    if (input.generationMode === "image") {
        if (containsAny(model, ["gemini", "imagen", "nano-banana", "nanobanana"])) {
            return {
                id: "gemini-image",
                label: "Gemini / Imagen 图片模型",
                promptShape: "清晰的自然语言场景描述，按主体 → 背景与上下文 → 风格与摄影细节组织。",
                rules: ["优先使用完整句子和具体视觉事实，参考图只描述确实可见的内容。", "如果画面含文字，保留原文并明确位置、层级和字数，避免无关装饰。", "控制提示词长度，先保留主体、上下文和风格这三个核心层次。"],
                avoid: ["不要使用 SD 权重、反向提示词标签或未确认的供应商参数。"],
            };
        }
        if (containsAny(model, ["gpt-image", "dall-e", "dalle", "openai-image", "openai"])) {
            return {
                id: "openai-image",
                label: "OpenAI 图片模型",
                promptShape: "简洁、完整的自然语言描述，先说要生成什么，再补充构图、光线、材质和风格。",
                rules: ["使用模型能直接理解的画面描述，不把提示词写成控制台参数。", "对画面中的文字、位置、数量和主体关系使用明确句子。"],
                avoid: ["不要添加 SD 权重、逗号关键词堆叠或 -- 参数。", "不要依赖单独 negativePrompt，重要限制要写进正向描述。"],
            };
        }
        if (containsAny(model, ["grok-image", "grok-imagine"])) {
            return {
                id: "grok-image",
                label: "Grok 图片模型",
                promptShape: "简洁的自然语言画面描述，主体、动作、环境和视觉风格清晰分层。",
                rules: ["保留明确的主体关系、构图和风格意图，避免把提示词写成参数清单。", "有参考图时说明要保留的主体或风格特征，不臆测看不见的细节。"],
                avoid: ["不要添加 SD 权重、Midjourney 参数或模型未确认支持的控制语法。"],
            };
        }
        if (containsAny(model, ["seedream", "jimeng", "doubao", "volcengine-ark-image", "volcengine-jimeng-image"])) {
            return {
                id: "seedream-image",
                label: "Seedream / 即梦 / 火山图片模型",
                promptShape: "中文自然语言镜头描述，按主体与动作 → 构图 → 光影 → 材质与风格组织。",
                rules: ["优先写清人物或主体的外观、动作、空间关系和画面重点。", "需要人物一致性时重复关键外观特征，避免只写抽象的‘保持一致’。", "中文需求保持中文表达，英文专有名词只在确实有帮助时保留。"],
                avoid: ["不要套用 SD 的权重语法、质量词串或无意义的英文标签。", "不要把多个镜头和互相冲突的动作混在一条提示词里。"],
            };
        }
        if (containsAny(model, ["flux"])) {
            return {
                id: "flux-image",
                label: "FLUX 图片模型",
                promptShape: "自然语言段落 + 少量明确的视觉关键词，主体和动作放在前面。",
                rules: ["用具体关系描述主体、位置、材质和光线，而不是重复质量形容词。", "保留用户指定的风格和构图，不主动添加模型参数。"],
                avoid: ["不要输出很长的逗号标签清单或堆叠 negative prompt。", "不要添加未经用户要求的 LoRA、采样器或权重标记。"],
            };
        }
        if (containsAny(model, ["sdxl", "stable-diffusion", "stable diffusion", "sd3", "stable3"])) {
            return {
                id: "stable-diffusion-image",
                label: "Stable Diffusion / SDXL 图片模型",
                promptShape: "紧凑的分层关键词或短句，按主体 → 构图 → 光线 → 风格与质量组织。",
                rules: ["只保留能影响画面的关键词，主体和构图优先。", "如果原提示词已经使用括号权重，只在确有必要时保留并少量调整。", "将画面主体和反向规避项分开表达，避免互相冲突。"],
                avoid: ["不要盲目添加过多质量词、艺术家名或模型专属标签。", "不确定权重语法是否被当前渠道支持时，不要主动新增。"],
            };
        }
        if (containsAny(model, ["midjourney", "mid-journey"])) {
            return {
                id: "midjourney-image",
                label: "Midjourney 图片模型",
                promptShape: "精炼的视觉描述，主体、场景、构图和风格清晰，参数放在末尾。",
                rules: ["优先写画面内容和视觉方向，保持短而有辨识度。", "只有用户原本提供或明确要求时才保留 --ar、--stylize 等参数。"],
                avoid: ["不要臆造 Midjourney 参数或把所有摄影术语都堆上去。", "不要使用与当前工作台协议无关的命令前缀。"],
            };
        }
        if (containsAny(model, ["ideogram", "recraft"])) {
            return {
                id: "design-image",
                label: "设计与文字图片模型",
                promptShape: "先说明画布、主体和版式，再说明文字内容、位置、层级、字体气质和配色。",
                rules: ["画面文字保留精确原文并控制字数，明确文字与主体的空间关系。", "区分内容、版式和视觉风格，避免只给抽象审美词。"],
                avoid: ["不要擅自改写品牌名、标题、数字或标语。"],
            };
        }
        return genericImageProfile;
    }

    if (containsAny(model, ["seedance", "doubao-seedance", "volcengine-ark-video", "volcengine-jimeng-video", "jimeng-video"])) {
        return {
            id: "seedance-video",
            label: "Seedance / 即梦视频模型",
            promptShape: "单镜头时序描述，明确起始构图、动作节拍、镜头运动、环境变化和结尾状态。",
            rules: ["用连续动作描述主体如何开始、发展和结束，保持镜头内的因果关系。", "人物、服装、场景和道具的一致性优先于堆叠风格词。", "有首帧或参考图时，明确哪些内容必须保持、哪些内容允许变化。"],
            avoid: ["不要在一条提示词中拼接多个无关镜头。", "不要把静态图片参数当成视频动作指令。"],
        };
    }
    if (containsAny(model, ["veo", "gemini-veo"])) {
        return {
            id: "veo-video",
            label: "Veo 视频模型",
            promptShape: "电影化的自然语言镜头描述，按主体、动作、镜头、环境和节奏组织。",
            rules: ["把想法拆成可观察的动作和镜头运动，并补充时间顺序。", "用景别、机位、运镜、光线和环境声等可视化要素控制镜头。"],
            avoid: ["不要只写情绪和抽象风格，不给动作或镜头变化。", "不要加入用户未要求的多镜头转场。"],
        };
    }
    if (containsAny(model, ["kling"])) {
        return {
            id: "kling-video",
            label: "Kling 视频模型",
            promptShape: "简洁、连续的动作指令，明确主体运动和摄像机运动。",
            rules: ["每个动作都写清主体、方向、速度或结果，避免互相冲突的动作。", "优先保证物理连续性、角色一致性和镜头稳定。"],
            avoid: ["不要加入过多抽象叙事或无法在短片段中完成的事件。"],
        };
    }
    if (containsAny(model, ["runway", "gen-3", "gen3", "minimax-video", "hailuo", "wan", "ltx-video", "hunyuan-video"])) {
        return {
            id: "general-video-family",
            label: "通用视频模型",
            promptShape: "以单个镜头为单位描述起始画面、动作过程、摄影机和结束画面。",
            rules: ["动作使用连续动词，明确运动主体和摄像机，不把结果写成静态形容词。", "保持角色、服装、场景和光线的连续性。"],
            avoid: ["不要堆砌静态图片关键词或一次安排过多动作。"],
        };
    }
    return genericVideoProfile;
}

function buildUserMessage(input: PromptOptimizationInput, modelProfile: ModelAdaptationProfile | null = input.mode === "model-adapt" ? resolveModelAdaptationProfile(input) : null): PluginTextMessage {
    const textParts = [
        `优化模式：${modeLabels[input.mode]}`,
        `目标类型：${input.generationMode === "image" ? "图片" : "视频"}`,
        `目标生成模型：${input.targetModel?.trim() || "未指定"}`,
        `目标接口协议：${input.targetProtocol?.trim() || "未指定"}`,
        "",
        "用户原始提示词：",
        input.prompt.trim() || "（用户还没有写出具体提示词，请从参考上下文中提炼一个可执行版本）",
    ];
    if (modelProfile) {
        textParts.push(
            "",
            `模型适配策略：${modelProfile.label}`,
            `建议提示词结构：${modelProfile.promptShape}`,
            "必须遵守：",
            ...modelProfile.rules.map((rule) => `- ${rule}`),
            "避免：",
            ...modelProfile.avoid.map((rule) => `- ${rule}`),
            "请在 changes 中明确说明已经采用的模型适配要点。",
        );
    }
    if (input.context?.texts?.length) {
        textParts.push("", "已连接的文本上下文：", ...input.context.texts.map((item) => `- ${item.title}：${item.text}`));
    }
    if (input.context?.images?.length) {
        textParts.push("", "已连接的参考图已作为图片输入，请只在确实可见的内容上做判断：", ...input.context.images.map((item) => `- ${item.title}`));
    }
    textParts.push(
        "",
        "输出要求：",
        "1. optimizedPrompt 是一段可以直接复制到当前生成节点的提示词。",
        "2. negativePrompt 只填写明确有帮助的规避项，没有就留空。",
        "3. changes 和 assumptions 使用简短中文条目。",
        "4. variants 最多给出两个明显不同但仍忠于原意的版本，没有必要时返回空数组。",
    );

    const content: PluginTextContentPart[] = [{ type: "text", text: textParts.join("\n") }];
    for (const image of input.context?.images || []) {
        if (/^(data:|https?:\/\/)/i.test(image.url.trim())) content.push({ type: "image_url", image_url: { url: image.url.trim() } });
    }
    return { role: "user", content };
}

function parseJsonObject(value: string) {
    const cleaned = value
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
    const candidates = [cleaned];
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) candidates.push(cleaned.slice(start, end + 1));
    for (const candidate of candidates) {
        try {
            const parsed: unknown = JSON.parse(candidate);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
        } catch {
            // 某些兼容模型会在 JSON 外包一层解释，继续尝试截取对象部分。
        }
    }
    return null;
}

function stringArray(value: unknown) {
    return Array.isArray(value)
        ? value
              .filter((item): item is string => typeof item === "string")
              .map((item) => item.trim())
              .filter(Boolean)
        : [];
}

function variants(value: unknown): PromptOptimizationVariant[] {
    if (!Array.isArray(value)) return [];
    return value
        .flatMap((item): PromptOptimizationVariant[] => {
            if (!item || typeof item !== "object") return [];
            const record = item as Record<string, unknown>;
            const label = typeof record.label === "string" ? record.label.trim() : "备选版本";
            const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
            return prompt ? [{ label: label || "备选版本", prompt }] : [];
        })
        .slice(0, 2);
}

function normalizeResult(value: Record<string, unknown> | null, sourcePrompt: string, modelProfile?: ModelAdaptationProfile | null): PromptOptimizationResult {
    const optimizedPrompt = typeof value?.optimizedPrompt === "string" ? value.optimizedPrompt.trim() : "";
    const negativePrompt = typeof value?.negativePrompt === "string" ? value.negativePrompt.trim() : "";
    return {
        optimizedPrompt: optimizedPrompt || sourcePrompt.trim(),
        negativePrompt,
        changes: stringArray(value?.changes),
        assumptions: stringArray(value?.assumptions),
        variants: variants(value?.variants),
        modelProfile: modelProfile ? { id: modelProfile.id, label: modelProfile.label } : undefined,
    };
}

function createPromptOptimizer(context: Parameters<NonNullable<RegisteredPlugin["createPromptOptimizer"]>>[0]): PromptOptimizerProvider {
    const textService = context.services?.ai?.text;
    if (!textService) throw new Error("提示词优化器暂未获得文本模型服务");

    return {
        optimize: async (input, options) => {
            const modelProfile = input.mode === "model-adapt" ? resolveModelAdaptationProfile(input) : null;
            const response = await textService.requestToolResponse({
                model: input.optimizerModel,
                messages: [{ role: "system", content: systemPrompt }, buildUserMessage(input, modelProfile)],
                tools: [optimizerTool],
                toolChoice: { type: "function", name: "optimize_prompt" },
                signal: options?.signal,
                onDelta: options?.onDelta,
            });
            const toolCall = response.toolCalls.find((call) => call.name === "optimize_prompt");
            const parsed = parseJsonObject(toolCall?.arguments || response.content);
            return normalizeResult(parsed, input.prompt, modelProfile);
        },
    };
}

export const promptOptimizerPlugin: RegisteredPlugin = {
    manifest,
    createPromptOptimizer,
};

registerPlugin(promptOptimizerPlugin);
