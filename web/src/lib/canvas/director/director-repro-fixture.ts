import { resolveDirectorPlacement } from "@/lib/canvas/director/director-placement";
import { createDirectorModel, touchDirectorScene } from "@/lib/canvas/director/director-scene";
import type { DirectorObject, DirectorScene, DirectorVec3 } from "@/types/director";

/**
 * P0 复现用确定性 fixture。
 *
 * 硬约束：fixture 自身绝不引用网络资产。
 * - 不使用 createDirectorScene（它会放入依赖远端 GLB 的默认演员）；
 * - 所有对象都是 primitive，不带 url / storageKey / assetId；
 * - 所有 id 与时间戳都是字面量，因此每次构造完全一致（可直接断言）。
 *
 * 注意边界：这只保证「初始 fixture」离线。真实工作台自带的新增控件
 * （默认演员、上传模型、画布图片立牌）仍可能联网，因此模型相关的复现项
 * 需要显式注入本地资产，不能假装当前 fixture 已经覆盖。
 */

const FIXTURE_CREATED_AT = "2026-01-01T00:00:00.000Z";
const FIXTURE_SCENE_ID = "repro-scene-1";
const FIXTURE_SHOT_ID = "repro-shot-1";
const FIXTURE_CAMERA_ID = "repro-camera-1";

function fixtureObject(input: { id: string; name: string; primitive: "box" | "sphere" | "cylinder" | "plane"; position: DirectorVec3; color: string }): DirectorObject {
    return {
        id: input.id,
        name: input.name,
        kind: "primitive",
        primitive: input.primitive,
        color: input.color,
        visible: true,
        castShadow: true,
        receiveShadow: true,
        transform: { position: input.position, rotation: [0, 0, 0], scale: [1, 1, 1] },
        keyframes: [],
    };
}

/**
 * 构造 fixture 场景。同一 seed 下结构完全确定，不含任何远端资产。
 * 返回全新对象，调用方可以自由改写而不影响后续构造。
 */
export function createDirectorReproScene(): DirectorScene {
    return {
        id: FIXTURE_SCENE_ID,
        version: 1,
        title: "P0 复现场景",
        background: "#d8dde3",
        environmentIntensity: 0.7,
        gridVisible: true,
        objects: [
            fixtureObject({ id: "repro-box-1", name: "立方体 A", primitive: "box", position: [0, 0.5, 0], color: "#8795a5" }),
            fixtureObject({ id: "repro-sphere-1", name: "球体 B", primitive: "sphere", position: [2.2, 0.5, 0], color: "#6f8fb8" }),
            fixtureObject({ id: "repro-cylinder-1", name: "圆柱 C", primitive: "cylinder", position: [-2.2, 0.5, 0], color: "#b8926f" }),
        ],
        cameras: [
            {
                id: FIXTURE_CAMERA_ID,
                name: "主摄影机",
                transform: { position: [4.8, 2.7, 6.8], rotation: [0, 0, 0], scale: [1, 1, 1] },
                target: [0, 1, 0],
                focalLength: 35,
                fov: 50,
                aperture: 2.8,
                focusDistance: 5,
                near: 0.05,
                far: 500,
                keyframes: [],
            },
        ],
        lights: [
            {
                id: "repro-light-1",
                name: "主光",
                type: "directional",
                color: "#ffffff",
                intensity: 2.4,
                castShadow: true,
                transform: { position: [4, 6, 4], rotation: [0, 0, 0], scale: [1, 1, 1] },
            },
        ],
        shots: [
            {
                id: FIXTURE_SHOT_ID,
                name: "镜头 1",
                cameraId: FIXTURE_CAMERA_ID,
                shotSize: "medium",
                cameraMove: "static",
                duration: 4,
                fps: 24,
                prompt: "",
            },
        ],
        activeShotId: FIXTURE_SHOT_ID,
        createdAt: FIXTURE_CREATED_AT,
        updatedAt: FIXTURE_CREATED_AT,
    };
}

/** fixture 是否完全不依赖网络资产：任何 url/storageKey/assetId 都算违约。 */
export function directorReproSceneIsOffline(scene: DirectorScene): boolean {
    return scene.objects.every((object) => !object.url && !object.storageKey && !object.assetId);
}

/** P0 手工复现矩阵。页面据此渲染清单，Stage D 可以逐条执行。 */
export type DirectorReproCase = {
    id: string;
    group: string;
    title: string;
    steps: string;
    expected: string;
};

export const DIRECTOR_REPRO_MATRIX: readonly DirectorReproCase[] = [
    { id: "empty-click", group: "选择语义", title: "空白单击", steps: "在视口空白处单击。", expected: "取消选择，不产生历史记录，状态栏不变为未保存。" },
    { id: "right-click", group: "选择语义", title: "右击", steps: "在对象上右击，再在空白处右击。", expected: "不改变选择、不开始手势、不写入历史。" },
    { id: "switch-object", group: "选择语义", title: "切换对象", steps: "拖动对象 A 后不松手切换选中 B（或先松手再选 B）。", expected: "旧手势先被终结，B 不消费 A 的 base。" },
    { id: "release-outside", group: "手势终结", title: "视口外释放", steps: "在视口内按下并拖动，移出视口后松开鼠标。", expected: "手势以 commit 终结一次，不留下悬挂预览。" },
    { id: "blur", group: "手势终结", title: "窗口 blur", steps: "拖动过程中切换到其它窗口。", expected: "手势终结，草稿状态一致，不重复镜像。" },
    { id: "escape", group: "手势终结", title: "Escape 取消", steps: "拖动过程中按 Escape。", expected: "恢复到手势前快照，且被取消的值绝不发布。" },
    { id: "playing", group: "时间轴", title: "播放中操作", steps: "点击播放，播放中尝试选择与拖动。", expected: "播放不被打断成错误状态；改动语义与暂停时一致。" },
    { id: "non-zero-time", group: "时间轴", title: "非 0 秒操作", steps: "把播放头拖到非 0 且非帧格整数位置后拖动对象。", expected: "增量以 raw playhead 为起点，不产生漂移。" },
    { id: "autokey-on", group: "时间轴", title: "Auto Key 开", steps: "打开 Auto Key，在非 0 秒拖动对象。", expected: "在吸附后的目的时间写入关键帧。" },
    { id: "autokey-off", group: "时间轴", title: "Auto Key 关", steps: "关闭 Auto Key，在非 0 秒拖动对象。", expected: "只改基础 transform，不产生关键帧。" },
    { id: "add-move-delete-undo", group: "编辑链路", title: "连续新增/移动/删除/Undo", steps: "连续新增三个对象，各移动一次，删除中间一个，然后连续 Undo 到初始。", expected: "每步都可逆，Undo 后位置与选择状态自洽，不出现重叠或丢失。" },
    { id: "delete-while-loading", group: "模型", title: "模型加载中删除", steps: "点击「注入本地模型」，立即打开工作台，在模型仍在加载时于左侧列表删除它。", expected: "晚到的加载结果被丢弃并释放，不留孤儿资源、不报错。" },
    { id: "model-load-failed", group: "模型", title: "模型加载失败", steps: "点击「注入缺失模型」，打开工作台等待加载失败。", expected: "退回占位人偶，右上出现可操作「重试加载」，诊断记录 DIRECTOR_MODEL_LOAD_FAILED。" },
    { id: "save-failed", group: "保存", title: "保存失败", steps: "让保存 flush 抛错后观察头部状态与重试。", expected: "状态为错误，草稿保留时提示可恢复，重试可再次尝试。" },
    { id: "close-recovery", group: "保存", title: "关闭与草稿恢复", steps: "保存失败后关闭；重开同一场景。", expected: "关闭走 prepareClose 决策；重开时提示恢复或放弃，放弃后不再重复提示。" },
];

/** 注入变体：本地可达 glTF，或确定性不可达地址。 */
export type DirectorReproModelVariant = "local" | "missing";

/** 固定 id：重复注入必须替换同一对象，而不是不断堆叠新对象。 */
export const DIRECTOR_REPRO_MODEL_IDS: Record<DirectorReproModelVariant, string> = {
    local: "repro-model-local",
    missing: "repro-model-missing",
};

/** 同源本地资产，不依赖外网可达性。
 *  手写 glTF 2.0：内嵌 base64 buffer、无纹理、无压缩扩展，
 *  因此不需要 KTX2Loader / DRACOLoader 也能被 GLTFLoader 直接解析。 */
export const DIRECTOR_REPRO_LOCAL_MODEL_URL = "/canvas/models/director-repro-triangle.gltf";
/** 同源但确定不存在：稳定触发加载失败路径，不依赖外网可达性。 */
export const DIRECTOR_REPRO_MISSING_MODEL_URL = "/__director-repro-missing.glb";

const MODEL_URLS: Record<DirectorReproModelVariant, string> = {
    local: DIRECTOR_REPRO_LOCAL_MODEL_URL,
    missing: DIRECTOR_REPRO_MISSING_MODEL_URL,
};

/** local 是 JSON 形态 glTF，missing 仍按二进制声明，各自与 URL 后缀一致。 */
const MODEL_MIME_TYPES: Record<DirectorReproModelVariant, string> = {
    local: "model/gltf+json",
    missing: "model/gltf-binary",
};

const MODEL_NAMES: Record<DirectorReproModelVariant, string> = {
    local: "本地模型 repro triangle",
    missing: "缺失模型（预期失败）",
};

/**
 * 纯函数：把一个模型对象注入场景副本并返回新场景，绝不改写入参。
 *
 * 语义要点：
 * - 固定 id，重复注入先移除同 id 再重算位置，因此不会堆叠也不会自我碰撞；
 * - 只改 XZ，Y 严格保留 createDirectorModel 给出的 0（模型贴地）；
 * - 位置经 resolveDirectorPlacement 避让现有对象；
 * - 初始 fixture 本身不含模型，注入是显式动作，不污染离线基线。
 */
export function injectDirectorReproModel(scene: DirectorScene, variant: DirectorReproModelVariant): DirectorScene {
    const id = DIRECTOR_REPRO_MODEL_IDS[variant];
    const base = createDirectorModel({
        name: MODEL_NAMES[variant],
        assetId: id,
        storageKey: undefined,
        url: MODEL_URLS[variant],
        mimeType: MODEL_MIME_TYPES[variant],
    });
    const model: DirectorObject = { ...base, id };

    // 先剔除同 id 旧对象，避免重复点击时新位置去避让自己。
    const others = scene.objects.filter((object) => object.id !== id);
    const position = resolveDirectorPlacement({ object: model, existing: others });

    return touchDirectorScene({
        ...scene,
        objects: [...others, { ...model, transform: { ...model.transform, position } }],
    });
}
