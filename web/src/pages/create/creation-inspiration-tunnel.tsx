// 创作页空态的纵深图片画廊：卡片沿 Z 轴前后排队，当前一张在最前、最大，
// 其余依次后退缩小，像展厅里一排挂在纵深上的画。
// 滚轮、左右按钮或自动轮播切换，切换靠 CSS transition 平滑过渡。
// 卡片是带玻璃质感边框的实体面板，不做弧形、也不压成薄片。
// 展示内容跟随下方输入框的创作类型：选视频就只排队视频灵感，选图片就只排队图片灵感。
//
// 队列是「随机取样」而不是固定切片：每次进场、每次换创作类型都会重新抽一批，
// 并且记住最近出现过哪些，走完一轮自动换下一批，避免反复看到同样那几张。
//
// 池子不打包，走 public/inspirations/gallery-pool.json：几百条连提示词正文一起
// 就是几百 KB，压进首屏 JS 是白背的，而这份数据只服务这一处。
//
// 每张卡片等自己的封面加载完再露面。不这么做的话，先到的图先显示、
// 慢的那几张只剩一块空面板，观感就是"右边出来了左边还空着"。

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { useReducedMotion } from "motion/react";

import { catalogIdOf, type CreationInspiration } from "@/lib/inspirations/catalog";
import { loadGalleryPool } from "@/services/inspiration-catalog";
import type { CreationMode } from "./creation-types";
import "./creation-inspiration-tunnel.css";

/** 画廊里排队展示的照片数，取奇数，两侧层数才对得齐。 */
const GALLERY_SIZE = 11;
/** 每后退一层的横向偏移（px）。 */
const STEP_X = 185;
/** 每后退一层的纵深（px）。 */
const STEP_Z = 150;
/** 虚拟焦距，只用来算出"后退一层缩多少"，不再是 CSS perspective。 */
const PERSPECTIVE = 1200;
/** 最多同时可见的层数，再远就隐掉。 */
const MAX_DEPTH = 4;
/** 每一层的透明度，越靠后越淡，做出空气透视。 */
const DEPTH_OPACITY = [1, 0.98, 0.95, 0.91, 0.86];
/** 自动轮播间隔。悬停、聚焦或系统开了"减少动效"时暂停。 */
const AUTO_ADVANCE_MS = 6500;
/** 记住最近展示过的条目数，换页/刷新时不会又抽到同一批。 */
const RECENT_MEMORY = 66;
const RECENT_KEY = "yingce:creation-gallery-recent";
/**
 * 等封面的兜底时长。正常情况下封面几百毫秒就回来了，这条不会生效；
 * 万一某张请求挂住不回，也不能让队列永远缺一块，超时就先放行。
 */
const COVER_FALLBACK_MS = 8000;

/**
 * 把"离眼睛多远"换算成这一层的等比缩放。
 * 原先交给 CSS perspective 做，但每帧的投影光栅化太贵；
 * 平面卡片在固定 z 上做投影变换，结果恰好就是等比缩放加向中轴平移，所以自己算更省。
 */
function depthScale(depth: number): number {
    return PERSPECTIVE / (PERSPECTIVE + STEP_Z * depth);
}

function shuffled<T>(list: T[]): T[] {
    const next = [...list];
    for (let index = next.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(Math.random() * (index + 1));
        [next[index], next[swap]] = [next[swap], next[index]];
    }
    return next;
}

function readRecent(mode: CreationMode): string[] {
    try {
        const raw = window.sessionStorage.getItem(`${RECENT_KEY}:${mode}`);
        const parsed = raw ? (JSON.parse(raw) as unknown) : null;
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
        return [];
    }
}

function writeRecent(mode: CreationMode, ids: string[]) {
    try {
        window.sessionStorage.setItem(`${RECENT_KEY}:${mode}`, JSON.stringify(ids.slice(-RECENT_MEMORY)));
    } catch {
        // 隐私模式下 sessionStorage 可能不可用；退化成每次纯随机，不影响功能。
    }
}

/** 随机抽一批：先挑没在最近出现过的，不够再用出现过的补齐，抽完把结果记进"最近"。 */
function pickBatch(pool: CreationInspiration[], size: number, mode: CreationMode): CreationInspiration[] {
    if (pool.length <= size) return shuffled(pool);
    const recent = new Set(readRecent(mode));
    const byFreshness = [...shuffled(pool.filter((item) => !recent.has(catalogIdOf(item)))), ...shuffled(pool.filter((item) => recent.has(catalogIdOf(item))))];
    const picked = byFreshness.slice(0, size);
    writeRecent(mode, [...recent, ...picked.map(catalogIdOf)]);
    return picked;
}

/**
 * 画廊只服务鼠标氛围：读屏与键盘用户走输入框和快捷入口创作，
 * 所以卡片整体对辅助技术隐藏、也不进 Tab 顺序；左右切换按钮仍可聚焦，
 * 当前展示的是哪一张由下面那条 aria-live 文本播报。
 */
export function CreationInspirationTunnel({ mode, onStartPrompt }: { mode: CreationMode; onStartPrompt: (mode: CreationMode, prompt: string) => void }) {
    /**
     * 池子来自 gallery-pool.json，是单独一份静态 JSON，不打包。
     * 它没到之前整条画廊不渲染——先摆一小批再换成大池子，用户会看到画面整排重排一次。
     */
    const [pool, setPool] = useState<CreationInspiration[]>([]);
    const [poolReady, setPoolReady] = useState(false);
    const [shots, setShots] = useState<CreationInspiration[]>([]);
    const [active, setActive] = useState(0);
    const [paused, setPaused] = useState(false);
    const [readyIds, setReadyIds] = useState<ReadonlySet<string>>(() => new Set());
    const reducedMotion = useReducedMotion();
    const stageRef = useRef<HTMLDivElement>(null);
    const activeRef = useRef(0);
    activeRef.current = active;

    const modePool = useMemo(() => pool.filter((item) => item.mode === mode), [pool, mode]);
    /** 轮换时读最新的池子，但不把池子写进轮播的依赖——否则池子一到就重置计时。 */
    const modePoolRef = useRef(modePool);
    modePoolRef.current = modePool;

    useEffect(() => {
        let alive = true;
        // 加载器不会 reject：拉不到就退回打包的原创条目，画廊宁可少几张也不该空着。
        loadGalleryPool().then((entries) => {
            if (!alive) return;
            setPool(entries);
            setPoolReady(true);
        });
        return () => {
            alive = false;
        };
    }, []);

    // 抽一批的时机只有两个：池子到货（含进场），以及换创作类型。
    useEffect(() => {
        if (!poolReady) return;
        setShots(pickBatch(modePool, GALLERY_SIZE, mode));
        setActive(0);
    }, [mode, modePool, poolReady]);

    /** 封面就绪（含加载失败）后放行这张卡。失败的也要放行，否则卡片永远不出现。 */
    const markReady = useCallback((id: string) => {
        setReadyIds((current) => (current.has(id) ? current : new Set(current).add(id)));
    }, []);

    // 兜底放行：请求挂住不返回时，到点把这一批全部放出来，宁可露出空面板也不留缺口。
    useEffect(() => {
        if (!shots.length) return;
        const timer = window.setTimeout(() => {
            setReadyIds((current) => new Set([...current, ...shots.map(catalogIdOf)]));
        }, COVER_FALLBACK_MS);
        return () => window.clearTimeout(timer);
    }, [shots]);

    const step = useCallback(
        (delta: number) => {
            if (!shots.length) return;
            setActive((current) => (current + delta + shots.length) % shots.length);
        },
        [shots.length],
    );

    // 自动轮播：走完一轮就换一批新的，用户不会反复看到同样那几张。
    useEffect(() => {
        if (paused || reducedMotion || shots.length < 2) return;
        const timer = window.setInterval(() => {
            const next = activeRef.current + 1;
            if (next < shots.length) {
                setActive(next);
                return;
            }
            setShots(pickBatch(modePoolRef.current, GALLERY_SIZE, mode));
            setActive(0);
        }, AUTO_ADVANCE_MS);
        return () => window.clearInterval(timer);
    }, [paused, reducedMotion, shots.length, mode]);

    // 标签页切到后台时停掉，回来再继续，免得空转。
    useEffect(() => {
        const handleVisibility = () => setPaused(document.hidden);
        document.addEventListener("visibilitychange", handleVisibility);
        return () => document.removeEventListener("visibilitychange", handleVisibility);
    }, []);

    // 滚轮切换：向上退到上一张、向下进到下一张。
    useEffect(() => {
        const node = stageRef.current;
        if (!node) return;
        let latched = false;
        const handleWheel = (event: WheelEvent) => {
            event.preventDefault();
            // 触控板一次滑动会连发多个事件，锁一小段时间，避免一次滑过好几张。
            if (latched) return;
            latched = true;
            window.setTimeout(() => {
                latched = false;
            }, 240);
            step(event.deltaY > 0 ? 1 : -1);
        };
        node.addEventListener("wheel", handleWheel, { passive: false });
        return () => node.removeEventListener("wheel", handleWheel);
    }, [step]);

    const current = shots[active];

    if (!shots.length) return null;

    return (
        <div
            className="creation-inspiration-tunnel"
            onPointerEnter={() => setPaused(true)}
            onPointerLeave={() => setPaused(false)}
            onFocusCapture={() => setPaused(true)}
            onBlurCapture={() => setPaused(false)}
        >
            <div ref={stageRef} className="creation-gallery-stage" aria-hidden="true">
                {shots.map((inspiration, index) => {
                    const id = catalogIdOf(inspiration);
                    // 相对当前卡片的距离，绕成最短路径，形成首尾相接的队列。
                    const half = Math.floor(shots.length / 2);
                    const relative = ((index - active + half + shots.length) % shots.length) - half;

                    const depth = Math.abs(relative);
                    // 超出可见层数就靠透明度淡出，不切 visibility——
                    // 硬切会让最远那张在过渡中途"啪"地消失。
                    const style = {
                        "--card-x": `${(Math.sign(relative) * STEP_X * depth).toFixed(1)}px`,
                        "--card-scale": depthScale(depth).toFixed(4),
                        "--card-depth-opacity": `${DEPTH_OPACITY[Math.min(depth, DEPTH_OPACITY.length - 1)]}`,
                        zIndex: `${100 - depth}`,
                    } as CSSProperties;

                    return (
                        <button
                            key={id}
                            type="button"
                            tabIndex={-1}
                            className={`creation-tunnel-card ${depth === 0 ? "is-active" : ""} ${readyIds.has(id) ? "is-ready" : ""}`}
                            style={style}
                            onClick={() => onStartPrompt(inspiration.mode, inspiration.prompt)}
                        >
                            <img
                                src={inspiration.image}
                                alt=""
                                draggable={false}
                                decoding="async"
                                onLoad={() => markReady(id)}
                                onError={() => markReady(id)}
                                // 命中浏览器缓存的图可能在挂监听之前就 complete 了，onLoad 不会再触发，这里补一次。
                                ref={(node) => {
                                    if (node?.complete) markReady(id);
                                }}
                            />
                            {/* 三段式提示词信息：行动点、标题、描述，只有最前那张露出来。 */}
                            <span className="creation-tunnel-card-info">
                                <span className="creation-tunnel-card-cta">
                                    <ArrowUp aria-hidden="true" />
                                    使用这个创意
                                </span>
                                <span className="creation-tunnel-card-title">{inspiration.title}</span>
                                <span className="creation-tunnel-card-desc">{inspiration.description}</span>
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* 图标外面套一层 span 是必须的：workspace-product.css 里有一条
                `button:has(> svg):not(:has(> span)):not(:disabled):hover` 会认领"纯图标按钮"，
                用 !important 改写 color / background 并把 transform 顶成 translateY(-1px)，
                按钮会当场掉半个身位。带 span 的按钮不在那条规则的射程内。 */}
            <button type="button" className="creation-gallery-arrow is-prev" aria-label="上一张灵感" onClick={() => step(-1)}>
                <span className="creation-gallery-arrow-icon"><ChevronLeft aria-hidden="true" /></span>
            </button>
            <button type="button" className="creation-gallery-arrow is-next" aria-label="下一张灵感" onClick={() => step(1)}>
                <span className="creation-gallery-arrow-icon"><ChevronRight aria-hidden="true" /></span>
            </button>

            {/* 卡片本身对辅助技术隐藏，切换结果靠这条播报传达。 */}
            <p className="creation-gallery-announce" aria-live="polite">
                {current ? `${current.title}：${current.description}` : ""}
            </p>
        </div>
    );
}