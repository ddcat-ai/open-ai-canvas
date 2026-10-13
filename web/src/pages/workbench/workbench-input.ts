import type { WorkbenchTool } from "@/services/api/workbench";

export function workbenchPromptRequired(tool: WorkbenchTool | null) {
    return !tool || tool.inputContract?.promptRequired !== false || (tool.inputContract?.minTextReferences || 0) > 0;
}

export function missingWorkbenchInput(tool: WorkbenchTool | null, references: Array<{ slotKey?: string; resourceId?: string; uploading?: boolean; error?: string }>) {
    return tool?.inputContract?.slots.find((slot) => references.filter((reference) => reference.slotKey === slot.key && reference.resourceId && !reference.uploading && !reference.error).length < Math.max(slot.minCount, slot.required ? 1 : 0));
}
