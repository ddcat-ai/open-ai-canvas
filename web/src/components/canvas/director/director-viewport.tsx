import { Canvas, useThree } from "@react-three/fiber";
import { Grid, OrbitControls, TransformControls } from "@react-three/drei";
import { forwardRef, Suspense, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Box3, Color, Group, Mesh, MeshDepthMaterial, MeshNormalMaterial, Object3D, PerspectiveCamera, Scene, Texture, TextureLoader, Vector3, WebGLRenderer } from "three";
import { GLTFLoader } from "three-stdlib";

import { interpolateDirectorTransform } from "@/lib/canvas/director/director-scene";
import { resolveMediaUrl } from "@/services/file-storage";
import type { DirectorCamera, DirectorLight, DirectorObject, DirectorRenderMode, DirectorScene, DirectorTransform } from "@/types/director";

export type DirectorViewportHandle = {
    capture: (mode: DirectorRenderMode) => Promise<Blob>;
    readCameraTransform: () => DirectorTransform | null;
};

type DirectorViewportProps = {
    scene: DirectorScene;
    selectedObjectId: string | null;
    transformMode: "translate" | "rotate" | "scale";
    renderMode: DirectorRenderMode;
    playhead: number;
    onSelectObject: (id: string | null) => void;
    onObjectTransform: (id: string, transform: DirectorTransform) => void;
};

type CaptureContext = { gl: WebGLRenderer; scene: Scene; camera: PerspectiveCamera };

export const DirectorViewport = forwardRef<DirectorViewportHandle, DirectorViewportProps>(function DirectorViewport(props, ref) {
    const captureContext = useRef<CaptureContext | null>(null);
    useImperativeHandle(ref, () => ({
        capture: (mode) => captureFrame(captureContext.current, mode),
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
                <DirectorSceneContent {...props} onCaptureContext={(context) => (captureContext.current = context)} />
            </Suspense>
        </Canvas>
    );
});

function DirectorSceneContent({ scene, selectedObjectId, transformMode, renderMode, playhead, onSelectObject, onObjectTransform, onCaptureContext }: DirectorViewportProps & { onCaptureContext: (context: CaptureContext) => void }) {
    const { gl, camera, scene: threeScene, invalidate } = useThree();
    const [transforming, setTransforming] = useState(false);
    const shot = scene.shots.find((item) => item.id === scene.activeShotId) || scene.shots[0];
    const activeCamera = scene.cameras.find((item) => item.id === shot?.cameraId) || scene.cameras[0];

    useEffect(() => {
        onCaptureContext({ gl, camera: camera as PerspectiveCamera, scene: threeScene });
    }, [camera, gl, onCaptureContext, threeScene]);

    useEffect(() => {
        threeScene.background = new Color(scene.background);
        invalidate();
    }, [invalidate, scene.background, threeScene]);

    useEffect(() => {
        const material = renderMode === "depth" ? new MeshDepthMaterial() : renderMode === "normal" ? new MeshNormalMaterial() : null;
        threeScene.overrideMaterial = material;
        invalidate();
        return () => {
            if (threeScene.overrideMaterial === material) threeScene.overrideMaterial = null;
            material?.dispose();
        };
    }, [invalidate, renderMode, threeScene]);

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
                    transformMode={transformMode}
                    playhead={playhead}
                    onSelect={() => onSelectObject(object.id)}
                    onTransforming={setTransforming}
                    onTransform={(transform) => onObjectTransform(object.id, transform)}
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

function DirectorObjectView({ object, selected, transformMode, playhead, onSelect, onTransforming, onTransform }: { object: DirectorObject; selected: boolean; transformMode: DirectorViewportProps["transformMode"]; playhead: number; onSelect: () => void; onTransforming: (value: boolean) => void; onTransform: (transform: DirectorTransform) => void }) {
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
            <DirectorObjectVisual object={object} selected={selected} />
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

function DirectorObjectVisual({ object, selected }: { object: DirectorObject; selected: boolean }) {
    if (object.kind === "model" && object.url) return <DirectorModel object={object} selected={selected} />;
    if (object.kind === "billboard" && object.url) return <DirectorBillboard object={object} selected={selected} />;
    if (object.primitive === "character") return <DirectorCharacter object={object} selected={selected} />;
    const material = <meshStandardMaterial color={selected ? "#2f8cff" : object.color} roughness={0.68} metalness={0.05} />;
    return (
        <mesh castShadow={object.castShadow} receiveShadow={object.receiveShadow}>
            {object.primitive === "sphere" ? <sphereGeometry args={[0.6, 32, 24]} /> : object.primitive === "cylinder" ? <cylinderGeometry args={[0.5, 0.5, 1.2, 32]} /> : object.primitive === "plane" ? <planeGeometry args={[1.6, 1]} /> : <boxGeometry args={[1, 1, 1]} />}
            {material}
        </mesh>
    );
}

function DirectorCharacter({ object, selected }: { object: DirectorObject; selected: boolean }) {
    const color = selected ? "#2f8cff" : object.color;
    const pose = characterPose(object.pose || "stand");
    return (
        <group>
            <mesh castShadow position={[0, 1.55, 0]}><sphereGeometry args={[0.24, 24, 18]} /><meshStandardMaterial color={color} roughness={0.76} /></mesh>
            <mesh castShadow position={[0, 1.05, 0]}><capsuleGeometry args={[0.28, 0.65, 8, 16]} /><meshStandardMaterial color={color} roughness={0.76} /></mesh>
            <Limb position={[-0.34, 1.16, 0]} rotation={pose.leftArm} color={color} />
            <Limb position={[0.34, 1.16, 0]} rotation={pose.rightArm} color={color} />
            <Limb position={[-0.17, 0.43, 0]} rotation={pose.leftLeg} color={color} length={0.82} />
            <Limb position={[0.17, 0.43, 0]} rotation={pose.rightLeg} color={color} length={0.82} />
        </group>
    );
}

function Limb({ position, rotation, color, length = 0.68 }: { position: [number, number, number]; rotation: [number, number, number]; color: string; length?: number }) {
    return <mesh castShadow position={position} rotation={rotation}><capsuleGeometry args={[0.09, length, 6, 12]} /><meshStandardMaterial color={color} roughness={0.76} /></mesh>;
}

function DirectorModel({ object, selected }: { object: DirectorObject; selected: boolean }) {
    const [model, setModel] = useState<Object3D | null>(null);
    useEffect(() => {
        let active = true;
        const loader = new GLTFLoader();
        void resolveMediaUrl(object.storageKey, object.url).then((url) => loader.load(url, (gltf) => {
            if (!active) return;
            const next = gltf.scene.clone(true);
            const bounds = new Box3().setFromObject(next);
            const size = bounds.getSize(new Vector3());
            const maxSize = Math.max(size.x, size.y, size.z, 0.001);
            next.scale.multiplyScalar(2 / maxSize);
            const centered = new Box3().setFromObject(next);
            const center = centered.getCenter(new Vector3());
            next.position.sub(center);
            next.position.y -= centered.min.y - center.y;
            next.traverse((child) => {
                const mesh = child as Mesh;
                if (!mesh.isMesh) return;
                mesh.castShadow = object.castShadow;
                mesh.receiveShadow = object.receiveShadow;
            });
            applyHumanoidPose(next, object.pose || "stand");
            setModel(next);
        }, undefined, () => active && setModel(null)));
        return () => { active = false; };
    }, [object.castShadow, object.pose, object.receiveShadow, object.storageKey, object.url]);
    if (!model) return <mesh castShadow><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color={selected ? "#2f8cff" : "#e39145"} wireframe /></mesh>;
    return <primitive object={model} />;
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

function characterPose(pose: NonNullable<DirectorObject["pose"]>): Record<"leftArm" | "rightArm" | "leftLeg" | "rightLeg", [number, number, number]> {
    if (pose === "walk") return { leftArm: [0.35, 0, 0.18], rightArm: [-0.35, 0, -0.18], leftLeg: [-0.24, 0, 0.08], rightLeg: [0.24, 0, -0.08] };
    if (pose === "run") return { leftArm: [0.7, 0, 0.35], rightArm: [-0.7, 0, -0.35], leftLeg: [-0.55, 0, 0.12], rightLeg: [0.55, 0, -0.12] };
    if (pose === "sit") return { leftArm: [0.15, 0, 0.05], rightArm: [0.15, 0, -0.05], leftLeg: [1.1, 0, 0], rightLeg: [1.1, 0, 0] };
    if (pose === "action") return { leftArm: [1.1, 0.2, 0.5], rightArm: [-0.7, -0.2, -0.5], leftLeg: [-0.35, 0, 0.2], rightLeg: [0.45, 0, -0.15] };
    return { leftArm: [0, 0, 0.08], rightArm: [0, 0, -0.08], leftLeg: [0, 0, 0], rightLeg: [0, 0, 0] };
}

function applyHumanoidPose(root: Object3D, pose: NonNullable<DirectorObject["pose"]>) {
    const rotations = humanoidBoneRotations(pose);
    root.traverse((child) => {
        const name = child.name.toLowerCase().replace(/[^a-z0-9]/g, "");
        const entry = rotations.find(([pattern]) => pattern.test(name));
        if (entry) child.rotation.set(...entry[1]);
    });
}

function humanoidBoneRotations(pose: NonNullable<DirectorObject["pose"]>): Array<[RegExp, [number, number, number]]> {
    const values = characterPose(pose);
    return [
        [/left(upper)?arm|upperarmleft|mixamorigleftarm/, values.leftArm],
        [/right(upper)?arm|upperarmright|mixamorigrightarm/, values.rightArm],
        [/left(up)?leg|upperlegleft|mixamorigleftupleg/, values.leftLeg],
        [/right(up)?leg|upperlegright|mixamorigrightupleg/, values.rightLeg],
        [/spine|chest/, pose === "action" ? [0.08, 0.18, -0.08] : [0, 0, 0]],
    ];
}

async function captureFrame(context: CaptureContext | null, mode: DirectorRenderMode) {
    if (!context) throw new Error("3D 视口尚未就绪");
    const { gl, scene, camera } = context;
    const previous = scene.overrideMaterial;
    const override = mode === "depth" ? new MeshDepthMaterial() : mode === "normal" ? new MeshNormalMaterial() : null;
    scene.overrideMaterial = override;
    gl.render(scene, camera);
    const blob = await canvasToBlob(gl.domElement);
    scene.overrideMaterial = previous;
    override?.dispose();
    gl.render(scene, camera);
    return blob;
}

function canvasToBlob(canvas: HTMLCanvasElement) {
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("3D 预览图导出失败"))), "image/png"));
}
