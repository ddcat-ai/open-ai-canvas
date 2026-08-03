import { Home } from "lucide-react";
import { Link } from "react-router";

import { WorkspaceSignalIcon } from "@/components/ui/aceternity/workspace-signal-icon";

export default function NotFound() {
    return (
        <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
            <main className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-background px-6 py-10 text-stone-900 dark:text-stone-100">
                <section className="w-full max-w-md text-center">
                    <WorkspaceSignalIcon variant="empty" size="lg" className="mx-auto mb-5" />
                    <div className="mb-2 text-xs font-semibold tabular-nums text-foreground/45">404</div>
                    <h1 className="text-3xl font-semibold tracking-normal">页面不存在</h1>
                    <p className="mt-3 text-sm leading-6 text-stone-500 dark:text-stone-400">这个地址没有对应的页面，可能已经移动或被合并到其他入口。</p>
                    <div className="mt-8 flex flex-wrap justify-center gap-3">
                        <Link to="/" className="inline-flex h-9 items-center gap-2 rounded-md bg-stone-950 px-4 text-[var(--fs-body)] font-medium text-white transition-colors hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-200">
                            <Home className="size-4" />
                            返回首页
                        </Link>
                    </div>
                </section>
            </main>
        </div>
    );
}
