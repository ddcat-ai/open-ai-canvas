import { Canvas, useThree } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { ColorPicker, Modal } from "antd";
import { Box, Camera, FileUp, Lightbulb, UserRound, Users } from "lucide-react";
import { Suspense, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Color, Object3D, type PerspectiveCamera } from "three";

import { PrevisPropThumb } from "./previs-prop-library-panel";
import {
    buildPrevisActorFromTemplate,
    buildPrevisCameraFromPreset,
    buildPrevisLightFromPreset,
    buildPrevisPropObject,
    PREVIS_ACTOR_TEMPLATES,
    PREVIS_CAMERA_PRESETS,
    PREVIS_LIGHT_PRESETS,
    type PrevisActorTemplate,
    type PrevisCameraPreset,
    type PrevisLightPreset,
} from "@/lib/canvas/previs/previs-add-catalog";
import { buildPrevisMannequin, loadPrevisMannequinTemplate, resolvePrevisMannequinProfile } from "@/lib/canvas/previs/previs-mannequin";
import { evaluatePrevisActorPose } from "@/lib/canvas/previs/previs-motion";
import { PREVIS_PROP_LIBRARY, formatPrevisPropSize, type PrevisPropItem } from "@/lib/canvas/previs/previs-prop-library";
import { previsVerticalFov } from "@/lib/canvas/previs/previs-optics";
import type { PrevisCamera, PrevisLight, PrevisObject, PrevisPose, PrevisTransform } from "@/types/previs";
import { poseOptions } from "./previs-inspectors";

/**
 * 「添加到场景」弹窗：左侧选项、右侧实时 3D 预览，确认后才写入场景。
 * 预览与写入调用 previs-add-catalog 的同一组 build 函数，保证看到的就是加进去的。
 * 弹窗只在打开时挂载 Canvas（destroyOnHidden），不长期占用第二个 WebGL 上下文。
 */
export type PrevisAddKind = "actor" | "prop" | "light" | "camera";

export type PrevisAddResult = { kind: "actor"; objects: PrevisObject[] } | { kind: "prop"; objects: PrevisObject[] } | { kind: "light"; light: PrevisLight } | { kind: "camera"; camera: PrevisCamera };

const TABS: Array<{ kind: PrevisAddKind; label: string; icon: typeof UserRound }> = [
    { kind: "actor", label: "角色", icon: UserRound },
    { kind: "prop", label: "道具", icon: Box },
    { kind: "light", label: "灯光", icon: Lightbulb },
    { kind: "camera", label: "机位", icon: Camera },
];

const ACTOR_SWATCHES = ["#2f7de1", "#d84949", "#dfae3f", "#34a276", "#8b5cf6", "#f97316", "#06b6d4", "#8a93a0"];
const PROP_SWATCHES = ["#8795a5", "#b08968", "#6b7f5e", "#c9ccd1", "#5a6270", "#a35f4c"];

export function PrevisAddDialog({
    open,
    themeStyle,
    initialKind,
    counts,
    readCurrentView,
    onClose,
    onConfirm,
    onUploadModel,
}: {
    open: boolean;
    themeStyle: CSSProperties;
    initialKind: PrevisAddKind;
    /** 已有数量，用于命名（演员 3、机位 2…）。 */
    counts: { actors: number; props: number; lights: number; cameras: number };
    readCurrentView: () => PrevisTransform | null;
    onClose: () => void;
    onConfirm: (result: PrevisAddResult) => void;
    onUploadModel: () => void;
}) {
    const [kind, setKind] = useState<PrevisAddKind>(initialKind);
    const [actorTemplate, setActorTemplate] = useState<PrevisActorTemplate>(PREVIS_ACTOR_TEMPLATES[0]);
    const [actorColor, setActorColor] = useState(ACTOR_SWATCHES[0]);
    const [actorPose, setActorPose] = useState<PrevisPose>("stand");
    const [crowd, setCrowd] = useState(false);
    const [prop, setProp] = useState<PrevisPropItem>(PREVIS_PROP_LIBRARY[0].items[0]);
    const [propCategory, setPropCategory] = useState(PREVIS_PROP_LIBRARY[0].id);
    const [propColor, setPropColor] = useState(PROP_SWATCHES[0]);
    const [lightPreset, setLightPreset] = useState<PrevisLightPreset>(PREVIS_LIGHT_PRESETS[0]);
    const [cameraPreset, setCameraPreset] = useState<PrevisCameraPreset>(PREVIS_CAMERA_PRESETS[1]);
    const [currentView, setCurrentView] = useState<PrevisTransform | null>(null);

    useEffect(() => {
        if (!open) return;
        setKind(initialKind);
        // 打开那一刻的视口角度；「当前视角」机位预览与写入都用这一份。
        setCurrentView(readCurrentView());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, initialKind]);

    const previewActor = useMemo(() => ({ ...buildPrevisActorFromTemplate(actorTemplate, { index: counts.actors, color: actorColor }), pose: actorPose }), [actorColor, actorPose, actorTemplate, counts.actors]);
    const previewProp = useMemo(() => buildPrevisPropObject(prop, propColor), [prop, propColor]);
    const previewLight = useMemo(() => buildPrevisLightFromPreset(lightPreset, counts.lights), [counts.lights, lightPreset]);
    const previewCamera = useMemo(() => buildPrevisCameraFromPreset(cameraPreset, counts.cameras, currentView), [cameraPreset, counts.cameras, currentView]);

    const confirm = () => {
        if (kind === "actor") {
            if (!crowd) onConfirm({ kind, objects: [previewActor] });
            else {
                // 3×3 群众：同一模板，颜色轮换，网格站位由场景放置逻辑再做碰撞避让。
                const objects = Array.from({ length: 9 }, (_, index) => {
                    const actor = buildPrevisActorFromTemplate(actorTemplate, { index: counts.actors + index });
                    return { ...actor, pose: actorPose, transform: { ...actor.transform, position: [(index % 3) * 1.1 - 1.1, 0, Math.floor(index / 3) * 1.1 - 1.1] as PrevisTransform["position"] } };
                });
                onConfirm({ kind, objects });
            }
        } else if (kind === "prop") onConfirm({ kind, objects: [previewProp] });
        else if (kind === "light") onConfirm({ kind, light: previewLight });
        else onConfirm({ kind, camera: previewCamera });
    };

    const confirmLabel = kind === "actor" ? (crowd ? "加入 9 个角色" : `加入「${actorTemplate.label}」`) : kind === "prop" ? `加入「${prop.name}」` : kind === "light" ? `加入「${lightPreset.label}」` : `加入「${cameraPreset.label}」机位`;
    const category = PREVIS_PROP_LIBRARY.find((item) => item.id === propCategory) ?? PREVIS_PROP_LIBRARY[0];

    return (
        <Modal open={open} onCancel={onClose} footer={null} width={880} title="添加到场景" destroyOnHidden rootClassName="previs-add-dialog-root" styles={{ root: themeStyle }} centered>
            <div className="previs-add-dialog">
                <div className="previs-add-dialog__tabs" role="tablist" aria-label="添加类型">
                    {TABS.map((tab) => (
                        <button key={tab.kind} type="button" role="tab" aria-selected={kind === tab.kind} className={`previs-add-dialog__tab ${kind === tab.kind ? "is-active" : ""}`} onClick={() => setKind(tab.kind)}>
                            <tab.icon className="size-4" />
                            {tab.label}
                        </button>
                    ))}
                </div>
                <div className="previs-add-dialog__body">
                    <div className="previs-add-dialog__options">
                        {kind === "actor" ? (
                            <>
                                <OptionGrid>
                                    {PREVIS_ACTOR_TEMPLATES.map((template) => (
                                        <OptionCard key={template.id} active={actorTemplate.id === template.id} title={template.label} hint={template.hint} onClick={() => setActorTemplate(template)} />
                                    ))}
                                </OptionGrid>
                                <OptionSection title="颜色">
                                    <Swatches colors={ACTOR_SWATCHES} value={actorColor} onChange={setActorColor} />
                                </OptionSection>
                                <OptionSection title="初始姿势">
                                    <div className="previs-add-dialog__chips">
                                        {poseOptions.slice(0, 12).map((option) => (
                                            <button key={option.value} type="button" className={`previs-add-dialog__chip ${actorPose === option.value ? "is-active" : ""}`} onClick={() => setActorPose(option.value)}>
                                                {option.label}
                                            </button>
                                        ))}
                                    </div>
                                </OptionSection>
                                <label className="previs-add-dialog__check">
                                    <input type="checkbox" checked={crowd} onChange={(event) => setCrowd(event.target.checked)} />
                                    <Users className="size-3.5" />
                                    一次加入 3×3 群众
                                </label>
                                <button type="button" className="previs-add-dialog__link" onClick={onUploadModel}>
                                    <FileUp className="size-3.5" />
                                    上传自己的角色模型（.glb / .gltf）
                                </button>
                            </>
                        ) : kind === "prop" ? (
                            <>
                                <div className="previs-add-dialog__chips">
                                    {PREVIS_PROP_LIBRARY.map((item) => (
                                        <button key={item.id} type="button" className={`previs-add-dialog__chip ${propCategory === item.id ? "is-active" : ""}`} onClick={() => setPropCategory(item.id)}>
                                            {item.label}
                                        </button>
                                    ))}
                                </div>
                                <OptionGrid>
                                    {category.items.map((item) => (
                                        <OptionCard key={item.id} active={prop.id === item.id} title={item.name} hint={formatPrevisPropSize(item.size)} thumb={<PrevisPropThumb prop={item} />} onClick={() => setProp(item)} />
                                    ))}
                                </OptionGrid>
                                <OptionSection title="颜色">
                                    <Swatches colors={PROP_SWATCHES} value={propColor} onChange={setPropColor} />
                                </OptionSection>
                                <button type="button" className="previs-add-dialog__link" onClick={onUploadModel}>
                                    <FileUp className="size-3.5" />
                                    上传本地模型（.glb / .gltf）
                                </button>
                            </>
                        ) : kind === "light" ? (
                            <OptionGrid>
                                {PREVIS_LIGHT_PRESETS.map((preset) => (
                                    <OptionCard key={preset.id} active={lightPreset.id === preset.id} title={preset.label} hint={preset.hint} swatch={preset.color ?? "#ffffff"} onClick={() => setLightPreset(preset)} />
                                ))}
                            </OptionGrid>
                        ) : (
                            <OptionGrid>
                                {PREVIS_CAMERA_PRESETS.map((preset) => (
                                    <OptionCard key={preset.id} active={cameraPreset.id === preset.id} title={preset.label} hint={`${preset.hint}${preset.fromCurrentView ? "" : ` · ${preset.focalLength}mm`}`} onClick={() => setCameraPreset(preset)} />
                                ))}
                            </OptionGrid>
                        )}
                    </div>
                    <div className="previs-add-dialog__preview">
                        <div className="previs-add-dialog__preview-label">{kind === "camera" ? "机位画面预览" : kind === "light" ? "灯光效果预览（参考演员）" : "预览 · 拖动旋转"}</div>
                        <Canvas shadows dpr={[1, 1.75]} camera={{ position: [2.6, 1.7, 3.4], fov: 40 }} gl={{ antialias: true, preserveDrawingBuffer: false }}>
                            <color attach="background" args={["#d8dde3"]} />
                            <Suspense fallback={null}>
                                {kind === "actor" ? <ActorPreview actor={previewActor} /> : null}
                                {kind === "prop" ? <PropPreview object={previewProp} /> : null}
                                {kind === "light" ? <LightPreview light={previewLight} /> : null}
                                {kind === "camera" ? <CameraPreview camera={previewCamera} /> : null}
                            </Suspense>
                        </Canvas>
                        {kind === "prop" ? <div className="previs-add-dialog__preview-note">灰色人偶为 1.83m 身高参考</div> : null}
                    </div>
                </div>
                <div className="previs-add-dialog__footer">
                    <span className="previs-add-dialog__footer-hint">加入后会放在视口中心附近，自动避开已有对象，可再拖动调整。</span>
                    <button type="button" className="pv-btn" onClick={onClose}>
                        取消
                    </button>
                    <button type="button" className="pv-btn pv-btn--accent" onClick={confirm}>
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </Modal>
    );
}

function OptionGrid({ children }: { children: React.ReactNode }) {
    return <div className="previs-add-dialog__grid">{children}</div>;
}

function OptionSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="previs-add-dialog__section">
            <div className="previs-add-dialog__section-title">{title}</div>
            {children}
        </div>
    );
}

function OptionCard({ active, title, hint, thumb, swatch, onClick }: { active: boolean; title: string; hint?: string; thumb?: React.ReactNode; swatch?: string; onClick: () => void }) {
    return (
        <button type="button" className={`previs-add-dialog__card ${active ? "is-active" : ""}`} aria-pressed={active} onClick={onClick}>
            {thumb ? <span className="previs-add-dialog__card-thumb">{thumb}</span> : null}
            <span className="previs-add-dialog__card-title">
                {swatch ? <span className="previs-add-dialog__card-swatch" style={{ background: swatch }} /> : null}
                {title}
            </span>
            {hint ? <span className="previs-add-dialog__card-hint">{hint}</span> : null}
        </button>
    );
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** 预设色 + 取色器 + 十六进制输入；输入框只在合法时提交，避免半截输入把颜色改成黑色。 */
function Swatches({ colors, value, onChange }: { colors: string[]; value: string; onChange: (color: string) => void }) {
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    const custom = !colors.includes(value.toLowerCase());
    return (
        <div className="previs-add-dialog__swatches">
            {colors.map((color) => (
                <button key={color} type="button" aria-label={`颜色 ${color}`} aria-pressed={value === color} className={`previs-add-dialog__swatch ${value === color ? "is-active" : ""}`} style={{ background: color }} onClick={() => onChange(color)} />
            ))}
            <ColorPicker size="small" value={value} disabledAlpha getPopupContainer={(node) => node.parentElement ?? document.body} onChange={(color) => onChange(color.toHexString())}>
                <button type="button" aria-label="自定义颜色" aria-pressed={custom} className={`previs-add-dialog__swatch previs-add-dialog__swatch--custom ${custom ? "is-active" : ""}`} style={custom ? { background: value } : undefined} />
            </ColorPicker>
            <input
                className="previs-add-dialog__hex"
                aria-label="十六进制颜色"
                value={draft}
                maxLength={7}
                spellCheck={false}
                onChange={(event) => {
                    const next = event.target.value.startsWith("#") ? event.target.value : `#${event.target.value}`;
                    setDraft(next);
                    if (HEX_COLOR.test(next)) onChange(next.toLowerCase());
                }}
                onBlur={() => setDraft(value)}
            />
        </div>
    );
}

/* ── 预览场景 ────────────────────────────────────────────────────────────── */

function Stage({ children, target = [0, 0.9, 0] as [number, number, number], orbit = true }: { children: React.ReactNode; target?: [number, number, number]; orbit?: boolean }) {
    return (
        <>
            <hemisphereLight args={["#ffffff", "#8a939c", 0.9]} />
            <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
                <circleGeometry args={[8, 48]} />
                <meshStandardMaterial color="#c3cad1" roughness={0.95} />
            </mesh>
            <Grid position={[0, 0.002, 0]} args={[16, 16]} cellSize={0.5} sectionSize={2} cellColor="#9aa4ae" sectionColor="#7d8892" fadeDistance={14} infiniteGrid />
            {children}
            {orbit ? <OrbitControls target={target} enablePan={false} minDistance={1.4} maxDistance={14} maxPolarAngle={Math.PI * 0.49} /> : null}
        </>
    );
}

/** 预览里的标准人偶：与视口同一套模板、体型与姿势求值。 */
function PreviewMannequin({ actor, ghost = false }: { actor: Pick<PrevisObject, "archetype" | "actorProfile" | "color" | "pose" | "transform">; ghost?: boolean }) {
    const [template, setTemplate] = useState<Object3D | null>(null);
    useEffect(() => {
        let alive = true;
        loadPrevisMannequinTemplate().then(
            (value) => alive && setTemplate(value),
            () => undefined,
        );
        return () => {
            alive = false;
        };
    }, []);
    const profile = resolvePrevisMannequinProfile(actor.archetype || "adult", actor.actorProfile);
    const mannequin = useMemo(
        () => (template ? buildPrevisMannequin({ template, archetype: actor.archetype, profile, color: actor.color, castShadow: true, receiveShadow: false }) : null),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [template, actor.archetype, JSON.stringify(profile)],
    );
    useEffect(() => () => mannequin?.dispose(), [mannequin]);
    useEffect(() => {
        if (!mannequin) return;
        mannequin.setColor(ghost ? "#9aa3ad" : actor.color, false);
        mannequin.applyPose(evaluatePrevisActorPose({ pose: actor.pose || "stand", keyframes: [] }, 0));
    }, [actor.color, actor.pose, ghost, mannequin]);
    if (!mannequin) return null;
    return (
        <group position={actor.transform.position} rotation={actor.transform.rotation}>
            <primitive object={mannequin.root} />
        </group>
    );
}

function ActorPreview({ actor }: { actor: PrevisObject }) {
    return (
        <Stage>
            <directionalLight position={[3, 5, 4]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} />
            <PreviewMannequin actor={actor} />
        </Stage>
    );
}

function PropPreview({ object }: { object: PrevisObject }) {
    const [w, , d] = object.transform.scale;
    const span = Math.max(1.2, w, d, object.transform.position[1] * 2);
    // 参考人偶站在道具右侧，比例一眼可见；镜头距离随道具尺寸放大。
    const reference = useMemo(
        () => ({
            archetype: "adult" as const,
            color: "#9aa3ad",
            pose: "stand" as PrevisPose,
            transform: { position: [span * 0.5 + 0.6, 0, 0] as [number, number, number], rotation: [0, -0.5, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] },
        }),
        [span],
    );
    return (
        <Stage target={[span * 0.2, Math.min(1.2, object.transform.position[1] + 0.3), 0]}>
            <FitCamera distance={Math.max(4, span * 1.6)} />
            <directionalLight position={[3, 5, 4]} intensity={1.6} castShadow />
            <mesh position={object.transform.position} scale={object.transform.scale} castShadow receiveShadow>
                {object.primitive === "sphere" ? <sphereGeometry args={[0.6, 32, 24]} /> : object.primitive === "cylinder" ? <cylinderGeometry args={[0.5, 0.5, 1.2, 32]} /> : <boxGeometry args={[1, 1, 1]} />}
                <meshStandardMaterial color={object.color} roughness={0.7} />
            </mesh>
            <PreviewMannequin actor={reference} ghost />
        </Stage>
    );
}

function FitCamera({ distance }: { distance: number }) {
    const camera = useThree((state) => state.camera);
    useEffect(() => {
        const direction = camera.position.clone().normalize();
        camera.position.copy(direction.multiplyScalar(distance));
    }, [camera, distance]);
    return null;
}

const REFERENCE_ACTOR = {
    archetype: "adult" as const,
    color: "#e4e6ea",
    pose: "stand" as PrevisPose,
    transform: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] },
};

function LightPreview({ light }: { light: PrevisLight }) {
    const color = useMemo(() => new Color(light.color), [light.color]);
    return (
        <>
            {/* 灯光预览不用 Stage 的半球光，否则看不出单盏灯的方向与阴影。 */}
            <ambientLight intensity={0.12} />
            <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
                <circleGeometry args={[8, 48]} />
                <meshStandardMaterial color="#c3cad1" roughness={0.95} />
            </mesh>
            {light.type === "directional" ? <directionalLight position={light.transform.position} color={color} intensity={light.intensity} castShadow shadow-mapSize={[1024, 1024]} /> : null}
            {light.type === "point" ? <pointLight position={light.transform.position} color={color} intensity={light.intensity * 6} distance={0} decay={1.4} castShadow /> : null}
            {light.type === "spot" ? <SpotPreview light={light} color={color} /> : null}
            {light.type === "ambient" ? <ambientLight color={color} intensity={light.intensity * 1.4} /> : null}
            {light.type !== "ambient" ? (
                <mesh position={light.transform.position}>
                    <sphereGeometry args={[0.08, 16, 12]} />
                    <meshBasicMaterial color={color} />
                </mesh>
            ) : null}
            <PreviewMannequin actor={REFERENCE_ACTOR} />
            <FitCamera distance={6.5} />
            <OrbitControls target={[0, 1, 0]} enablePan={false} minDistance={2} maxDistance={14} maxPolarAngle={Math.PI * 0.49} />
        </>
    );
}

function SpotPreview({ light, color }: { light: PrevisLight; color: Color }) {
    const scene = useThree((state) => state.scene);
    // 聚光灯需要场景里的 target 对象才能朝向演员胸口。
    const [spotTarget] = useState(() => new Object3D());
    useEffect(() => {
        spotTarget.position.set(0, 1, 0);
        scene.add(spotTarget);
        return () => {
            scene.remove(spotTarget);
        };
    }, [scene, spotTarget]);
    return <spotLight position={light.transform.position} color={color} intensity={light.intensity * 8} angle={light.angle ?? Math.PI / 4} penumbra={light.penumbra ?? 0.35} decay={1.4} distance={0} castShadow target={spotTarget} />;
}

/** 机位预览：直接用预设机位取景参考演员，画幅按 16:9 预览。 */
function CameraPreview({ camera }: { camera: PrevisCamera }) {
    const three = useThree();
    useEffect(() => {
        const perspective = three.camera as PerspectiveCamera;
        perspective.position.set(...camera.transform.position);
        if (camera.transform.rotation.some((value) => value !== 0)) perspective.rotation.set(...camera.transform.rotation);
        else perspective.lookAt(...camera.target);
        perspective.fov = previsVerticalFov(camera.focalLength, three.size.width / Math.max(1, three.size.height));
        perspective.updateProjectionMatrix();
        three.invalidate();
    }, [camera, three]);
    return (
        <Stage orbit={false}>
            <directionalLight position={[3, 5, 4]} intensity={1.6} castShadow />
            <PreviewMannequin actor={REFERENCE_ACTOR} />
        </Stage>
    );
}
