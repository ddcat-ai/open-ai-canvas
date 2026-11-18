import { Columns3, ContactRound, Layers2, PersonStanding, ScanFace, ScanLine, Shirt, Stamp, UsersRound, type LucideIcon } from "lucide-react";
import type { TryOnFunction } from "./tryon-kinds";

const icons: Record<TryOnFunction, LucideIcon> = {
    outfit: Shirt,
    "fine-outfit": Shirt,
    "model-views": Columns3,
    "multi-model": UsersRound,
    "multi-outfit": Layers2,
    pose: PersonStanding,
    "face-swap": ContactRound,
    "smart-face": ScanFace,
    "smart-head": ScanLine,
    background: ScanLine,
    scene: Layers2,
    enhance: ScanFace,
    print: Stamp,
};

/** Shared function icons use the same outline weight and optical size. */
export function TryOnGlyph({ id }: { id: TryOnFunction }) {
    const Icon = icons[id];
    return <Icon width="100%" height="100%" strokeWidth={1.6} aria-hidden="true" />;
}
