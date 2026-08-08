import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, OrbitControls, TransformControls } from "@react-three/drei";
import { forwardRef, Suspense, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { AnimationClip, AnimationMixer, Box3, Bone, Color, Group, LoopOnce, LoopRepeat, Mesh, MeshBasicMaterial, MeshDepthMaterial, MeshNormalMaterial, MeshStandardMaterial, Object3D, PerspectiveCamera, Quaternion, Scene, SkeletonHelper, Texture, TextureLoader, Vector3, WebGLRenderer } from "three";
import type { Material } from "three";
import { GLTFLoader, SkeletonUtils } from "three-stdlib";

import { DIRECTOR_DEFAULT_ACTOR_URL, directorPoseBoneDeltas, interpolateDirectorBoneRotation, interpolateDirectorTransform } from "@/lib/canvas/director/director-scene";
import { resolveMediaUrl } from "@/services/file-storage";
import type { DirectorCamera, DirectorHumanoidBone, DirectorLight, DirectorObject, DirectorQuat, DirectorRenderMode, DirectorRig, DirectorScene, DirectorTransform, DirectorVec3 } from "@/types/director";

export type DirectorViewportHandle = {
    capture: (mode: DirectorRenderMode) => Promise<Blob>;
    recordVideo: (duration: number, fps: number) => Promise<Blob>;
    readCameraTransform: () => DirectorTransform | null;
};

type DirectorViewportProps = {
    scene: DirectorScene;
    selectedObjectId: string | null;
    selectedBone: string | null;
    transformMode: "translate" | "rotate" | "scale";
    renderMode: DirectorRenderMode;
    playhead: number;
    onSelectObject: (id: string | null) => void;
    onSelectBone: (bone: string | null) => void;
    onObjectTransform: (id: string, transform: DirectorTransform) => void;
    onBoneTransform: (id: string, bone: string, rotation: DirectorQuat) => void;
    onActorRigReady: (id: string, rig: DirectorRig, animations: AnimationClip[]) => void;
};

type CaptureContext = { gl: WebGLRenderer; scene: Scene; camera: PerspectiveCamera; suspendDisplayMaterialOverride: () => () => void };

export const DirectorViewport = forwardRef<DirectorViewportHandle, DirectorViewportProps>(function DirectorViewport(props, ref) {
    const captureContext = useRef<CaptureContext | null>(null);
    const onCaptureContext = useCallback((context: CaptureContext) => { captureContext.current = context; }, []);
    useImperativeHandle(ref, () => ({
        capture: (mode) => captureFrame(captureContext.current, mode),
        recordVideo: (duration, fps) => recordCanvas(captureContext.current, duration, fps),
        readCameraTransform: () => {
            const camera = captureContext.current?.camera;
            return camera ? { position: camera.position.toArray() as DirectorTransform["position"], rotation: [camera.rotation.x, camera.rotation.y, camera.rotation.z], scale: [1, 1, 1] } : null;
        },
    }), []);

    return (
        <Canvas
            shadows
            frameloop="demand"
            dpr={[1, 1.5]}
            camera={{ position: [4.8, 2.7, 6.8], fov: 50, near: 0.05, far: 500 }}
            gl={{ antialias: true, preserveDrawingBuffer: true, alpha: false }}
            onPointerMissed={() => props.onSelectObject(null)}
        >
            <Suspense fallback={null}>
                <DirectorSceneContent {...props} onCaptureContext={onCaptureContext} />
            </Suspense>
        </Canvas>
    );
});

function DirectorSceneContent({ scene, selectedObjectId, selectedBone, transformMode, renderMode, playhead, onSelectObject, onSelectBone, onObjectTransform, onBoneTransform, onActorRigReady, onCaptureContext }: DirectorViewportProps & { onCaptureContext: (context: CaptureContext) => void }) {
    const { gl, camera, scene: threeScene, invalidate } = useThree();
    const [transforming, setTransforming] = useState(false);
    const displayClayRestoreRef = useRef<(() => void) | null>(null);
    const shot = scene.shots.find((item) => item.id === scene.activeShotId) || scene.shots[0];
    const activeCamera = scene.cameras.find((item) => item.id === shot?.cameraId) || scene.cameras[0];
    const suspendDisplayMaterialOverride = useCallback(() => {
        const suspended = Boolean(displayClayRestoreRef.current);
        displayClayRestoreRef.current?.();
        displayClayRestoreRef.current = null;
        return () => {
            if (suspended) displayClayRestoreRef.current = applyClaySceneMaterials(threeScene);
        };
    }, [threeScene]);

    useEffect(() => {
        onCaptureContext({ gl, camera: camera as PerspectiveCamera, scene: threeScene, suspendDisplayMaterialOverride });
    }, [camera, gl, onCaptureContext, suspendDisplayMaterialOverride, threeScene]);

    useEffect(() => {
        threeScene.background = new Color(scene.background);
        invalidate();
    }, [invalidate, scene.background, threeScene]);

    useEffect(() => {
        const material = renderMode === "depth" ? new MeshDepthMaterial() : renderMode === "normal" ? new MeshNormalMaterial() : renderMode === "pose" ? new MeshBasicMaterial({ color: "#ffffff", wireframe: true }) : null;
        if (renderMode === "clay") displayClayRestoreRef.current = applyClaySceneMaterials(threeScene);
        threeScene.overrideMaterial = material;
        invalidate();
        return () => {
            if (threeScene.overrideMaterial === material) threeScene.overrideMaterial = null;
            displayClayRestoreRef.current?.();
            displayClayRestoreRef.current = null;
            material?.dispose();
        };
    }, [invalidate, renderMode, scene.objects, threeScene]);

    return (
        <>
            <CameraSync camera={activeCamera} playhead={playhead} />
            <ambientLight intensity={scene.environmentIntensity * 0.35} />
            {scene.lights.map((light) => <DirectorLightView key={light.id} light={light} />)}
            {scene.gridVisible ? <Grid position={[0, 0, 0]} infiniteGrid fadeDistance={40} fadeStrength={5} cellSize={0.5} sectionSize={5} cellColor="#8f99a3" sectionColor="#626d77" /> : null}
            <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, -0.012, 0]}>
                <planeGeometry args={[120, 120]} />
                <meshStandardMaterial color="#aeb7bf" roughness={0.92} />
            </mesh>
            {scene.objects.filter((item) => item.visible).map((object) => (
                <DirectorObjectView
                    key={object.id}
                    object={object}
                    selected={selectedObjectId === object.id}
                    selectedBone={selectedObjectId === object.id ? selectedBone : null}
                    transformMode={transformMode}
                    playhead={playhead}
                    onSelect={() => onSelectObject(object.id)}
                    onSelectBone={(bone) => { onSelectObject(object.id); onSelectBone(bone); }}
                    onTransforming={setTransforming}
                    onTransform={(transform) => onObjectTransform(object.id, transform)}
                    onBoneTransform={(bone, rotation) => onBoneTransform(object.id, bone, rotation)}
                    onActorRigReady={(rig, animations) => onActorRigReady(object.id, rig, animations)}
                />
            ))}
            <OrbitControls makeDefault enabled={!transforming} target={activeCamera?.target || [0, 1, 0]} minDistance={0.6} maxDistance={80} />
        </>
    );
}

function CameraSync({ camera, playhead }: { camera?: DirectorCamera; playhead: number }) {
    const threeCamera = useThree((state) => state.camera as PerspectiveCamera);
    const invalidate = useThree((state) => state.invalidate);
    useEffect(() => {
        if (!camera) return;
        const transform = interpolateDirectorTransform(camera.transform, camera.keyframes, playhead);
        threeCamera.position.set(...transform.position);
        threeCamera.rotation.set(...transform.rotation);
        threeCamera.fov = camera.fov;
        threeCamera.near = camera.near;
        threeCamera.far = camera.far;
        threeCamera.lookAt(...camera.target);
        threeCamera.updateProjectionMatrix();
        invalidate();
    }, [camera, invalidate, playhead, threeCamera]);
    return null;
}

function DirectorObjectView({ object, selected, selectedBone, transformMode, playhead, onSelect, onSelectBone, onTransforming, onTransform, onBoneTransform, onActorRigReady }: { object: DirectorObject; selected: boolean; selectedBone: string | null; transformMode: DirectorViewportProps["transformMode"]; playhead: number; onSelect: () => void; onSelectBone: (bone: string | null) => void; onTransforming: (value: boolean) => void; onTransform: (transform: DirectorTransform) => void; onBoneTransform: (bone: string, rotation: DirectorQuat) => void; onActorRigReady: (rig: DirectorRig, animations: AnimationClip[]) => void }) {
    const groupRef = useRef<Group>(null);
    const transform = interpolateDirectorTransform(object.transform, object.keyframes, playhead);
    const content = (
        <group
            ref={groupRef}
            position={transform.position}
            rotation={transform.rotation}
            scale={transform.scale}
            onPointerDown={(event) => {
                event.stopPropagation();
                onSelect();
            }}
        >
            <DirectorObjectVisual object={object} selected={selected} selectedBone={selectedBone} playhead={playhead} onSelectBone={onSelectBone} onBoneTransform={onBoneTransform} onActorRigReady={onActorRigReady} />
        </group>
    );
    if (!selected) return content;
    return (
        <TransformControls
            mode={transformMode}
            size={0.8}
            onMouseDown={() => onTransforming(true)}
            onMouseUp={() => {
                onTransforming(false);
                const target = groupRef.current;
                if (!target) return;
                onTransform({ position: target.position.toArray() as DirectorTransform["position"], rotation: [target.rotation.x, target.rotation.y, target.rotation.z], scale: target.scale.toArray() as DirectorTransform["scale"] });
            }}
        >
            {content}
        </TransformControls>
    );
}

function DirectorObjectVisual({ object, selected, selectedBone, playhead, onSelectBone, onBoneTransform, onActorRigReady }: { object: DirectorObject; selected: boolean; selectedBone: string | null; playhead: number; onSelectBone: (bone: string | null) => void; onBoneTransform: (bone: string, rotation: DirectorQuat) => void; onActorRigReady: (rig: DirectorRig, animations: AnimationClip[]) => void }) {
    if ((object.kind === "model" || object.kind === "actor" || object.primitive === "character") && (object.url || object.primitive === "character")) return <DirectorModel object={object} selected={selected} selectedBone={selectedBone} playhead={playhead} onSelectBone={onSelectBone} onBoneTransform={onBoneTransform} onActorRigReady={onActorRigReady} />;
    if (object.kind === "billboard" && object.url) return <DirectorBillboard object={object} selected={selected} />;
    const material = <meshStandardMaterial color={selected ? "#2f8cff" : object.color} roughness={0.68} metalness={0.05} />;
    return (
        <mesh castShadow={object.castShadow} receiveShadow={object.receiveShadow}>
            {object.primitive === "sphere" ? <sphereGeometry args={[0.6, 32, 24]} /> : object.primitive === "cylinder" ? <cylinderGeometry args={[0.5, 0.5, 1.2, 32]} /> : object.primitive === "plane" ? <planeGeometry args={[1.6, 1]} /> : <boxGeometry args={[1, 1, 1]} />}
            {material}
        </mesh>
    );
}

function DirectorModel({ object, selected, selectedBone, playhead, onSelectBone, onBoneTransform, onActorRigReady }: { object: DirectorObject; selected: boolean; selectedBone: string | null; playhead: number; onSelectBone: (bone: string | null) => void; onBoneTransform: (bone: string, rotation: DirectorQuat) => void; onActorRigReady: (rig: DirectorRig, animations: AnimationClip[]) => void }) {
    const [model, setModel] = useState<Object3D | null>(null);
    const [animations, setAnimations] = useState<AnimationClip[]>([]);
    const [rig, setRig] = useState<DirectorRig | null>(null);
    const [restRotations, setRestRotations] = useState<Partial<Record<DirectorHumanoidBone, DirectorQuat>>>({});
    const mixerRef = useRef<AnimationMixer | null>(null);
    const onActorRigReadyRef = useRef(onActorRigReady);
    const invalidate = useThree((state) => state.invalidate);
    const helper = useMemo(() => model ? new SkeletonHelper(model) : null, [model]);
    const selectedBoneObject = selectedBone && rig?.boneMap[selectedBone as DirectorHumanoidBone] ? model?.getObjectByName(rig.boneMap[selectedBone as DirectorHumanoidBone]!) : null;
    const motion = object.motionClips?.find((item) => item.id === object.activeMotionClipId);
    const activeAnimation = motion ? animations.find((item) => item.name === motion.sourceAnimation) : undefined;
    const modelUrl = object.kind === "actor" || object.primitive === "character" ? DIRECTOR_DEFAULT_ACTOR_URL : object.url;

    useEffect(() => { onActorRigReadyRef.current = onActorRigReady; }, [onActorRigReady]);

    useEffect(() => {
        let active = true;
        const loader = new GLTFLoader();
        void resolveMediaUrl(object.storageKey, modelUrl).then((url) => loader.load(url, (gltf) => {
            if (!active) return;
            const next = SkeletonUtils.clone(gltf.scene);
            normalizeModel(next, object.castShadow, object.receiveShadow);
            const nextRig = inferDirectorRig(next, gltf.animations.map((clip) => clip.name));
            if (object.kind === "actor" || object.primitive === "character") applyActorReferenceMaterial(next, object.color);
            mixerRef.current = new AnimationMixer(next);
            setRig(nextRig);
            setRestRotations(readRigRestRotations(next, nextRig));
            setAnimations(gltf.animations);
            setModel(next);
            onActorRigReadyRef.current(nextRig, gltf.animations);
        }, undefined, () => active && setModel(null)));
        return () => {
            active = false;
            mixerRef.current?.stopAllAction();
            mixerRef.current = null;
        };
    }, [modelUrl, object.kind, object.storageKey]);

    useEffect(() => {
        if (!model) return;
        model.traverse((child) => {
            const mesh = child as Mesh;
            if (!mesh.isMesh) return;
            mesh.castShadow = object.castShadow;
            mesh.receiveShadow = object.receiveShadow;
        });
        invalidate();
    }, [invalidate, model, object.castShadow, object.receiveShadow]);

    useEffect(() => {
        if (!model || (object.kind !== "actor" && object.primitive !== "character")) return;
        updateActorReferenceColor(model, object.color);
        invalidate();
    }, [invalidate, model, object.color, object.kind]);

    useEffect(() => {
        if (!model || !mixerRef.current) return;
        const mixer = mixerRef.current;
        mixer.stopAllAction();
        if (!activeAnimation) return;
        mixer.clipAction(activeAnimation).setLoop(motion?.loop ? LoopRepeat : LoopOnce, motion?.loop ? Infinity : 1).play();
        return () => {
            mixer.stopAllAction();
        };
    }, [activeAnimation, model, motion?.loop]);

    useEffect(() => {
        if (!model || !mixerRef.current) return;
        if (activeAnimation && motion) {
            const localTime = Math.max(0, playhead - motion.start) * motion.playbackRate;
            const clipDuration = motion.duration || activeAnimation.duration;
            mixerRef.current.setTime(motion.loop && clipDuration > 0 ? localTime % clipDuration : localTime);
        }
        applyDirectorBoneTracks(model, object, playhead, rig, restRotations, Boolean(activeAnimation && motion));
        helper?.updateMatrixWorld(true);
        invalidate();
    }, [activeAnimation, helper, invalidate, model, motion, object.boneOverrides, object.boneTracks, object.pose, playhead, restRotations, rig]);

    useFrame(() => {
        if (selectedBoneObject && selected) selectedBoneObject.updateMatrixWorld(true);
    });

    if (!model) return <DirectorMannequin color={object.color} selected={selected} />;
    return <group>
        <primitive object={model} />
        {selected && helper ? <primitive object={helper} /> : null}
        {selected && rig ? Object.entries(rig.boneMap).filter(([, name]) => Boolean(name)).map(([bone, name]) => <BoneController key={bone} bone={model.getObjectByName(name!)} model={model} selected={selectedBone === bone} onSelect={() => onSelectBone(bone)} />) : null}
        {selected && selectedBoneObject ? <TransformControls object={selectedBoneObject} mode="rotate" size={0.55} onMouseUp={() => onBoneTransform(selectedBone!, selectedBoneObject.quaternion.toArray() as DirectorQuat)} /> : null}
    </group>;
}

function DirectorMannequin({ color, selected }: { color: string; selected: boolean }) {
    const resolvedColor = selected ? new Color(color).lerp(new Color("#78a9ff"), 0.18).getStyle() : color;
    const joints: DirectorVec3[] = [[0, 1.72, 0], [0, 1.48, 0], [-0.3, 1.4, 0], [0.3, 1.4, 0], [-0.32, 1.05, 0], [0.32, 1.05, 0], [-0.33, 0.72, 0], [0.33, 0.72, 0], [-0.13, 0.88, 0], [0.13, 0.88, 0], [-0.13, 0.46, 0], [0.13, 0.46, 0], [-0.13, 0.05, 0], [0.13, 0.05, 0]];
    const bones: Array<[DirectorVec3, DirectorVec3]> = [[joints[0], joints[1]], [joints[1], joints[2]], [joints[1], joints[3]], [joints[2], joints[4]], [joints[4], joints[6]], [joints[3], joints[5]], [joints[5], joints[7]], [joints[1], [0, 0.92, 0]], [[0, 0.92, 0], joints[8]], [[0, 0.92, 0], joints[9]], [joints[8], joints[10]], [joints[10], joints[12]], [joints[9], joints[11]], [joints[11], joints[13]]];
    return <group>
        {bones.map(([from, to], index) => <LoadingBone key={`bone-${index}`} from={from} to={to} color={resolvedColor} />)}
        {joints.map((position, index) => <mesh key={`joint-${index}`} position={position}><sphereGeometry args={[index === 0 ? 0.11 : 0.04, 12, 8]} /><meshBasicMaterial color={resolvedColor} transparent opacity={0.72} /></mesh>)}
    </group>;
}

function LoadingBone({ from, to, color }: { from: DirectorVec3; to: DirectorVec3; color: string }) {
    const start = useMemo(() => new Vector3(...from), [from]);
    const end = useMemo(() => new Vector3(...to), [to]);
    const direction = useMemo(() => end.clone().sub(start), [end, start]);
    const midpoint = useMemo(() => start.clone().add(end).multiplyScalar(0.5), [end, start]);
    const rotation = useMemo(() => new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.clone().normalize()), [direction]);
    return <mesh position={midpoint} quaternion={rotation}><cylinderGeometry args={[0.025, 0.025, direction.length(), 8]} /><meshBasicMaterial color={color} transparent opacity={0.62} /></mesh>;
}

function BoneController({ bone, model, selected, onSelect }: { bone: Object3D | undefined; model: Object3D; selected: boolean; onSelect: () => void }) {
    const ref = useRef<Group>(null);
    const world = useMemo(() => new Vector3(), []);
    useFrame(() => {
        if (!bone || !ref.current) return;
        bone.getWorldPosition(world);
        model.worldToLocal(world);
        ref.current.position.copy(world);
    });
    if (!bone) return null;
    return <group ref={ref} onPointerDown={(event) => { event.stopPropagation(); onSelect(); }}><mesh><sphereGeometry args={[selected ? 0.07 : 0.045, 12, 8]} /><meshBasicMaterial color={selected ? "#f0b36a" : "#78a9ff"} depthTest={false} transparent opacity={selected ? 1 : 0.75} /></mesh></group>;
}

function normalizeModel(root: Object3D, castShadow: boolean, receiveShadow: boolean) {
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

function applyActorReferenceMaterial(root: Object3D, color: string) {
    const material = new MeshStandardMaterial({ color, roughness: 0.74, metalness: 0.02 });
    root.traverse((child) => {
        const mesh = child as Mesh;
        if (!mesh.isMesh) return;
        mesh.material = material;
        mesh.userData.directorActor = true;
        mesh.userData.directorActorMaterial = material;
    });
}

function updateActorReferenceColor(root: Object3D, color: string) {
    root.traverse((child) => {
        const mesh = child as Mesh;
        if (!mesh.isMesh || !mesh.userData.directorActor) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((material) => {
            if (material instanceof MeshStandardMaterial) material.color.set(color);
        });
    });
}

function readRigRestRotations(root: Object3D, rig: DirectorRig) {
    return Object.fromEntries(Object.entries(rig.boneMap).flatMap(([bone, name]) => {
        const target = name ? root.getObjectByName(name) : null;
        return target ? [[bone, target.quaternion.toArray() as DirectorQuat]] : [];
    })) as Partial<Record<DirectorHumanoidBone, DirectorQuat>>;
}

function inferDirectorRig(root: Object3D, animationNames: string[]): DirectorRig {
    const names = new Map<string, string>();
    root.traverse((child) => { if (child instanceof Bone) names.set(normalizeBoneName(child.name), child.name); });
    const patterns: Record<DirectorHumanoidBone, RegExp[]> = {
        root: [/^root$/, /armature/], hips: [/hips|pelvis/, /mixamorig.*hip/], spine: [/spine1?$|lowerback/], chest: [/spine2|chest|upperback/], neck: [/neck/], head: [/head/],
        leftShoulder: [/leftshoulder|shoulder_l|mixamorigleftshoulder/], leftUpperArm: [/leftupperarm|leftarm|upperarm_l|mixamorigleftarm/], leftLowerArm: [/leftforearm|leftlowerarm|forearm_l|mixamorigleftforearm/], leftHand: [/lefthand|hand_l|mixamoriglefthand/],
        rightShoulder: [/rightshoulder|shoulder_r|mixamorigrightshoulder/], rightUpperArm: [/rightupperarm|rightarm|upperarm_r|mixamorigrightarm/], rightLowerArm: [/rightforearm|rightlowerarm|forearm_r|mixamorigrightforearm/], rightHand: [/righthand|hand_r|mixamorigrighthand/],
        leftUpperLeg: [/leftupleg|leftthigh|thigh_l|mixamorigleftupleg/], leftLowerLeg: [/leftleg|leftcalf|calf_l|mixamorigleftleg/], leftFoot: [/leftfoot|foot_l|mixamorigleftfoot/], rightUpperLeg: [/rightupleg|rightthigh|thigh_r|mixamorigrightupleg/], rightLowerLeg: [/rightleg|rightcalf|calf_r|mixamorigrightleg/], rightFoot: [/rightfoot|foot_r|mixamorigrightfoot/],
    };
    const boneMap = Object.fromEntries(Object.entries(patterns).map(([bone, candidates]) => [bone, candidates.map((pattern) => [...names.entries()].find(([normalized]) => pattern.test(normalized))?.[1]).find(Boolean)]).filter(([, name]) => Boolean(name))) as DirectorRig["boneMap"];
    return { status: Object.keys(boneMap).length >= 8 ? "ready" : "unmapped", boneMap, animationNames };
}

function normalizeBoneName(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function applyDirectorBoneTracks(model: Object3D, object: DirectorObject, playhead: number, rig: DirectorRig | null, restRotations: Partial<Record<DirectorHumanoidBone, DirectorQuat>>, hasActiveMotion: boolean) {
    if (!rig) return;
    const poseDeltas = hasActiveMotion ? {} : directorPoseBoneDeltas(object.pose || "stand");
    Object.entries(rig.boneMap).forEach(([bone, name]) => {
        const target = name ? model.getObjectByName(name) : null;
        if (!target) return;
        const humanoidBone = bone as DirectorHumanoidBone;
        if (!hasActiveMotion) {
            const rest = restRotations[humanoidBone];
            if (rest) target.quaternion.copy(new Quaternion(...rest));
            const delta = poseDeltas[humanoidBone];
            if (delta) target.quaternion.multiply(new Quaternion(...delta));
        }
        const override = object.boneOverrides?.[bone as DirectorHumanoidBone];
        const track = object.boneTracks?.find((item) => item.bone === bone);
        const rotation = track ? interpolateDirectorBoneRotation(override || target.quaternion.toArray() as DirectorQuat, track.keyframes, playhead) : override;
        if (rotation) target.quaternion.copy(new Quaternion(...rotation));
    });
}

function DirectorBillboard({ object, selected }: { object: DirectorObject; selected: boolean }) {
    const [texture, setTexture] = useState<Texture | null>(null);
    useEffect(() => {
        let active = true;
        new TextureLoader().load(object.url!, (next) => active && setTexture(next), undefined, () => active && setTexture(null));
        return () => { active = false; };
    }, [object.url]);
    return (
        <mesh castShadow={object.castShadow}>
            <planeGeometry args={[1.6, 1]} />
            <meshBasicMaterial map={texture || undefined} color={texture ? "#ffffff" : selected ? "#2f8cff" : object.color} toneMapped={false} />
        </mesh>
    );
}

function DirectorLightView({ light }: { light: DirectorLight }) {
    const position = light.transform.position;
    if (light.type === "ambient") return <ambientLight color={light.color} intensity={light.intensity} />;
    if (light.type === "point") return <pointLight position={position} color={light.color} intensity={light.intensity} castShadow={light.castShadow} />;
    if (light.type === "spot") return <spotLight position={position} color={light.color} intensity={light.intensity} angle={light.angle} penumbra={light.penumbra} castShadow={light.castShadow} />;
    return <directionalLight position={position} color={light.color} intensity={light.intensity} castShadow={light.castShadow} shadow-mapSize-width={1024} shadow-mapSize-height={1024} />;
}

async function captureFrame(context: CaptureContext | null, mode: DirectorRenderMode) {
    if (!context) throw new Error("3D 视口尚未就绪");
    const { gl, scene, camera } = context;
    const resumeDisplayMaterialOverride = context.suspendDisplayMaterialOverride();
    const previous = scene.overrideMaterial;
    const override = mode === "depth" ? new MeshDepthMaterial() : mode === "normal" ? new MeshNormalMaterial() : mode === "pose" ? new MeshBasicMaterial({ color: "#ffffff", wireframe: true }) : null;
    const restoreClayMaterials = mode === "clay" ? applyClaySceneMaterials(scene) : null;
    try {
        scene.overrideMaterial = override;
        gl.render(scene, camera);
        return await canvasToBlob(gl.domElement);
    } finally {
        scene.overrideMaterial = previous;
        restoreClayMaterials?.();
        override?.dispose();
        resumeDisplayMaterialOverride();
        gl.render(scene, camera);
    }
}

async function recordCanvas(context: CaptureContext | null, duration: number, fps: number) {
    if (!context) throw new Error("3D 视口尚未就绪");
    if (!context.gl.domElement.captureStream || typeof MediaRecorder === "undefined") throw new Error("当前浏览器不支持视频录制，请导出帧序列");
    const resumeDisplayMaterialOverride = context.suspendDisplayMaterialOverride();
    const previousMaterial = context.scene.overrideMaterial;
    const restoreClayMaterials = applyClaySceneMaterials(context.scene);
    context.scene.overrideMaterial = null;
    context.gl.render(context.scene, context.camera);
    const stream = context.gl.domElement.captureStream(fps);
    const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type)) || "";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    const result = new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
        recorder.onerror = () => reject(new Error("白膜视频录制失败"));
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
    });
    recorder.start();
    window.setTimeout(() => recorder.stop(), Math.max(250, duration * 1000 + 120));
    try {
        return await result;
    } finally {
        stream.getTracks().forEach((track) => track.stop());
        restoreClayMaterials();
        context.scene.overrideMaterial = previousMaterial;
        resumeDisplayMaterialOverride();
        context.gl.render(context.scene, context.camera);
    }
}

function applyClaySceneMaterials(scene: Scene) {
    const clayMaterial = new MeshStandardMaterial({ color: "#d6d9dd", roughness: 0.88, metalness: 0 });
    const originals: Array<{ mesh: Mesh; material: Material | Material[] }> = [];
    scene.traverse((child) => {
        const mesh = child as Mesh;
        if (!mesh.isMesh || mesh.userData.directorActor) return;
        originals.push({ mesh, material: mesh.material });
        mesh.material = clayMaterial;
    });
    return () => {
        originals.forEach(({ mesh, material }) => { mesh.material = material; });
        clayMaterial.dispose();
    };
}

function canvasToBlob(canvas: HTMLCanvasElement) {
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("3D 预览图导出失败"))), "image/png"));
}
