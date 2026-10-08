import type { PrevisCamera, PrevisEnvironment, PrevisObject, PrevisScene, PrevisShot } from "@/types/previs";
import { previsActorArchetypeLabel, previsColorLabel, previsPoseLabel } from "@/lib/canvas/previs/previs-scene";

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
    return [
        shot.prompt.trim(),
        `镜头设计：${shotSizeLabels[shot.shotSize]}，${cameraMoveLabels[shot.cameraMove]}，时长 ${formatNumber(shot.duration)} 秒。`,
        camera ? cameraPrompt(camera) : "",
        environmentPrompt(scene.environment),
        actors.length ? `角色原型与颜色映射：${actors.map((actor) => `${previsActorArchetypeLabel(actor.archetype)}${actor.name}（${actor.color}）`).join("；")}。生成视频时保持每个角色的体型、轮廓和身份稳定。` : "",
        visibleObjects.length ? `空间调度：${visibleObjects.map(objectPrompt).join("；")}。` : "",
        assetReferencePrompt(scene),
        `灯光：${scene.lights.map((light) => `${light.name}${formatNumber(light.intensity)}强度${light.color}`).join("，")}。`,
        "保持角色、道具、空间方向、光线方向和镜头轴线连续，遵循真实摄影机透视与物理遮挡。",
    ]
        .filter(Boolean)
        .join("\n");
}

function environmentPrompt(environment?: PrevisEnvironment) {
    if (!environment || environment.mode !== "panorama" || !environment.url) return "背景环境：使用工作台灰色预览背景。";
    return `背景环境：使用已绑定的 360° 全景图作为空间背景，保持全景图的水平朝向与镜头旋转连续；白膜角色只参考站位、比例、动作和遮挡，不把全景图拉伸成普通平面。`;
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
    return `${object.name}${archetype}${color}位于 (${formatNumber(x)}, ${formatNumber(y)}, ${formatNumber(z)})${pose}`;
}

function formatNumber(value: number) {
    return Number(value.toFixed(2));
}
