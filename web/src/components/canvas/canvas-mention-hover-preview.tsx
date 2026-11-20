// 悬停在提示词 @ 引用胶囊上时显示的小预览卡。
//
// 胶囊是 contentEditable 里命令式创建的 DOM，事件在编辑器上统一委托处理。预览卡挂到 body、使用 --z-tooltip，
// 放大编辑弹窗（AntD Modal）里同样在最上层；卡片不接收指针、不抢焦点，不影响输入和拖放替换。

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Image as ImageIcon } from "lucide-react";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { primeVideoPreviewFrame, referencePreviewUrl } from "./canvas-mention-chips";
import { clamp } from "./canvas-mention-menu";

// 与 Tooltip 一致：首次悬停 500ms 才出现，刚收起后的短时间内移到相邻胶囊立即切换。
const OPEN_DELAY_MS = 500;
const WARM_WINDOW_MS = 400;
const VIEWPORT_INSET = 8;
const ANCHOR_GAP = 6;

export type MentionHoverTarget = { chip: HTMLElement; reference: CanvasResourceReference };

type HoveredChip = { chip: HTMLElement; container: HTMLElement; referenceId: string };

function mentionChipFromTarget(target: EventTarget | null) {
    return target instanceof Element ? target.closest<HTMLElement>("[data-mention-reference-id]") : null;
}

export function useMentionHoverPreview(references: CanvasResourceReference[]) {
    const [hovered, setHovered] = useState<HoveredChip | null>(null);
    const referencesRef = useRef(references);
    const shownChipRef = useRef<HTMLElement | null>(null);
    const pointerChipRef = useRef<HTMLElement | null>(null);
    const suppressedChipRef = useRef<HTMLElement | null>(null);
    const timerRef = useRef<number | undefined>(undefined);
    const closedAtRef = useRef(0);

    useLayoutEffect(() => {
        referencesRef.current = references;
    });

    const close = useCallback(() => {
        window.clearTimeout(timerRef.current);
        if (!shownChipRef.current) return;
        shownChipRef.current = null;
        closedAtRef.current = Date.now();
        setHovered(null);
    }, []);

    /** 点击、输入、滚动、双击放大时收起；指针离开当前胶囊之前不再弹出。 */
    const dismiss = useCallback(() => {
        suppressedChipRef.current = pointerChipRef.current;
        close();
    }, [close]);

    const onPointerOver = useCallback(
        (event: ReactPointerEvent<HTMLElement>) => {
            const chip = mentionChipFromTarget(event.target);
            if (!chip || event.pointerType === "touch") return;
            pointerChipRef.current = chip;
            if (chip === shownChipRef.current || chip === suppressedChipRef.current) return;
            window.clearTimeout(timerRef.current);
            const referenceId = chip.dataset.mentionReferenceId || "";
            const reference = referencesRef.current.find((item) => item.id === referenceId);
            if (!reference || !referencePreviewUrl(reference)) {
                close();
                return;
            }
            const container = event.currentTarget;
            const open = () => {
                if (!chip.isConnected || pointerChipRef.current !== chip) return;
                shownChipRef.current = chip;
                setHovered({ chip, container, referenceId });
            };
            if (shownChipRef.current || Date.now() - closedAtRef.current < WARM_WINDOW_MS) open();
            else timerRef.current = window.setTimeout(open, OPEN_DELAY_MS);
        },
        [close],
    );

    const onPointerOut = useCallback(
        (event: ReactPointerEvent<HTMLElement>) => {
            const chip = mentionChipFromTarget(event.target);
            if (!chip) return;
            if (event.relatedTarget instanceof Node && chip.contains(event.relatedTarget)) return;
            if (pointerChipRef.current === chip) pointerChipRef.current = null;
            if (suppressedChipRef.current === chip) suppressedChipRef.current = null;
            close();
        },
        [close],
    );

    useEffect(() => {
        if (!hovered) return;
        // 重画提示词会替换胶囊节点；锚点脱离文档后立即收起，指针再动一下会落到新胶囊上。
        const observer = new MutationObserver(() => {
            if (!hovered.chip.isConnected) close();
        });
        observer.observe(hovered.container, { childList: true, subtree: true });
        window.addEventListener("scroll", close, true);
        window.addEventListener("resize", close);
        return () => {
            observer.disconnect();
            window.removeEventListener("scroll", close, true);
            window.removeEventListener("resize", close);
        };
    }, [close, hovered]);

    useEffect(() => () => window.clearTimeout(timerRef.current), []);

    const reference = hovered ? references.find((item) => item.id === hovered.referenceId) : undefined;
    const target: MentionHoverTarget | null = hovered && reference && referencePreviewUrl(reference) ? { chip: hovered.chip, reference } : null;
    return { target, onPointerOver, onPointerOut, dismiss };
}

type CardLayout = { left: number; top: number; placement: "top" | "bottom" };

export function MentionHoverPreview({ target }: { target: MentionHoverTarget }) {
    const { chip, reference } = target;
    const cardRef = useRef<HTMLDivElement | null>(null);
    const { t } = useTranslation();
    const [layout, setLayout] = useState<CardLayout | null>(null);
    const [failedUrl, setFailedUrl] = useState("");
    const imageUrl = reference.previewUrl || "";
    const videoUrl = !imageUrl && reference.kind === "video" ? reference.mediaUrl || "" : "";
    const mediaFailed = Boolean(imageUrl) && failedUrl === imageUrl;

    const place = useCallback(() => {
        const card = cardRef.current;
        if (!card || !chip.isConnected) return;
        const anchor = chip.getBoundingClientRect();
        const size = card.getBoundingClientRect();
        // 默认放在胶囊上方，上方放不下且下方更宽时翻到下方；水平方向居中后夹在视口内。
        const spaceAbove = anchor.top - ANCHOR_GAP - VIEWPORT_INSET;
        const spaceBelow = window.innerHeight - anchor.bottom - ANCHOR_GAP - VIEWPORT_INSET;
        const placement = spaceAbove >= size.height || spaceAbove >= spaceBelow ? "top" : "bottom";
        const left = clamp(anchor.left + anchor.width / 2 - size.width / 2, VIEWPORT_INSET, window.innerWidth - size.width - VIEWPORT_INSET);
        const top = placement === "top" ? Math.max(VIEWPORT_INSET, anchor.top - ANCHOR_GAP - size.height) : Math.max(VIEWPORT_INSET, Math.min(anchor.bottom + ANCHOR_GAP, window.innerHeight - size.height - VIEWPORT_INSET));
        setLayout((current) => (current && current.left === left && current.top === top && current.placement === placement ? current : { left, top, placement }));
    }, [chip]);

    useLayoutEffect(() => {
        place();
    }, [place, imageUrl, videoUrl, mediaFailed, reference.label, reference.title]);

    const caption = reference.title && reference.title !== reference.label ? reference.title : "";
    return createPortal(
        <div ref={cardRef} aria-hidden className="canvas-mention-hover-preview ra-pop-in" data-placement={layout?.placement ?? "top"} style={{ left: layout?.left ?? 0, top: layout?.top ?? 0, visibility: layout ? "visible" : "hidden" }}>
            <div className="canvas-mention-hover-preview-media">
                {imageUrl && !mediaFailed ? (
                    <img src={imageUrl} alt="" draggable={false} onLoad={place} onError={() => setFailedUrl(imageUrl)} />
                ) : videoUrl ? (
                    <video
                        src={videoUrl}
                        muted
                        playsInline
                        preload="metadata"
                        onLoadedMetadata={(event) => {
                            primeVideoPreviewFrame(event.currentTarget);
                            place();
                        }}
                    />
                ) : (
                    <ImageIcon className="canvas-mention-hover-preview-fallback" />
                )}
            </div>
            <div className="canvas-mention-hover-preview-caption">
                <strong>{reference.label}</strong>
                {caption ? <span>{caption}</span> : null}
                <small>{t("canvasB.mention.doubleClickZoom")}</small>
            </div>
        </div>,
        document.body,
    );
}
