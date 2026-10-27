export type PrevisVec3 = [number, number, number];
export type PrevisQuat = [number, number, number, number];

export type PrevisActorArchetype = "adult" | "child" | "elderly" | "man" | "woman" | "monster";
export type PrevisActorAccessory = "none" | "cane" | "horns" | "crown";
export type PrevisActorProfile = {
    height: number;
    headRatio: number;
    shoulderWidth: number;
    torsoRatio: number;
    accessory: PrevisActorAccessory;
};
export type PrevisTransform = {
    position: PrevisVec3;
    rotation: PrevisVec3;
    scale: PrevisVec3;
};

export type PrevisPrimitiveKind = "box" | "sphere" | "cylinder" | "plane" | "character";
/** prop = 程序化道具目录里的单个道具；layout = 按模板和种子展开的整片布景（街区、城镇、园林）。 */
export type PrevisObjectKind = "primitive" | "model" | "actor" | "billboard" | "prop" | "layout";

export type PrevisWeather = "clear" | "cloudy" | "overcast" | "rain" | "storm" | "snow" | "fog";
export type PrevisGroundType = "grass" | "forest" | "sand" | "redsoil" | "snow" | "water" | "city" | "warm" | "white" | "gray";
export type PrevisGroundSize = 1000 | 2000 | 4000;

/** 世界环境：天空、太阳、天气、地表。存在时取代纯色背景和 120m 灰地面。 */
export type PrevisWorld = {
    /** 0–24 小时，决定太阳方位与天色。 */
    timeOfDay: number;
    weather: PrevisWeather;
    ground: PrevisGroundType;
    /** 地面边长（米）。 */
    groundSize: PrevisGroundSize;
    /** 远景山体；关闭时只保留平地。 */
    horizon: boolean;
};

/** 参数化道具的取值：数值（层数、长度）或枚举（风格、屋顶、铺装）。定义见 previs-prop-catalog.ts。 */
export type PrevisPropParams = Record<string, number | string>;

export type PrevisLayoutTemplate = "ancient_city" | "ancient_street" | "modern_city" | "modern_street" | "village" | "garden" | "forest";

/** 程序化布景参数。对象位置是布景中心，size 为边长（米）。同一组参数永远展开出同一片布景。 */
export type PrevisLayout = {
    template: PrevisLayoutTemplate;
    seed: number;
    size: number;
    /** 0.2–1，建筑和植物的密度。 */
    density: number;
    /** 是否生成路人。 */
    crowd: boolean;
    /** 已拆出为独立对象（或删除）的实例序号；模板、种子、范围、密度变化后序号失效并清空。 */
    removed?: number[];
};
export type PrevisPose = "neutral" | "stand" | "t_pose" | "walk" | "run" | "sit" | "squat" | "kneel_single" | "kneel_double" | "hands_hips" | "lean" | "bow" | "think" | "fight" | "kick" | "throw" | "push" | "wave" | "reach" | "arms_crossed" | "phone";
export type PrevisCameraMove = "static" | "push_in" | "pull_out" | "pan_left" | "pan_right" | "tilt_up" | "tilt_down" | "orbit_left" | "orbit_right" | "handheld";
export type PrevisShotSize = "extreme_wide" | "wide" | "full" | "medium" | "close_up" | "extreme_close_up";
export type PrevisAspectRatio = "9:16" | "16:9" | "2.39:1";
export type PrevisRenderMode = "beauty" | "clay" | "depth" | "normal" | "pose";
export type PrevisKeyframeEasing = "step" | "linear" | "smooth";

/** 标准人偶的程序化动作片段 ID；定义见 lib/canvas/previs/previs-motion-library.ts。 */
export type PrevisMotionId = "idle" | "walk" | "run" | "talk" | "wave" | "nod" | "shake_head" | "look_around" | "point" | "phone_call" | "sit_idle" | "clap" | "fight_idle" | "punch" | "jump" | "fall" | "cry" | "cheer" | "slap" | "hold_hand" | "hit_react";

/** 演员时间轴上的一段动作：从 start 开始播放 duration 秒，前后各有短混合。 */
export type PrevisActorMotion = {
    id: string;
    motion: PrevisMotionId;
    start: number;
    duration: number;
    /** 动作幅度，1 为标准。 */
    intensity?: number;
};
/** 位移方式：走/跑/冲刺由步态表达；飞行、御剑、悬浮、跳跃叠加离地高度与专属姿态；闪现瞬移到终点。 */
export type PrevisTravelStyle = "walk" | "run" | "dash" | "jump" | "fly" | "sword_fly" | "float" | "teleport";

/** 演员的一段 A→B 位移：位置由 transform 关键帧表达（始终贴地），这里只描述姿态与离地高度。 */
export type PrevisActorTravel = {
    id: string;
    start: number;
    duration: number;
    style: PrevisTravelStyle;
    /** 飞行类的巡航离地高度（米）。 */
    height?: number;
};

/** 用户在视口里右键标记的坐标点（A、B、C…），Agent 可按标签引用。 */
export type PrevisMarker = {
    id: string;
    label: string;
    position: PrevisVec3;
};

export type PrevisMotionPath = {
    points: PrevisVec3[];
    speed: "slow" | "walk" | "run";
    startDelay: number;
    orientToPath: boolean;
};

export type PrevisKeyframe = {
    id: string;
    time: number;
    transform: PrevisTransform;
    easing?: PrevisKeyframeEasing;
};

export type PrevisFingerBone =
    | "leftThumb1"
    | "leftThumb2"
    | "leftThumb3"
    | "leftIndex1"
    | "leftIndex2"
    | "leftIndex3"
    | "leftMiddle1"
    | "leftMiddle2"
    | "leftMiddle3"
    | "leftRing1"
    | "leftRing2"
    | "leftRing3"
    | "leftPinky1"
    | "leftPinky2"
    | "leftPinky3"
    | "rightThumb1"
    | "rightThumb2"
    | "rightThumb3"
    | "rightIndex1"
    | "rightIndex2"
    | "rightIndex3"
    | "rightMiddle1"
    | "rightMiddle2"
    | "rightMiddle3"
    | "rightRing1"
    | "rightRing2"
    | "rightRing3"
    | "rightPinky1"
    | "rightPinky2"
    | "rightPinky3";

export type PrevisHumanoidBone =
    | "root"
    | "hips"
    | "spine"
    | "chest"
    | "neck"
    | "head"
    | "leftShoulder"
    | "leftUpperArm"
    | "leftLowerArm"
    | "leftHand"
    | "rightShoulder"
    | "rightUpperArm"
    | "rightLowerArm"
    | "rightHand"
    | "leftUpperLeg"
    | "leftLowerLeg"
    | "leftFoot"
    | "rightUpperLeg"
    | "rightLowerLeg"
    | "rightFoot"
    | PrevisFingerBone;

export type PrevisBoneKeyframe = {
    id: string;
    time: number;
    rotation: PrevisQuat;
    easing?: PrevisKeyframeEasing;
};

export type PrevisBoneTrack = {
    bone: PrevisHumanoidBone;
    keyframes: PrevisBoneKeyframe[];
};

/**
 * 时间轴上一个可删除关键帧的定位信息。
 * 三类覆盖当前时间轴真正可见的关键帧轨道：对象 transform、对象骨骼、摄影机。
 */
export type PrevisKeyframeDeleteTarget =
    { track: "object-transform"; objectId: string; keyframeId: string } | { track: "object-bone"; objectId: string; bone: PrevisHumanoidBone; keyframeId: string } | { track: "camera"; cameraId: string; keyframeId: string };

export type PrevisRig = {
    status: "unmapped" | "ready";
    boneMap: Partial<Record<PrevisHumanoidBone, string>>;
    animationNames: string[];
};

export type PrevisMotionClip = {
    id: string;
    name: string;
    sourceAnimation: string;
    start: number;
    duration: number;
    playbackRate: number;
    loop: boolean;
};

export type PrevisCharacterBinding = {
    characterAssetId: string;
    characterVersionId: string;
    referenceNodeId: string;
    characterName?: string;
};

export type PrevisObject = {
    id: string;
    name: string;
    kind: PrevisObjectKind;
    primitive?: PrevisPrimitiveKind;
    transform: PrevisTransform;
    color: string;
    visible: boolean;
    castShadow: boolean;
    receiveShadow: boolean;
    pose?: PrevisPose;
    archetype?: PrevisActorArchetype;
    actorProfile?: PrevisActorProfile;
    rig?: PrevisRig;
    motionClips?: PrevisMotionClip[];
    activeMotionClipId?: string;
    characterBinding?: PrevisCharacterBinding;
    boneOverrides?: Partial<Record<PrevisHumanoidBone, PrevisQuat>>;
    boneTracks?: PrevisBoneTrack[];
    sourceNodeId?: string;
    assetId?: string;
    storageKey?: string;
    url?: string;
    mimeType?: string;
    keyframes: PrevisKeyframe[];
    motionPath?: PrevisMotionPath;
    /** kind=prop 时的程序化道具目录 ID；见 previs-prop-catalog.ts。 */
    propId?: string;
    /** kind=prop 时的造型变体种子，同一道具不同变体的高度、层数、配色略有差异。 */
    variant?: number;
    /** kind=prop 时的组件参数（层数、宽深、材质…），只对带参数定义的道具生效。 */
    params?: PrevisPropParams;
    /** kind=layout 时的布景参数。 */
    layout?: PrevisLayout;
    /** 程序化布景生成的对象共享同一个 setId，便于整体选择与删除。 */
    setId?: string;
    /** 标准人偶动作片段；移动时步态由位移速度自动推导，不需要写入。 */
    motions?: PrevisActorMotion[];
    /** A→B 位移段（飞行、御剑、闪现等），与 transform 关键帧配合。 */
    travels?: PrevisActorTravel[];
};

export type PrevisCamera = {
    id: string;
    name: string;
    transform: PrevisTransform;
    target: PrevisVec3;
    focalLength: number;
    fov: number;
    aperture: number;
    focusDistance: number;
    near: number;
    far: number;
    keyframes: PrevisKeyframe[];
    motionPath?: PrevisMotionPath;
};

export type PrevisLight = {
    id: string;
    name: string;
    type: "directional" | "point" | "spot" | "ambient";
    transform: PrevisTransform;
    color: string;
    intensity: number;
    angle?: number;
    penumbra?: number;
    castShadow: boolean;
};

export type PrevisShot = {
    id: string;
    name: string;
    cameraId: string;
    duration: number;
    fps: 24 | 25 | 30;
    aspectRatio?: PrevisAspectRatio;
    shotSize: PrevisShotSize;
    cameraMove: PrevisCameraMove;
    prompt: string;
    previewNodeId?: string;
    depthNodeId?: string;
    normalNodeId?: string;
};

export type PrevisEnvironment = {
    mode: "color" | "panorama";
    url?: string;
    storageKey?: string;
    sourceNodeId?: string;
    rotationY?: number;
    opacity?: number;
    exposure?: number;
    useAsLighting?: boolean;
    lightingIntensity?: number;
};

export type PrevisScene = {
    id: string;
    version: 1;
    title: string;
    background: string;
    environmentIntensity: number;
    environment?: PrevisEnvironment;
    world?: PrevisWorld;
    /** 右键标记的坐标点。 */
    markers?: PrevisMarker[];
    gridVisible: boolean;
    objects: PrevisObject[];
    cameras: PrevisCamera[];
    lights: PrevisLight[];
    shots: PrevisShot[];
    activeShotId: string;
    createdAt: string;
    updatedAt: string;
};

export type PrevisSceneOutput = {
    scene: PrevisScene;
    shot: PrevisShot;
    prompt: string;
    beauty: Blob;
    depth?: Blob;
    normal?: Blob;
    pose?: Blob;
    clayVideo?: Blob;
    clayVideoMimeType?: string;
    depthVideo?: Blob;
};
