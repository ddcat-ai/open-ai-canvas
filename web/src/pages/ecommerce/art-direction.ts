import type { EcommerceDraft } from "@/services/api/ecommerce";
import { commerceAllowsText, commerceCreativeDirection } from "./creative-controls";

const narrativeTypes = new Set(["detail", "set", "amazon-a-plus"]);
const fixedLayoutTypes = new Set(["sku", "white", "size", "three-view", "package"]);

const detailModules = [
    "品牌视觉首屏：完整商品作为大主体，建立品类识别与本套主色；标题、简短说明与少量真实亮点形成清晰层级",
    "核心亮点：选择一项已确认卖点或最有辨识度的可见结构，用侧前方中近景与简洁图标说明表达；没有功能资料就讲可见设计",
    "使用情境：展示适合该品类的具体环境，改变商品朝向与景别；商品清楚可辨，不暗示未确认的使用效果",
    "细节解说：主体与两到三处有实拍依据的局部放大窗组成版式，解释可见轮廓、连接、纹理或操作位置，不补造隐藏结构",
    "交互与体验：围绕用户已提供的使用方式安排步骤或场景；可动商品可从已见外观推演合理的开启、闭合等状态切换作为视觉探索，未见细节留待核对；不可动商品改为俯拍与可见形态解说，不编造功能",
    "质感特写：聚焦另一处可见细节，采用微距、侧光与大留白，材质成分只用已确认资料，其他只描述表面质感",
    "延伸生活场景：使用与前图不同的环境、机位和主体尺度，继续沿用系列色彩与光线语言，避免重复口号",
    "理性信息：有真实尺寸、规格或包装资料时清晰编排；缺失时改为可见外观关系与整体现身，不编造数值、包装或配件",
    "收束海报：回到完整商品，以新的角度和简洁有力的标题收束整套视觉；不凭空添加价格、优惠、认证或售后承诺",
];

const alternateLayouts = [
    "完整主体的居中英雄图，建立清晰商品轮廓，标题与商品有充足间距",
    "主体偏轴的三分之四视角，单侧留白，标题与短说明沿同一轴线对齐",
    "侧向中近景与左右分栏，商品占主要空间，文字与图标组成紧凑信息区",
    "真实可见局部的放大特写，主次画面大小有明显区别，说明贴近对应细节",
    "具体使用场景的宽景，保持商品清楚可辨，留出自然的标题阅读区",
    "俯拍或低机位陈列，强调可见轮廓，采用与前图不同的留白位置",
];

/** Shared guidance for planning and direct generation, without inventing product facts. */
export function commerceSeriesDirection(draft: EcommerceDraft): string {
    return [
        "整套美术执行规范：以用户已选方向和本套 visualStrategy 决定背景配色、标题字体、场景和图形语言；真实商品图负责锁定商品颜色、轮廓、表面纹理和Logo。商品原色不限制背景色盘，统一不等于单调灰色棚拍。主色、辅助色和强调色须明确；不能把不同风格都套成同一科技蓝或金属场景。",
        "背景、承托台、光影和商品须具有统一透视、合理比例与接触阴影，避免仅把抠图贴在模板上。全套建立一致的边距、字重层级与图形语言；背景、光线与色温按用户所选色彩节奏制定变化规则，逐图改变叙事、景别、构图和信息布局。",
        !commerceAllowsText(draft)
            ? "无文字模式：不添加标题、说明、图标标签或装饰字，仅保留商品本身真实 Logo 和包装原文。"
            : "文字系统：使用适合目标语言的同一字体家族，主标题醒目、说明克制、细节标签清楚，固定字重、对齐方式和安全边距；在小屏上仍可读。图标系统：同一套线宽、形状、材质与尺度，最多突出 2–4 项有依据的信息，不画无事实支持的性能或认证图标。",
        "装饰元素只服务于该商品与本张主题，不遮挡轮廓、Logo 和关键细节。同一商品或 SKU 的图片保持相同身份、颜色、结构和品牌标识，不同 SKU 严格遵循各自真实参考。",
        "没有内部结构资料时，不绘制写实爆炸图、剖面或内部零件；可将已经可见的外观部件做概念式分层悬浮，用光线和轮廓线表达层次，并明确这是视觉提案而非真实拆解。用户明确要求概念示意时须明确标注为示意，并避免冒充真实工程结构。",
        "主动寻找与上传图不同的合理视觉状态：有盖板、翻盖、抽屉或折叠外观的商品可安排打开与闭合、使用中与静物展示的镜头；例如只见闭合马桶时，可以规划盖板打开的候选画面。未知的背面与内部细节只做保守外观推演，不写成商品事实；白底、SKU 等固定布局和用户指定严格保真时不加入概念装饰。",
        fixedLayoutTypes.has(draft.imageType) ? "所选类型的统一展示要求优先：白底图保持纯白，SKU 保持统一尺度，尺寸与三视图保持可核对的标注和视角，不强加场景或装饰。" : "",
        commerceCreativeDirection(draft),
    ].join("");
}

/** Fisher–Yates shuffle; `random` is injectable so tests can pin an order. */
export function commerceShuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
        const swap = Math.min(index, Math.floor(random() * (index + 1)));
        [result[index], result[swap]] = [result[swap], result[index]];
    }
    return result;
}

function commerceShotLine(draft: EcommerceDraft, module: string, repeated: boolean): string {
    return `${module}。${repeated ? "选取尚未展示的可见细节或适合品类的新场景，不能复刻前图。" : ""}用户明确指定的本张内容、文案、板块顺序和创作类型参数优先；本项仅为未指定时的构图建议。${!commerceAllowsText(draft) ? "本张不添加新文字或文字标签。" : ""}`;
}

/** Deterministic per-index direction, used by direct generation without a planner. */
export function commerceShotDirection(draft: EcommerceDraft, index: number): string {
    if (fixedLayoutTypes.has(draft.imageType)) return "保持本创作类型要求的统一背景、尺度和展示规则，用户指定的角度与布局优先。";
    const modules = narrativeTypes.has(draft.imageType) ? detailModules : alternateLayouts;
    const slot = draft.count > 1 && draft.count <= detailModules.length && narrativeTypes.has(draft.imageType) ? Math.round((index * (detailModules.length - 1)) / (draft.count - 1)) : index % modules.length;
    return commerceShotLine(draft, modules[slot], index >= modules.length);
}

/**
 * Planner storyboard. The opening hero and the closing poster stay put; the middle
 * modules are drawn in a new random order on every call so repeated plans of the
 * same style do not converge on one sequence. A two-image set (main + secondary)
 * has no closing page, so its second image draws a random middle module instead.
 */
export function commerceNarrativeDirection(draft: EcommerceDraft, random: () => number = Math.random): string {
    if (!narrativeTypes.has(draft.imageType)) return "";
    const count = Math.max(1, draft.count);
    const middle = commerceShuffle(detailModules.slice(1, -1), random);
    const closing = detailModules[detailModules.length - 1];
    const lines = Array.from({ length: count }, (_, index) => {
        if (index === 0) return commerceShotLine(draft, detailModules[0], false);
        if (index === count - 1 && count > 2) return commerceShotLine(draft, closing, false);
        const at = index - 1;
        return commerceShotLine(draft, middle[at % middle.length], at >= middle.length);
    });
    return `整套内容分镜（本轮随机轮换的备选叙事，每次策划都会换序；服务端【本轮版式方案】存在时，以其逐张版式、UI 套件与字体为准，本节只补充各张的内容主题；每张是一幅完整可独立导出的成品，不将全套拼为九宫格）：\n${lines.map((line, index) => `图${index + 1}：${line}`).join("\n")}\n信息不足的模块改用可见设计、不同场景或真实局部细节，不能为了凑满张数虚构卖点。`;
}
