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
export type PrevisObjectKind = "primitive" | "model" | "actor" | "billboard" | "prop";
export type PrevisPose = "neutral" | "stand" | "t_pose" | "walk" | "run" | "sit" | "squat" | "kneel_single" | "kneel_double" | "hands_hips" | "lean" | "bow" | "think" | "fight" | "kick" | "throw" | "push" | "wave" | "reach" | "arms_crossed" | "phone";
export type PrevisCameraMove = "static" | "push_in" | "pull_out" | "pan_left" | "pan_right" | "tilt_up" | "tilt_down" | "orbit_left" | "orbit_right" | "handheld";
export type PrevisShotSize = "extreme_wide" | "wide" | "full" | "medium" | "close_up" | "extreme_close_up";
/** auto = 自适应：取景与输出跟随当前视口宽高比。 */
export type PrevisAspectRatio = "auto" | "2.39:1" | "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
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
    /** 程序化布景生成的对象共享同一个 setId，便于整体选择与删除。 */
    setId?: string;
    /** 标准人偶动作片段；移动时步态由位移速度自动推导，不需要写入。 */
    motions?: PrevisActorMotion[];
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
    gridVisible: boolean;
    objects: PrevisObject[];
    cameras: PrevisCamera[];
    lights: PrevisLight[];
    shots: PrevisShot[];
    activeShotId: string;
    createdAt: string;
    updatedAt: string;
};

export type PrevisCanvasExport = {
    sceneId: string;
    shotId: string;
    title: string;
    prompt: string;
} & ({ kind: "prompt" } | { kind: "screenshot"; image: Blob; renderMode: PrevisRenderMode; timecode: string; duration: number });

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
