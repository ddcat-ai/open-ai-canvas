import type { WorkbenchTool } from "@/services/api/workbench";

export function workbenchVideoOperation(references: ReadonlyArray<{ kind: string; role?: string }>) {
    if (references.some((reference) => reference.kind === "video" || (reference.kind === "image" && reference.role !== "first_frame" && reference.role !== "last_frame"))) return "reference_to_video";
    if (references.some((reference) => reference.kind === "image")) return "image_to_video";
    if (references.some((reference) => reference.kind === "audio")) return "audio_to_video";
    return "text_to_video";
}

export function workbenchPromptRequired(tool: WorkbenchTool | null) {
    return !tool || tool.inputContract?.promptRequired !== false || (tool.inputContract?.minTextReferences || 0) > 0;
}

export function missingWorkbenchInput(tool: WorkbenchTool | null, references: Array<{ slotKey?: string; resourceId?: string; uploading?: boolean; error?: string }>) {
    return tool?.inputContract?.slots.find((slot) => references.filter((reference) => reference.slotKey === slot.key && reference.resourceId && !reference.uploading && !reference.error).length < Math.max(slot.minCount, slot.required ? 1 : 0));
}
