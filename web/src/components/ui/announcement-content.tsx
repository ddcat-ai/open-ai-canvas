import { Fragment, createElement, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type AnnouncementContentProps = {
    content: string;
    className?: string;
};

const elementMap = {
    a: "a",
    b: "strong",
    blockquote: "blockquote",
    br: "br",
    code: "code",
    del: "del",
    div: "div",
    em: "em",
    i: "em",
    li: "li",
    mark: "mark",
    ol: "ol",
    p: "p",
    s: "s",
    strong: "strong",
    u: "u",
    ul: "ul",
} as const;

const ignoredTags = new Set(["iframe", "object", "script", "style", "svg", "template"]);

/**
 * 公告由管理员输入但会在所有用户页面展示，因此只将受控标签转换成 React 节点，避免直接注入 HTML。
 * 链接强制新窗口打开，并且只允许 http/https 协议。
 */
export function AnnouncementContent({ content, className }: AnnouncementContentProps) {
    return <div className={cn("whitespace-pre-wrap break-words", className)}>{parseAnnouncementContent(content)}</div>;
}

function parseAnnouncementContent(content: string): ReactNode {
    if (typeof DOMParser === "undefined") return content;

    const document = new DOMParser().parseFromString(content, "text/html");
    return Array.from(document.body.childNodes).map((node, index) => renderNode(node, `announcement-${index}`));
}

function renderNode(node: ChildNode, key: string): ReactNode {
    if (node.nodeType === Node.TEXT_NODE) {
        return <Fragment key={key}>{node.textContent}</Fragment>;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();
    if (ignoredTags.has(tag)) return null;

    const children = Array.from(element.childNodes).map((child, index) => renderNode(child, `${key}-${index}`));
    if (!(tag in elementMap)) return <Fragment key={key}>{children}</Fragment>;

    if (tag === "a") {
        const href = safeHref(element.getAttribute("href"));
        if (!href) return <Fragment key={key}>{children}</Fragment>;
        return (
            <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline decoration-blue-600/40 underline-offset-2 transition hover:text-blue-700 dark:text-blue-400 dark:decoration-blue-400/50 dark:hover:text-blue-300">
                {children}
            </a>
        );
    }

    const component = elementMap[tag as keyof typeof elementMap];
    return createElement(component, { key }, children);
}

function safeHref(value: string | null) {
    if (!value) return null;
    try {
        const url = new URL(value, window.location.href);
        return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    } catch {
        return null;
    }
}
