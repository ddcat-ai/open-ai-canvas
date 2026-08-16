import { countLines, describeLanguage } from "./utils";

type Props = {
    content: string;
    language: string;
    status: "streaming" | "idle";
};

export function ArtifactCodeBlock({ content, language, status }: Props) {
    const displayLang = describeLanguage(language);
    return (
        <div className="artifact-code-block">
            <div className="artifact-code-toolbar">
                <div className="artifact-code-lang-tag">
                    <span className="artifact-code-dot" aria-hidden />
                    <span className="artifact-code-language">{displayLang}</span>
                </div>
                <div className="artifact-code-lines" title={content ? `共 ${countLines(content)} 行` : "正在生成"}>
                    {content ? `${countLines(content)} lines` : "generating…"}
                </div>
            </div>
            <div className="artifact-code-content-wrap">
                {!content && status === "streaming" ? (
                    <div className="artifact-code-skeleton" aria-label="代码生成中">
                        <span /><span /><span />
                    </div>
                ) : (
                    <pre className="artifact-code-content">
                        <code className={language ? `language-${language}` : ""}>
                            {content}
                        </code>
                    </pre>
                )}
                {status === "streaming" && content ? <span className="artifact-stream-caret" aria-hidden /> : null}
            </div>
        </div>
    );
}
