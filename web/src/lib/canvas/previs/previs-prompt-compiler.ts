import type { PrevisCamera, PrevisEnvironment, PrevisMotionPath, PrevisObject, PrevisScene, PrevisShot, PrevisWorld } from "@/types/previs";
import { previsActorArchetypeLabel, previsColorLabel, previsPoseLabel } from "@/lib/canvas/previs/previs-scene";
import { resolvePrevisCatalogProp, resolvePrevisLayoutTemplate } from "@/lib/canvas/previs/previs-prop-catalog";
import { formatPrevisTimeOfDay, PREVIS_GROUND_OPTIONS, PREVIS_WEATHER_OPTIONS } from "@/lib/canvas/previs/previs-world";
import { previsActorPositionAt, resolvePrevisTravelStyle } from "@/lib/canvas/previs/previs-travel";
import { previsCameraMovePhrase, resolvePrevisCameraTechnique } from "@/lib/canvas/previs/previs-camera-techniques";
import { planPrevisMotionPath, PREVIS_PATH_EASINGS } from "@/lib/canvas/previs/previs-motion-path";

const shotSizeLabels: Record<PrevisShot["shotSize"], string> = {
    extreme_wide: "大远景",
    wide: "远景",
    full: "全身景",
    medium: "中景",
    close_up: "近景特写",
    extreme_close_up: "大特写",
};

const cameraMoveLabels: Record<PrevisShot["cameraMove"], string> = {
    static: "固定机位",
    push_in: "镜头缓慢推进",
    pull_out: "镜头缓慢拉远",
    pan_left: "镜头向左横摇",
    pan_right: "镜头向右横摇",
    tilt_up: "镜头向上摇摄",
    tilt_down: "镜头向下摇摄",
    orbit_left: "镜头向左环绕主体",
    orbit_right: "镜头向右环绕主体",
    handheld: "克制的手持摄影运动",
};

export function compilePrevisPrompt(scene: PrevisScene, shot: PrevisShot) {
    const camera = scene.cameras.find((item) => item.id === shot.cameraId) || scene.cameras[0];
    const visibleObjects = scene.objects.filter((item) => item.visible);
    const actors = visibleObjects.filter((item) => item.kind === "actor" || item.primitive === "character");
    const moves = camera ? cameraMovesPrompt(scene, camera) : "";
    return [
        shot.prompt.trim(),
        `镜头设计：${shotSizeLabels[shot.shotSize]}，${moves ? "运镜按下方时间线进行" : cameraMoveLabels[shot.cameraMove]}，时长 ${formatNumber(shot.duration)} 秒。`,
        camera ? cameraPrompt(camera) : "",
        moves,
        scene.world ? worldPrompt(scene.world) : environmentPrompt(scene.environment),
        layoutPrompt(visibleObjects),
        travelPrompt(actors),
        pathPrompt(shot, visibleObjects, camera),
        actors.length ? `角色原型与颜色映射：${actors.map((actor) => `${previsActorArchetypeLabel(actor.archetype)}${actor.name}（${actor.color}）`).join("；")}。生成视频时保持每个角色的体型、轮廓和身份稳定。` : "",
        visibleObjects.some((item) => item.kind !== "layout")
            ? `空间调度：${visibleObjects
                  .filter((item) => item.kind !== "layout")
                  .map(objectPrompt)
                  .join("；")}。`
            : "",
        assetReferencePrompt(scene),
        scene.world ? "" : `灯光：${scene.lights.map((light) => `${light.name}${formatNumber(light.intensity)}强度${light.color}`).join("，")}。`,
        "保持角色、道具、空间方向、光线方向和镜头轴线连续，遵循真实摄影机透视与物理遮挡。",
    ]
        .filter(Boolean)
        .join("\n");
}

function environmentPrompt(environment?: PrevisEnvironment) {
    if (!environment || environment.mode !== "panorama" || !environment.url) return "背景环境：使用工作台灰色预览背景。";
    return `背景环境：使用已绑定的 360° 全景图作为空间背景，保持全景图的水平朝向与镜头旋转连续；白膜角色只参考站位、比例、动作和遮挡，不把全景图拉伸成普通平面。`;
}

function timeOfDayLabel(hours: number) {
    if (hours < 5 || hours >= 20) return "夜晚";
    if (hours < 8) return "清晨";
    if (hours < 11) return "上午";
    if (hours < 14) return "正午";
    if (hours < 17) return "午后";
    return "黄昏";
}

function worldPrompt(world: PrevisWorld) {
    const weather = PREVIS_WEATHER_OPTIONS.find((item) => item.value === world.weather)?.label ?? "晴";
    const ground = PREVIS_GROUND_OPTIONS.find((item) => item.value === world.ground)?.label ?? "草地";
    return `环境与光线：${timeOfDayLabel(world.timeOfDay)}（${formatPrevisTimeOfDay(world.timeOfDay)}），天气${weather}，远景为${ground}${world.horizon ? "与连绵远山" : ""}；光线方向、色温与阴影长度符合该时刻的太阳位置。`;
}

function layoutPrompt(objects: PrevisObject[]) {
    const layouts = objects.filter((item) => item.kind === "layout" && item.layout);
    if (!layouts.length) return "";
    return `场景布景：${layouts
        .map((item) => {
            const info = resolvePrevisLayoutTemplate(item.layout?.template);
            return `${item.name}（${info?.name ?? "布景"}，约 ${Math.round(item.layout?.size ?? 0)} 米见方${info ? `，${info.hint}` : ""}${item.layout?.crowd ? "，街上有往来行人" : ""}）`;
        })
        .join("；")}。白膜只表达建筑体量、街道走向与空间层次，生成时补全真实材质与细节。`;
}

function travelPrompt(actors: PrevisObject[]) {
    const lines = actors.flatMap((actor) =>
        (actor.travels ?? []).map((travel) => {
            const style = resolvePrevisTravelStyle(travel.style);
            const from = previsActorPositionAt(actor, travel.start);
            const to = previsActorPositionAt(actor, travel.start + travel.duration);
            const height = travel.height && travel.height > 0 ? `，离地约 ${formatNumber(travel.height)} 米` : "";
            const flash = travel.style === "teleport" ? "，原地残影消失、终点瞬间出现" : "";
            return `${actor.name} 在 ${formatNumber(travel.start)}–${formatNumber(travel.start + travel.duration)} 秒从 (${formatNumber(from[0])}, ${formatNumber(from[2])}) ${style.verb} (${formatNumber(to[0])}, ${formatNumber(to[2])})${height}${flash}`;
        }),
    );
    return lines.length ? `人物位移：${lines.join("；")}。移动方向、速度与时长与预演一致。` : "";
}

const FLYING_TRAVELS = new Set(["fly", "sword_fly", "float"]);

/** 运镜时间线：每段「起止秒 + 手法短语」；跟拍飞行 / 御剑的人物时补一句机位随之升空。 */
function cameraMovesPrompt(scene: PrevisScene, camera: PrevisCamera) {
    const moves = (camera.moves ?? []).filter((move) => resolvePrevisCameraTechnique(move.technique)).toSorted((left, right) => left.start - right.start);
    if (!moves.length) return "";
    const lines = moves.map((move) => {
        let phrase = previsCameraMovePhrase(move, scene);
        if (move.technique === "follow" && move.subjectId) {
            const subject = scene.objects.find((item) => item.id === move.subjectId);
            const flight = subject?.travels?.find((travel) => FLYING_TRAVELS.has(travel.style) && travel.start < move.start + move.duration && move.start < travel.start + travel.duration);
            if (flight) phrase += `，${subject?.name}${resolvePrevisTravelStyle(flight.style).label}升空时机位一起升空、保持跟随`;
        }
        return `${formatNumber(move.start)}–${formatNumber(move.start + move.duration)} 秒${phrase}`;
    });
    return `运镜：${lines.join("；")}。机位运动的方向、幅度与节奏与预演一致。`;
}

/** 路径动画：起止时间、途经点数、运动规律、停留与最高离地高度。 */
function pathPrompt(shot: PrevisShot, objects: PrevisObject[], camera?: PrevisCamera) {
    const describe = (name: string, path: PrevisMotionPath) => {
        let plan;
        try {
            plan = planPrevisMotionPath(path, shot.duration);
        } catch {
            return "";
        }
        if (plan.stationary) return "";
        const first = path.points[0];
        const last = path.points[path.points.length - 1];
        const law = PREVIS_PATH_EASINGS.find((item) => item.value === (path.easing ?? "linear"))?.label ?? "匀速";
        const top = Math.max(...path.points.map((point) => point[1]));
        const holds = (path.holds ?? []).map((value, index) => (value > 0 ? `在第 ${index + 1} 个途经点停留 ${formatNumber(value)} 秒` : "")).filter(Boolean);
        return [
            `${name} 在 ${formatNumber(plan.start)}–${formatNumber(plan.end)} 秒沿${path.curve ? "平滑曲线" : "折线"}路径${law}移动，经过 ${path.points.length} 个途经点，从 (${formatNumber(first[0])}, ${formatNumber(first[2])}) 到 (${formatNumber(last[0])}, ${formatNumber(last[2])})，全长约 ${formatNumber(plan.length)} 米`,
            top > 0.05 ? `离地高度在 ${formatNumber(Math.min(...path.points.map((point) => point[1])))}–${formatNumber(top)} 米之间变化` : "",
            ...holds,
        ]
            .filter(Boolean)
            .join("，");
    };
    const lines = [...objects.filter((object) => object.motionPath).map((object) => describe(object.name, object.motionPath!)), camera?.motionPath ? describe(`摄影机${camera.name}`, camera.motionPath) : ""].filter(Boolean);
    return lines.length ? `路径运动：${lines.join("；")}。速度变化、停顿与高度起伏与预演一致。` : "";
}

function assetReferencePrompt(scene: PrevisScene) {
    const assets = scene.objects.filter((object) => object.visible && (object.sourceNodeId || object.assetId));
    if (!assets.length) return "";
    return `资产引用：${assets.map((object) => `${object.name}${object.sourceNodeId ? `（画布图片节点 ${object.sourceNodeId}）` : `（3D 素材 ${object.assetId}）`}`).join("；")}。生成时优先参考这些已绑定资产，并保持其主体身份、构图关系和空间方向。`;
}

function cameraPrompt(camera: PrevisCamera) {
    const [x, y, z] = camera.transform.position;
    const [tx, ty, tz] = camera.target;
    const height = y < ty - 0.4 ? "低机位" : y > ty + 1.2 ? "高机位" : "平视机位";
    const side = x < tx - 0.8 ? "主体左前侧" : x > tx + 0.8 ? "主体右前侧" : "主体正面";
    const distance = Math.hypot(x - tx, y - ty, z - tz);
    return `摄影机：${formatNumber(camera.focalLength)}mm 焦段，f/${formatNumber(camera.aperture)} 光圈，焦点距离 ${formatNumber(camera.focusDistance)} 米，${height}，位于${side}，机位距离约 ${formatNumber(distance)} 米，焦点指向 (${formatNumber(tx)}, ${formatNumber(ty)}, ${formatNumber(tz)})，景深遵循真实镜头光学。`;
}

function objectPrompt(object: PrevisObject) {
    const [x, y, z] = object.transform.position;
    const pose = object.pose ? `，姿势${previsPoseLabel(object.pose)}` : "";
    const archetype = object.kind === "actor" || object.primitive === "character" ? `，角色原型${previsActorArchetypeLabel(object.archetype)}` : "";
    const color = object.kind === "actor" || object.primitive === "character" ? `，${previsColorLabel(object.color)}参考色` : "";
    const catalog = object.kind === "prop" ? resolvePrevisCatalogProp(object.propId) : undefined;
    const kindLabel = catalog && catalog.name !== object.name ? `（${catalog.name}）` : "";
    return `${object.name}${kindLabel}${archetype}${color}位于 (${formatNumber(x)}, ${formatNumber(y)}, ${formatNumber(z)})${pose}`;
}

function formatNumber(value: number) {
    return Number(value.toFixed(2));
}
