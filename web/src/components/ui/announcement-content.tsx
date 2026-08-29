import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

type AnnouncementContentProps = {
    content: string;
    className?: string;
};

/**
 * 公告由管理员输入但会在所有用户页面展示，因此不启用原始 HTML，避免直接注入 HTML。
 * 链接强制新窗口打开，并且只允许 http/https 协议。
 */
export function AnnouncementContent({ content, className }: AnnouncementContentProps) {
    return (
        <div className={cn("break-words [&_a]:text-blue-600 [&_a]:underline [&_a]:decoration-blue-600/40 [&_a]:underline-offset-2 [&_a]:transition [&_a]:hover:text-blue-700 dark:[&_a]:text-blue-400 dark:[&_a]:decoration-blue-400/50 dark:[&_a]:hover:text-blue-300 [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em] [&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ol_li]:list-decimal [&_ol]:my-2 [&_p]:my-2 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-2 [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_ul]:my-2", className)}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                skipHtml
                components={{
                    a: ({ children, href }) => {
                        const safeURL = safeHref(href);
                        return safeURL ? <a href={safeURL} target="_blank" rel="noopener noreferrer">{children}</a> : <>{children}</>;
                    },
                    table: ({ children }) => <div className="overflow-x-auto"><table>{children}</table></div>,
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}

function safeHref(value?: string) {
    if (!value || typeof window === "undefined") return null;
    try {
        const url = new URL(value, window.location.href);
        return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    } catch {
        return null;
    }
}
