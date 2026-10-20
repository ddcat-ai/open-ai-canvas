import { buildCameraPrompt } from "@/lib/canvas/camera-prompt-library";
import { buildPortraitTexturePrompt } from "@/lib/canvas/canvas-portrait-texture";
import type { CanvasGenerationMode, CanvasNodeData } from "@/types/canvas";

/** Keep queued input snapshots and immediate generation on the same prompt preparation path. */
export function canvasGenerationInputPrompt(node: CanvasNodeData | undefined, mode: CanvasGenerationMode, prompt: string) {
    let result = mode === "image" && node?.metadata?.portraitTexture ? buildPortraitTexturePrompt(prompt, node.metadata.portraitTexture) : prompt;
    if (mode === "image" && node?.metadata?.cameraControl?.enabled) {
        const camera = node.metadata.cameraControl;
        result += `\n${buildCameraPrompt({ cameraId: camera.camera, lensId: camera.lens, focalLengthMm: camera.focalLength, apertureF: camera.aperture })}`;
    }
    return result;
}
