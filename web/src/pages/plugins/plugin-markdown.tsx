import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type PluginMarkdownProps = {
    source: string;
    className?: string;
};

export function PluginMarkdown({ source, className = "" }: PluginMarkdownProps) {
    return (
        <div className={`plugin-markdown ${className}`.trim()}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
                    table: ({ children }) => (
                        <div className="plugin-markdown-table-wrap">
                            <table>{children}</table>
                        </div>
                    ),
                }}
            >
                {source}
            </ReactMarkdown>
        </div>
    );
}
