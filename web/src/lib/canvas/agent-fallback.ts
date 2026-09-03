// 轻量 Agent 降级决策（纯函数，便于单测）。
//
// 背景：本地 Codex runtime 能力最强但依赖本机进程，可能未启动/断开；后端文本模型通道
// （canvas_text generation task）始终可用，适合处理不需要多步画布操作的“简单任务”。
// 本模块只做“该不该降级、是不是简单任务”的判定，不直接发请求，也不依赖 React/DOM。

export type AgentExecutionMode = "local" | "lightweight";

export type LightweightTaskKind =
    | "qa" // 问答 / 解释
    | "writing" // 文案 / 润色 / 翻译
    | "summary" // 总结 / 梳理
    | "ideation" // 头脑风暴 / 建议
    | "chat" // 普通闲聊
    | "complex"; // 需要本地 Codex 多步执行 / 画布写操作 / 媒体生成

export type ClassifyTaskResult = {
    kind: LightweightTaskKind;
    // 0~1，简单任务的置信度；complex 恒为 0。
    confidence: number;
    simple: boolean;
};

// 需要本地 Codex 多步操作、直接改动画布或驱动媒体生成的意图，不适合单轮轻量通道。
const COMPLEX_PATTERNS: RegExp[] = [
    /拆.{0,6}分镜|分镜.{0,4}(放到|投影|画布)|故事板/,
    /(生成|制作|出|画).{0,8}(图片|图像|视频|音频|配乐|配音|关键帧|镜头)/,
    /(画布|节点|连线|工作流).{0,10}(创建|搭建|批量|删除|移动|连接|排布|布局|自动)/,
    /(批量|自动).{0,10}(生成|创建|排布|布局|执行)/,
    /操作画布|改动画布|在画布上/,
    /多轮|一步步执行|按步骤执行整个/,
];

const KIND_PATTERNS: Array<{ kind: Exclude<LightweightTaskKind, "complex" | "chat">; patterns: RegExp[]; confidence: number }> = [
    {
        kind: "writing",
        confidence: 0.9,
        patterns: [
            /写(一?个?|一段|一篇|条)?.{0,12}(文案|标题|标语|slogan|脚本|描述|简介|大纲|台词|旁白|字幕)/,
            /润色|改写|扩写|缩写|续写|仿写|翻译成?|中文翻译|英文翻译|polish/,
            /起(个)??(名字|名称|标题)|命名/,
        ],
    },
    {
        kind: "summary",
        confidence: 0.85,
        patterns: [/总结|概括|归纳|梳理|提炼|要点|摘要|复盘|一句话说/, /分析(一下|下)?(这段|这句话|文本|内容|优缺点)/],
    },
    {
        kind: "qa",
        confidence: 0.8,
        patterns: [/什么是|是什么|为什么|怎么(看|理解|办|做)|如何理解|区别|含义|解释|请问|是不是|能不能|是否|who|what|why|how/i],
    },
    {
        kind: "ideation",
        confidence: 0.75,
        patterns: [/头脑风暴|灵感|想法|点子|建议|方案|创意|有哪些(方向|选择|可能)/],
    },
];

/**
 * 判断一段用户意图是否为轻量通道可处理的“简单任务”。
 * 只基于文本特征，不访问模型；命中复杂模式优先判为 complex。
 */
export function classifyLightweightTask(rawPrompt: string): ClassifyTaskResult {
    const prompt = (rawPrompt || "").trim();
    if (!prompt) return { kind: "chat", confidence: 0, simple: false };
    if (COMPLEX_PATTERNS.some((pattern) => pattern.test(prompt))) {
        return { kind: "complex", confidence: 0, simple: false };
    }
    for (const candidate of KIND_PATTERNS) {
        if (candidate.patterns.some((pattern) => pattern.test(prompt))) {
            return { kind: candidate.kind, confidence: candidate.confidence, simple: true };
        }
    }
    // 短文本且不含画布/媒体动作词时，按普通对话处理，给予较低但可用的置信度。
    const length = prompt.length;
    if (length <= 200 && !/[。！？!?]{2,}/.test(prompt)) {
        return { kind: "chat", confidence: 0.55, simple: true };
    }
    return { kind: "complex", confidence: 0, simple: false };
}

export type DecideAgentModeInput = {
    // 本地 Codex runtime 是否已连接可用。
    localConnected: boolean;
    // 后端文本模型是否已配置就绪（可选到可用逻辑模型/渠道）。
    cloudModelReady: boolean;
    prompt: string;
    // 是否允许在本地不可用时自动降级（用户可关闭自动降级）。默认 true。
    autoFallbackEnabled?: boolean;
};

export type DecideAgentModeResult = {
    mode: AgentExecutionMode;
    // 不选择轻量/本地的具体原因，便于日志与用户提示。
    reason?: "local-available" | "simple-task-fallback" | "cloud-model-unready" | "complex-task-requires-local" | "fallback-disabled";
    classification: ClassifyTaskResult;
};

/**
 * 决定一次 Agent 对话走本地 Codex 还是后端轻量文本通道。
 * 规则：本地可用永远优先本地；本地不可用且允许降级、云端模型就绪、且是简单任务时才降级。
 */
export function decideAgentExecutionMode(input: DecideAgentModeInput): DecideAgentModeResult {
    const classification = classifyLightweightTask(input.prompt);
    if (input.localConnected) {
        return { mode: "local", reason: "local-available", classification };
    }
    if (input.autoFallbackEnabled === false) {
        return { mode: "local", reason: "fallback-disabled", classification };
    }
    if (!input.cloudModelReady) {
        return { mode: "local", reason: "cloud-model-unready", classification };
    }
    if (!classification.simple) {
        return { mode: "local", reason: "complex-task-requires-local", classification };
    }
    return { mode: "lightweight", reason: "simple-task-fallback", classification };
}
