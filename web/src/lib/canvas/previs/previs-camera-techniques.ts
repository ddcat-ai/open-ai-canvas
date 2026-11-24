import type { PrevisCameraFollowSide, PrevisCameraMove, PrevisCameraMoveParams, PrevisCameraMoveSegment, PrevisCameraTechnique, PrevisPathEasing, PrevisScene, PrevisShot, PrevisShotSize } from "@/types/previs";

/**
 * 世界引擎运镜手法表（纯数据，不依赖 three，画布页也可以引用）。
 *
 * 摄影机的 moves 是按开始时间排列的运镜段，求值见 previs-camera-moves.ts。
 * 后端 cloud_agent_previs_camera.go 用同一份手法 ID、参数键与范围校验 Agent 写入，两边改动需同步；
 * web/test/previs-camera-moves.test.ts 会逐项比对。
 */

export type PrevisCameraNumberParamKey = Exclude<keyof PrevisCameraMoveParams, "side" | "shotSize">;

export type PrevisCameraParamSpec =
    | { kind: "number"; key: PrevisCameraNumberParamKey; label: string; unit: string; min: number; max: number; step: number; defaultValue?: number; autoHint?: string }
    | { kind: "side"; key: "side"; label: string }
    | { kind: "shotSize"; key: "shotSize"; label: string };

export type PrevisCameraTechniqueGroup = "dolly" | "pan" | "crane" | "follow" | "texture";

export type PrevisCameraTechniqueInfo = {
    id: PrevisCameraTechnique;
    label: string;
    group: PrevisCameraTechniqueGroup;
    hint: string;
    /** none：不需要主体；optional：给了主体就围绕 / 盯住它；required：必须指定主体。 */
    subject: "none" | "optional" | "required";
    /** 叠加层（手持、震动）：只在时间窗内生效，可与其他运镜重叠。 */
    layer?: boolean;
    /** 默认时长（秒）；省略表示到镜头结束。 */
    duration?: number;
    params: PrevisCameraParamSpec[];
};

export const PREVIS_CAMERA_MAX_MOVES = 24;

export const PREVIS_CAMERA_TECHNIQUE_GROUPS: Array<{ id: PrevisCameraTechniqueGroup; label: string }> = [
    { id: "dolly", label: "推拉变焦" },
    { id: "pan", label: "摇移" },
    { id: "crane", label: "升降环绕" },
    { id: "follow", label: "跟随" },
    { id: "texture", label: "质感" },
];

/** 跟拍方位的默认距离（米）与高度（相对主体脚底，按身高比例；飞行时随主体一起升空）。 */
export const PREVIS_CAMERA_FOLLOW_SIDES: Array<{ value: PrevisCameraFollowSide; label: string; distance: number; heightRatio: number }> = [
    { value: "behind", label: "后方", distance: 4.5, heightRatio: 1.05 },
    { value: "front", label: "前方（倒退跟拍）", distance: 4, heightRatio: 0.88 },
    { value: "left", label: "人物左侧", distance: 4.5, heightRatio: 0.82 },
    { value: "right", label: "人物右侧", distance: 4.5, heightRatio: 0.82 },
    { value: "above", label: "正上方俯拍", distance: 1.5, heightRatio: 5 },
    { value: "shoulder", label: "过肩", distance: 1.1, heightRatio: 0.95 },
    { value: "pov", label: "主观视角", distance: 0.3, heightRatio: 0.93 },
];

/**
 * 跟拍景别：画面短边要框住的主体高度比例（extent）、画面中心高度（aim）与机位高度（eye），都按身高比例。
 * 距离按当时焦段与镜头画幅换算（previsFramingDistance），所以同一景别换焦段、换画幅仍然框住同样的范围。
 * 只对后方、前方、左右侧生效；俯拍、过肩、主观视角有自己的几何。
 */
export const PREVIS_CAMERA_FOLLOW_SHOT_SIZES: Array<{ value: PrevisShotSize; label: string; extent: number; aim: number; eye: number }> = [
    { value: "extreme_close_up", label: "大特写（面部）", extent: 0.16, aim: 0.93, eye: 0.93 },
    { value: "close_up", label: "近景（肩部以上）", extent: 0.3, aim: 0.88, eye: 0.9 },
    { value: "medium", label: "中景（腰部以上）", extent: 0.62, aim: 0.74, eye: 0.86 },
    { value: "full", label: "全景（全身）", extent: 1.3, aim: 0.52, eye: 0.82 },
    { value: "wide", label: "远景", extent: 3.2, aim: 0.5, eye: 0.9 },
    { value: "extreme_wide", label: "大远景", extent: 9, aim: 0.5, eye: 2.5 },
];

export function resolvePrevisCameraFollowShotSize(value: string | undefined) {
    return value ? PREVIS_CAMERA_FOLLOW_SHOT_SIZES.find((item) => item.value === value) : undefined;
}

const number = (key: PrevisCameraNumberParamKey, label: string, unit: string, min: number, max: number, step: number, extra: { defaultValue?: number; autoHint?: string } = {}): PrevisCameraParamSpec => ({
    kind: "number",
    key,
    label,
    unit,
    min,
    max,
    step,
    ...extra,
});
const AIM = number("aim", "注视高度", "米", 0, 20, 0.1, { autoHint: "胸口" });
const INTENSITY = number("intensity", "强度", "", 0.1, 3, 0.1, { defaultValue: 1 });
const SIDE: PrevisCameraParamSpec = { kind: "side", key: "side", label: "方位" };
const SHOT_SIZE: PrevisCameraParamSpec = { kind: "shotSize", key: "shotSize", label: "景别" };

export const PREVIS_CAMERA_TECHNIQUES: PrevisCameraTechniqueInfo[] = [
    { id: "push_in", label: "推镜头", group: "dolly", hint: "沿视线推近主体", subject: "none", params: [number("distance", "推近", "米", 0.1, 200, 0.5, { autoHint: "距离的 45%" })] },
    { id: "pull_out", label: "拉镜头", group: "dolly", hint: "沿视线后退，交代环境", subject: "none", params: [number("distance", "拉远", "米", 0.1, 200, 0.5, { autoHint: "距离的 60%" })] },
    {
        id: "dolly_zoom_out",
        label: "希区柯克变焦",
        group: "dolly",
        hint: "后退同时推长焦段：主体大小不变，背景向主体压近（《迷魂记》）",
        subject: "optional",
        params: [number("distance", "后退", "米", 0.1, 200, 0.5, { autoHint: "退到 2 倍距离" }), AIM],
    },
    {
        id: "dolly_zoom_in",
        label: "反向希区柯克",
        group: "dolly",
        hint: "推近同时缩短焦段：主体大小不变，背景向后拉开（《大白鲨》）",
        subject: "optional",
        params: [number("distance", "推近", "米", 0.1, 200, 0.5, { autoHint: "推到一半距离" }), AIM],
    },
    { id: "zoom_in", label: "变焦推", group: "dolly", hint: "机位不动，只把焦段推长", subject: "none", params: [number("focalLength", "推到", "mm", 8, 300, 1, { autoHint: "焦段 ×2" })] },
    { id: "zoom_out", label: "变焦拉", group: "dolly", hint: "机位不动，焦段变短看得更广", subject: "none", params: [number("focalLength", "拉到", "mm", 8, 300, 1, { autoHint: "焦段 ×0.5" })] },
    { id: "pan_left", label: "左摇", group: "pan", hint: "机位不动，镜头向左转", subject: "none", params: [number("angle", "角度", "°", 1, 360, 5, { defaultValue: 30 })] },
    { id: "pan_right", label: "右摇", group: "pan", hint: "机位不动，镜头向右转", subject: "none", params: [number("angle", "角度", "°", 1, 360, 5, { defaultValue: 30 })] },
    { id: "tilt_up", label: "上摇", group: "pan", hint: "机位不动，镜头向上仰", subject: "none", params: [number("angle", "角度", "°", 1, 80, 1, { defaultValue: 15 })] },
    { id: "tilt_down", label: "下摇", group: "pan", hint: "机位不动，镜头向下俯", subject: "none", params: [number("angle", "角度", "°", 1, 80, 1, { defaultValue: 15 })] },
    { id: "whip_pan_left", label: "左甩", group: "pan", hint: "极快的横摇，常用作转场", subject: "none", duration: 0.5, params: [number("angle", "角度", "°", 15, 270, 5, { defaultValue: 90 })] },
    { id: "whip_pan_right", label: "右甩", group: "pan", hint: "极快的横摇，常用作转场", subject: "none", duration: 0.5, params: [number("angle", "角度", "°", 15, 270, 5, { defaultValue: 90 })] },
    { id: "truck_left", label: "左移", group: "pan", hint: "机位与焦点一起向左平移", subject: "none", params: [number("distance", "距离", "米", 0.1, 200, 0.5, { defaultValue: 2 })] },
    { id: "truck_right", label: "右移", group: "pan", hint: "机位与焦点一起向右平移", subject: "none", params: [number("distance", "距离", "米", 0.1, 200, 0.5, { defaultValue: 2 })] },
    { id: "roll", label: "旋转", group: "pan", hint: "绕视线旋转画面（荷兰角），正数向右倾", subject: "none", params: [number("angle", "角度", "°", -180, 180, 1, { defaultValue: 15 })] },
    { id: "pedestal_up", label: "升", group: "crane", hint: "机位与焦点一起升高", subject: "none", params: [number("distance", "升高", "米", 0.1, 100, 0.5, { defaultValue: 1 })] },
    { id: "pedestal_down", label: "降", group: "crane", hint: "机位与焦点一起降低", subject: "none", params: [number("distance", "降低", "米", 0.1, 100, 0.5, { defaultValue: 1 })] },
    {
        id: "crane_up",
        label: "摇臂升",
        group: "crane",
        hint: "机位升高、镜头一直对着焦点；同时后退就是航拍拉升",
        subject: "none",
        params: [number("height", "升高", "米", 0.2, 100, 0.5, { defaultValue: 2.5 }), number("distance", "同时后退", "米", 0, 200, 0.5, { defaultValue: 0 })],
    },
    {
        id: "crane_down",
        label: "摇臂降",
        group: "crane",
        hint: "机位降低、镜头一直对着焦点；可同时前推",
        subject: "none",
        params: [number("height", "降低", "米", 0.2, 100, 0.5, { defaultValue: 2 }), number("distance", "同时前推", "米", 0, 200, 0.5, { defaultValue: 0 })],
    },
    {
        id: "orbit_left",
        label: "左环绕",
        group: "crane",
        hint: "绕主体（未指定时绕焦点）向左转；主体在移动时与跟拍叠加",
        subject: "optional",
        params: [number("angle", "角度", "°", 5, 720, 5, { defaultValue: 90 }), number("rise", "同时升高", "米", -50, 50, 0.5, { defaultValue: 0 }), AIM],
    },
    {
        id: "orbit_right",
        label: "右环绕",
        group: "crane",
        hint: "绕主体（未指定时绕焦点）向右转；主体在移动时与跟拍叠加",
        subject: "optional",
        params: [number("angle", "角度", "°", 5, 720, 5, { defaultValue: 90 }), number("rise", "同时升高", "米", -50, 50, 0.5, { defaultValue: 0 }), AIM],
    },
    {
        id: "follow",
        label: "跟拍",
        group: "follow",
        hint: "跟着主体移动；人物飞行、御剑时机位一起升空。换方位或景别时绕主体过渡（切入用时）",
        subject: "required",
        params: [
            SIDE,
            SHOT_SIZE,
            number("distance", "距离", "米", 0, 60, 0.5, { autoHint: "按方位或景别" }),
            number("height", "高度", "米", -5, 100, 0.1, { autoHint: "按方位或景别" }),
            number("lag", "滞后", "秒", 0, 2, 0.05, { defaultValue: 0.25 }),
            number("blend", "切入用时", "秒", 0, 10, 0.1, { autoHint: "≤0.6 秒" }),
            AIM,
        ],
    },
    { id: "look_at", label: "跟摇", group: "follow", hint: "机位不动，镜头始终盯住主体", subject: "required", params: [AIM] },
    { id: "handheld", label: "手持", group: "texture", hint: "呼吸感的轻微晃动，可与其他运镜叠加", subject: "none", layer: true, params: [INTENSITY] },
    { id: "shake", label: "震动", group: "texture", hint: "撞击、爆炸时的画面冲击，快速衰减", subject: "none", layer: true, duration: 0.6, params: [INTENSITY] },
];

const TECHNIQUE_BY_ID = new Map(PREVIS_CAMERA_TECHNIQUES.map((item) => [item.id, item]));

export function resolvePrevisCameraTechnique(id: string | undefined): PrevisCameraTechniqueInfo | undefined {
    return id ? TECHNIQUE_BY_ID.get(id as PrevisCameraTechnique) : undefined;
}

export function resolvePrevisCameraFollowSide(side: string | undefined) {
    return PREVIS_CAMERA_FOLLOW_SIDES.find((item) => item.value === side) ?? PREVIS_CAMERA_FOLLOW_SIDES[0];
}

/** 读一个数值参数：越界按手法范围截断，非法值视为未填（走自动取值）。 */
export function previsCameraMoveNumber(move: Pick<PrevisCameraMoveSegment, "technique" | "params">, key: PrevisCameraNumberParamKey): number | undefined {
    const value = move.params?.[key];
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    const spec = resolvePrevisCameraTechnique(move.technique)?.params.find((item) => item.key === key);
    if (!spec || spec.kind !== "number") return undefined;
    return Math.min(spec.max, Math.max(spec.min, value));
}

/** 只保留手法支持的参数，数值按范围截断；用于 UI 与配方写入。 */
export function sanitizePrevisCameraMoveParams(technique: PrevisCameraTechnique, params: PrevisCameraMoveParams | undefined): PrevisCameraMoveParams | undefined {
    const info = resolvePrevisCameraTechnique(technique);
    if (!info || !params) return undefined;
    const result: PrevisCameraMoveParams = {};
    for (const spec of info.params) {
        if (spec.kind === "side") {
            if (params.side && PREVIS_CAMERA_FOLLOW_SIDES.some((item) => item.value === params.side)) result.side = params.side;
            continue;
        }
        if (spec.kind === "shotSize") {
            if (resolvePrevisCameraFollowShotSize(params.shotSize)) result.shotSize = params.shotSize;
            continue;
        }
        const value = params[spec.key];
        if (typeof value === "number" && Number.isFinite(value)) result[spec.key] = Math.min(spec.max, Math.max(spec.min, value));
    }
    return Object.keys(result).length ? result : undefined;
}

export type PrevisCameraRecipeInput = { start: number; duration: number; subjectId?: string };

/**
 * 配方里的一段运镜，时间按配方总时长的比例写：at 开始、span 时长，max 是时长上限（秒），
 * alignEnd 让这段贴着配方结尾；blendSpan 是跟拍切入用时占总时长的比例（展开成 params.blend 秒数）。
 * 需要或可选主体的手法自动带上配方主体。
 */
export type PrevisCameraRecipeSegment = {
    technique: PrevisCameraTechnique;
    at: number;
    span: number;
    max?: number;
    alignEnd?: boolean;
    easing?: PrevisPathEasing;
    blendSpan?: number;
    params?: PrevisCameraMoveParams;
};

/**
 * 大师手法：一组运镜段的组合（纯数据）。
 * 后端 cloud_agent_previs_camera_recipes.go 有同一张表，Agent 用 camera_move 的 recipe 一次写入整套；
 * 两边按 backend/internal/app/testdata/previs_camera_recipes.json 的展开结果互相校验。
 */
export type PrevisCameraRecipe = {
    id: string;
    label: string;
    source: string;
    hint: string;
    subject: "none" | "optional" | "required";
    segments: PrevisCameraRecipeSegment[];
};

export const PREVIS_CAMERA_RECIPES: PrevisCameraRecipe[] = [
    {
        id: "ots_to_closeup",
        label: "过肩跟随转正面特写",
        source: "斯坦尼康长镜头（《摔角王》式背后跟随）",
        hint: "贴着人物肩后跟着走，再绕到正面收成近景，最后收到面部大特写",
        subject: "required",
        segments: [
            { technique: "follow", at: 0, span: 0.75, params: { side: "shoulder" } },
            { technique: "follow", at: 0.4, span: 0.6, blendSpan: 0.35, params: { side: "front", shotSize: "close_up", lag: 0.1 } },
            { technique: "follow", at: 0.78, span: 0.22, blendSpan: 0.18, params: { side: "front", shotSize: "extreme_close_up", lag: 0.1 } },
            { technique: "handheld", at: 0, span: 1, params: { intensity: 0.35 } },
        ],
    },
    {
        id: "walk_and_talk",
        label: "倒退跟拍收紧",
        source: "《白宫风云》walk and talk",
        hint: "在人物前方倒退跟拍中景，说到关键处收紧到近景",
        subject: "required",
        segments: [
            { technique: "follow", at: 0, span: 1, params: { side: "front", shotSize: "medium", lag: 0.2 } },
            { technique: "follow", at: 0.6, span: 0.4, blendSpan: 0.3, params: { side: "front", shotSize: "close_up", lag: 0.2 } },
            { technique: "handheld", at: 0, span: 1, params: { intensity: 0.3 } },
        ],
    },
    {
        id: "hero_reveal",
        label: "背影绕前亮相",
        source: "史诗片英雄亮相",
        hint: "从背后全景跟随，缓慢绕到正面并降低机位，收成仰拍近景",
        subject: "required",
        segments: [
            { technique: "follow", at: 0, span: 0.85, params: { side: "behind", shotSize: "full", lag: 0.15 } },
            { technique: "follow", at: 0.3, span: 0.7, blendSpan: 0.55, params: { side: "front", shotSize: "close_up", height: 0.9, lag: 0.15 } },
        ],
    },
    { id: "vertigo", label: "眩晕变焦", source: "希区柯克《迷魂记》", hint: "后退同时推焦，主体不变、背景压近", subject: "optional", segments: [{ technique: "dolly_zoom_out", at: 0, span: 1 }] },
    { id: "emotional_push", label: "情绪推镜", source: "斯皮尔伯格", hint: "缓慢推近人物，强调顿悟与情绪", subject: "none", segments: [{ technique: "push_in", at: 0, span: 1 }] },
    { id: "hero_orbit", label: "英雄环绕", source: "迈克尔·贝", hint: "绕主体转半圈，配低机位更有气势", subject: "optional", segments: [{ technique: "orbit_right", at: 0, span: 1, params: { angle: 180 } }] },
    { id: "aerial_reveal", label: "航拍拉升", source: "诺兰", hint: "升高并后退，揭示整个世界", subject: "none", segments: [{ technique: "crane_up", at: 0, span: 1, params: { height: 12, distance: 16 } }] },
    {
        id: "intimate_handheld",
        label: "贴身手持",
        source: "王家卫",
        hint: "近距离跟着人物，叠加手持晃动",
        subject: "required",
        segments: [
            { technique: "follow", at: 0, span: 1, params: { side: "behind", distance: 2.2, lag: 0.12 } },
            { technique: "handheld", at: 0, span: 1, params: { intensity: 1.6 } },
        ],
    },
    { id: "symmetric_follow", label: "一点透视跟拍", source: "库布里克《闪灵》", hint: "人物正后方居中跟随", subject: "required", segments: [{ technique: "follow", at: 0, span: 1, params: { side: "behind", distance: 5, lag: 0.3 } }] },
    { id: "side_track", label: "侧面平移跟拍", source: "黑泽明", hint: "与人物平行移动，看清动作全貌", subject: "required", segments: [{ technique: "follow", at: 0, span: 1, params: { side: "left", distance: 6, lag: 0.2 } }] },
    {
        id: "whip_transition",
        label: "横移甩镜",
        source: "韦斯·安德森",
        hint: "平稳横移，结尾快速甩镜转场",
        subject: "none",
        segments: [
            { technique: "truck_right", at: 0, span: 1, params: { distance: 2.5 } },
            { technique: "whip_pan_right", at: 0, span: 0.5, max: 0.5, alignEnd: true },
        ],
    },
    {
        id: "sword_chase",
        label: "御剑跟拍",
        source: "仙侠动作",
        hint: "跟在人物后方一起升空，后半段绕到侧面",
        subject: "required",
        segments: [
            { technique: "follow", at: 0, span: 1, params: { side: "behind", distance: 6, lag: 0.35 } },
            { technique: "orbit_left", at: 0.5, span: 0.5, params: { angle: 120 } },
        ],
    },
    { id: "spiral_rise", label: "螺旋升镜", source: "长镜头", hint: "绕主体一圈同时升高", subject: "optional", segments: [{ technique: "orbit_left", at: 0, span: 1, params: { angle: 360, rise: 4 } }] },
    { id: "crash_zoom", label: "急推变焦", source: "港式动作片", hint: "播放头处 0.4 秒猛推焦段", subject: "none", segments: [{ technique: "zoom_in", at: 0, span: 1, max: 0.4, easing: "linear" }] },
    { id: "impact_shake", label: "冲击震屏", source: "动作片", hint: "播放头处 0.6 秒震动", subject: "none", segments: [{ technique: "shake", at: 0, span: 1, max: 0.6, params: { intensity: 1.2 } }] },
];

const roundRecipeTime = (value: number) => Math.round(value * 1000) / 1000;

/** 配方按开始时间与总时长展开成运镜段（未截断、未分配 id）；后端同名函数逐项一致。 */
export function expandPrevisCameraRecipe(recipe: PrevisCameraRecipe, input: PrevisCameraRecipeInput): Array<Omit<PrevisCameraMoveSegment, "id">> {
    return recipe.segments.map((segment) => {
        const duration = segment.max ? Math.min(segment.span * input.duration, segment.max) : segment.span * input.duration;
        const start = segment.alignEnd ? input.start + input.duration - duration : input.start + segment.at * input.duration;
        const params: PrevisCameraMoveParams | undefined = segment.blendSpan ? { ...segment.params, blend: roundRecipeTime(segment.blendSpan * input.duration) } : segment.params;
        const move: Omit<PrevisCameraMoveSegment, "id"> = { technique: segment.technique, start, duration };
        if (segment.easing) move.easing = segment.easing;
        if (input.subjectId && resolvePrevisCameraTechnique(segment.technique)?.subject !== "none") move.subjectId = input.subjectId;
        if (params) move.params = { ...params };
        return move;
    });
}

export function resolvePrevisCameraRecipe(id: string) {
    return PREVIS_CAMERA_RECIPES.find((item) => item.id === id);
}

function formatNumber(value: number) {
    return Number(value.toFixed(2));
}

function subjectName(scene: Pick<PrevisScene, "objects"> | undefined, subjectId: string | undefined) {
    if (!subjectId) return undefined;
    return scene?.objects.find((item) => item.id === subjectId)?.name;
}

/** 列表与时间轴上的一行说明：「0–3s 推镜头 2m」。 */
export function describePrevisCameraMove(move: PrevisCameraMoveSegment, scene?: Pick<PrevisScene, "objects">) {
    const info = resolvePrevisCameraTechnique(move.technique);
    const parts = [`${formatNumber(move.start)}–${formatNumber(move.start + move.duration)}s`, info?.label ?? move.technique];
    const subject = subjectName(scene, move.subjectId);
    if (subject) parts.push(subject);
    if (move.technique === "follow") {
        parts.push(resolvePrevisCameraFollowSide(move.params?.side).label);
        const size = resolvePrevisCameraFollowShotSize(move.params?.shotSize);
        if (size) parts.push(size.label);
    }
    for (const spec of info?.params ?? []) {
        if (spec.kind !== "number" || spec.key === "aim" || spec.key === "lag" || spec.key === "blend") continue;
        const value = previsCameraMoveNumber(move, spec.key);
        if (value !== undefined && value !== 0) parts.push(`${formatNumber(value)}${spec.unit}`);
    }
    return parts.join(" ");
}

/** 写进视频提示词的运镜短语（不含时间）。跟拍的飞行描述由提示词编译器补充。 */
export function previsCameraMovePhrase(move: PrevisCameraMoveSegment, scene?: Pick<PrevisScene, "objects">) {
    const value = (key: Parameters<typeof previsCameraMoveNumber>[1]) => previsCameraMoveNumber(move, key);
    const subject = subjectName(scene, move.subjectId);
    const slow = move.duration >= 3 ? "缓慢" : "";
    const meters = (amount: number | undefined, prefix = "约 ") => (amount ? `${prefix}${formatNumber(amount)} 米` : "");
    const degrees = (fallback: number) => `${formatNumber(Math.abs(value("angle") ?? fallback))}°`;
    switch (move.technique) {
        case "push_in":
            return `镜头${slow}推近${meters(value("distance"))}`;
        case "pull_out":
            return `镜头${slow}拉远${meters(value("distance"))}`;
        case "dolly_zoom_out":
            return `希区柯克变焦：机位后退同时焦段推长，${subject ?? "主体"}在画面中大小不变、背景向其压近`;
        case "dolly_zoom_in":
            return `反向希区柯克变焦：机位推近同时焦段变短，${subject ?? "主体"}大小不变、背景向后拉开`;
        case "zoom_in":
            return `镜头变焦推近${value("focalLength") ? `至 ${formatNumber(value("focalLength")!)}mm` : ""}，机位不动`;
        case "zoom_out":
            return `镜头变焦拉远${value("focalLength") ? `至 ${formatNumber(value("focalLength")!)}mm` : ""}，机位不动`;
        case "pan_left":
        case "pan_right":
            return `镜头向${move.technique === "pan_left" ? "左" : "右"}横摇 ${degrees(30)}`;
        case "tilt_up":
        case "tilt_down":
            return `镜头${move.technique === "tilt_up" ? "向上仰摇" : "向下俯摇"} ${degrees(15)}`;
        case "whip_pan_left":
        case "whip_pan_right":
            return `快速向${move.technique === "whip_pan_left" ? "左" : "右"}甩镜 ${degrees(90)}，画面带强烈运动模糊`;
        case "roll":
            return `镜头绕光轴向${(value("angle") ?? 15) >= 0 ? "右" : "左"}旋转 ${degrees(15)}，形成倾斜的荷兰角`;
        case "truck_left":
        case "truck_right":
            return `镜头向${move.technique === "truck_left" ? "左" : "右"}横移${meters(value("distance") ?? 2, " ")}`;
        case "pedestal_up":
        case "pedestal_down":
            return `镜头平行${move.technique === "pedestal_up" ? "升高" : "降低"}${meters(value("distance") ?? 1, " ")}`;
        case "crane_up":
            return `摇臂升起${meters(value("height") ?? 2.5, " ")}${value("distance") ? `并后退 ${formatNumber(value("distance")!)} 米` : ""}，镜头始终对准主体，逐渐揭示全景`;
        case "crane_down":
            return `摇臂下降${meters(value("height") ?? 2, " ")}${value("distance") ? `并前推 ${formatNumber(value("distance")!)} 米` : ""}，镜头始终对准主体`;
        case "orbit_left":
        case "orbit_right": {
            const rise = value("rise");
            return `镜头围绕${subject ?? "画面主体"}向${move.technique === "orbit_left" ? "左" : "右"}环绕 ${degrees(90)}${rise ? `，同时${rise > 0 ? "升高" : "降低"} ${formatNumber(Math.abs(rise))} 米` : ""}`;
        }
        case "follow": {
            const who = subject ?? "主体";
            const at = value("distance") ? ` ${formatNumber(value("distance")!)} 米处` : "";
            const size = resolvePrevisCameraFollowShotSize(move.params?.shotSize);
            const framed = size ? `，景别为${size.label}` : "";
            const blend = value("blend");
            // 切入用时较长的跟拍是一次可见的机位过渡：镜头绕着人物走到新方位，而不是硬切。
            const arrive = blend && blend >= 0.8 ? `镜头用 ${formatNumber(blend)} 秒绕着${who}平滑移到` : "镜头在";
            switch (resolvePrevisCameraFollowSide(move.params?.side).value) {
                case "front":
                    return `${arrive}${who}前方${at}倒退跟拍，始终拍到人物正面${framed}`;
                case "left":
                case "right":
                    return `${arrive}${who}${move.params?.side === "left" ? "左" : "右"}侧${at}平行跟拍，与人物同步移动${framed}`;
                case "above":
                    return `${arrive}${who}正上方俯拍跟随`;
                case "shoulder":
                    return `${blend && blend >= 0.8 ? arrive + who + "肩后，" : ""}过${who}肩膀的过肩镜头，随人物前进`;
                case "pov":
                    return `${who}的主观视角镜头，随人物一起移动`;
                default:
                    return `${arrive}${who}身后${at}跟拍，与人物同步移动${framed}`;
            }
        }
        case "look_at":
            return `机位不动，镜头跟摇始终对准${subject ?? "主体"}`;
        case "handheld":
            return "手持摄影的轻微呼吸感晃动";
        case "shake":
            return "画面受冲击剧烈震动后迅速平息";
        default:
            return "";
    }
}

/** 运镜段映射到旧的镜头运镜标签，供节点元数据（videoCameraMoveId）与没有运镜段的旧流程使用。 */
const LABEL_BY_TECHNIQUE: Partial<Record<PrevisCameraTechnique, PrevisCameraMove>> = {
    push_in: "push_in",
    dolly_zoom_in: "push_in",
    zoom_in: "push_in",
    pull_out: "pull_out",
    dolly_zoom_out: "pull_out",
    zoom_out: "pull_out",
    crane_up: "tilt_up",
    pedestal_up: "tilt_up",
    tilt_up: "tilt_up",
    crane_down: "tilt_down",
    pedestal_down: "tilt_down",
    tilt_down: "tilt_down",
    pan_left: "pan_left",
    whip_pan_left: "pan_left",
    truck_left: "pan_left",
    pan_right: "pan_right",
    whip_pan_right: "pan_right",
    truck_right: "pan_right",
    orbit_left: "orbit_left",
    orbit_right: "orbit_right",
    handheld: "handheld",
    shake: "handheld",
};

/** 镜头的主运镜标签：取最长的非叠加运镜段；没有可映射的运镜段时沿用镜头上手选的标签。 */
export function resolvePrevisShotCameraMove(scene: Pick<PrevisScene, "cameras">, shot: Pick<PrevisShot, "cameraId" | "cameraMove">): PrevisCameraMove {
    const moves = scene.cameras.find((item) => item.id === shot.cameraId)?.moves ?? [];
    const ranked = moves.toSorted((left, right) => Number(Boolean(resolvePrevisCameraTechnique(left.technique)?.layer)) - Number(Boolean(resolvePrevisCameraTechnique(right.technique)?.layer)) || right.duration - left.duration);
    for (const move of ranked) {
        const label = LABEL_BY_TECHNIQUE[move.technique];
        if (label) return label;
    }
    return shot.cameraMove;
}
