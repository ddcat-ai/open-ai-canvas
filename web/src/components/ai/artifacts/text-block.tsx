import { AIMessageMarkdown } from "../ai-message-markdown";

type Props = {
    content: string;
    status: "streaming" | "idle";
};

export function ArtifactTextBlock({ content, status }: Props) {
    const words = content ? countWords(content) : 0;
    return (
        <div className="artifact-text-block">
            <div className="artifact-text-toolbar">
                <div className="artifact-text-meta">
                    <span className="artifact-text-icon" aria-hidden>¶</span>
                    <span className="artifact-text-streaming">
                        {status === "streaming" ? (
                            <>
                                <span className="artifact-status-dot is-streaming" aria-hidden />
                                正在续写…
                            </>
                        ) : (
                            "正文内容"
                        )}
                    </span>
                </div>
                <div className="artifact-text-stats" title={words ? `约 ${words} 字` : ""}>
                    {words ? `${words} 字` : "generating…"}
                </div>
            </div>
            <div className="artifact-text-content">
                {!content && status === "streaming" ? (
                    <div className="artifact-text-skeleton" aria-hidden>
                        <span className="artifact-text-skel-line w-90" />
                        <span className="artifact-text-skel-line w-full" />
                        <span className="artifact-text-skel-line w-85" />
                        <span className="artifact-text-skel-line w-75" />
                    </div>
                ) : (
                    content ? <AIMessageMarkdown isStreaming={status === "streaming"}>{content}</AIMessageMarkdown> : null
                )}
                {status === "streaming" && content ? <span className="artifact-stream-caret" aria-hidden /> : null}
            </div>
        </div>
    );
}

// 中文字符每字计数；ASCII 按空白分隔的词计数；标点与空白不计。
function countWords(s: string): number {
    let n = 0;
    let inASCIIWord = false;
    const isCJKChar = (code: number) =>
        (code >= 0x4E00 && code <= 0x9FFF) ||
        (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0x3040 && code <= 0x30FF) ||
        (code >= 0xAC00 && code <= 0xD7AF);
    const isWhitespace = (ch: string) => /\s/.test(ch);
    const isPunctuation = (ch: string) =>
        /[，。！？、；：""''（）【】《》,.!?;:\[\]()"'<>`~@#$%^&*+\-=/\\|]/.test(ch);

    for (let i = 0; i < s.length; i += 1) {
        const ch = s[i];
        const code = s.charCodeAt(i);
        if (isCJKChar(code) && !isPunctuation(ch)) {
            n += 1;
            inASCIIWord = false;
            continue;
        }
        if (isWhitespace(ch) || isPunctuation(ch)) {
            inASCIIWord = false;
            continue;
        }
        if (!inASCIIWord) {
            n += 1;
            inASCIIWord = true;
        }
    }
    return n;
}
