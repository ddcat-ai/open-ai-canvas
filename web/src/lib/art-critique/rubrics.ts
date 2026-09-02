import { ART_CRITIQUE_RUBRIC_VERSION, type ArtCritiqueCategory, type ArtCritiqueImageType } from "./contracts";

export type RubricCategory = Exclude<ArtCritiqueCategory, "other">;

export type ArtCritiqueRubricPromptOptions = {
    /** Restrict the prompt to one or more reviewer-owned categories. */
    categories?: readonly RubricCategory[];
    /** Full prompts keep the research mapping; narrow reviewer prompts omit it to reduce distraction. */
    includeReferenceMapping?: boolean;
};

export type ArtCritiqueRubricCheck = {
    id: string;
    label: string;
    check: string;
    flagWhen: string;
    applicableImageTypes?: readonly ArtCritiqueImageType[];
    evidenceRequired?: boolean;
    minConfidence?: number;
    mergeKeys?: readonly string[];
};

export type ArtCritiqueRubricSection = {
    category: RubricCategory;
    label: string;
    references: readonly string[];
    checks: readonly ArtCritiqueRubricCheck[];
};

/**
 * 这些项目只作为方法论来源，不作为运行时依赖。模型仍然通过当前项目的云端渠道调用。
 */
export const ART_CRITIQUE_RUBRIC: readonly ArtCritiqueRubricSection[] = [
    {
        category: "composition",
        label: "构图与视觉层级",
        references: ["CADB / SAMP-Net", "CG-IAA", "PhotoFramer-Assessment"],
        checks: [
            { id: "subject-placement", label: "主体位置", check: "主体位置是否服务于画面意图和叙事方向", flagWhen: "主体位置让画面失去方向感，或明显削弱了主题表达", applicableImageTypes: ["portrait", "landscape", "product", "illustration", "concept-art", "architecture", "still-life", "other"], evidenceRequired: true, minConfidence: 0.55, mergeKeys: ["subject", "placement"] },
            { id: "visual-balance", label: "视觉平衡", check: "左右、上下和前后景的视觉重量是否合理", flagWhen: "一侧重量明显压住另一侧，且不是有意制造的不平衡", applicableImageTypes: ["portrait", "landscape", "product", "illustration", "concept-art", "architecture", "still-life", "other"], evidenceRequired: true, minConfidence: 0.55, mergeKeys: ["balance", "weight"] },
            { id: "negative-space", label: "留白与呼吸", check: "留白是否提供呼吸感、方向感或叙事空间", flagWhen: "留白挤压主体、切断动作方向，或空白区域没有发挥作用", applicableImageTypes: ["portrait", "landscape", "product", "illustration", "concept-art", "architecture", "still-life", "other"], evidenceRequired: true, minConfidence: 0.55, mergeKeys: ["negative-space", "space"] },
            { id: "visual-flow", label: "视觉动线", check: "第一视觉焦点、第二焦点和视线移动路径是否清楚", flagWhen: "背景或局部高对比抢走主体注意力，视线无法自然进入画面", applicableImageTypes: ["portrait", "landscape", "product", "illustration", "concept-art", "architecture", "still-life", "other"], evidenceRequired: true, minConfidence: 0.55, mergeKeys: ["flow", "focus"] },
            { id: "composition-pattern", label: "构图模式", check: "当前画面更接近居中、三分、黄金比例、三角、水平、垂直、对角、对称、曲线、放射、消失点、pattern 或 fill-frame 中的哪一种", flagWhen: "构图模式与画面意图冲突（不能仅因没有使用三分法就报告）", applicableImageTypes: ["portrait", "landscape", "product", "illustration", "concept-art", "architecture", "still-life", "other"], evidenceRequired: true, minConfidence: 0.6, mergeKeys: ["pattern", "intent"] },
            { id: "crop-and-depth", label: "裁切与景深", check: "裁切、遮挡和前中后景是否强化主体关系", flagWhen: "裁切破坏主体结构，或空间层次让画面关系难以理解", applicableImageTypes: ["portrait", "landscape", "product", "illustration", "concept-art", "architecture", "still-life", "other"], evidenceRequired: true, minConfidence: 0.55, mergeKeys: ["crop", "depth"] },
        ],
    },
    {
        category: "color",
        label: "色彩",
        references: ["CG-IAA", "AesExpert"],
        checks: [
            { id: "palette", label: "色彩关系", check: "主色、辅色和强调色是否形成清楚的色彩关系", flagWhen: "颜色彼此争夺注意力，或主色关系混乱到削弱主题" },
            { id: "temperature", label: "冷暖与和谐", check: "冷暖关系、色相关系和整体氛围是否一致", flagWhen: "局部冷暖或色相突然跳出，且没有叙事或焦点上的理由" },
            { id: "value-and-saturation", label: "明度与饱和度", check: "明度层次和饱和度分布是否支持视觉层级", flagWhen: "主体与背景明度接近、颜色发灰发脏，或次要区域过度鲜艳" },
            { id: "color-separation", label: "色彩分离", check: "主体与背景、相邻形体之间是否有足够的色彩区分", flagWhen: "关键形体融入背景，导致轮廓、情绪或信息无法被读出" },
        ],
    },
    {
        category: "lighting",
        label: "光线",
        references: ["CG-IAA", "AesExpert", "HumanAesExpert"],
        checks: [
            { id: "light-direction", label: "光源方向", check: "主光源方向、高光和阴影方向是否一致", flagWhen: "同一画面不同对象的光照方向互相矛盾" },
            { id: "exposure", label: "曝光与对比", check: "曝光、局部对比和高光阴影是否保留了重要信息", flagWhen: "主体关键区域过曝、死黑，或局部对比不足以建立焦点" },
            { id: "volume", label: "体积与空间", check: "光线是否帮助形体、距离和空间深度被理解", flagWhen: "形体变平、空间关系混乱，或光线没有服务于主体" },
            { id: "subject-separation", label: "主体分离", check: "主体是否通过光线与环境建立清楚的层次", flagWhen: "主体与背景的亮度或光质接近，导致主体被吞没" },
        ],
    },
    {
        category: "proportion",
        label: "比例、结构与透视",
        references: ["HumanAesExpert", "PhotoFramer-Assessment", "CG-IAA"],
        checks: [
            { id: "human-proportion", label: "人物比例", check: "人物的脸部、五官、手脚、肢体长度和头身关系是否自然", flagWhen: "可见的结构异常影响可信度（不要把正常透视变化误判为畸形）", applicableImageTypes: ["portrait"], evidenceRequired: true, minConfidence: 0.7, mergeKeys: ["human", "proportion"] },
            { id: "object-scale", label: "物体相对尺寸", check: "物体之间的相对大小是否符合场景关系", flagWhen: "关键物体大小关系破坏空间或叙事逻辑" },
            { id: "perspective", label: "透视与遮挡", check: "消失方向、近大远小、地面关系和遮挡顺序是否一致", flagWhen: "透视线索互相冲突，或遮挡关系让空间无法成立" },
            { id: "detail-consistency", label: "细节一致性", check: "关键边缘、纹理、清晰度和风格是否保持一致", flagWhen: "局部明显崩坏、重复、异常，且会影响主体阅读" },
        ],
    },
];

export function findArtCritiqueRubricCheck(checkId: string) {
    for (const section of ART_CRITIQUE_RUBRIC) {
        const check = section.checks.find((item) => item.id === checkId);
        if (check) return { ...check, category: section.category };
    }
    return undefined;
}

export const ART_CRITIQUE_REFERENCE_METHODS = [
    "用 CG-IAA / AesExpert 的维度化 critique 思路组织评价，不把审美压成单一分数。",
    "用 CADB 的构图模式作为参考，但先判断画面意图，不把三分法等几何规则当成绝对答案。",
    "用 HumanAesExpert 的人物维度补充人像模式，只有看得清且确实影响画面时才指出结构问题。",
    "用 PhotoFramer 的 shift、zoom/crop、view change 思路组织修改动作，建议必须能转成下一轮提示词。",
    "用 Grounding-IQA 的描述与区域绑定思路表达 target；无法可靠定位时使用 global。",
] as const;

export function buildArtCritiqueRubricPrompt(options: ArtCritiqueRubricPromptOptions = {}) {
    const selectedCategories = options.categories?.length ? new Set(options.categories) : undefined;
    const sectionsToRender = selectedCategories ? ART_CRITIQUE_RUBRIC.filter((section) => selectedCategories.has(section.category)) : ART_CRITIQUE_RUBRIC;
    const sections = sectionsToRender.map((section) => {
        const checks = section.checks.map((item) => `- ${item.label}（规则 ID：${item.id}；适用图片：${(item.applicableImageTypes || ["所有图片"]).join("、")}；最低置信度：${item.minConfidence ?? 0.55}；需要证据：${item.evidenceRequired !== false ? "是" : "否"}；合并关键词：${(item.mergeKeys || []).join("、")}）：检查${item.check}；只有在${item.flagWhen}时才报告。`).join("\n");
        return [`【${section.label}｜${section.category}】`, `方法参考：${section.references.join("、")}`, checks].join("\n");
    }).join("\n\n");
    const includeReferenceMapping = options.includeReferenceMapping ?? !selectedCategories;

    return [
        `审美 Rubric 版本：${ART_CRITIQUE_RUBRIC_VERSION}`,
        "以下是影策当前采用的内部审美检查标准。参考项目提供的是任务定义和方法论，不是需要引用的答案，也不是必须部署的模型。",
        selectedCategories ? `本次 Reviewer 只负责以下维度：${[...selectedCategories].join("、")}。不要评价其他维度，也不要重复其他 Reviewer 的职责。` : "先判断图片类型、主体、视觉意图和当前构图策略，再应用检查项。",
        "审美偏好不等于结构性错误；只有有画面证据、会影响表达、且能给出动作时才生成问题。允许没有问题，不要为了覆盖检查项、满足数量或显得有帮助而凑数。",
        ...(includeReferenceMapping ? [`参考方法映射：\n${ART_CRITIQUE_REFERENCE_METHODS.map((method) => `- ${method}`).join("\n")}`] : []),
        sections,
        "每个候选必须填写命中的规则 ID（checkId），只能选择当前 Reviewer 负责维度中的规则。规则不适用当前图片类型时不要报告；没有具体证据时不要报告；置信度低于规则最低值时不要报告。",
        "规则 ID 只用于本地校验和聚合去重，不要把规则 ID 当作问题标题展示给用户。",
        "修改建议优先使用可执行动作：移动主体（shift）、裁切或缩放（zoom/crop）、调整视角或空间关系（view change）、调整颜色/光线、局部重绘或重生成。写清楚修改目标、具体动作、需要保留的内容和预期效果。",
        "定位必须服从问题描述：连续的一块局部区域（例如脸部、人物、前景、桌面、头部周边）优先用 box；box 只允许左上角和右下角两个角点，且左右、上下跨度都至少为图片尺寸的 2.5%，不能返回同一条水平线或竖线。单一离散位置用 point，多个互不相连的位置用 points，沿轮廓的区域才用 polygon，整体问题用 global。所有坐标为原图左上角 0,0、右下角 1,1 的归一化坐标。无法可靠定位时宁可使用 global，不要猜测一个框。",
    ].join("\n\n");
}
