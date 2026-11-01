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
    "文字排版验收：全部标题、说明、标签及装饰的完整外接框，必须位于画幅四边各内缩至少 7% 的安全区内；背景仍连续铺满四边。标题宽度不得超过可用文字栏，长标题主动分为两行，说明按文字栏宽逐行换行，禁止横向单行溢出、贴边、裁字、遮挡商品或用极小字体硬塞。内容较多时减少装饰、扩大文字留白并重排商品，仍无法容纳则精炼文案重新策划。仅把明确提供的消费者成品文案印在图中；构图、机位、手持关系、保真规则、字段名、JSON、提示词及本段执行说明只用于创作，绝不能作为可见文字。成品文案应自然、具体、有阅读节奏，不把制作过程写成广告。";
