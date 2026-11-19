import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";
import "./studio-opening.css";

export function StudioOpening() {
    return (
        <section className="drama-studio-opening" role="status" aria-busy="true" aria-label="正在打开制作台">
            <header>
                <Link to="/projects" viewTransition aria-label="返回作品列表">
                    <ArrowLeft aria-hidden />
                </Link>
                <span>正在打开制作台…</span>
            </header>
            <div className="drama-opening-body" aria-hidden="true">
                <aside>
                    <i />
                    <i />
                    <i />
                </aside>
                <div>
                    <i />
                    <i />
                    <i />
                </div>
            </div>
        </section>
    );
}
