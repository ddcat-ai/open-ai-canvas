import type { CanvasAppearance } from "@/lib/canvas/agent-appearance";
import { spriteThumbnailURL } from "@/services/api/appearance";
import { useSpriteImage } from "./use-sprite-image";
import { Circle, RotateCw, UserRound } from "lucide-react";
import "./pet-thumbnail.css";
import { useEffect, useRef, useState } from "react";
import { petAvatarSize } from "@/lib/canvas/pet-menu";

// Pickers load a small neutral frame, never an animation atlas or a Live2D context.
export function PetThumbnail({ pet, preview = false }: { pet: Pick<CanvasAppearance, "avatarType" | "sprite" | "spriteResourceId">; preview?: boolean }) {
    const url = pet.avatarType === "sprite" && pet.spriteResourceId && pet.sprite ? spriteThumbnailURL(pet.spriteResourceId, pet.sprite, preview) : "";
    const host = useRef<HTMLSpanElement>(null),
        [visible, setVisible] = useState(false);
    const [loaded, setLoaded] = useState("");
    useEffect(() => {
        const node = host.current;
        if (!node || !url) return;
        if (typeof IntersectionObserver === "undefined") {
            setVisible(true);
            return;
        }
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setVisible(true);
                    observer.disconnect();
                }
            },
            { root: node.closest(".pet-menu-models.is-grid"), rootMargin: "88px 0px" },
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [url]);
    const image = useSpriteImage(visible ? url : "", "thumbnail");
    const [retried, setRetried] = useState("");
    useEffect(() => {
        if (!image.error || retried === url) return;
        const timer = setTimeout(() => {
            setRetried(url);
            image.retry();
        }, 1500);
        return () => clearTimeout(timer);
    }, [image.error, url, retried, image.retry]);
    if (pet.avatarType !== "sprite" || !pet.sprite || !url)
        return (
            <span className="pet-thumbnail-symbol" aria-hidden>
                {pet.avatarType === "orb" ? <Circle /> : <UserRound />}
            </span>
        );
    const { width: w, height: h } = petAvatarSize(pet, 44);
    return (
        <span ref={host} aria-hidden className="pet-thumbnail-stage" title={image.error ? "预览暂不可用，仍可选择此形象" : undefined}>
            <span className={`pet-thumbnail ${loaded === image.src && image.src ? "is-ready" : image.error ? "is-error" : "is-loading"}`} style={{ width: w, height: h }}>
                {image.src ? <img alt="" src={image.src} draggable={false} decoding="async" onLoad={() => setLoaded(image.src)} /> : image.error ? <RotateCw /> : null}
            </span>
        </span>
    );
}
