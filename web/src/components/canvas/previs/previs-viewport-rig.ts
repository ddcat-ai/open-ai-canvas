// 预演台人物模型的骨骼推断、姿态轨道应用与参考材质。纯 three.js 操作，不涉及 React。

import { Bone, Box3, Camera, Color, type Material, Mesh, Object3D, OrthographicCamera, PerspectiveCamera, Quaternion, ShaderMaterial, Vector3 } from "three";
import { disposePrevisMaterials } from "@/lib/canvas/previs/previs-resources";
import { type PrevisHumanoidBone, type PrevisObject, type PrevisQuat, type PrevisRig } from "@/types/previs";
import { previsPoseBoneDeltas } from "@/lib/canvas/previs/previs-scene";
import { resolvePrevisBoneRotation } from "@/lib/canvas/previs/previs-animation-semantics";

export function screenPixelsToWorldRadius(camera: Camera, distance: number, pixels: number, viewportHeight: number) {
    const height = Math.max(1, viewportHeight);
    if (camera instanceof PerspectiveCamera) return (pixels * 2 * Math.max(0.01, distance) * Math.tan((camera.fov * Math.PI) / 360)) / (height * Math.max(0.01, camera.zoom));
    if (camera instanceof OrthographicCamera) return (pixels * (camera.top - camera.bottom)) / (height * Math.max(0.01, camera.zoom));
    return pixels * 0.001;
}

export function previsFingerGroup(bone: string | null) {
    const match = bone?.match(/^(left|right)(Thumb|Index|Middle|Ring|Pinky)\d$/);
    return match ? `${match[1]}${match[2]}` : null;
}

export function normalizeModel(root: Object3D, castShadow: boolean, receiveShadow: boolean) {
    root.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(root, true);
    const size = bounds.getSize(new Vector3());
    const maxSize = Math.max(size.x, size.y, size.z, 0.001);
    root.scale.multiplyScalar(2 / maxSize);
    root.updateMatrixWorld(true);
    const centered = new Box3().setFromObject(root, true);
    const center = centered.getCenter(new Vector3());
    root.position.sub(center);
    root.position.y -= centered.min.y - center.y;
    root.traverse((child) => {
        const mesh = child as Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = castShadow;
        mesh.receiveShadow = receiveShadow;
    });
}

export function applyActorReferenceMaterial(root: Object3D, baseColor: string) {
    const color = new Color(baseColor);
    const material = new ShaderMaterial({
        uniforms: {
            uBaseColor: { value: color },
            uRimColor: { value: new Color(0xffffff) },
            uRimPower: { value: 3.2 },
            uRimIntensity: { value: 0.42 },
            uTopColor: { value: new Color(0x87ceeb).multiplyScalar(0.16) },
            uBottomColor: { value: new Color(0x2c2c2c).multiplyScalar(0.28) },
            uRoughness: { value: 0.7 },
            uMetalness: { value: 0.05 },
        },
        vertexShader: `
            #include <common>
            #include <skinning_pars_vertex>

            varying vec3 vNormal;
            varying vec3 vViewPosition;
            varying float vHeight;

            void main() {
                #include <beginnormal_vertex>
                #include <skinbase_vertex>
                #include <skinnormal_vertex>
                #include <defaultnormal_vertex>
                #include <begin_vertex>
                #include <skinning_vertex>

                vNormal = normalize(transformedNormal);
                vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
                vViewPosition = -mvPosition.xyz;
                vHeight = transformed.y;
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform vec3 uBaseColor;
            uniform vec3 uRimColor;
            uniform float uRimPower;
            uniform float uRimIntensity;
            uniform vec3 uTopColor;
            uniform vec3 uBottomColor;
            uniform float uRoughness;
            uniform float uMetalness;

            varying vec3 vNormal;
            varying vec3 vViewPosition;
            varying float vHeight;

            void main() {
                vec3 normal = normalize(vNormal);
                vec3 viewDir = normalize(vViewPosition);
                float facing = max(dot(normal, viewDir), 0.0);
                float rim = pow(1.0 - facing, uRimPower) * uRimIntensity;
                float heightFactor = clamp(vHeight * 0.5, 0.0, 1.0);
                vec3 ambientGradient = mix(uBottomColor, uTopColor, heightFactor);
                float softSpecular = pow(facing, mix(10.0, 28.0, 1.0 - uRoughness)) * (0.08 + uMetalness * 0.12);
                vec3 finalColor = uBaseColor * (0.9 + facing * 0.1) + ambientGradient + rim * uRimColor + softSpecular;
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `,
    });
    const replaced: Material[] = [];

    root.traverse((child) => {
        const mesh = child as Mesh;
        if (!mesh.isMesh || mesh.userData.previsNoMaterialOverride) return;
        if (mesh.material) replaced.push(...(Array.isArray(mesh.material) ? mesh.material : [mesh.material]));
        mesh.material = material;
        mesh.userData.previsActor = true;
        mesh.userData.previsActorMaterial = material;
    });

    disposePrevisMaterials(replaced.filter((item) => item !== material));
}

export function updateActorReferenceColor(root: Object3D, baseColor: string) {
    const color = new Color(baseColor);
    root.traverse((child) => {
        const mesh = child as Mesh;
        if (!mesh.isMesh || !mesh.userData.previsActor) return;
        const material = mesh.material as Material;
        if (material instanceof ShaderMaterial && material.uniforms.uBaseColor) {
            material.uniforms.uBaseColor.value = color.clone();
        }
    });
}

export function readRigRestRotations(root: Object3D, rig: PrevisRig) {
    return Object.fromEntries(
        Object.entries(rig.boneMap).flatMap(([bone, name]) => {
            const target = name ? root.getObjectByName(name) : null;
            return target ? [[bone, target.quaternion.toArray() as PrevisQuat]] : [];
        }),
    ) as Partial<Record<PrevisHumanoidBone, PrevisQuat>>;
}

export function inferPrevisRig(root: Object3D, animationNames: string[]): PrevisRig {
    const names = new Map<string, string>();
    root.traverse((child) => {
        if (child instanceof Bone) names.set(normalizeBoneName(child.name), child.name);
    });
    const fingerPatterns = (side: "left" | "right", finger: "thumb" | "index" | "middle" | "ring" | "pinky", segment: 1 | 2 | 3) => [
        new RegExp(`^mixamorig${side}hand${finger}${segment}$`),
        new RegExp(`^${side}hand${finger}${segment}$`),
        new RegExp(`^${side}${finger}${segment}$`),
        new RegExp(`^${finger}0?${segment}${side === "left" ? "l" : "r"}$`),
    ];
    const patterns: Record<PrevisHumanoidBone, RegExp[]> = {
        root: [/^root$/, /armature/],
        hips: [/hips|pelvis/, /mixamorig.*hip/],
        spine: [/spine1?$|lowerback/],
        chest: [/spine2|chest|upperback/],
        neck: [/neck/],
        head: [/head/],
        leftShoulder: [/leftshoulder|shoulder_l|mixamorigleftshoulder/],
        leftUpperArm: [/leftupperarm|leftarm|upperarm_l|mixamorigleftarm/],
        leftLowerArm: [/leftforearm|leftlowerarm|forearm_l|mixamorigleftforearm/],
        leftHand: [/^lefthand$/, /^handl$/, /^mixamoriglefthand$/],
        leftThumb1: fingerPatterns("left", "thumb", 1),
        leftThumb2: fingerPatterns("left", "thumb", 2),
        leftThumb3: fingerPatterns("left", "thumb", 3),
        leftIndex1: fingerPatterns("left", "index", 1),
        leftIndex2: fingerPatterns("left", "index", 2),
        leftIndex3: fingerPatterns("left", "index", 3),
        leftMiddle1: fingerPatterns("left", "middle", 1),
        leftMiddle2: fingerPatterns("left", "middle", 2),
        leftMiddle3: fingerPatterns("left", "middle", 3),
        leftRing1: fingerPatterns("left", "ring", 1),
        leftRing2: fingerPatterns("left", "ring", 2),
        leftRing3: fingerPatterns("left", "ring", 3),
        leftPinky1: fingerPatterns("left", "pinky", 1),
        leftPinky2: fingerPatterns("left", "pinky", 2),
        leftPinky3: fingerPatterns("left", "pinky", 3),
        rightShoulder: [/rightshoulder|shoulder_r|mixamorigrightshoulder/],
        rightUpperArm: [/rightupperarm|rightarm|upperarm_r|mixamorigrightarm/],
        rightLowerArm: [/rightforearm|rightlowerarm|forearm_r|mixamorigrightforearm/],
        rightHand: [/^righthand$/, /^handr$/, /^mixamorigrighthand$/],
        rightThumb1: fingerPatterns("right", "thumb", 1),
        rightThumb2: fingerPatterns("right", "thumb", 2),
        rightThumb3: fingerPatterns("right", "thumb", 3),
        rightIndex1: fingerPatterns("right", "index", 1),
        rightIndex2: fingerPatterns("right", "index", 2),
        rightIndex3: fingerPatterns("right", "index", 3),
        rightMiddle1: fingerPatterns("right", "middle", 1),
        rightMiddle2: fingerPatterns("right", "middle", 2),
        rightMiddle3: fingerPatterns("right", "middle", 3),
        rightRing1: fingerPatterns("right", "ring", 1),
        rightRing2: fingerPatterns("right", "ring", 2),
        rightRing3: fingerPatterns("right", "ring", 3),
        rightPinky1: fingerPatterns("right", "pinky", 1),
        rightPinky2: fingerPatterns("right", "pinky", 2),
        rightPinky3: fingerPatterns("right", "pinky", 3),
        leftUpperLeg: [/leftupleg|leftthigh|thigh_l|mixamorigleftupleg/],
        leftLowerLeg: [/leftleg|leftcalf|calf_l|mixamorigleftleg/],
        leftFoot: [/leftfoot|foot_l|mixamorigleftfoot/],
        rightUpperLeg: [/rightupleg|rightthigh|thigh_r|mixamorigrightupleg/],
        rightLowerLeg: [/rightleg|rightcalf|calf_r|mixamorigrightleg/],
        rightFoot: [/rightfoot|foot_r|mixamorigrightfoot/],
    };
    const boneMap = Object.fromEntries(
        Object.entries(patterns)
            .map(([bone, candidates]) => [bone, candidates.map((pattern) => [...names.entries()].find(([normalized]) => pattern.test(normalized))?.[1]).find(Boolean)])
            .filter(([, name]) => Boolean(name)),
    ) as PrevisRig["boneMap"];
    return { status: Object.keys(boneMap).length >= 8 ? "ready" : "unmapped", boneMap, animationNames };
}

export function normalizeBoneName(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function applyPrevisBoneTracks(model: Object3D, object: PrevisObject, playhead: number, rig: PrevisRig | null, restRotations: Partial<Record<PrevisHumanoidBone, PrevisQuat>>, hasActiveMotion: boolean) {
    if (!rig) return;
    const poseDeltas = hasActiveMotion ? {} : previsPoseBoneDeltas(object.pose || "stand");
    Object.entries(rig.boneMap).forEach(([bone, name]) => {
        const target = name ? model.getObjectByName(name) : null;
        if (!target) return;
        const humanoidBone = bone as PrevisHumanoidBone;
        // hasActiveMotion 时 mixer 已写入 target.quaternion，直接作为动作层输入。
        const rotation = resolvePrevisBoneRotation({
            motion: hasActiveMotion ? (target.quaternion.toArray() as PrevisQuat) : null,
            rest: hasActiveMotion ? null : restRotations[humanoidBone] || null,
            poseDelta: hasActiveMotion ? null : poseDeltas[humanoidBone] || null,
            override: object.boneOverrides?.[humanoidBone] || null,
            keyframes: object.boneTracks?.find((item) => item.bone === bone)?.keyframes || null,
            time: playhead,
        });
        if (rotation) {
            target.quaternion.copy(new Quaternion(...rotation));
            return;
        }
        if (hasActiveMotion) return;
        const rest = restRotations[humanoidBone];
        if (rest) target.quaternion.copy(new Quaternion(...rest));
        const delta = poseDeltas[humanoidBone];
        if (delta) target.quaternion.multiply(new Quaternion(...delta));
    });
}
