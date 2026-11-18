import { CheckCircle2, XCircle } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import type { TryOnFunction, TryOnTipKind } from "./tryon-kinds";

/*
 * 批量换装的悬浮演示：
 * - 上传位：真人模特库裁出的实拍示范（推荐 / 不推荐），服装与印花用内联插画；
 * - 功能按钮：用插画演示「图一 + 图二 → 效果」，跟随明暗主题。
 */

const PHOTO = (name: string) => `/ecommerce-models/${name.replace(/-(front|face|pose)$/, "")}.png`;

// ---------- 插画人物：60×80 竖幅 ----------
type FigureProps = {
    skin?: string;
    hair?: string;
    hairStyle?: "long" | "short" | "bun" | "curly" | "bob";
    top?: string;
    bottom?: string;
    dress?: string;
    pattern?: boolean;
    pose?: "stand" | "hip" | "walk" | "wave";
    x?: number;
    y?: number;
    s?: number;
    face?: "round" | "long";
};

function Figure({ skin = "#f2c6a8", hair = "#2b211d", hairStyle = "long", top = "#f5f5f4", bottom = "#7aa2d6", dress, pattern = false, pose = "stand", x = 30, y = 8, s = 1, face = "round" }: FigureProps) {
    const arms =
        pose === "hip"
            ? ["M19 27 L14 36 L20 41", "M41 27 L46 36 L40 41"]
            : pose === "wave"
              ? ["M19 27 L13 37 L14 46", "M41 27 L47 17 L49 8"]
              : pose === "walk"
                ? ["M19 27 L15 37 L17 46", "M41 27 L46 36 L47 45"]
                : ["M19 27 L16 37 L16 46", "M41 27 L44 37 L44 46"];
    const legs = pose === "walk" ? ["M26 52 L21 74", "M34 52 L40 74"] : ["M26 52 L25 74", "M34 52 L35 74"];
    return (
        <g transform={`translate(${x - 30 * s} ${y - 8 * s}) scale(${s})`}>
            {hairStyle === "long" ? <path d="M21 12 Q20 32 24 34 L36 34 Q40 32 39 12 Z" fill={hair} /> : null}
            {arms.map((d) => (
                <path key={d} d={d} stroke={skin} strokeWidth={4.2} strokeLinecap="round" fill="none" />
            ))}
            {dress ? (
                <path d="M21 24 Q30 21 39 24 L41 34 L37 36 L44 70 Q30 74 16 70 L23 36 L19 34 Z" fill={dress} stroke="rgba(0,0,0,.12)" />
            ) : (
                <>
                    {legs.map((d) => (
                        <path key={d} d={d} stroke={bottom} strokeWidth={6} strokeLinecap="round" fill="none" />
                    ))}
                    <path d="M21 24 Q30 21 39 24 L41 34 L38 35 L38 52 L22 52 L22 35 L19 34 Z" fill={top} stroke="rgba(0,0,0,.12)" />
                </>
            )}
            {pattern ? (
                <g fill="#f472b6" opacity={0.85}>
                    <circle cx={27} cy={32} r={2} />
                    <circle cx={33} cy={38} r={2} />
                    <circle cx={29} cy={45} r={2} />
                    <circle cx={36} cy={30} r={1.4} />
                </g>
            ) : null}
            <rect x={27.5} y={18} width={5} height={5} fill={skin} />
            <ellipse cx={30} cy={13} rx={6.6} ry={face === "long" ? 8 : 7.2} fill={skin} />
            {hairStyle === "short" ? <path d="M23.4 12 Q23 4.6 30 4.6 Q37 4.6 36.6 12 Q35 8 30 8 Q25 8 23.4 12 Z" fill={hair} /> : null}
            {hairStyle === "long" || hairStyle === "bob" ? <path d="M23 15 Q22 4.4 30 4.4 Q38 4.4 37 15 Q36 9 30 8.6 Q24 9 23 15 Z" fill={hair} /> : null}
            {hairStyle === "bob" ? <path d="M22.6 12 Q22 20 25 21 L24.6 13 Z M37.4 12 Q38 20 35 21 L35.4 13 Z" fill={hair} /> : null}
            {hairStyle === "bun" ? (
                <>
                    <circle cx={30} cy={3.6} r={3.4} fill={hair} />
                    <path d="M23.4 12.6 Q23 5 30 5 Q37 5 36.6 12.6 Q35 8.4 30 8.4 Q25 8.4 23.4 12.6 Z" fill={hair} />
                </>
            ) : null}
            {hairStyle === "curly" ? (
                <g fill={hair}>
                    {[23, 26.5, 30, 33.5, 37].map((cx, index) => (
                        <circle key={cx} cx={cx} cy={index % 2 ? 5.4 : 6.6} r={3.2} />
                    ))}
                </g>
            ) : null}
            <circle cx={27.6} cy={13.6} r={0.8} fill="#3b2a25" />
            <circle cx={32.4} cy={13.6} r={0.8} fill="#3b2a25" />
            <path d="M28.4 17 Q30 18 31.6 17" stroke="#b5655a" strokeWidth={0.8} fill="none" strokeLinecap="round" />
        </g>
    );
}

function Tile({ children, bg = "var(--ecv-illus-bg, #eceff3)", label }: { children: ReactNode; bg?: string; label?: string }) {
    return (
        <span className="ect-demo-tile">
            {label ? <small>{label}</small> : null}
            <svg viewBox="0 0 60 80" aria-hidden="true">
                <rect width={60} height={80} rx={5} fill={bg} />
                {children}
            </svg>
        </span>
    );
}

function Tee({ color = "#ef4444", pattern = false, x = 30, y = 40, s = 1 }: { color?: string; pattern?: boolean; x?: number; y?: number; s?: number }) {
    return (
        <g transform={`translate(${x - 30 * s} ${y - 40 * s}) scale(${s})`}>
            <path d="M18 24 L25 20 Q30 25 35 20 L42 24 L47 33 L41 36 L40 60 L20 60 L19 36 L13 33 Z" fill={color} stroke="rgba(0,0,0,.14)" />
            {pattern ? (
                <g>
                    <circle cx={30} cy={38} r={6} fill="#fde047" />
                    {[0, 72, 144, 216, 288].map((angle) => (
                        <ellipse key={angle} cx={30} cy={31} rx={2.6} ry={4} fill="#f472b6" transform={`rotate(${angle} 30 38)`} />
                    ))}
                    <circle cx={30} cy={38} r={2.4} fill="#f97316" />
                </g>
            ) : null}
        </g>
    );
}

function Dress({ color = "#ef4444", x = 30, y = 40 }: { color?: string; x?: number; y?: number }) {
    return (
        <g transform={`translate(${x - 30} ${y - 40})`}>
            <path d="M24 16 L27 22 Q30 24 33 22 L36 16 L39 18 L37 30 L46 62 Q30 67 14 62 L23 30 L21 18 Z" fill={color} stroke="rgba(0,0,0,.14)" />
            <path d="M23 30 Q30 33 37 30" stroke="rgba(255,255,255,.45)" strokeWidth={1.4} fill="none" />
        </g>
    );
}

function Spark({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
    return <path transform={`translate(${x} ${y}) scale(${s})`} d="M0 -5 L1.3 -1.3 L5 0 L1.3 1.3 L0 5 L-1.3 1.3 L-5 0 L-1.3 -1.3 Z" fill="#fde68a" stroke="#f59e0b" strokeWidth={0.6} />;
}

function Checker() {
    return <g opacity={0.5}>{Array.from({ length: 8 }, (_, row) => Array.from({ length: 6 }, (_, col) => ((row + col) % 2 ? <rect key={`${row}-${col}`} x={col * 10} y={row * 10} width={10} height={10} fill="#cbd5e1" /> : null)))}</g>;
}

function Skeleton() {
    return (
        <g stroke="#38bdf8" strokeWidth={2.4} strokeLinecap="round" fill="none">
            <circle cx={30} cy={13} r={5} fill="#38bdf8" stroke="none" />
            <path d="M30 19 L29 44" />
            <path d="M30 24 L42 16 L46 8" />
            <path d="M30 25 L20 33 L16 40" />
            <path d="M29 44 L20 58 L22 73" />
            <path d="M29 44 L38 57 L44 70" />
        </g>
    );
}

const Op = ({ children }: { children: ReactNode }) => <i className="ect-demo-op">{children}</i>;

/** 功能按钮悬浮卡里的「图一 + 图二 → 效果」演示。 */
export function TryOnFunctionDemo({ id }: { id: TryOnFunction }) {
    switch (id) {
        case "model-views":
            return (
                <div className="ect-demo-flow">
                    {["正面", "45°侧面", "背面"].map((label) => (
                        <Tile key={label} label={label}>
                            <Figure top="#64748b" bottom="#334155" />
                        </Tile>
                    ))}
                </div>
            );
        case "outfit":
            return (
                <div className="ect-demo-flow">
                    <Tile label="模特">
                        <Figure top="#f5f5f4" bottom="#64748b" />
                    </Tile>
                    <Op>+</Op>
                    <Tile label="服装">
                        <Dress color="#e11d48" />
                    </Tile>
                    <Op>→</Op>
                    <Tile label="效果">
                        <Figure dress="#e11d48" />
                        <Spark x={50} y={10} />
                    </Tile>
                </div>
            );
        case "multi-model":
            return (
                <div className="ect-demo-flow">
                    <Tile label="服装">
                        <Tee color="#2563eb" />
                    </Tile>
                    <Op>→</Op>
                    <Tile label="中国">
                        <Figure top="#2563eb" bottom="#e5e7eb" />
                    </Tile>
                    <Tile label="美国">
                        <Figure top="#2563eb" bottom="#e5e7eb" skin="#7a4a2f" hair="#151010" hairStyle="curly" />
                    </Tile>
                    <Tile label="欧洲">
                        <Figure top="#2563eb" bottom="#e5e7eb" skin="#f4d2bd" hair="#c79a4a" hairStyle="bob" />
                    </Tile>
                </div>
            );
        case "multi-outfit":
            return (
                <div className="ect-demo-flow">
                    <Tile label="模特">
                        <Figure top="#f5f5f4" bottom="#64748b" hairStyle="bun" />
                    </Tile>
                    <Op>+</Op>
                    <Tile label="多件">
                        <Tee color="#16a34a" x={22} y={30} s={0.62} />
                        <Tee color="#f59e0b" x={40} y={42} s={0.62} />
                        <Tee color="#7c3aed" x={24} y={58} s={0.62} />
                    </Tile>
                    <Op>→</Op>
                    <Tile label="逐件">
                        <Figure top="#16a34a" bottom="#334155" hairStyle="bun" x={16} y={12} s={0.55} />
                        <Figure top="#f59e0b" bottom="#334155" hairStyle="bun" x={44} y={12} s={0.55} />
                        <Figure top="#7c3aed" bottom="#334155" hairStyle="bun" x={30} y={46} s={0.55} />
                    </Tile>
                </div>
            );
        case "pose":
            return (
                <div className="ect-demo-flow">
                    <Tile label="主体">
                        <Figure top="#fbbf24" bottom="#1f2937" />
                    </Tile>
                    <Op>+</Op>
                    <Tile label="姿势">
                        <Skeleton />
                    </Tile>
                    <Op>→</Op>
                    <Tile label="效果">
                        <Figure top="#fbbf24" bottom="#1f2937" pose="wave" />
                        <Spark x={10} y={12} />
                    </Tile>
                </div>
            );
        case "face-swap":
            return (
                <div className="ect-demo-flow">
                    <Tile label="脸部">
                        <Figure skin="#d9a27c" hair="#1c1410" hairStyle="short" face="long" top="#e2e8f0" bottom="#94a3b8" y={14} s={1.25} x={30} />
                    </Tile>
                    <Op>⇄</Op>
                    <Tile label="模特">
                        <Figure top="#0f766e" bottom="#e7e5e4" hairStyle="long" />
                    </Tile>
                    <Op>→</Op>
                    <Tile label="效果">
                        <Figure top="#0f766e" bottom="#e7e5e4" hairStyle="long" skin="#d9a27c" face="long" />
                        <Spark x={50} y={10} />
                    </Tile>
                </div>
            );
        case "smart-face":
            return (
                <div className="ect-demo-flow">
                    <Tile label="原图">
                        <Figure top="#be123c" bottom="#f5f5f4" hairStyle="long" />
                    </Tile>
                    <Op>→</Op>
                    <Tile label="新脸 1">
                        <Figure top="#be123c" bottom="#f5f5f4" hairStyle="long" skin="#b97d52" face="long" />
                        <Spark x={50} y={10} />
                    </Tile>
                    <Tile label="新脸 2">
                        <Figure top="#be123c" bottom="#f5f5f4" hairStyle="long" skin="#f6dccb" />
                        <Spark x={50} y={10} />
                    </Tile>
                </div>
            );
        case "smart-head":
            return (
                <div className="ect-demo-flow">
                    <Tile label="原图">
                        <Figure top="#4338ca" bottom="#e5e7eb" hairStyle="long" />
                    </Tile>
                    <Op>→</Op>
                    <Tile label="短发">
                        <Figure top="#4338ca" bottom="#e5e7eb" hairStyle="bob" hair="#c79a4a" skin="#f4d2bd" />
                        <Spark x={50} y={10} />
                    </Tile>
                    <Tile label="卷发">
                        <Figure top="#4338ca" bottom="#e5e7eb" hairStyle="curly" hair="#151010" skin="#7a4a2f" />
                        <Spark x={50} y={10} />
                    </Tile>
                </div>
            );
        default:
            return (
                <div className="ect-demo-flow">
                    <Tile label="服装">
                        <Tee color="#f8fafc" pattern />
                    </Tile>
                    <Op>→</Op>
                    <Tile label="PNG" bg="#ffffff">
                        <Checker />
                        <g transform="translate(0 2)">
                            <circle cx={30} cy={38} r={9} fill="#fde047" />
                            {[0, 72, 144, 216, 288].map((angle) => (
                                <ellipse key={angle} cx={30} cy={27} rx={4} ry={6} fill="#f472b6" transform={`rotate(${angle} 30 38)`} />
                            ))}
                            <circle cx={30} cy={38} r={3.6} fill="#f97316" />
                        </g>
                    </Tile>
                </div>
            );
    }
}

// ---------- 上传位的「上传示范」 ----------
type TipItem = { title: string; note?: string; photo?: string; style?: CSSProperties; group?: string[]; art?: ReactNode };

const blur: CSSProperties = { filter: "blur(3px) saturate(0.7)" };

function GarmentFlat() {
    return (
        <Tile bg="#ffffff">
            <Tee color="#0ea5e9" />
        </Tile>
    );
}

function GarmentHanger() {
    return (
        <Tile bg="#f8fafc">
            <path d="M30 10 Q30 6 33 7 Q35 8 33 11 L30 14 L16 22 H44 Z" stroke="#64748b" strokeWidth={1.4} fill="none" />
            <Dress color="#a855f7" y={46} />
        </Tile>
    );
}

function GarmentPile() {
    return (
        <Tile bg="#f5f5f4">
            <Tee color="#ef4444" x={22} y={34} s={0.7} />
            <Tee color="#22c55e" x={36} y={42} s={0.7} />
            <Tee color="#3b82f6" x={28} y={54} s={0.7} />
        </Tile>
    );
}

function GarmentWrinkled({ pattern = false }: { pattern?: boolean }) {
    return (
        <Tile bg="#e7e5e4">
            <g transform="rotate(-18 30 40)">
                <Tee color={pattern ? "#f8fafc" : "#f59e0b"} pattern={pattern} />
            </g>
            <path d="M14 30 Q24 36 20 48 M36 26 Q30 38 42 50 M22 58 Q32 52 40 62" stroke="rgba(0,0,0,.22)" strokeWidth={1.6} fill="none" />
        </Tile>
    );
}

function PrintFlat() {
    return (
        <Tile bg="#ffffff">
            <rect x={8} y={12} width={44} height={56} rx={3} fill="#f8fafc" stroke="#e2e8f0" />
            {[0, 1, 2].flatMap((row) =>
                [0, 1].map((col) => (
                    <g key={`${row}-${col}`} transform={`translate(${19 + col * 22} ${24 + row * 17}) scale(0.5)`}>
                        <circle r={6} fill="#fde047" />
                        <circle r={2.4} fill="#f97316" />
                    </g>
                )),
            )}
        </Tile>
    );
}

function FaceCover() {
    return (
        <Tile>
            <Figure s={1.5} x={30} y={14} top="#94a3b8" />
            <rect x={19} y={19} width={10} height={5} rx={2} fill="#111827" />
            <rect x={31} y={19} width={10} height={5} rx={2} fill="#111827" />
            <rect x={22} y={27} width={16} height={9} rx={4} fill="#93c5fd" />
        </Tile>
    );
}

const TIPS: Record<TryOnTipKind, { title: string; good: TipItem[]; bad: TipItem[] }> = {
    model: {
        title: "模特图怎么选",
        good: [
            { title: "正面全身", note: "头到脚完整，站姿自然", photo: "cn-woman-front" },
            { title: "光线均匀", note: "脸部与身材清楚", photo: "us-man-front" },
            { title: "单人清晰", note: "背景简洁，服装轮廓清楚", photo: "eu-woman-pose" },
        ],
        bad: [
            { title: "模糊低清", photo: "cn-man-front", style: blur },
            { title: "多人合照", group: ["in-woman-front", "eu-senior-man-front", "jp-senior-woman-front"] },
            { title: "裁掉头部", photo: "us-man-torso" },
        ],
    },
    subject: {
        title: "主体图怎么选",
        good: [
            { title: "人物完整", note: "全身入镜，方便调整姿势", photo: "eu-woman-front" },
            { title: "服装清楚", note: "保持的服装细节要看得清", photo: "cn-woman-front" },
            { title: "背景简单", note: "姿势变化后背景更好补全", photo: "us-man-front" },
        ],
        bad: [
            { title: "模糊低清", photo: "in-woman-front", style: blur },
            { title: "多人合照", group: ["cn-man-front", "cn-woman-front", "us-boy-front"] },
            { title: "只有半身", photo: "eu-woman-torso" },
        ],
    },
    garment: {
        title: "服装图怎么拍",
        good: [
            { title: "平铺图", note: "正面摊平，颜色与印花清楚", art: <GarmentFlat /> },
            { title: "上身实拍", note: "穿在人身上，可裁掉头部", photo: "us-man-torso" },
            { title: "挂拍图", note: "整件完整，背景干净", art: <GarmentHanger /> },
        ],
        bad: [
            { title: "多件堆叠", art: <GarmentPile /> },
            { title: "褶皱遮挡", art: <GarmentWrinkled /> },
            { title: "模糊低清", photo: "eu-woman-torso", style: blur },
        ],
    },
    pose: {
        title: "姿势图怎么选",
        good: [
            { title: "全身完整", note: "四肢都在画面里", photo: "us-man-pose" },
            { title: "动作清楚", note: "身体朝向与重心明确", photo: "eu-woman-side" },
            { title: "单人", note: "只参考一个人的动作", photo: "cn-woman-pose" },
        ],
        bad: [
            { title: "只有半身", photo: "us-man-torso" },
            { title: "多人合照", group: ["eu-woman-front", "us-man-front", "cn-woman-front"] },
            { title: "模糊低清", photo: "eu-woman-pose", style: blur },
        ],
    },
    face: {
        title: "脸部图怎么选",
        good: [
            { title: "正脸清晰", note: "五官清楚，脸占画面大半", photo: "eu-woman-face" },
            { title: "光线均匀", note: "没有明显阴影与滤镜", photo: "us-man-face" },
            { title: "补充侧脸", note: "多角度换脸更稳定", photo: "cn-woman-side" },
        ],
        bad: [
            { title: "模糊低清", photo: "cn-woman-face", style: blur },
            { title: "墨镜口罩", art: <FaceCover /> },
            { title: "多人合照", group: ["cn-man-face", "in-woman-face", "jp-senior-woman-face"] },
        ],
    },
    print: {
        title: "印花服装怎么拍",
        good: [
            { title: "印花平整", note: "正面拍摄，图案完整", art: <GarmentFlat /> },
            { title: "清晰特写", note: "细节和颜色看得清", art: <PrintFlat /> },
        ],
        bad: [
            { title: "褶皱严重", art: <GarmentWrinkled pattern /> },
            { title: "多件堆叠", art: <GarmentPile /> },
        ],
    },
};

function TipVisual({ item }: { item: TipItem }) {
    if (item.art) return <>{item.art}</>;
    if (item.group)
        return (
            <span className="ect-tip-photo is-group">
                {item.group.map((name) => (
                    <img key={name} src={PHOTO(name)} alt="" loading="lazy" decoding="async" />
                ))}
            </span>
        );
    return (
        <span className="ect-tip-photo">
            <img src={PHOTO(item.photo || "cn-woman-front")} alt="" loading="lazy" decoding="async" style={item.style} />
        </span>
    );
}

/** 悬停上传位时出现的「上传示范」卡片：推荐与不推荐的实拍 / 插画示例。 */
export function TryOnUploadTipCard({ kind, onDismiss, onClose }: { kind: TryOnTipKind; onDismiss: () => void; onClose: () => void }) {
    const content = TIPS[kind];
    return (
        <div className="ecv-tip ect-tip" role="dialog" aria-label={content.title}>
            <div className="ecv-tip-actions">
                <button type="button" onClick={onDismiss}>
                    不再提醒
                </button>
                <button type="button" aria-label="关闭" onClick={onClose}>
                    ×
                </button>
            </div>
            <h4 className="ecv-tip-title">{content.title}</h4>
            <p className="ecv-tip-group is-good">
                <CheckCircle2 size={15} /> 推荐
            </p>
            <div className="ecv-tip-grid ect-tip-grid" data-count={content.good.length}>
                {content.good.map((item, index) => (
                    <figure key={item.title} style={{ "--i": index } as CSSProperties}>
                        <TipVisual item={item} />
                        <figcaption>
                            <strong>
                                <i className="is-good">{index + 1}</i>
                                {item.title}
                            </strong>
                            {item.note ? <small>{item.note}</small> : null}
                        </figcaption>
                    </figure>
                ))}
            </div>
            <p className="ecv-tip-group is-bad">
                <XCircle size={15} /> 不推荐
            </p>
            <div className="ecv-tip-grid ect-tip-grid is-bad" data-count={content.bad.length}>
                {content.bad.map((item, index) => (
                    <figure key={item.title} className="is-bad" style={{ "--i": index + content.good.length } as CSSProperties}>
                        <TipVisual item={item} />
                        <figcaption>
                            <strong>
                                <i className="is-bad">{index + 1}</i>
                                {item.title}
                            </strong>
                        </figcaption>
                    </figure>
                ))}
            </div>
        </div>
    );
}

/** 作品区空状态与功能按钮悬浮卡共用：每个功能一句「能做什么」。 */
export const TRYON_EMPTY_TIPS: Array<{ id: TryOnFunction; tip: string }> = [
    { id: "model-views", tip: "同一位模特，正面、侧面、背面一次成图" },
    { id: "outfit", tip: "模特 + 服装，一键上身" },
    { id: "multi-model", tip: "一件衣服，多国真人模特同穿" },
    { id: "multi-outfit", tip: "一位模特，试穿多件衣服" },
    { id: "pose", tip: "参考图或文字，复刻姿势" },
    { id: "face-swap", tip: "指定的脸，批量换到模特图" },
    { id: "smart-face", tip: "AI 原创新脸，规避肖像风险" },
    { id: "smart-head", tip: "新脸 + 新发型，一起换新" },
    { id: "print", tip: "提取印花，导出 PNG" },
];
