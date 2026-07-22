import { ArrowRight, Bot, Clapperboard, Film, FolderOpen, Images, Library, ListChecks, Plus, Sparkles, WandSparkles } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { App } from "antd";

import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import { createCanvasProjectWithRemoteSync } from "@/services/user-data-sync";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";

const capabilities = [
    {
        icon: <Clapperboard className="size-4" />,
        title: "故事与分镜在同一上下文里",
        description: "从故事梗概、小说或文本节点拆解镜头，角色、场景和项目画风会沿连接关系持续引用。",
    },
    {
        icon: <Images className="size-4" />,
        title: "每个生成结果都能继续编辑",
        description: "图片、视频和音频不是终点，可继续标注、局部编辑、创建变体并接入下一段工作流。",
    },
    {
        icon: <Bot className="size-4" />,
        title: "Agent 直接参与画布编排",
        description: "把完整任务交给 Agent，也可以随时接管节点、调整提示词并撤销本次自动操作。",
    },
    {
        icon: <WandSparkles className="size-4" />,
        title: "模型与素材按项目统一管理",
        description: "参考素材、生成配置、任务状态和最终结果都保留在项目中，减少跨工具搬运。",
    },
];

const workflow = [
    { title: "输入故事", description: "故事梗概、小说或已有文本" },
    { title: "生成分镜", description: "拆分镜头与角色视觉资产" },
    { title: "打磨镜头", description: "生成图片、视频并逐步调整" },
    { title: "合并成片", description: "汇总镜头并输出最终视频" },
];

export default function IndexPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const user = useUserStore((state) => state.user);
    const recentProjects = useMemo(() => [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6), [projects]);
    const createAndEnter = () => {
        if (!hydrated) return;
        if (!user) {
            navigate(`/login?next=${encodeURIComponent("/canvas?mode=new")}`);
            return;
        }
        void createCanvasProjectWithRemoteSync(`影视项目 ${projects.length + 1}`).then(({ id, syncError }) => {
            if (syncError) message.warning(syncError instanceof Error ? `画布已在本地创建，云端同步失败：${syncError.message}` : "画布已在本地创建，云端同步失败");
            navigate(`/canvas/${id}`);
        });
    };

    return (
        <main className="app-user-content app-workspace-canvas h-full overflow-y-auto text-foreground">
            <div className="mx-auto w-full max-w-[1440px] px-5 pb-12 pt-7 sm:px-8 lg:px-10">
                <section className="grid gap-8 border-b border-stone-200/80 pb-9 pt-2 dark:border-stone-800 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)] lg:gap-14 lg:pb-11">
                    <div className="flex min-w-0 flex-col justify-center">
                        <div className="mb-4 inline-flex items-center gap-2 text-xs font-semibold text-stone-500 dark:text-stone-400">
                            <Sparkles className="size-3.5" />无限画布
                        </div>
                        <h1 className="max-w-[720px] text-3xl font-semibold leading-[1.08] tracking-normal sm:text-4xl lg:text-5xl">
                            从故事到成片，都在一张画布里完成
                        </h1>
                        <p className="mt-5 max-w-[660px] text-sm leading-7 text-stone-600 dark:text-stone-400 sm:text-base">
                            连接文本、角色、分镜、图片和视频，让创作上下文沿节点持续流动。你可以自己编排，也可以让 Agent 完成整段工作流。
                        </p>
                        <div className="mt-7 flex flex-wrap items-center gap-3">
                            <button type="button" disabled={!hydrated} className="app-home-primary-action inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40" onClick={createAndEnter}>
                                <Plus className="size-4" />开始创作
                            </button>
                            <button type="button" disabled={!hydrated} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-[var(--workspace-surface)] px-4 text-sm font-semibold text-foreground backdrop-blur-xl transition-colors hover:border-[var(--workspace-border-strong)] hover:bg-[var(--workspace-surface-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40" onClick={() => navigate("/canvas?mode=new")}>
                                <Bot className="size-4" />从 Agent 开始
                            </button>
                        </div>
                        <nav aria-label="工作台快捷入口" className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-stone-500 dark:text-stone-400">
                            <TextLink label="全部项目" icon={<FolderOpen />} onClick={() => navigate("/canvas")} />
                            <TextLink label="素材库" icon={<Library />} onClick={() => navigate("/assets")} />
                            <TextLink label="生成任务" icon={<ListChecks />} onClick={() => navigate("/tasks")} />
                        </nav>
                    </div>

                    <div className="border-t border-stone-200/80 pt-6 dark:border-stone-800 lg:border-l lg:border-t-0 lg:pl-9 lg:pt-1">
                        <div className="flex items-center gap-2 text-sm font-semibold"><Film className="size-4" />一条完整创作链</div>
                        <div className="mt-5 grid gap-0">
                            {workflow.map((item, index) => (
                                <div key={item.title} className="group relative grid grid-cols-[28px_minmax(0,1fr)] gap-3 pb-5 last:pb-0">
                                    {index < workflow.length - 1 ? <span aria-hidden className="absolute bottom-0 left-[13px] top-6 w-px bg-stone-200 dark:bg-stone-800" /> : null}
                                    <span className="relative grid size-7 place-items-center rounded-full border border-stone-300 bg-white text-[10px] font-semibold text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">{index + 1}</span>
                                    <span className="min-w-0 pt-0.5">
                                        <span className="block text-sm font-semibold">{item.title}</span>
                                        <span className="mt-1 block text-xs leading-5 text-stone-500 dark:text-stone-400">{item.description}</span>
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="py-9 lg:py-11">
                    <div className="max-w-[660px]">
                        <h2 className="text-xl font-semibold tracking-normal sm:text-2xl">让生成能力成为连续工作流</h2>
                        <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">节点不只是内容容器。连接关系会保留上下文，让每一步生成都能继续编辑、复用和追踪。</p>
                    </div>
                    <div className="mt-7 grid border-t border-stone-200/80 dark:border-stone-800 md:grid-cols-2">
                        {capabilities.map((item, index) => (
                            <article key={item.title} className={`grid grid-cols-[32px_minmax(0,1fr)] gap-3 border-b border-stone-200/80 py-5 dark:border-stone-800 ${index % 2 === 0 ? "md:pr-8" : "md:border-l md:pl-8"}`}>
                                <span className="grid size-8 place-items-center rounded-lg border border-stone-200 bg-white text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">{item.icon}</span>
                                <span>
                                    <h3 className="text-sm font-semibold">{item.title}</h3>
                                    <p className="mt-1.5 max-w-[520px] text-xs leading-6 text-stone-500 dark:text-stone-400">{item.description}</p>
                                </span>
                            </article>
                        ))}
                    </div>
                </section>

                <section className="border-t border-stone-200/80 pt-7 dark:border-stone-800">
                    <div className="mb-5 flex items-end justify-between gap-4">
                        <div>
                            <h2 className="text-lg font-semibold">最近项目</h2>
                            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{hydrated ? `${projects.length} 个项目` : "正在载入项目"}</p>
                        </div>
                        <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-stone-500 transition hover:text-stone-950 dark:text-stone-400 dark:hover:text-white" onClick={() => navigate("/canvas")}>查看全部<ArrowRight className="size-3.5" /></button>
                    </div>
                    {recentProjects.length ? (
                        <div className="grid justify-start gap-4 [grid-template-columns:repeat(auto-fill,minmax(260px,300px))]">
                            {recentProjects.map((project) => <CanvasProjectCard key={project.id} project={project} variant="recent" />)}
                        </div>
                    ) : (
                        <button type="button" disabled={!hydrated} className="flex h-36 w-full max-w-[300px] flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 text-center transition hover:border-stone-500 hover:bg-white/45 disabled:opacity-50 dark:border-stone-700 dark:hover:border-stone-500 dark:hover:bg-stone-900/45" onClick={createAndEnter}>
                            <span className="grid size-9 place-items-center rounded-lg border border-stone-200 bg-white text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"><Plus className="size-4" /></span>
                            <span className="mt-3 text-sm font-semibold">创建第一个项目</span>
                            <span className="mt-1 text-xs text-stone-500 dark:text-stone-400">从空白画布或 Agent 开始</span>
                        </button>
                    )}
                </section>
            </div>
        </main>
    );
}

function TextLink({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
    return (
        <button type="button" className="inline-flex items-center gap-1.5 transition hover:text-stone-950 dark:hover:text-white [&_svg]:size-3.5" onClick={onClick}>
            {icon}{label}
        </button>
    );
}
