import { useState } from "react";
import { ChevronRight, FileUp } from "lucide-react";
import { useTranslation } from "react-i18next";

import { PREVIS_PROP_LIBRARY, formatPrevisPropSize, type PrevisPropItem } from "@/lib/canvas/previs/previs-prop-library";

/**
 * 道具缩略图：按道具真实比例画一个等轴测轮廓（box/cylinder/sphere），
 * 不依赖渲染器或图片资源，尺寸变化时缩略图同步变化。
 */
export function PrevisPropThumb({ prop }: { prop: PrevisPropItem }) {
    const [w, h, d] = prop.size;
    // 等轴测投影：x 轴向右下、z 轴向左下，y 轴向上；整体按最大投影尺寸归一化到 40×32 视框。
    const cos = Math.cos(Math.PI / 6);
    const sin = Math.sin(Math.PI / 6);
    const spanX = (w + d) * cos;
    const spanY = h + (w + d) * sin;
    const scale = Math.min(36 / spanX, 28 / spanY);
    const sw = w * scale;
    const sh = h * scale;
    const sd = d * scale;
    const ox = 20 - ((sw - sd) * cos) / 2;
    const oy = 16 + spanY * scale * 0.5 - (sw + sd) * sin * 0.5;
    const p = (x: number, y: number, z: number) => `${(ox + (x - z) * cos).toFixed(2)},${(oy + (x + z) * sin - y).toFixed(2)}`;
    const top = [p(0, sh, 0), p(sw, sh, 0), p(sw, sh, sd), p(0, sh, sd)].join(" ");
    const right = [p(sw, 0, 0), p(sw, sh, 0), p(sw, sh, sd), p(sw, 0, sd)].join(" ");
    const left = [p(0, 0, sd), p(sw, 0, sd), p(sw, sh, sd), p(0, sh, sd)].join(" ");
    return (
        <svg className="pv-prop-thumb" viewBox="0 0 40 32" aria-hidden="true">
            {prop.primitive === "sphere" ? (
                <>
                    <ellipse cx="20" cy="16" rx={Math.min(16, (16 * w) / Math.max(w, h))} ry={Math.min(13, (13 * h) / Math.max(w, h))} className="pv-prop-thumb__side" />
                    <ellipse cx="16" cy="12" rx="4" ry="3" className="pv-prop-thumb__top" />
                </>
            ) : prop.primitive === "cylinder" ? (
                <CylinderThumb w={w} h={h} />
            ) : (
                <>
                    <polygon points={left} className="pv-prop-thumb__side" />
                    <polygon points={right} className="pv-prop-thumb__shade" />
                    <polygon points={top} className="pv-prop-thumb__top" />
                </>
            )}
        </svg>
    );
}

function CylinderThumb({ w, h }: { w: number; h: number }) {
    const scale = Math.min(28 / w, 24 / h);
    const rx = (w * scale) / 2;
    const ry = Math.max(1.5, rx * 0.35);
    const height = h * scale;
    const top = 16 - height / 2;
    const bottom = 16 + height / 2;
    return (
        <>
            <path d={`M${20 - rx},${top} L${20 - rx},${bottom} A${rx},${ry} 0 0 0 ${20 + rx},${bottom} L${20 + rx},${top} Z`} className="pv-prop-thumb__side" />
            <ellipse cx="20" cy={top} rx={rx} ry={ry} className="pv-prop-thumb__top" />
        </>
    );
}

/** 左侧道具库：分类可折叠，卡片 = 比例缩略图 + 名称 + 真实尺寸。 */
export function PrevisPropLibraryPanel({ onAdd, onUpload }: { onAdd: (prop: PrevisPropItem) => void; onUpload: () => void }) {
    const { t } = useTranslation();
    const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
    const [open, setOpen] = useState(true);
    const toggle = (id: string) =>
        setCollapsed((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    return (
        <section className="pv-entity-section pv-entity-section--prop-lib">
            <button type="button" className="pv-prop-lib__header" aria-expanded={open} onClick={() => setOpen(!open)}>
                <ChevronRight className={`size-3 pv-prop-lib__chevron ${open ? "is-open" : ""}`} />
                <span>{t("canvasC.previsProps.title")}</span>
            </button>
            {open ? (
                <>
                    <div className="pv-prop-cats">
                        {PREVIS_PROP_LIBRARY.map((category) => {
                            const expanded = !collapsed.has(category.id);
                            return (
                                <div key={category.id} className="pv-prop-cat">
                                    <button type="button" className="pv-prop-cat__label" aria-expanded={expanded} onClick={() => toggle(category.id)}>
                                        <ChevronRight className={`size-3 pv-prop-lib__chevron ${expanded ? "is-open" : ""}`} />
                                        <span>{category.label}</span>
                                        <span className="pv-prop-cat__count">{category.items.length}</span>
                                    </button>
                                    {expanded ? (
                                        <div className="pv-prop-grid">
                                            {category.items.map((prop) => (
                                                <button key={prop.id} type="button" className="pv-prop-card" title={t("canvasC.previsProps.add", { name: prop.name, size: formatPrevisPropSize(prop.size) })} onClick={() => onAdd(prop)}>
                                                    <PrevisPropThumb prop={prop} />
                                                    <span className="pv-prop-card__name">{prop.name}</span>
                                                    <span className="pv-prop-card__size">{formatPrevisPropSize(prop.size)}</span>
                                                </button>
                                            ))}
                                        </div>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                    <div className="pv-prop-upload-row">
                        <button type="button" className="pv-prop-upload-full" onClick={onUpload}>
                            <FileUp className="size-3.5" />
                            {t("canvasC.previsProps.upload")}
                        </button>
                    </div>
                </>
            ) : null}
        </section>
    );
}
