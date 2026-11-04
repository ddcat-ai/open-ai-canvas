import type { ReactNode } from "react";

/** 「知识与技能」各标签页的内容头：一句说明 + 本标签的操作。页面标题与标签切换由外层页面提供。 */
export function EcommerceLibraryPanel({ description, actions, children }: { description: string; actions?: ReactNode; children: ReactNode }) {
    return (
        <section className="eal-panel">
            <header className="eal-panel-head">
                <p>{description}</p>
                {actions ? <div className="eal-panel-actions">{actions}</div> : null}
            </header>
            {children}
        </section>
    );
}
