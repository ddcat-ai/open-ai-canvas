import { Home } from "lucide-react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";

import { WorkspaceSignalIcon } from "@/components/ui/aceternity/workspace-signal-icon";
import { useThemePack } from "@/themes/use-theme-pack";

export default function NotFound() {
    const { t } = useTranslation();
    // 主题包可以给 404 加背景装饰、换掉标题上方的图标，或换一句标题和说明。
    const notFound = useThemePack()?.notFound;
    const Backdrop = notFound?.backdrop;
    const Emblem = notFound?.emblem;
    return (
        <div className="app-workspace-page flex h-dvh flex-col overflow-hidden text-foreground">
            <main className="app-workspace-page relative flex h-full min-h-0 items-center justify-center overflow-y-auto px-6 py-10 text-foreground">
                {Backdrop ? <Backdrop /> : null}
                <section className="relative w-full max-w-md text-center">
                    {Emblem ? <Emblem /> : <WorkspaceSignalIcon variant="empty" size="lg" className="mx-auto mb-5" />}
                    <div className="mb-2 text-xs font-semibold tabular-nums text-foreground/45">404</div>
                    <h1 className="not-found-title text-3xl font-semibold tracking-normal">{notFound?.title || t("account.notFound.title")}</h1>
                    <p className="mt-3 text-sm leading-6 text-stone-500 dark:text-stone-400">{notFound?.description || t("account.notFound.description")}</p>
                    <div className="mt-8 flex flex-wrap justify-center gap-3">
                        <Link
                            to="/"
                            className="inline-flex h-9 items-center gap-2 rounded-md bg-stone-950 px-4 text-[var(--fs-body)] font-medium text-white transition-colors hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-200"
                        >
                            <Home className="size-4" />
                            {t("auth.backHome")}
                        </Link>
                    </div>
                </section>
            </main>
        </div>
    );
}
