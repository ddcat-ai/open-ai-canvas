import { Streamdown, type Components } from "streamdown";
import { code as streamdownCode } from "@streamdown/code";

import "streamdown/styles.css";

type AIMessageMarkdownProps = {
    children: string;
    isStreaming?: boolean;
    className?: string;
};

const components: Components = {
    h1: ({ children, ...props }) => <h2 {...props} className="ai-message-markdown-heading ai-message-markdown-heading-1">{children}</h2>,
    h2: ({ children, ...props }) => <h3 {...props} className="ai-message-markdown-heading ai-message-markdown-heading-2">{children}</h3>,
    h3: ({ children, ...props }) => <h4 {...props} className="ai-message-markdown-heading ai-message-markdown-heading-3">{children}</h4>,
    h4: ({ children, ...props }) => <h5 {...props} className="ai-message-markdown-heading ai-message-markdown-heading-4">{children}</h5>,
    p: ({ children, ...props }) => <p {...props} className="ai-message-markdown-paragraph">{children}</p>,
    ul: ({ children, ...props }) => <ul {...props} className="ai-message-markdown-list ai-message-markdown-list-unordered">{children}</ul>,
    ol: ({ children, ...props }) => <ol {...props} className="ai-message-markdown-list ai-message-markdown-list-ordered">{children}</ol>,
    li: ({ children, ...props }) => <li {...props} className="ai-message-markdown-list-item">{children}</li>,
    blockquote: ({ children, ...props }) => <blockquote {...props} className="ai-message-markdown-blockquote">{children}</blockquote>,
    pre: ({ children, ...props }) => <pre {...props} className="ai-message-markdown-pre">{children}</pre>,
    code: ({ children, className, ...props }) => <code {...props} className={`ai-message-markdown-code ${className || ""}`.trim()}>{children}</code>,
    a: ({ children, ...props }) => <a {...props} className="ai-message-markdown-link" target="_blank" rel="noreferrer">{children}</a>,
    hr: (props) => <hr {...props} className="ai-message-markdown-rule" />,
    table: ({ children, ...props }) => <div className="ai-message-markdown-table-wrap"><table {...props} className="ai-message-markdown-table">{children}</table></div>,
    th: ({ children, ...props }) => <th {...props} className="ai-message-markdown-table-cell ai-message-markdown-table-header">{children}</th>,
    td: ({ children, ...props }) => <td {...props} className="ai-message-markdown-table-cell">{children}</td>,
    input: ({ ...props }) => <input {...props} className="ai-message-markdown-task" disabled />,
};

export function AIMessageMarkdown({ children, isStreaming = false, className = "" }: AIMessageMarkdownProps) {
    if (!children.trim()) return null;
    return (
        <Streamdown
            className={`ai-message-markdown ${className}`.trim()}
            mode="streaming"
            dir="auto"
            isAnimating={isStreaming}
            animated={isStreaming ? { animation: "fadeIn", duration: 140, sep: "word", stagger: 8 } : false}
            parseIncompleteMarkdown
            skipHtml
            lineNumbers={false}
            plugins={{ code: streamdownCode }}
            components={components}
        >
            {children}
        </Streamdown>
    );
}
