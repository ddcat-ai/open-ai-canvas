import { Bone, Color, ConeGeometry, CylinderGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, Object3D, Quaternion, TorusGeometry, Vector3, type BufferGeometry, type SkinnedMesh } from "three";
import { GLTFLoader, SkeletonUtils } from "three-stdlib";

import { previsActorProfileForArchetype } from "@/lib/canvas/previs/previs-scene";
import { PREVIS_MANNEQUIN_BONES, type PrevisEvaluatedPose, type PrevisMannequinBone } from "@/lib/canvas/previs/previs-motion";
import type { PrevisActorArchetype, PrevisActorProfile, PrevisRig } from "@/types/previs";

/**
 * 标准人偶：本地打包的 CC0 光滑人体（Quaternius Universal Animation Library 的 Mannequin，
 * 见 public/previs/LICENSE-mannequin.txt），蒙皮网格 + 53 根骨骼。
 *
 * 姿态体系不直接写 UAL 骨骼，而是两层：
 * 1. 规范骨架（proxy）：19 根 three Bone，名字就是 PrevisHumanoidBone；静置为自然站立（手臂下垂）、
 *    局部旋转全为单位四元数、面朝 +Z、左手 +X。previs-motion.ts 的姿势/动作/骨骼覆盖都写在这里，
 *    骨骼 gizmo 也挂在这里，所以存档里的 boneOverrides 与模型无关。
 * 2. 重定向：每次求值把规范骨架的世界旋转增量叠到 UAL 静置世界旋转上，再换算成 UAL 局部旋转。
 *    UAL 静置是 T-pose，手臂链额外乘一个「T-pose → 下垂」的校正旋转 C。
 *
 * 贴地：用挂在 UAL 骨骼上的接触点（脚尖、脚跟、膝、肘、手、头、臀）求最低点，整体抬落到 y=0。
 */
export const PREVIS_MANNEQUIN_URL = "/previs/mannequin.glb";
export const PREVIS_MANNEQUIN_HEIGHT = 1.83;

export type PrevisMannequin = {
    root: Group;
    /** 规范骨架（gizmo、检查器、存档语义）。 */
    bones: Record<PrevisMannequinBone, Bone>;
    /** 与规范骨骼对应的可见关节（UAL 蒙皮骨骼），用于摆放关节控制点。 */
    joints: Record<PrevisMannequinBone, Object3D>;
    rig: PrevisRig;
    applyPose: (pose: PrevisEvaluatedPose) => void;
    /** 规范骨架被 gizmo 直接旋转后调用：重定向并重新贴地。 */
    sync: () => void;
    setColor: (color: string, selected: boolean) => void;
    dispose: () => void;
};

type Profile = PrevisActorProfile;

/** 规范骨骼 → UAL 骨骼（three 会去掉节点名里的「.」）。 */
const UAL_BONE: Record<PrevisMannequinBone, string> = {
    hips: "DEF-hips",
    spine: "DEF-spine001",
    chest: "DEF-spine003",
    neck: "DEF-neck",
    head: "DEF-head",
    leftShoulder: "DEF-shoulderL",
    leftUpperArm: "DEF-upper_armL",
    leftLowerArm: "DEF-forearmL",
    leftHand: "DEF-handL",
    rightShoulder: "DEF-shoulderR",
    rightUpperArm: "DEF-upper_armR",
    rightLowerArm: "DEF-forearmR",
    rightHand: "DEF-handR",
    leftUpperLeg: "DEF-thighL",
    leftLowerLeg: "DEF-shinL",
    leftFoot: "DEF-footL",
    rightUpperLeg: "DEF-thighR",
    rightLowerLeg: "DEF-shinR",
    rightFoot: "DEF-footR",
};

const CANONICAL_PARENT: Record<PrevisMannequinBone, PrevisMannequinBone | null> = {
    hips: null,
    spine: "hips",
    chest: "spine",
    neck: "chest",
    head: "neck",
    leftShoulder: "chest",
    leftUpperArm: "leftShoulder",
    leftLowerArm: "leftUpperArm",
    leftHand: "leftLowerArm",
    rightShoulder: "chest",
    rightUpperArm: "rightShoulder",
    rightLowerArm: "rightUpperArm",
    rightHand: "rightLowerArm",
    leftUpperLeg: "hips",
    leftLowerLeg: "leftUpperLeg",
    leftFoot: "leftLowerLeg",
    rightUpperLeg: "hips",
    rightLowerLeg: "rightUpperLeg",
    rightFoot: "rightLowerLeg",
};

const Z_AXIS = new Vector3(0, 0, 1);
/** UAL T-pose 手臂沿 ±X，规范静置手臂下垂：左臂绕 Z 转 -90°，右臂 +90°。 */
const ARM_DOWN_LEFT = new Quaternion().setFromAxisAngle(Z_AXIS, -Math.PI / 2);
const ARM_DOWN_RIGHT = new Quaternion().setFromAxisAngle(Z_AXIS, Math.PI / 2);
function restCorrection(bone: PrevisMannequinBone) {
    if (bone === "leftUpperArm" || bone === "leftLowerArm" || bone === "leftHand") return ARM_DOWN_LEFT;
    if (bone === "rightUpperArm" || bone === "rightLowerArm" || bone === "rightHand") return ARM_DOWN_RIGHT;
    return null;
}

/** 接触点：UAL 静置空间（米）里的点 + 半径，构建时换算到骨骼局部。 */
const CONTACTS: Array<{ bone: string; point?: [number, number, number]; radius: number }> = [
    { bone: "DEF-toeL", point: [0.089, 0.015, 0.2], radius: 0.015 },
    { bone: "DEF-toeR", point: [-0.089, 0.015, 0.2], radius: 0.015 },
    { bone: "DEF-footL", point: [0.089, 0.03, -0.075], radius: 0.03 },
    { bone: "DEF-footR", point: [-0.089, 0.03, -0.075], radius: 0.03 },
    { bone: "DEF-shinL", point: [0.089, 0.532, 0.05], radius: 0.02 },
    { bone: "DEF-shinR", point: [-0.089, 0.532, 0.05], radius: 0.02 },
    { bone: "DEF-forearmL", radius: 0.045 },
    { bone: "DEF-forearmR", radius: 0.045 },
    { bone: "DEF-f_middle01L", radius: 0.03 },
    { bone: "DEF-f_middle01R", radius: 0.03 },
    { bone: "DEF-head", point: [0, 1.7, 0.01], radius: 0.13 },
    { bone: "DEF-hips", point: [0, 0.88, -0.06], radius: 0.12 },
    { bone: "DEF-spine003", radius: 0.13 },
];

/**
 * 演员是否走标准人偶：没有用户上传模型（url/assetId/storageKey）的演员，以及旧数据里的
 * primitive=character 与 CDN Xbot 默认地址，都统一渲染为标准人偶，保证模板、工作台、Agent 三条路径一致。
 */
const LEGACY_DEFAULT_ACTOR_URL = "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r185/examples/models/gltf/Xbot.glb";
export function isPrevisStandardActor(object: { kind: string; primitive?: string; url?: string; assetId?: string; storageKey?: string }) {
    const actor = object.kind === "actor" || object.primitive === "character";
    if (!actor) return false;
    if (object.assetId || object.storageKey) return false;
    return !object.url || object.url === LEGACY_DEFAULT_ACTOR_URL;
}

export function resolvePrevisMannequinProfile(archetype: PrevisActorArchetype = "adult", custom?: Partial<PrevisActorProfile>): Profile {
    const base = previsActorProfileForArchetype(archetype);
    const merged = { ...base, ...(custom || {}) };
    const clamp = (value: number, min: number, max: number, fallback: number) => (Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback);
    return {
        height: clamp(merged.height, 0.4, 1.6, base.height),
        headRatio: clamp(merged.headRatio, 0.6, 1.8, base.headRatio),
        shoulderWidth: clamp(merged.shoulderWidth, 0.5, 1.8, base.shoulderWidth),
        torsoRatio: clamp(merged.torsoRatio, 0.6, 1.5, base.torsoRatio),
        accessory: merged.accessory || "none",
    };
}

export function previsMannequinProfileKey(archetype: PrevisActorArchetype | undefined, profile: Profile) {
    return [archetype || "adult", profile.height, profile.headRatio, profile.shoulderWidth, profile.torsoRatio, profile.accessory].join("|");
}

/** 人偶站立时的身高与 XZ 半宽/半深（米），供包围盒、放置、取景使用。 */
export function previsMannequinExtents(profile: Profile) {
    const height = PREVIS_MANNEQUIN_HEIGHT * profile.height * (profile.accessory === "horns" ? 1.06 : 1);
    return { height, halfWidth: 0.3 * Math.max(0.8, profile.shoulderWidth) * profile.height, halfDepth: 0.2 * profile.height };
}

let templatePromise: Promise<Object3D> | null = null;
/** 模板只加载一次，每个演员用 SkeletonUtils.clone 得到独立骨架（几何体共享）。 */
export function loadPrevisMannequinTemplate(url = PREVIS_MANNEQUIN_URL): Promise<Object3D> {
    templatePromise ??= new GLTFLoader().loadAsync(url).then(
        (gltf) => gltf.scene,
        (error) => {
            templatePromise = null;
            throw error;
        },
    );
    return templatePromise;
}

export function buildPrevisMannequin(input: { template: Object3D; archetype?: PrevisActorArchetype; profile: Profile; color: string; castShadow: boolean; receiveShadow: boolean }): PrevisMannequin {
    const { profile } = input;
    const body = new MeshStandardMaterial({ color: input.color, roughness: 0.55, metalness: 0.02 });
    const joint = new MeshStandardMaterial({ color: new Color(input.color).multiplyScalar(0.7), roughness: 0.6, metalness: 0.02 });
    const prop = new MeshStandardMaterial({ color: "#5d4639", roughness: 0.9 });
    const materials = [body, joint, prop];
    const ownGeometries: BufferGeometry[] = [];

    const root = new Group();
    root.name = "previs-mannequin";
    // 身高缩放放在 scaler 上，root 只负责贴地偏移。
    const scaler = new Group();
    scaler.scale.setScalar(profile.height);
    root.add(scaler);
    const model = SkeletonUtils.clone(input.template);
    scaler.add(model);

    model.traverse((child) => {
        const mesh = child as SkinnedMesh;
        if (!mesh.isMesh) return;
        const name = Array.isArray(mesh.material) ? "" : mesh.material.name;
        mesh.material = name === "M_Joints" ? joint : body;
        mesh.castShadow = input.castShadow;
        mesh.receiveShadow = input.receiveShadow;
        // 蒙皮后的包围体随姿态变化，静置包围盒不可靠。
        mesh.frustumCulled = false;
        mesh.userData.previsActor = true;
    });

    const ual = (name: string) => {
        const found = model.getObjectByName(name);
        if (!found) throw new Error(`标准人偶缺少骨骼 ${name}`);
        return found;
    };

    // 体型：只改骨骼位置/缩放，旋转保持静置，重定向不受影响。
    const female = input.archetype === "woman";
    for (const side of ["L", "R"]) {
        ual(`DEF-upper_arm${side}`).position.multiplyScalar(profile.shoulderWidth);
        if (female) ual(`DEF-thigh${side}`).position.x *= 1.1;
    }
    ual("DEF-spine002").position.multiplyScalar(profile.torsoRatio);
    ual("DEF-spine003").position.multiplyScalar(profile.torsoRatio);
    ual("DEF-head").scale.setScalar(profile.headRatio);

    // 静置世界姿态（相对 model）：所有骨骼的旋转与位置。
    model.updateMatrixWorld(true);
    const toModel = model.matrixWorld.clone().invert();
    const restWorldQuat = new Map<Object3D, Quaternion>();
    const restWorldPos = new Map<Object3D, Vector3>();
    const tmpMatrix = new Matrix4();
    const tmpPos = new Vector3();
    const tmpScale = new Vector3();
    model.traverse((child) => {
        const quat = new Quaternion();
        tmpMatrix.multiplyMatrices(toModel, child.matrixWorld).decompose(tmpPos, quat, tmpScale);
        restWorldQuat.set(child, quat);
        restWorldPos.set(child, tmpPos.clone());
    });

    const joints = {} as Record<PrevisMannequinBone, Object3D>;
    const canonicalOf = new Map<Object3D, PrevisMannequinBone>();
    for (const bone of PREVIS_MANNEQUIN_BONES) {
        joints[bone] = ual(UAL_BONE[bone]);
        canonicalOf.set(joints[bone], bone);
    }

    // UAL 骨骼按层级顺序排列；每根骨骼跟随自己或最近的已映射祖先。
    const skeletonRoot = ual("root");
    const ordered: Array<{ node: Object3D; follow: PrevisMannequinBone | null; rest: Quaternion }> = [];
    skeletonRoot.traverse((child) => {
        let follow: PrevisMannequinBone | null = null;
        for (let current: Object3D | null = child; current && current !== model; current = current.parent) {
            const mapped = canonicalOf.get(current);
            if (mapped) {
                follow = mapped;
                break;
            }
        }
        ordered.push({ node: child, follow, rest: restWorldQuat.get(child)! });
    });

    // 规范骨架：位置取 UAL 静置关节，手臂链按校正旋转摆成下垂。
    const bones = {} as Record<PrevisMannequinBone, Bone>;
    const proxyRoot = new Group();
    proxyRoot.name = "previs-mannequin-proxy";
    proxyRoot.userData.previsCaptureExclude = true;
    scaler.add(proxyRoot);
    for (const bone of PREVIS_MANNEQUIN_BONES) {
        const item = new Bone();
        item.name = bone;
        const parent = CANONICAL_PARENT[bone];
        const position = restWorldPos.get(joints[bone])!.clone();
        if (parent) {
            position.sub(restWorldPos.get(joints[parent])!);
            const correction = restCorrection(parent);
            if (correction) position.applyQuaternion(correction);
        }
        item.position.copy(position);
        (parent ? bones[parent] : proxyRoot).add(item);
        bones[bone] = item;
    }

    // 接触点：静置空间里的点换算成骨骼局部，跟随蒙皮骨骼运动。
    const contacts: Array<{ marker: Object3D; radius: number }> = [];
    for (const contact of CONTACTS) {
        const owner = ual(contact.bone);
        const marker = new Object3D();
        const point = contact.point ? new Vector3(...contact.point) : restWorldPos.get(owner)!.clone();
        marker.position.copy(owner.worldToLocal(point.applyMatrix4(model.matrixWorld)));
        owner.add(marker);
        contacts.push({ marker, radius: contact.radius });
    }

    // 配件挂在骨骼上，但抵消骨骼静置朝向，让配件按人偶坐标系摆放。
    const attach = (boneName: string) => {
        const owner = ual(boneName);
        const group = new Group();
        group.quaternion.copy(restWorldQuat.get(owner)!).invert();
        const offset = restWorldPos.get(owner)!;
        group.position.copy(owner.worldToLocal(offset.clone().applyMatrix4(model.matrixWorld)));
        // 组的原点放在骨骼原点，子物体用相对骨骼原点的人偶坐标。
        group.position.set(0, 0, 0);
        owner.add(group);
        return group;
    };
    const accessoryMesh = (parent: Object3D, geometry: BufferGeometry, material: MeshStandardMaterial, position: [number, number, number], rotation?: [number, number, number]) => {
        ownGeometries.push(geometry);
        const item = new Mesh(geometry, material);
        item.position.set(...position);
        if (rotation) item.rotation.set(...rotation);
        item.castShadow = input.castShadow;
        item.userData.previsActor = true;
        parent.add(item);
    };
    if (profile.accessory === "horns") {
        const head = attach("DEF-head");
        accessoryMesh(head, new ConeGeometry(0.035, 0.15, 12), joint, [0.075, 0.2, 0.02], [0, 0, -0.45]);
        accessoryMesh(head, new ConeGeometry(0.035, 0.15, 12), joint, [-0.075, 0.2, 0.02], [0, 0, 0.45]);
    } else if (profile.accessory === "crown") {
        const head = attach("DEF-head");
        accessoryMesh(head, new CylinderGeometry(0.08, 0.085, 0.06, 12, 1, true), prop, [0, 0.24, 0]);
    } else if (profile.accessory === "cane") {
        const hand = attach("DEF-handR");
        accessoryMesh(hand, new CylinderGeometry(0.014, 0.014, 0.86, 8), prop, [-0.08, -0.43, 0.02]);
        accessoryMesh(hand, new TorusGeometry(0.04, 0.013, 6, 12, Math.PI), prop, [-0.08, 0.0, 0.02], [0, Math.PI / 2, 0]);
    }

    const rig: PrevisRig = { status: "ready", boneMap: Object.fromEntries(PREVIS_MANNEQUIN_BONES.map((name) => [name, name])), animationNames: [] };
    const canonicalWorld = new Map<PrevisMannequinBone, Quaternion>(PREVIS_MANNEQUIN_BONES.map((bone) => [bone, new Quaternion()]));
    const posedWorld = new Map<Object3D, Quaternion>();
    const desired = new Quaternion();
    const parentInverse = new Quaternion();
    const contactPoint = new Vector3();
    let lift = 0;
    let worldLift = 0;

    const sync = () => {
        for (const bone of PREVIS_MANNEQUIN_BONES) {
            const parent = CANONICAL_PARENT[bone];
            const world = canonicalWorld.get(bone)!;
            if (parent) world.multiplyQuaternions(canonicalWorld.get(parent)!, bones[bone].quaternion);
            else world.copy(bones[bone].quaternion);
        }
        posedWorld.clear();
        for (const entry of ordered) {
            if (entry.follow) {
                desired.copy(canonicalWorld.get(entry.follow)!);
                const correction = restCorrection(entry.follow);
                if (correction) desired.multiply(correction);
                desired.multiply(entry.rest);
            } else {
                desired.copy(entry.rest);
            }
            const parent = entry.node.parent!;
            parentInverse.copy(posedWorld.get(parent) ?? restWorldQuat.get(parent) ?? new Quaternion()).invert();
            entry.node.quaternion.multiplyQuaternions(parentInverse, desired).normalize();
            posedWorld.set(entry.node, desired.clone());
        }
        // 贴地：先归零 root，再按接触点最低处抬落。只在人偶局部坐标里算。
        root.position.set(0, 0, 0);
        root.updateMatrixWorld(true);
        const toRoot = root.matrixWorld.clone().invert();
        let lowest = Number.POSITIVE_INFINITY;
        for (const contact of contacts) {
            contact.marker.getWorldPosition(contactPoint).applyMatrix4(toRoot);
            lowest = Math.min(lowest, contactPoint.y - contact.radius * profile.height);
        }
        // lift 是动作片段的跳跃高度（随身高缩放），worldLift 是飞行与路径高度（米）。
        root.position.y = (Number.isFinite(lowest) ? -lowest : 0) + lift * profile.height + worldLift;
        root.updateMatrixWorld(true);
    };

    return {
        root,
        bones,
        joints,
        rig,
        sync,
        applyPose(pose) {
            for (const name of PREVIS_MANNEQUIN_BONES) {
                const rotation = pose.rotations[name];
                if (rotation && rotation.every(Number.isFinite)) bones[name].quaternion.fromArray(rotation).normalize();
            }
            lift = Math.max(0, pose.lift);
            worldLift = Number.isFinite(pose.worldLift) ? Math.max(0, pose.worldLift) : 0;
            sync();
        },
        setColor(color, selected) {
            const base = new Color(color);
            if (selected) base.lerp(new Color("#8fb8ff"), 0.16);
            body.color.copy(base);
            joint.color.copy(base).multiplyScalar(0.7);
            body.emissive.set(selected ? "#1c3d73" : "#000000");
            body.emissiveIntensity = selected ? 0.3 : 0;
        },
        dispose() {
            // 网格几何体由模板共享，只释放本演员自己的材质与配件几何。
            ownGeometries.forEach((item) => item.dispose());
            materials.forEach((item) => item.dispose());
        },
    };
}
