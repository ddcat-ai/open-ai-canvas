/**
 * 把 Agent / 助手的回答收成一段能直接投给视频模型的画面提示词。
 *
 * 回答里经常混着解释、标题、代码块和「想清楚了就点交给 Agent 出片」这类操作说明；
 * 「去出片」只应该带画面描述，不能把整段回答（包括提示怎么点按钮）塞进首页输入框。
 */

const META_PATTERN =
    /(想清楚了就点|交给\s*Agent\s*出片|去出片|片子会直接|点击|复制|粘贴|可继续|还需要我|需要我|要不要|希望对你有帮助|拿去用|直接发送|发送到|打开.{0,6}画布|下面这段|以上)/i;

const LABEL_PATTERN = /^(提示词|画面提示词|最终提示词|出片提示词|画面描述)\s*[:：]\s*/;

function cleanText(value: string) {
    return value
        .replace(/^\s*#{1,6}\s*/, "")
        .replace(/^\s*[-*>d]+[.、)]\s*/, "")
        .replace(/\*\*/g, "")
        .replace(/^\s*[「"'']+|[」"'']+\s*$/g, "")
        .trim();
}

function dropMetaSentences(value: string) {
    return value
        .split(/(?<=[。！？!?])/)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence && !META_PATTERN.test(sentence))
        .join("");
}

export function ll2CleanVideoPrompt(text: string): string {
    const withoutFences = String(text || "").replace(/```[\s\S]*?```/g, " ");
    const paragraphs = withoutFences
        .split(/\n{2,}/)
        .map((paragraph) =>
            paragraph
                .split(/\r?\n/)
                .map(cleanText)
                .filter(Boolean)
                .join(""),
        )
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);

    const labelled = paragraphs.find((paragraph) => /(?:提示词|画面提示词|最终提示词|出片提示词|画面描述)\s*[:：]/.test(paragraph));
    const candidates = paragraphs.filter((paragraph) => !META_PATTERN.test(paragraph));
    const picked = labelled || [...candidates].sort((a, b) => b.length - a.length)[0] || paragraphs.join("，");
    // 标签不一定在段首（如「这里是改好的版本：提示词：…」），取标签后的正文。
    const labelledAt = picked.search(/(?:提示词|画面提示词|最终提示词|出片提示词|画面描述)\s*[:：]\s*/);
    const stripped =
        labelledAt >= 0
            ? picked.slice(labelledAt + picked.slice(labelledAt).match(/^(?:提示词|画面提示词|最终提示词|出片提示词|画面描述)\s*[:：]\s*/)![0].length)
            : picked.replace(LABEL_PATTERN, "");
    const content = dropMetaSentences(stripped) || stripped;
    return content.replace(/\s+/g, " ").replace(/^["'「『]+|["'」』]+$/g, "").trim().slice(0, 700);
}
