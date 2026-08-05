export type DirectorVec3 = [number, number, number];
export type DirectorQuat = [number, number, number, number];

export type DirectorTransform = {
    position: DirectorVec3;
    rotation: DirectorVec3;
    scale: DirectorVec3;
};

export type DirectorPrimitiveKind = "box" | "sphere" | "cylinder" | "plane" | "character";
export type DirectorObjectKind = "primitive" | "model" | "actor" | "billboard";
export type DirectorPose = "neutral" | "stand" | "t_pose" | "walk" | "run" | "sit" | "squat" | "kneel_single" | "kneel_double" | "hands_hips" | "lean" | "bow" | "think" | "fight" | "kick" | "throw" | "push" | "wave" | "reach" | "arms_crossed" | "phone";
export type DirectorCameraMove = "static" | "push_in" | "pull_out" | "pan_left" | "pan_right" | "tilt_up" | "tilt_down" | "orbit_left" | "orbit_right" | "handheld";
export type DirectorShotSize = "extreme_wide" | "wide" | "full" | "medium" | "close_up" | "extreme_close_up";
export type DirectorRenderMode = "beauty" | "clay" | "depth" | "normal" | "pose";

export type DirectorKeyframe = {
    id: string;
    time: number;
    transform: DirectorTransform;
    easing?: "step" | "linear" | "smooth";
};

export type DirectorHumanoidBone = "root" | "hips" | "spine" | "chest" | "neck" | "head" | "leftShoulder" | "leftUpperArm" | "leftLowerArm" | "leftHand" | "rightShoulder" | "rightUpperArm" | "rightLowerArm" | "rightHand" | "leftUpperLeg" | "leftLowerLeg" | "leftFoot" | "rightUpperLeg" | "rightLowerLeg" | "rightFoot";

export type DirectorBoneKeyframe = {
    id: string;
    time: number;
    rotation: DirectorQuat;
    easing?: "step" | "linear" | "smooth";
};

export type DirectorBoneTrack = {
    bone: DirectorHumanoidBone;
    keyframes: DirectorBoneKeyframe[];
};

export type DirectorRig = {
    status: "unmapped" | "ready";
    boneMap: Partial<Record<DirectorHumanoidBone, string>>;
    animationNames: string[];
};

export type DirectorMotionClip = {
    id: string;
    name: string;
    sourceAnimation: string;
    start: number;
    duration: number;
    playbackRate: number;
    loop: boolean;
};

export type DirectorObject = {
    id: string;
    name: string;
    kind: DirectorObjectKind;
    primitive?: DirectorPrimitiveKind;
    transform: DirectorTransform;
    color: string;
    visible: boolean;
    castShadow: boolean;
    receiveShadow: boolean;
    pose?: DirectorPose;
    rig?: DirectorRig;
    motionClips?: DirectorMotionClip[];
    activeMotionClipId?: string;
    boneOverrides?: Partial<Record<DirectorHumanoidBone, DirectorQuat>>;
    boneTracks?: DirectorBoneTrack[];
    sourceNodeId?: string;
    assetId?: string;
    storageKey?: string;
    url?: string;
    mimeType?: string;
    keyframes: DirectorKeyframe[];
};

export type DirectorCamera = {
    id: string;
    name: string;
    transform: DirectorTransform;
    target: DirectorVec3;
    focalLength: number;
    fov: number;
    aperture: number;
    focusDistance: number;
    near: number;
    far: number;
    keyframes: DirectorKeyframe[];
};

export type DirectorLight = {
    id: string;
    name: string;
    type: "directional" | "point" | "spot" | "ambient";
    transform: DirectorTransform;
    color: string;
    intensity: number;
    angle?: number;
    penumbra?: number;
    castShadow: boolean;
};

export type DirectorShot = {
    id: string;
    name: string;
    cameraId: string;
    duration: number;
    fps: 24 | 25 | 30;
    shotSize: DirectorShotSize;
    cameraMove: DirectorCameraMove;
    prompt: string;
    previewNodeId?: string;
    depthNodeId?: string;
    normalNodeId?: string;
};

export type DirectorScene = {
    id: string;
    version: 1;
    title: string;
    background: string;
    environmentIntensity: number;
    gridVisible: boolean;
    objects: DirectorObject[];
    cameras: DirectorCamera[];
    lights: DirectorLight[];
    shots: DirectorShot[];
    activeShotId: string;
    createdAt: string;
    updatedAt: string;
};

export type DirectorSceneOutput = {
    scene: DirectorScene;
    shot: DirectorShot;
    prompt: string;
    beauty: Blob;
    depth?: Blob;
    normal?: Blob;
    clayVideo?: Blob;
    clayVideoMimeType?: string;
};
