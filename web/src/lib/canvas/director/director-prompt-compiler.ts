import type { DirectorCamera, DirectorObject, DirectorScene, DirectorShot } from "@/types/director";

const shotSizeLabels: Record<DirectorShot["shotSize"], string> = {
    extreme_wide: "大远景",
    wide: "远景",
    full: "全身景",
    medium: "中景",
    close_up: "近景特写",
    extreme_close_up: "大特写",
};

const cameraMoveLabels: Record<DirectorShot["cameraMove"], string> = {
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

export function compileDirectorPrompt(scene: DirectorScene, shot: DirectorShot) {
    const camera = scene.cameras.find((item) => item.id === shot.cameraId) || scene.cameras[0];
    const visibleObjects = scene.objects.filter((item) => item.visible);
    return [
        shot.prompt.trim(),
        `镜头设计：${shotSizeLabels[shot.shotSize]}，${cameraMoveLabels[shot.cameraMove]}，时长 ${formatNumber(shot.duration)} 秒。`,
        camera ? cameraPrompt(camera) : "",
        visibleObjects.length ? `空间调度：${visibleObjects.map(objectPrompt).join("；")}。` : "",
        `灯光：${scene.lights.map((light) => `${light.name}${formatNumber(light.intensity)}强度${light.color}`).join("，")}。`,
        "保持角色、道具、空间方向、光线方向和镜头轴线连续，遵循真实摄影机透视与物理遮挡。",
    ]
        .filter(Boolean)
        .join("\n");
}

function cameraPrompt(camera: DirectorCamera) {
    const [x, y, z] = camera.transform.position;
    const [tx, ty, tz] = camera.target;
    const height = y < ty - 0.4 ? "低机位" : y > ty + 1.2 ? "高机位" : "平视机位";
    const side = x < tx - 0.8 ? "主体左前侧" : x > tx + 0.8 ? "主体右前侧" : "主体正面";
    const distance = Math.hypot(x - tx, y - ty, z - tz);
    return `摄影机：${formatNumber(camera.focalLength)}mm 焦段，f/${formatNumber(camera.aperture)} 光圈，焦点距离 ${formatNumber(camera.focusDistance)} 米，${height}，位于${side}，机位距离约 ${formatNumber(distance)} 米，焦点指向 (${formatNumber(tx)}, ${formatNumber(ty)}, ${formatNumber(tz)})，景深遵循真实镜头光学。`;
}

function objectPrompt(object: DirectorObject) {
    const [x, y, z] = object.transform.position;
    const pose = object.pose ? `，姿势${poseLabel(object.pose)}` : "";
    return `${object.name}位于 (${formatNumber(x)}, ${formatNumber(y)}, ${formatNumber(z)})${pose}`;
}

function poseLabel(pose: NonNullable<DirectorObject["pose"]>) {
    return { neutral: "自然", stand: "站立", walk: "行走", run: "奔跑", sit: "坐姿", action: "动作姿态" }[pose];
}

function formatNumber(value: number) {
    return Number(value.toFixed(2));
}
