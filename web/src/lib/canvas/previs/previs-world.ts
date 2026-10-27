import { Color, Vector3 } from "three";

import type { PrevisGroundSize, PrevisGroundType, PrevisWeather, PrevisWorld } from "@/types/previs";

/** 世界模式下相机远裁剪面：4km 地面 + 远山 + 天空盒都要在视锥内。 */
export const PREVIS_WORLD_CAMERA_FAR = 12000;

export const PREVIS_DEFAULT_WORLD: PrevisWorld = { timeOfDay: 10, weather: "clear", ground: "grass", groundSize: 1000, horizon: true };

export const PREVIS_WEATHER_OPTIONS: Array<{ value: PrevisWeather; label: string }> = [
    { value: "clear", label: "晴" },
    { value: "cloudy", label: "多云" },
    { value: "overcast", label: "阴" },
    { value: "rain", label: "雨" },
    { value: "storm", label: "雷雨" },
    { value: "snow", label: "雪" },
    { value: "fog", label: "雾" },
];

export const PREVIS_GROUND_OPTIONS: Array<{ value: PrevisGroundType; label: string; near: string; far: string }> = [
    { value: "grass", label: "草地", near: "#a9b98f", far: "#7f9a63" },
    { value: "forest", label: "林地", near: "#93a37c", far: "#4f6e45" },
    { value: "sand", label: "沙地", near: "#ddcfae", far: "#d2b98a" },
    { value: "redsoil", label: "红土", near: "#c9a184", far: "#a8694c" },
    { value: "snow", label: "雪地", near: "#eef1f4", far: "#dfe5ec" },
    { value: "water", label: "水面", near: "#c7c3b8", far: "#6f97b3" },
    { value: "city", label: "城市", near: "#b9bcc0", far: "#9aa0a7" },
    { value: "warm", label: "暖白", near: "#ede4d6", far: "#e2d6c4" },
    { value: "white", label: "纯白", near: "#f4f4f2", far: "#ececea" },
    { value: "gray", label: "浅灰", near: "#c6cacf", far: "#b3b8be" },
];

export const PREVIS_GROUND_SIZES: Array<{ value: PrevisGroundSize; label: string }> = [
    { value: 1000, label: "1 km" },
    { value: 2000, label: "2 km" },
    { value: 4000, label: "4 km" },
];

export const PREVIS_TIME_PRESETS = [
    { label: "清晨", value: 6.5 },
    { label: "正午", value: 12 },
    { label: "午后", value: 15.5 },
    { label: "黄昏", value: 18.2 },
    { label: "夜晚", value: 21.5 },
];

const WEATHERS = new Set(PREVIS_WEATHER_OPTIONS.map((item) => item.value));
const GROUNDS = new Set(PREVIS_GROUND_OPTIONS.map((item) => item.value));

/** 读取旧数据或 Agent 写入的世界设置时做一次收敛，不合法字段回落默认值。 */
export function normalizePrevisWorld(value: unknown): PrevisWorld | undefined {
    if (!value || typeof value !== "object") return undefined;
    const raw = value as Partial<PrevisWorld>;
    const time = Number(raw.timeOfDay);
    return {
        timeOfDay: Number.isFinite(time) ? Math.min(24, Math.max(0, time)) : PREVIS_DEFAULT_WORLD.timeOfDay,
        weather: raw.weather && WEATHERS.has(raw.weather) ? raw.weather : PREVIS_DEFAULT_WORLD.weather,
        ground: raw.ground && GROUNDS.has(raw.ground) ? raw.ground : PREVIS_DEFAULT_WORLD.ground,
        groundSize: raw.groundSize === 2000 || raw.groundSize === 4000 ? raw.groundSize : 1000,
        horizon: raw.horizon !== false,
    };
}

export function formatPrevisTimeOfDay(hours: number) {
    const total = Math.round(hours * 60) % (24 * 60);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export type PrevisWorldLighting = {
    sunDirection: Vector3;
    /** 太阳高度角（弧度），负值为夜晚。 */
    elevation: number;
    sunColor: Color;
    sunIntensity: number;
    skyColor: Color;
    groundColor: Color;
    hemisphereIntensity: number;
    /** 雾色同时作为阴天/雨雪天的背景色，远山与天空无缝衔接。 */
    fogColor: Color;
    fogDensity: number;
    /** 晴天和多云用物理天空着色器，其余天气用纯色天幕。 */
    physicalSky: boolean;
    turbidity: number;
    rayleigh: number;
};

const WEATHER_PARAMS: Record<PrevisWeather, { sun: number; fog: number; tint: string; physical: boolean; turbidity: number }> = {
    clear: { sun: 1, fog: 0.00045, tint: "#c9dcef", physical: true, turbidity: 4 },
    cloudy: { sun: 0.72, fog: 0.0008, tint: "#d3dce6", physical: true, turbidity: 9 },
    overcast: { sun: 0.32, fog: 0.0016, tint: "#c3c9d0", physical: false, turbidity: 12 },
    rain: { sun: 0.22, fog: 0.003, tint: "#9da7b1", physical: false, turbidity: 14 },
    storm: { sun: 0.12, fog: 0.0042, tint: "#6f7a86", physical: false, turbidity: 18 },
    snow: { sun: 0.3, fog: 0.0034, tint: "#d5dbe2", physical: false, turbidity: 12 },
    fog: { sun: 0.18, fog: 0.012, tint: "#d0d4d8", physical: false, turbidity: 16 },
};

/**
 * 时间 → 太阳方位：6 点日出（东，+X），12 点最高（偏南 -Z 方向抬升 62°），18 点日落（西）。
 * 夜间保留弱月光，避免画面全黑看不清白膜。
 */
export function resolvePrevisWorldLighting(world: PrevisWorld): PrevisWorldLighting {
    const params = WEATHER_PARAMS[world.weather];
    const dayPhase = ((world.timeOfDay - 6) / 12) * Math.PI;
    const elevation = Math.sin(dayPhase) * ((62 * Math.PI) / 180);
    const azimuth = dayPhase;
    const sunDirection = new Vector3(Math.cos(azimuth), Math.sin(Math.max(elevation, 0.04)), -Math.sin(azimuth) * 0.55 - 0.35).normalize();
    const daylight = Math.max(0, Math.min(1, (elevation + 0.08) / 0.4));
    const golden = Math.max(0, 1 - Math.abs(elevation) / 0.32) * daylight;
    const sunColor = new Color("#fff4e2").lerp(new Color("#ffb46b"), golden * 0.85);
    const night = new Color("#2a3448");
    const tint = new Color(params.tint);
    const skyColor = night.clone().lerp(tint.clone().lerp(new Color("#ffd7b0"), golden * 0.4), daylight);
    const groundOption = PREVIS_GROUND_OPTIONS.find((item) => item.value === world.ground) ?? PREVIS_GROUND_OPTIONS[0];
    const groundColor = new Color(groundOption.near).multiplyScalar(0.55 + daylight * 0.35);
    const fogColor = night.clone().lerp(tint.clone().lerp(new Color("#f2c9a0"), golden * 0.35), daylight);
    return {
        sunDirection,
        elevation,
        sunColor: daylight > 0 ? sunColor : new Color("#9fb4d6"),
        sunIntensity: daylight > 0 ? (0.6 + daylight * 2.4) * params.sun : 0.25,
        skyColor,
        groundColor,
        hemisphereIntensity: 0.35 + daylight * 0.85 * (0.55 + (1 - params.sun) * 0.6),
        fogColor,
        fogDensity: params.fog * (1000 / Math.max(1000, world.groundSize)) ** 0.5,
        physicalSky: params.physical && elevation > -0.05,
        turbidity: params.turbidity,
        rayleigh: world.weather === "clear" ? 1.2 + golden * 1.6 : 2.4,
    };
}

export function resolvePrevisGroundColors(world: PrevisWorld) {
    const option = PREVIS_GROUND_OPTIONS.find((item) => item.value === world.ground) ?? PREVIS_GROUND_OPTIONS[0];
    // 下雪时近景地面积雪，远山也偏白。
    if (world.weather === "snow") return { near: new Color(option.near).lerp(new Color("#f3f5f7"), 0.75), far: new Color(option.far).lerp(new Color("#e9edf1"), 0.6), water: option.value === "water" };
    return { near: new Color(option.near), far: new Color(option.far), water: option.value === "water" };
}
