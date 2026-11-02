/** Reject production directions before they can become printed advertising copy. */
export function commerceCopyHasDirections(copy: string) {
    const directions =
        /(?:手持|正面|侧面|局部)?画面(?:呈现|展示|安排|采用|使用|保持)|(?:构图|镜头|机位|景别|排版|提示词|安全边距|字号|字重|文案位置|主体占比|相对关系|装饰仍清晰可见)|(?:主标题|副标题|说明文案|正文|标题)\s*[:：]|(?:放在|置于|位于).{0,12}(?:左侧|右侧|上方|下方|画幅)|(?:render|place|layout|composition|camera|prompt)\s*[:：]/i;
    return directions.test(copy);
}

export function assertCommerceConsumerCopy(copy: string) {
    if (commerceCopyHasDirections(copy)) throw new Error("文案中含有画面说明，请重新策划后再生成");
}

export const commerceTypographyInstruction =
    "文字排版验收：全部标题、说明、标签及装饰的完整外接框（含描边、阴影、旋转后的四角、图标和引线），必须位于画幅四边各内缩至少 8% 的安全区内，即横纵坐标均在 8%–92% 内；背景仍连续铺满四边。保留约 20%–30% 不承载文字或装饰的干净呼吸空间，留白延续本套背景与场景，不是外加白边。标题宽度不得超过可用文字栏，长标题主动分为两行，说明按文字栏宽逐行换行，禁止横向单行溢出、贴边、裁字、遮挡商品或用极小字体硬塞。文字与商品、不同信息组之间至少留出一行正文字高，卡片内边距至少半行字高。单屏只设一个主标题和一组辅助信息，默认最多 3 个短标签或 2 组带说明的卡片，细节放大窗最多 2 个；不把卖点条、气泡、放大窗和底部横幅同时堆满。先在策划阶段精炼重复文案、减少装饰、扩大文字留白并重排商品；生成阶段保留已审阅文案全文，以换行和重排容纳，不能截断或擅自删字。安全区与可读性优先于超大标题、斜切贴纸和参考图中的贴边布局。仅把明确提供的消费者成品文案印在图中；构图、机位、手持关系、保真规则、字段名、JSON、提示词及本段执行说明只用于创作，绝不能作为可见文字。成品文案应自然、具体、有阅读节奏，不把制作过程写成广告。";
