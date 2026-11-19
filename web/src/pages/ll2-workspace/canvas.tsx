import { ArrowUpRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { AppModal } from "@/components/ui/product/app-modal";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { ll2CreateLocalCanvas, ll2NewCanvasName } from "@/lib/ll2-workspace";

/**
 * 无限画布列表页。
 * 2026-11-18：说明改白话，默认名不再叫「自由画布 1」，页内统一叫「无限画布」。
 * 2026-11-19：补「删除」和「清理空白画布」——试出来的空画布可以直接清掉。
 */
export default function LL2CanvasWorkbench() {
    const navigate = useNavigate();
    const projects = useCanvasStore((state) => state.projects);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
    const [clearEmptyOpen, setClearEmptyOpen] = useState(false);
    const recent = [...projects].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    const emptyProjects = recent.filter((project) => !project.nodes.length);

    const create = () => {
        void ll2CreateLocalCanvas(ll2NewCanvasName(projects.length)).then((id) => navigate(`/canvas/${id}`));
    };

    return (
        <div className="ll2-wb">
            <main className="ll2-wb-main is-wide">
                <header className="ll2-wb-page-head">
                    <span className="ll2-wb-eyebrow">无限画布</span>
                    <h1>一张画布，把故事慢慢摆出来</h1>
                    <p>把分镜和素材放在同一张画布上改。画布存在这台电脑，不用注册。</p>
                    <Link to="/" className="ll2-wb-history">不想摆了？回一句话成片 <ArrowUpRight className="size-3.5" /></Link>
                </header>

                <button type="button" className="ll2-wb-new-canvas" onClick={create}>
                    <span className="ll2-wb-new-canvas-plus"><Plus className="size-6" /></span>
                    <strong>新建一张画布</strong>
                    <small>点一下直接打开一张空白画布</small>
                </button>

                <section className="ll2-wb-section" aria-label="本机画布">
                    <div className="ll2-wb-section-head">
                        <h2>这台电脑上的画布</h2>
                        <div className="ll2-wb-section-actions">
                            {emptyProjects.length ? (
                                <button type="button" className="ll2-wb-clear-empty" onClick={() => setClearEmptyOpen(true)}>
                                    <Trash2 className="size-3" /> 清理 {emptyProjects.length} 张空白画布
                                </button>
                            ) : null}
                            <span>{hydrated ? `${projects.length} 张` : "读取中…"}</span>
                        </div>
                    </div>
                    {recent.length === 0 ? (
                        <p className="ll2-wb-empty">还没有画布。点上面的「新建一张画布」，会直接打开一张空白画布。</p>
                    ) : (
                        <div className="ll2-wb-project-grid">
                            {recent.map((project) => {
                                const title = project.title || "无限画布";
                                return (
                                    <div key={project.id} className="ll2-wb-project-cell">
                                        <button type="button" className="ll2-wb-project" onClick={() => navigate(`/canvas/${project.id}`)}>
                                            <span className="ll2-wb-project-glyph" aria-hidden />
                                            <strong>{title}</strong>
                                            <small>{project.nodes.length} 张卡片 · {new Date(project.updatedAt).toLocaleDateString("zh-CN")}</small>
                                            <ArrowUpRight className="ll2-wb-project-arrow size-3.5" />
                                        </button>
                                        <button
                                            type="button"
                                            className="ll2-wb-project-delete"
                                            aria-label={`删除 ${title}`}
                                            title="删除这张画布"
                                            onClick={() => setDeleteTarget({ id: project.id, title })}
                                        >
                                            <Trash2 className="size-3.5" />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>
            </main>

            <AppModal
                open={Boolean(deleteTarget)}
                centered
                title="删除这张画布？"
                width={420}
                okText="删除"
                okButtonProps={{ danger: true }}
                onCancel={() => setDeleteTarget(null)}
                onOk={() => {
                    if (deleteTarget) deleteProjects([deleteTarget.id]);
                    setDeleteTarget(null);
                }}
            >
                <p className="ll2-wb-modal-text">
                    「{deleteTarget?.title}」和里面的卡片会从这台电脑删掉，删了找不回来。
                </p>
            </AppModal>

            <AppModal
                open={clearEmptyOpen}
                centered
                title="清理空白画布？"
                width={420}
                okText={`删除 ${emptyProjects.length} 张`}
                okButtonProps={{ danger: true }}
                onCancel={() => setClearEmptyOpen(false)}
                onOk={() => {
                    deleteProjects(emptyProjects.map((project) => project.id));
                    setClearEmptyOpen(false);
                }}
            >
                <p className="ll2-wb-modal-text">
                    只有一张卡片都没加过的画布会被删掉，有内容的画布不会动。
                </p>
            </AppModal>
        </div>
    );
}
