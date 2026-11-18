import { Tooltip } from "antd";

import "./tryon-entry.css";
import { TryOnFunctionDemo } from "./tryon-demos";
import { TryOnGlyph } from "./tryon-glyphs";
import { TRYON_FUNCTIONS, type TryOnFunction } from "./tryon-kinds";

/** 批量换装的功能按钮：与商品视频「替换类型」同一套按钮（图标块 + 文字、点击弹跳光晕、悬浮说明卡），悬浮卡多一段效果演示。 */
function TryOnKindButton({ id, label, title, description, pressed, onPick }: { id: TryOnFunction; label: string; title: string; description: string; pressed: boolean; onPick: () => void }) {
    return (
        <Tooltip
            placement="top"
            mouseEnterDelay={0.35}
            arrow={false}
            classNames={{ root: "ecv-kind-tip ect-kind-tip" }}
            title={
                <span className="ect-kind-tip-card">
                    <span className="ecv-kind-tip-body">
                        <span className={`ecv-glyph-tile is-kind is-${id}`}>
                            <TryOnGlyph id={id} />
                        </span>
                        <span>
                            <strong>{title}</strong>
                            <small>{description}</small>
                        </span>
                    </span>
                    <TryOnFunctionDemo id={id} />
                </span>
            }
        >
            <button
                type="button"
                className="ecv-kind"
                aria-pressed={pressed}
                onClick={() => {
                    onPick();
                }}
            >
                <span className={`ecv-kind-icon is-${id}`}>
                    <TryOnGlyph id={id} />
                </span>
                <span className="ecv-kind-label">{label}</span>
            </button>
        </Tooltip>
    );
}

/** 「批量换装」区块：换装面板里「当前图片功能」卡片下方的八个功能，选中的功能决定下面的指令卡与上传位。 */
export function TryOnEntryBlock({ active, allowed, onPick }: { active: TryOnFunction; allowed?: TryOnFunction[]; onPick: (id: TryOnFunction) => void }) {
    // 后台关闭的功能不显示按钮（管理员的 allowed 包含全部功能）。
    const functions = allowed ? TRYON_FUNCTIONS.filter((item) => allowed.includes(item.id)) : TRYON_FUNCTIONS;
    const current = functions.find((item) => item.id === active);
    return (
        <section className="ecs-block ect-entry" aria-label="批量换装">
            <header>
                <h3>批量换装</h3>
                <span>{current ? `已选择：${current.label}` : "真人上身 · 多模特同款 · 换脸换头 · 姿势 · 印花"}</span>
            </header>
            <div className="ecv-shell ect-kinds-scope">
                <div className="ecv-kinds" role="group" aria-label="批量换装功能">
                    {functions.map((item) => (
                        <TryOnKindButton key={item.id} id={item.id} label={item.label} title={item.title} description={item.description} pressed={active === item.id} onPick={() => onPick(item.id)} />
                    ))}
                </div>
            </div>
        </section>
    );
}
