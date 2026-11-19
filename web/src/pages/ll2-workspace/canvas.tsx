import { ArrowUpRight, Plus } from "lucide-react";
import { Link, useNavigate } from "react-router";

import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { ll2CreateLocalCanvas, ll2NewCanvasName } from "@/lib/ll2-workspace";

/**
 * 无限画布列表页。
 * 2026-11-18：说明改白话，默认名不再叫「自由画布 1」，页内统一叫「无限画布」。
 */
export default function LL2CanvasWorkbench() {
    const navigate = useNavigate();
    const projects = useCanvasStore((state) => state.projects);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const recent = [...projects].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

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
                        <span>{hydrated ? `${projects.length} 张` : "读取中…"}</span>
                    </div>
                    {recent.length === 0 ? (
                        <p className="ll2-wb-empty">还没有画布。点上面的「新建一张画布」，会直接打开一张空白画布。</p>
                    ) : (
                        <div className="ll2-wb-project-grid">
                            {recent.map((project) => (
                                <button key={project.id} type="button" className="ll2-wb-project" onClick={() => navigate(`/canvas/${project.id}`)}>
                                    <span className="ll2-wb-project-glyph" aria-hidden />
                                    <strong>{project.title || "无限画布"}</strong>
                                    <small>{project.nodes.length} 张卡片 · {new Date(project.updatedAt).toLocaleDateString("zh-CN")}</small>
                                    <ArrowUpRight className="ll2-wb-project-arrow size-3.5" />
                                </button>
                            ))}
                        </div>
                    )}
                </section>
            </main>
        </div>
    );
}
