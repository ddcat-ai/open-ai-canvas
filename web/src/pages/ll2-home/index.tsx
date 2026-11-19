import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router";

import { LL2OneShot } from "@/components/ll2/ll2-oneshot";

/**
 * 一句话成片首页。
 *
 * 2026-11-17 21:59 用户口径：照抄影策体验站的「一句话想法」，保持这个简洁形态往上加功能。
 * 2026-11-17 23:59 用户口径：「这个工作台不要，看起来很不简洁」「无限画布就无限画布，
 * 一句话成片就一句话成片，不要搞个工作台，搞两遍要干嘛」。
 * 2026-11-18 用户口径：主标题要和侧栏一样直白，起步卡片由 LL2OneShot 自己渲染，
 * 这样「填入示例」能接在用户已写的句子后面，而不是覆盖掉。
 */
export default function LL2HomePage() {
    return (
        <div className="ll2-wb">
            <main className="ll2-wb-main">
                <header className="ll2-wb-head">
                    <span className="ll2-wb-eyebrow">DMC · 一句话成片</span>
                    <h1>写一句话，出一支片子</h1>
                    <p>不用懂剪辑，写清想拍的画面就行。</p>
                    <Link to="/films" className="ll2-wb-history">我的片子 <ArrowUpRight className="size-3.5" /></Link>
                </header>

                <LL2OneShot />

                <footer className="ll2-wb-foot">
                    <span>DMC · 写一句话，出一支片子</span>
                    <span>价格按官网单价算，账单以控制台为准 · 片子和画布都存这台电脑</span>
                </footer>
            </main>
        </div>
    );
}
