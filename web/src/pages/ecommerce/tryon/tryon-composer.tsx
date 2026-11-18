import { Button, Popover, Select, Tooltip } from "antd";
import { ArrowLeftRight, ArrowUp, Check, FolderOpen, LayoutTemplate, LoaderCircle, Maximize2, Minus, Plus, Sparkles, Users, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type DOMAttributes, type DragEvent, type ReactNode } from "react";

import { ModelPicker } from "@/components/model-picker";
import { RollingCreditAmount } from "@/components/rolling-credit-text";
import { CreditStar } from "@/components/ui/credit-star";
import { modelDisplayName } from "@/stores/use-config-store";
import { WorkbenchAssetPicker } from "@/pages/workbench/workbench-asset-picker";

import { imageSizeLabel as ratioLabel } from "../catalog";
import { TryOnUploadTipCard } from "./tryon-demos";
import { TryOnModelLibrary } from "./tryon-model-library";
import { TryOnReferenceLibrary } from "./reference-library";
import {
    AGES,
    BODIES,
    CHIP_NAMES,
    FACE_STYLES,
    GENDERS,
    HAIR_COLORS,
    HAIRSTYLES,
    MARKET_GROUPS,
    MARKETS,
    MAX_TRYON_COUNT,
    MAX_TRYON_NOTES,
    POSE_EXAMPLES,
    PRINT_MODES,
    SCENES,
    tryOnFunction,
    type TryOnSceneMode,
    type TryOnSlot,
    type TryOnSlotKey,
    type TryOnTipKind,
} from "./tryon-kinds";
import { distributionNote, effectiveSceneMode, garmentTypeOptions, tryOnPromptReferences, usesAiModel, type TryOnImage } from "./tryon-plan";
import { ReferencePromptTextarea } from "@/components/ui/reference-prompt-textarea";
import type { TryOnState } from "./use-tryon";

const TIP_STORAGE = "ect-tip-dismissed:";

function tipDismissed(kind: TryOnTipKind) {
    try {
        return window.localStorage.getItem(TIP_STORAGE + kind) === "1";
    } catch {
        return false;
    }
}

function ratioPreview(value: string) {
    const parts = value.split(/[:x×]/).map(Number);
    const ratio = parts.length === 2 && parts.every((part) => Number.isFinite(part) && part > 0) ? parts[0] / parts[1] : 1;
    return { width: Math.max(9, Math.round(ratio >= 1 ? 22 : 22 * ratio)), height: Math.max(9, Math.round(ratio >= 1 ? 22 / ratio : 22)) };
}

function stop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
}

/** 与商品图片区块同一结构：标题 + 说明，右侧可放操作。 */
function Block({ title, hint, extra, children, className = "" }: { title: string; hint?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <section className={`ecs-block ${className}`} aria-label={title}>
            <header className="ect-block-head">
                <h3>{title}</h3>
                {hint ? <span>{hint}</span> : null}
                {extra ? <span className="ect-block-extra">{extra}</span> : null}
            </header>
            {children}
        </section>
    );
}

/** 悬浮在已上传素材上时弹出大图；句子里的「图一 / 图二」用行内锚点，不打断句子排版。 */
function MediaHover({ src, name, children, inline = false }: { src: string; name: string; children: ReactNode; inline?: boolean }) {
    if (!src) return <>{children}</>;
    return (
        <Popover
            trigger={["hover"]}
            placement="rightTop"
            mouseEnterDelay={0.25}
            mouseLeaveDelay={0.1}
            arrow={false}
            destroyOnHidden
            classNames={{ root: "ecv-hover-preview ect-media-preview" }}
            content={
                <div className="ecv-hover-card is-image">
                    <img src={src} alt={name} />
                    <footer>
                        <span title={name}>{name}</span>
                    </footer>
                </div>
            }
        >
            <span className={inline ? "ect-hover-inline" : "ecv-hover-anchor"}>{children}</span>
        </Popover>
    );
}

/** 悬停空的上传位时弹出「上传示范」；点「不再提醒」后这一类不再弹出。 */
function UploadHint({ kind, children }: { kind: TryOnTipKind; children: ReactNode }) {
    const [open, setOpen] = useState(false);
    const [dismissed, setDismissed] = useState(() => tipDismissed(kind));
    useEffect(() => setDismissed(tipDismissed(kind)), [kind]);
    if (dismissed) return <>{children}</>;
    return (
        <Popover
            open={open}
            onOpenChange={setOpen}
            trigger={["hover"]}
            mouseEnterDelay={0.25}
            mouseLeaveDelay={0.15}
            placement="rightTop"
            arrow={false}
            classNames={{ root: "ecv-tip-popover ect-tip-popover" }}
            content={
                <TryOnUploadTipCard
                    kind={kind}
                    onClose={() => setOpen(false)}
                    onDismiss={() => {
                        try {
                            window.localStorage.setItem(TIP_STORAGE + kind, "1");
                        } catch {
                            // 浏览器禁用存储时只在本次页面内不再提醒。
                        }
                        setDismissed(true);
                        setOpen(false);
                    }}
                />
            }
        >
            <span className="ecv-tip-anchor">{children}</span>
        </Popover>
    );
}

type SlotHandlers = { pick: (slot: TryOnSlot) => void; library: (slot: TryOnSlot) => void; catalog: (slot: TryOnSlot) => void };

type DropHandlers = Pick<DOMAttributes<HTMLElement>, "onDragEnter" | "onDragOver" | "onDragLeave" | "onDrop">;

/** 多张上传位：已传的图叠放在上传位里，悬停时扇形展开，点击弹出面板管理（放大、移除、继续添加）。 */
function SlotStack({ state, slot, chip, images, full, dragging, onAdd, dropHandlers }: { state: TryOnState; slot: TryOnSlot; chip: string; images: TryOnImage[]; full: boolean; dragging: boolean; onAdd: () => void; dropHandlers: DropHandlers }) {
    const [open, setOpen] = useState(false);
    const [previewId, setPreviewId] = useState("");
    const shown = images.slice(0, 5);
    const uploading = images.filter((image) => image.progress !== undefined).length;
    const failed = images.filter((image) => image.error).length;
    const preview = images.find((image) => image.id === previewId);
    const panel = (
        <div className="ect-stack-panel">
            <header>
                <div>
                    <strong>{slot.label}</strong>
                    <small>
                        {images.length}/{slot.max} 张
                    </small>
                </div>
                <Button
                    size="small"
                    disabled={full}
                    onClick={() => {
                        setOpen(false);
                        onAdd();
                    }}
                >
                    继续添加
                </Button>
                <button type="button" className="ect-stack-close" aria-label="收起" onClick={() => setOpen(false)}>
                    <X size={14} />
                </button>
            </header>
            <ul>
                {images.map((image, index) => (
                    <li key={image.id} className={image.error ? "is-error" : undefined} title={image.error || image.name}>
                        <button type="button" className="ect-stack-preview" aria-label={`放大第 ${index + 1} 张${slot.label}`} disabled={!image.previewUrl || Boolean(image.error)} onClick={() => setPreviewId(image.id)}>
                            <img src={image.previewUrl} alt="" />
                            <span aria-hidden="true">
                                <Maximize2 size={12} />
                            </span>
                        </button>
                        <span className="ect-stack-label">图·{index + 1}</span>
                        {image.progress !== undefined ? <span className="ect-stack-state">{Math.round(image.progress * 100)}%</span> : null}
                        {image.error ? <span className="ect-stack-state">失败</span> : null}
                        <button type="button" className="ect-stack-remove" aria-label={`移除 ${image.name}`} onClick={() => state.removeImage(image.id)}>
                            <X size={12} />
                        </button>
                    </li>
                ))}
            </ul>
            {preview ? (
                <div className="ect-stack-zoom">
                    <img src={preview.previewUrl} alt={preview.name} />
                    <button type="button" className="ect-stack-close" aria-label="关闭大图" onClick={() => setPreviewId("")}>
                        <X size={14} />
                    </button>
                </div>
            ) : null}
        </div>
    );
    return (
        <Popover
            content={panel}
            open={open}
            onOpenChange={(value) => {
                setOpen(value);
                if (!value) setPreviewId("");
            }}
            trigger="click"
            placement="bottomLeft"
            arrow={false}
            classNames={{ root: "app-user-overlays ect-stack-popover" }}
        >
            <button
                type="button"
                className={`ect-stack${dragging ? " is-dragging" : ""}${open ? " is-open" : ""}`}
                aria-label={`已上传 ${images.length} 张${slot.label}，展开管理`}
                aria-expanded={open}
                style={{ "--n": shown.length } as CSSProperties}
                {...dropHandlers}
            >
                {shown.map((image, index) => (
                    <img key={image.id} src={image.previewUrl} alt="" className={image.error ? "is-error" : undefined} style={{ "--i": index } as CSSProperties} />
                ))}
                <span className="ect-slot-chip">{chip}</span>
                <span className="ecv-badge">
                    {images.length}/{slot.max}
                </span>
                {uploading ? <span className="ect-stack-badge">上传中 {uploading}</span> : failed ? <span className="ect-stack-badge is-error">{failed} 张失败</span> : null}
            </button>
        </Popover>
    );
}

/** 一个上传位：单张位上传后卡片直接显示图片；多张位已传的图叠放在上传位里（见 SlotStack），不再列在下方。 */
function SlotCard({ state, slot, chip, handlers, flip }: { state: TryOnState; slot: TryOnSlot; chip: string; handlers: SlotHandlers; flip?: boolean }) {
    const [dragging, setDragging] = useState(false);
    const images = state.slotImages(slot.key);
    const single = slot.max === 1;
    const filled = single ? images[0] : undefined;
    const full = !single && images.length >= slot.max;
    const required = slot.min > 0;
    const isModelSlot = slot.key === "model" || slot.key === "subject";
    const drop = (event: DragEvent) => {
        stop(event);
        setDragging(false);
        if (!full) void state.addFiles(slot.key, Array.from(event.dataTransfer.files));
    };
    const stacked = !single && images.length > 0;
    const card = stacked ? (
        <SlotStack
            state={state}
            slot={slot}
            chip={chip}
            images={images}
            full={full}
            dragging={dragging}
            onAdd={() => handlers.pick(slot)}
            dropHandlers={{
                onDragEnter: (event) => {
                    stop(event);
                    if (!full) setDragging(true);
                },
                onDragOver: stop,
                onDragLeave: (event) => {
                    stop(event);
                    setDragging(false);
                },
                onDrop: drop,
            }}
        />
    ) : filled ? (
        <div
            className={`ect-slot-card is-filled${flip ? " is-flip" : ""}${dragging ? " is-dragging" : ""}`}
            onDragEnter={(event) => {
                stop(event);
                setDragging(true);
            }}
            onDragOver={stop}
            onDragLeave={(event) => {
                stop(event);
                setDragging(false);
            }}
            onDrop={drop}
        >
            <MediaHover src={filled.error ? "" : filled.previewUrl} name={filled.name}>
                <img src={filled.previewUrl} alt={filled.name} />
            </MediaHover>
            <span className="ect-slot-chip">{chip}</span>
            {filled.progress !== undefined ? <span className="ect-slot-progress" style={{ "--p": `${Math.round(filled.progress * 100)}%` } as CSSProperties} /> : null}
            {filled.error ? <span className="ect-slot-error">{filled.error}</span> : null}
            <button type="button" className="ect-slot-remove" aria-label={`移除${slot.label}`} onClick={() => state.removeImage(filled.id)}>
                <X size={12} />
            </button>
            <button type="button" className="ect-slot-replace" onClick={() => handlers.pick(slot)}>
                替换
            </button>
        </div>
    ) : (
        <button
            type="button"
            className={`ect-slot-card${dragging ? " is-dragging" : ""}${flip ? " is-flip" : ""}`}
            disabled={full}
            onClick={() => handlers.pick(slot)}
            onDragEnter={(event) => {
                stop(event);
                if (!full) setDragging(true);
            }}
            onDragOver={stop}
            onDragLeave={(event) => {
                stop(event);
                setDragging(false);
            }}
            onDrop={drop}
        >
            <span className={`ecv-badge${required ? " is-required" : ""}`}>{single ? (required ? "必填" : "可选") : `${images.length}/${slot.max}`}</span>
            <span className="ect-slot-plus">
                <Plus size={20} />
            </span>
            <strong>{slot.label}</strong>
            <small>{chip}</small>
        </button>
    );
    return (
        <div className="ect-slot">
            {filled || stacked ? card : <UploadHint kind={slot.tip}>{card}</UploadHint>}
            <div className="ect-slot-tools">
                <button type="button" className="ecv-library" disabled={full} onClick={() => handlers.library(slot)}>
                    <FolderOpen size={12} /> 素材库
                </button>
                {isModelSlot ? (
                    <button type="button" className="ecv-library is-soft" disabled={full} onClick={() => handlers.catalog(slot)}>
                        <Users size={12} /> 模特库
                    </button>
                ) : null}
            </div>
            <p className="ecv-slot-note">{slot.note}</p>
        </div>
    );
}

/** 句子里的「图一 / 图二」：点击上传，已上传时显示缩略图。 */
function SentenceChip({ state, slot, chip, onPick }: { state: TryOnState; slot: TryOnSlot; chip: string; onPick: () => void }) {
    const images = state.slotImages(slot.key).filter((image) => !image.error);
    const first = images[0];
    const content = (
        <button type="button" className={`ect-sentence-chip${first ? " is-filled" : ""}`} onClick={onPick} title={`上传${slot.label}`}>
            {first ? <img src={first.previewUrl} alt="" /> : <Plus size={11} />}
            {chip}
            {images.length > 1 ? <small>×{images.length}</small> : null}
        </button>
    );
    return first ? (
        <MediaHover src={first.previewUrl} name={first.name} inline>
            {content}
        </MediaHover>
    ) : (
        content
    );
}

function Chips<T extends string>({ values, selected, onToggle, label, max }: { values: Array<{ value: T; label: string; title?: string }>; selected: T[]; onToggle: (value: T) => void; label: string; max?: number }) {
    return (
        <div className="ecs-phrase-chips ect-chips" role="group" aria-label={label}>
            {values.map((item, index) => {
                const pressed = selected.includes(item.value);
                return (
                    <button
                        key={item.value}
                        type="button"
                        className="ecs-chip"
                        title={item.title}
                        aria-pressed={pressed}
                        disabled={!pressed && max !== undefined && selected.length >= max}
                        style={{ "--i": index } as CSSProperties}
                        onClick={() => onToggle(item.value)}
                    >
                        {pressed ? <Check size={11} /> : null}
                        {item.label}
                    </button>
                );
            })}
        </div>
    );
}

function Segment<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string; disabled?: boolean; title?: string }>; onChange: (value: T) => void; label: string }) {
    return (
        <div className="ecs-segment" role="group" aria-label={label}>
            {options.map((item) => (
                <button key={item.value} type="button" aria-pressed={value === item.value} disabled={item.disabled} title={item.title} onClick={() => onChange(item.value)}>
                    {item.label}
                </button>
            ))}
        </div>
    );
}

/** 卡片式单选（与商品视频「声音」三选一同一套样式）。 */
function Choices<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string; hint: string; disabled?: boolean; icon?: ReactNode }>; onChange: (value: T) => void; label: string }) {
    return (
        <div className="ecv-audio ect-choices" role="radiogroup" aria-label={label} style={{ "--cols": options.length } as CSSProperties}>
            {options.map((item) => (
                <button key={item.value} type="button" role="radio" aria-checked={value === item.value} disabled={item.disabled} onClick={() => onChange(item.value)}>
                    <strong>
                        {item.icon}
                        {item.label}
                    </strong>
                    <small>{item.hint}</small>
                </button>
            ))}
        </div>
    );
}

function MarketChips({ state, label, optional = false }: { state: TryOnState; label: string; optional?: boolean }) {
    const { draft } = state;
    const toggle = (id: string) => {
        const next = draft.markets.includes(id) ? draft.markets.filter((value) => value !== id) : [...draft.markets, id].slice(-8);
        state.update({ markets: next });
    };
    return (
        <div className="ecs-field ect-markets">
            <span>
                {label}
                <small>{optional ? (draft.markets.length ? `已选 ${draft.markets.length} 个，多选时轮流选角` : "不选则跟随原图人物") : `已选 ${draft.markets.length} 个 · 多选时每张轮流换国家`}</small>
            </span>
            {MARKET_GROUPS.map((group) => (
                <div key={group} className="ect-market-group">
                    <em>{group}</em>
                    <Chips values={MARKETS.filter((item) => item.group === group).map((item) => ({ value: item.id, label: item.label, title: item.casting }))} selected={draft.markets} onToggle={toggle} label={`${group}国家和地区`} />
                </div>
            ))}
        </div>
    );
}

function CastingOptions({ state }: { state: TryOnState }) {
    const { draft } = state;
    return (
        <div className="ect-casting">
            <MarketChips state={state} label="国家和地区" />
            <div className="ecs-field-row">
                <div className="ecs-field">
                    <span>性别</span>
                    <Segment value={draft.gender} options={GENDERS} onChange={(gender) => state.update({ gender })} label="模特性别" />
                </div>
                <div className="ecs-field">
                    <span>身材</span>
                    <Select variant="filled" value={draft.body} options={BODIES.map((item) => ({ value: item.value, label: item.label }))} onChange={(body) => state.update({ body })} aria-label="模特身材" />
                </div>
            </div>
            <div className="ecs-field">
                <span>年龄</span>
                <Segment value={draft.age} options={AGES.map((item) => ({ value: item.value, label: item.label }))} onChange={(age) => state.update({ age })} label="模特年龄" />
            </div>
        </div>
    );
}

function ExamplesButton({ examples, onPick }: { examples: string[]; onPick: (value: string) => void }) {
    const [open, setOpen] = useState(false);
    return (
        <Popover
            open={open}
            onOpenChange={setOpen}
            trigger={["click"]}
            placement="bottomRight"
            arrow={false}
            classNames={{ root: "ect-examples-popover" }}
            content={
                <div className="ect-examples" role="listbox" aria-label="案例提示词">
                    <strong>案例提示词 · 点击填入</strong>
                    {examples.map((example, index) => (
                        <button
                            key={example}
                            type="button"
                            role="option"
                            aria-selected={false}
                            style={{ "--i": index } as CSSProperties}
                            onClick={() => {
                                onPick(example);
                                setOpen(false);
                            }}
                        >
                            <Sparkles size={12} />
                            <span>{example}</span>
                        </button>
                    ))}
                </div>
            }
        >
            <button type="button" className="ect-template" aria-haspopup="listbox" aria-expanded={open}>
                <LayoutTemplate size={13} />
                模板
            </button>
        </Popover>
    );
}

export function TryOnComposerSections({ state }: { state: TryOnState }) {
    const { draft } = state;
    const config = tryOnFunction(draft.fn);
    const ai = usesAiModel(draft);
    const inputs = useRef<Partial<Record<TryOnSlotKey, HTMLInputElement | null>>>({});
    const [library, setLibrary] = useState<TryOnSlot | null>(null);
    const [referenceLibrary, setReferenceLibrary] = useState<TryOnSlot | null>(null);
    const [catalog, setCatalog] = useState<TryOnSlot | null>(null);
    const [swapTurn, setSwapTurn] = useState(0);
    const visibleSlots = config.slots.filter((slot) => !(slot.key === "model" && ai));
    const sentence = ai && config.aiSentence ? config.aiSentence : config.sentence;
    const chipOf = (key: TryOnSlotKey) =>
        CHIP_NAMES[
            Math.max(
                0,
                visibleSlots.findIndex((slot) => slot.key === key),
            )
        ] || "图一";
    const handlers: SlotHandlers = {
        pick: (slot) => inputs.current[slot.key]?.click(),
        library: (slot) => (slot.key === "pose" || slot.key === "garment" ? setReferenceLibrary(slot) : setLibrary(slot)),
        catalog: (slot) => setCatalog(slot),
    };
    const swap = config.swap && visibleSlots.length === 2 && config.swap.every((key) => visibleSlots.some((slot) => slot.key === key)) ? config.swap : null;
    const sceneMode = effectiveSceneMode(draft);
    const notesCount = Array.from(draft.notes).length;
    const editFunction = draft.fn === "face-swap" || draft.fn === "smart-face" || draft.fn === "smart-head" || draft.fn === "pose";
    // 不能选时按功能固定显示：上传多位模特 = 每张各用一位（智能匹配），其余沿用上传的同一人（统一模特），印花不涉及模特。
    const fixedCasting = draft.fn === "print" ? null : draft.fn === "multi-model" ? "smart" : "unified";
    const castingNote = state.castingSelectable
        ? draft.casting === "unified"
            ? config.castingNote?.unified
            : config.castingNote?.smart
        : draft.fn === "print"
          ? "印花提取不涉及模特"
          : draft.fn === "multi-model"
            ? "使用你上传的每一位模特"
            : config.castingNote?.smart;
    const castingPressed = (value: "smart" | "unified") => (state.castingSelectable ? draft.casting === value : fixedCasting === value);
    const catalogSelected = state
        .slotImages(catalog?.key || "model")
        .map((image) => image.catalogId || "")
        .filter(Boolean);
    const catalogRoom = catalog ? (catalog.max === 1 ? 1 : catalog.max - state.slotImages(catalog.key).length) : 0;
    const appendExample = (example: string) => {
        const current = draft.notes.trim();
        const next = current && !current.includes(example) ? `${current}；${example}` : example;
        state.update({ notes: Array.from(next).slice(0, MAX_TRYON_NOTES).join("") });
    };
    return (
        <>
            <section className="ecs-block ect-command" aria-label="换装指令">
                <div className="ect-card">
                    <div className="ect-sentence">
                        <p key={`${draft.fn}-${ai}`} className="ect-sentence-text">
                            {sentence.map((part, index) =>
                                typeof part === "string" ? (
                                    <span key={index}>{part}</span>
                                ) : (
                                    (() => {
                                        const slot = visibleSlots.find((item) => item.key === part.slot);
                                        return slot ? <SentenceChip key={index} state={state} slot={slot} chip={chipOf(slot.key)} onPick={() => handlers.pick(slot)} /> : null;
                                    })()
                                ),
                            )}
                        </p>
                        <ExamplesButton examples={config.examples} onPick={appendExample} />
                    </div>
                    <div className={`ect-slots${swap ? " has-swap" : ""}`} data-count={visibleSlots.length}>
                        {visibleSlots.map((slot, index) => (
                            <div key={`${draft.fn}-${slot.key}`} className="ect-slot-cell" style={{ "--i": index } as CSSProperties}>
                                <SlotCard state={state} slot={slot} chip={chipOf(slot.key)} handlers={handlers} flip={index === 1} />
                                {swap && index === 0 ? (
                                    <Tooltip title={`${config.slots.find((item) => item.key === swap[0])?.label}与${config.slots.find((item) => item.key === swap[1])?.label}互换`} mouseEnterDelay={0.3}>
                                        <button
                                            type="button"
                                            className="ect-swap"
                                            aria-label="互换两边的素材"
                                            onClick={() => {
                                                setSwapTurn((value) => value + 1);
                                                state.swap(swap[0], swap[1]);
                                            }}
                                        >
                                            <ArrowLeftRight key={swapTurn} size={15} className={swapTurn ? "is-turn" : undefined} />
                                        </button>
                                    </Tooltip>
                                ) : null}
                            </div>
                        ))}
                        {visibleSlots.map((slot) => (
                            <input
                                key={`input-${slot.key}`}
                                ref={(element) => {
                                    inputs.current[slot.key] = element;
                                }}
                                hidden
                                type="file"
                                accept="image/png,image/jpeg,image/webp,image/*"
                                multiple={slot.max > 1}
                                onChange={(event) => {
                                    void state.addFiles(slot.key, Array.from(event.target.files || []));
                                    event.target.value = "";
                                }}
                            />
                        ))}
                    </div>
                    <div className="ect-notes">
                        <ReferencePromptTextarea materials={tryOnPromptReferences(draft)} value={draft.notes} rows={4} placeholder={config.placeholder} aria-invalid={notesCount > MAX_TRYON_NOTES} onChange={(notes) => state.update({ notes })} />
                        <span className={`ecv-count${notesCount > MAX_TRYON_NOTES ? " is-over" : ""}`}>
                            {notesCount}/{MAX_TRYON_NOTES}
                        </span>
                    </div>
                </div>
            </section>

            {draft.fn === "multi-model" || draft.fn === "multi-outfit" ? (
                <Block title="模特来源" hint={ai ? "AI 按国家选出真人模特，肤色、五官与发型随地区变化" : "上传自己的模特，或从真人模特库选择"}>
                    <Choices
                        value={draft.modelSource}
                        label="模特来源"
                        onChange={(modelSource) => state.update({ modelSource })}
                        options={[
                            { value: "upload", label: "我的模特", hint: draft.fn === "multi-model" ? "上传多位模特，每位都穿同一件" : "上传一位模特试穿每件衣服" },
                            { value: "ai", label: "AI 真人选角", hint: draft.fn === "multi-model" ? "按国家生成不同的真人模特" : "生成一位真人模特，全程同一人", icon: <Sparkles size={13} /> },
                        ]}
                    />
                    {ai ? <CastingOptions state={state} /> : null}
                    {draft.fn === "multi-outfit" ? (
                        <div className="ecs-field">
                            <span>
                                出图方式 <small>{draft.outfitMode === "set" ? "所有单品组合成一整套，全身入镜" : "一件衣服出一组图，方便做 SKU 对比"}</small>
                            </span>
                            <Segment
                                value={draft.outfitMode}
                                label="出图方式"
                                onChange={(outfitMode) => state.update({ outfitMode })}
                                options={[
                                    { value: "each", label: "逐件上身" },
                                    { value: "set", label: "整套搭配" },
                                ]}
                            />
                        </div>
                    ) : null}
                </Block>
            ) : null}

            {draft.fn === "pose" ? (
                <Block title="文本姿势" hint="不想找姿势图时直接选，选几个就出几种姿势">
                    <Chips
                        values={POSE_EXAMPLES.map((value) => ({ value, label: value }))}
                        selected={draft.poses}
                        onToggle={(value) => state.update({ poses: draft.poses.includes(value) ? draft.poses.filter((item) => item !== value) : [...draft.poses, value].slice(0, 12) })}
                        label="文本姿势"
                        max={12}
                    />
                </Block>
            ) : null}

            {draft.fn === "face-swap" ? (
                <Block title="换脸设置">
                    <label className="ecv-check ecv-check-strong">
                        <input type="checkbox" checked={draft.consent} onChange={(event) => state.update({ consent: event.target.checked })} />
                        <span>
                            我确认已取得脸部照片中人物的肖像授权
                            <small>换成真实人物的脸必须获得本人同意；不确定时请使用「智能换脸」生成 AI 原创面孔。</small>
                        </span>
                    </label>
                </Block>
            ) : null}

            {draft.fn === "smart-face" || draft.fn === "smart-head" ? (
                <Block title={draft.fn === "smart-face" ? "新面孔方向" : "新头型方向"} hint="生成 AI 原创的真人面孔，不对应任何真实人物">
                    <MarketChips state={state} label="国家和地区" optional />
                    <label className="ecv-check">
                        <input type="checkbox" checked={draft.keepGender} onChange={(event) => state.update({ keepGender: event.target.checked })} />
                        <span>保持原图人物的性别与年龄感</span>
                    </label>
                    {!draft.keepGender ? (
                        <div className="ecs-field-row">
                            <div className="ecs-field">
                                <span>性别</span>
                                <Segment value={draft.gender} options={GENDERS} onChange={(gender) => state.update({ gender })} label="新面孔性别" />
                            </div>
                            <div className="ecs-field">
                                <span>年龄</span>
                                <Select variant="filled" value={draft.age} options={AGES.map((item) => ({ value: item.value, label: item.label }))} onChange={(age) => state.update({ age })} aria-label="新面孔年龄" />
                            </div>
                        </div>
                    ) : null}
                    {draft.fn === "smart-face" ? (
                        <>
                            <div className="ecs-field">
                                <span>
                                    气质 <small>可多选，多张时轮流使用</small>
                                </span>
                                <Chips
                                    values={FACE_STYLES.map((value) => ({ value, label: value }))}
                                    selected={draft.faceStyles}
                                    onToggle={(value) => state.update({ faceStyles: draft.faceStyles.includes(value) ? draft.faceStyles.filter((item) => item !== value) : [...draft.faceStyles, value] })}
                                    label="气质"
                                />
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="ecs-field">
                                <span>发型</span>
                                <Chips values={HAIRSTYLES.map((value) => ({ value, label: value }))} selected={[draft.hairstyle]} onToggle={(hairstyle) => state.update({ hairstyle })} label="发型" />
                            </div>
                            <div className="ecs-field">
                                <span>发色</span>
                                <Chips values={HAIR_COLORS.map((value) => ({ value, label: value }))} selected={[draft.hairColor]} onToggle={(hairColor) => state.update({ hairColor })} label="发色" />
                            </div>
                        </>
                    )}
                </Block>
            ) : null}

            {draft.fn === "print" ? (
                <Block title="印花输出" hint="单独图案导出透明 PNG，其他形式按模型原图下载">
                    <Choices
                        value={draft.printMode}
                        label="印花输出形式"
                        onChange={(printMode) => state.update({ printMode, ratio: printMode === "seamless" ? "1:1" : draft.ratio })}
                        options={PRINT_MODES.map((item) => ({ value: item.value, label: item.label, hint: item.hint }))}
                    />
                    <label className="ecv-check">
                        <input type="checkbox" checked={draft.flatten} onChange={(event) => state.update({ flatten: event.target.checked })} />
                        <span>去除褶皱、阴影与面料光泽，输出平整的设计稿</span>
                    </label>
                </Block>
            ) : null}

            {config.scenes ? (
                <Block title="场景与风格" hint={sceneMode === "keep" ? "保持模特原图的姿势与背景，只换衣服" : sceneMode === "smart" ? "每张图换一个适合这件衣服的场景" : "按你选的场景轮流出图"}>
                    <Choices<TryOnSceneMode>
                        value={sceneMode}
                        label="场景"
                        onChange={(value) => state.update({ sceneMode: value })}
                        options={[
                            { value: "keep", label: "保持原图", hint: "姿势、背景与光线不变", disabled: ai },
                            { value: "smart", label: "Agent 多场景", hint: "按服装规划不同场景", icon: <Sparkles size={13} /> },
                            { value: "custom", label: "指定场景", hint: "选几个场景轮流出图" },
                        ]}
                    />
                    {sceneMode === "custom" ? (
                        <Chips
                            values={SCENES.map((item) => ({ value: item.id, label: item.label, title: item.text }))}
                            selected={draft.scenes}
                            onToggle={(id) => state.update({ scenes: draft.scenes.includes(id) ? draft.scenes.filter((item) => item !== id) : [...draft.scenes, id] })}
                            label="指定场景"
                        />
                    ) : null}
                    {sceneMode !== "keep" ? (
                        <div className="ecs-field">
                            <span>
                                服装品类 <small>{draft.garmentType === "auto" ? "Agent 读图识别；关闭 Agent 时按通用场景轮换" : "决定穿着方式与适合的场景"}</small>
                            </span>
                            <Select variant="filled" value={draft.garmentType} options={garmentTypeOptions} onChange={(garmentType) => state.update({ garmentType })} aria-label="服装品类" />
                        </div>
                    ) : null}
                    {sceneMode === "smart" ? (
                        <label className="ecv-check ecv-check-strong ect-agent-check">
                            <input type="checkbox" checked={draft.agent} onChange={(event) => state.update({ agent: event.target.checked })} />
                            <span>
                                Agent 结合后台知识库规划多场景
                                <small>
                                    {draft.agent ? "先识别服装品类、风格与季节，再按后台电商知识库（场景、选角、摄影与平台规范）为每张图规划不同的场景、姿势和机位。" : "不调用 Agent：按服装品类从内置场景库轮换场景与姿势，出图更快、不产生规划费用。"}
                                </small>
                            </span>
                        </label>
                    ) : null}
                </Block>
            ) : null}

            <Block title="模型与规格" hint="比例与清晰度随模型变化">
                <ModelPicker
                    config={state.config}
                    capability="image"
                    value={state.imageModel}
                    requirements={{ capability: "image", input: { textCount: 1, imageCount: state.refsPerImage, videoCount: 0, audioCount: 0, characterCount: 0 } }}
                    fullWidth
                    variant="creation"
                    className="creation-model-picker ecs-model-picker"
                    showSelectedPrice={false}
                    showOptionPrices
                    modelFilter={state.systemModel}
                    placeholder="选择图片模型"
                    onChange={state.setModel}
                />
                <div className="ecs-field">
                    <span>
                        比例{" "}
                        <small>
                            {modelDisplayName(state.config, state.imageModel)} 支持 {state.ratioChoices.length} 种
                        </small>
                    </span>
                    <div className="ecs-ratio-grid" key={state.imageModel}>
                        {state.ratioChoices.map(({ label, value }) => (
                            <button type="button" key={label} className="ecs-choice" aria-pressed={ratioLabel(state.ratio) === label} onClick={() => state.update({ ratio: value })}>
                                <span className="ecs-ratio-icon" style={ratioPreview(value)} aria-hidden="true" />
                                {label}
                            </button>
                        ))}
                    </div>
                    {state.ratio === "auto" ? <p className="ecs-note">{editFunction ? "自动：每张跟随原图比例" : "自动选择适合当前图片的比例"}</p> : null}
                </div>
                <div className="ecs-field-row">
                    <div className="ecs-field">
                        <span>清晰度</span>
                        <div className="ecs-segment" role="group" aria-label="清晰度">
                            {state.resolutionChoices.map((value) => (
                                <button type="button" key={value} aria-pressed={state.resolution === value} onClick={() => state.update({ resolution: value })}>
                                    {value.toUpperCase()}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="ecs-field">
                        <span>模特</span>
                        <Tooltip title={castingNote} mouseEnterDelay={0.3}>
                            <div className="ecs-segment" role="group" aria-label="画面模特">
                                <button type="button" aria-pressed={castingPressed("smart")} disabled={!state.castingSelectable} onClick={() => state.update({ casting: "smart" })}>
                                    智能匹配
                                </button>
                                <button type="button" aria-pressed={castingPressed("unified")} disabled={!state.castingSelectable} onClick={() => state.update({ casting: "unified" })}>
                                    统一模特
                                </button>
                            </div>
                        </Tooltip>
                    </div>
                </div>
                <div className="ecs-field">
                    <span>
                        张数 <small>{distributionNote({ ...draft, count: state.count }) || `最多 ${MAX_TRYON_COUNT} 张`}</small>
                    </span>
                    <div className="ecs-stepper" role="group" aria-label="图片张数">
                        <button type="button" aria-label="减少一张" disabled={state.count <= state.units} onClick={() => state.setCount(state.count - 1)}>
                            <Minus size={14} />
                        </button>
                        <output aria-live="polite" key={state.count} className="ect-count-bump">
                            {state.count} 张
                        </output>
                        <button type="button" aria-label="增加一张" disabled={state.count >= MAX_TRYON_COUNT} onClick={() => state.setCount(state.count + 1)}>
                            <Plus size={14} />
                        </button>
                    </div>
                </div>
            </Block>

            {referenceLibrary ? (
                <TryOnReferenceLibrary
                    key={referenceLibrary.key}
                    kind={referenceLibrary.key === "pose" ? "pose" : "garment"}
                    room={referenceLibrary.max === 1 ? 1 : Math.max(0, referenceLibrary.max - state.slotImages(referenceLibrary.key).length)}
                    onClose={() => setReferenceLibrary(null)}
                    onPersonal={() => {
                        setLibrary(referenceLibrary);
                        setReferenceLibrary(null);
                    }}
                    onPick={(selections) => state.addReferences(referenceLibrary.key, selections)}
                />
            ) : null}
            {library ? (
                <WorkbenchAssetPicker
                    open
                    accept={["image"]}
                    maxCount={Math.max(1, library.max === 1 ? 1 : library.max - state.slotImages(library.key).length)}
                    slotName={library.label}
                    onClose={() => setLibrary(null)}
                    onPick={(picked) =>
                        state.addResources(
                            library.key,
                            picked.map((item) => ({ resourceId: item.resourceId, name: item.name })),
                        )
                    }
                />
            ) : null}
            <TryOnModelLibrary
                open={Boolean(catalog)}
                room={catalogRoom}
                selected={catalogSelected}
                onClose={() => setCatalog(null)}
                onPick={async (profile) => {
                    if (!catalog) return;
                    await state.addCatalog(catalog.key, profile);
                    if (catalog.max === 1) setCatalog(null);
                }}
            />
        </>
    );
}

export function TryOnFooter({ state, onSubmitted }: { state: TryOnState; onSubmitted?: () => void }) {
    const busy = state.submitting;
    const reason = state.missing;
    const planned = state.planned;
    return (
        <footer className="ecs-footer">
            <div className="ecs-estimate" aria-live="polite">
                {state.total === null ? (
                    <strong className="is-pending">{state.estimate.loading ? "报价中" : "待报价"}</strong>
                ) : (
                    <strong title={planned && state.estimate.agent ? `含 Agent 规划 ${state.estimate.agent.toLocaleString("zh-CN", { maximumFractionDigits: 3 })} 积分` : undefined}>
                        <CreditStar />
                        <RollingCreditAmount value={state.total} maximumFractionDigits={3} />
                        <span>积分</span>
                    </strong>
                )}
                <span>{reason || `${state.count} 张 · ${planned ? (state.draft.fn === "face-swap" || state.draft.fn === "smart-face" ? "Agent 锁定原发型后只换五官" : "Agent 规划多场景后自动出图") : "按设置直接出图"}`}</span>
            </div>
            <Button
                type="primary"
                className="ecs-submit ect-submit"
                aria-busy={busy}
                disabled={Boolean(reason) || busy}
                icon={busy ? <LoaderCircle className="commerce-planning-spin" size={15} /> : <ArrowUp size={15} />}
                onClick={() =>
                    void state.generate().then((batch) => {
                        if (batch) onSubmitted?.();
                    })
                }
            >
                开始生成
            </Button>
        </footer>
    );
}
