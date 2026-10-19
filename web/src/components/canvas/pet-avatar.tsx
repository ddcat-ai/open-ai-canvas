import type { CanvasAppearance } from "@/lib/canvas/agent-appearance";
import type { SpriteRunState } from "@/lib/canvas/sprite-pet";
import { SpriteAvatar } from "./sprite-avatar";
import { Live2DAvatar } from "./live2d-avatar";
import { FluidOrb } from "@/components/ui/fluid-orb";
import { live2DModelURL, spriteImageURL } from "@/services/api/appearance";
import { useEffect } from "react";
import { petAvatarSize } from "@/lib/canvas/pet-menu";
import { PetBundleAvatar } from "./pet-bundle-avatar";

export function PetAvatar({
    appearance,
    height,
    paused,
    reducedMotion,
    state,
    moveDirection,
    onReady,
    onError,
}: {
    appearance: CanvasAppearance;
    height: number;
    paused: boolean;
    reducedMotion: boolean;
    state?: SpriteRunState;
    moveDirection?: number;
    onReady?: () => void;
    onError?: (error: string) => void;
}) {
    useEffect(() => {
        if (appearance.avatarType === "orb") onReady?.();
    }, [appearance.avatarType, onReady]);
    const fitted = petAvatarSize(appearance, height);
    const content =
        appearance.avatarType === "sprite" && appearance.sprite && appearance.spriteResourceId ? (
            <SpriteAvatar
                pet={appearance.sprite}
                url={spriteImageURL(appearance.spriteResourceId)}
                height={fitted.height}
                state={state}
                moveDirection={moveDirection}
                paused={paused}
                reducedMotion={reducedMotion}
                onReady={onReady}
                onError={onError}
                fallback={<FluidOrb size={Math.min(60, height * 0.8)} />}
            />
        ) : appearance.avatarType === "bundle" ? (
            <PetBundleAvatar appearance={appearance} height={height} paused={paused || reducedMotion} state={state} onReady={onReady} onError={onError} />
        ) : appearance.avatarType === "live2d" && appearance.live2dResourceId ? (
            <span style={{ display: "block", position: "relative", width: fitted.width, height: fitted.height }}>
                <span style={{ position: "absolute", left: 0, top: 0, width: 165, height: 220, transform: `scale(${fitted.height / 220})`, transformOrigin: "top left" }}>
                    <Live2DAvatar url={live2DModelURL(appearance.live2dResourceId, appearance.live2dEntry)} width={165} height={220} reducedMotion={reducedMotion || paused} onReady={onReady} onError={onError} fallback={<FluidOrb size={60} />} />
                </span>
            </span>
        ) : (
            <FluidOrb size={fitted.height} />
        );
    return (
        <span data-pet-avatar-stage style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: height, height, flexShrink: 0 }}>
            {content}
        </span>
    );
}
