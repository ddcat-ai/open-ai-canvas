import { http } from "@/services/api/request";
import { getResourceAccess, resolveResourceAccessURL, resourceStorageKey } from "@/services/api/resources";
import type { GenerationTask } from "@/services/api/task-center";

export type WorkbenchKind = "image" | "video";

export type WorkbenchPromptPreset = {
    id: string;
    name: string;
    summary?: string;
    promptTemplate: string;
    enabled?: boolean;
    defaultParameters?: Record<string, unknown>;
    requiredVariables?: string[];
    sortOrder?: number;
};

export type WorkbenchReferenceSlot = {
    key: string;
    name: string;
    mediaTypes: Array<"image" | "video" | "audio">;
    resourceKind?: string;
    maxCount: number;
    minCount: number;
    required: boolean;
    coverResourceId?: string;
    coverUrl?: string;
    sampleResourceId?: string;
    sampleUrl?: string;
};

export type WorkbenchInputContract = {
    promptRequired: boolean;
    minTextReferences: number;
    slots: WorkbenchReferenceSlot[];
};

export type WorkbenchResultExample = {
    title?: string;
    description?: string;
    imageResourceIds?: string[];
    imageUrls?: string[];
    videoResourceId?: string;
    videoUrl?: string;
};

export type WorkbenchTool = {
    id: string;
    kind: WorkbenchKind;
    categoryId: string;
    name: string;
    subtitle: string;
    description: string;
    iconUrl?: string;
    coverUrl?: string;
    iconResourceId?: string;
    coverResourceId?: string;
    sortOrder: number;
    enabled: boolean;
    supportedModes?: string[];
    capability?: Record<string, unknown> | string;
    capabilityRequirements?: Record<string, unknown>;
    guide?: Record<string, unknown> | string;
    inputHint?: string;
    searchKeywords?: string[];
    surfaces?: string[];
    recommended?: boolean;
    recommendationOrder?: number;
    inputContract?: WorkbenchInputContract;
    resultExample?: WorkbenchResultExample;
    presets: WorkbenchPromptPreset[];
};

export type WorkbenchToolDirectory = {
    tools: WorkbenchTool[];
};

export type CreateWorkbenchTaskInput = {
    kind: WorkbenchKind;
    toolId?: string;
    presetId?: string;
    workbench?: { kind: WorkbenchKind; toolId: string; presetId?: string };
    prompt: string;
    model: string;
    logicalModelId?: string;
    channelId?: string;
    modelChoice?: { logicalModelId?: string; userChannelId?: string; modelName?: string };
    parameters?: Record<string, unknown>;
    references?: Array<{
        resourceId: string;
        kind: "image" | "video" | "audio";
        role?: "reference" | "first_frame" | "last_frame";
        slotKey?: string;
    }>;
};

export async function listWorkbenchTasks(kind: WorkbenchKind, limit = 100, activeOnly = false, signal?: AbortSignal) {
    const pageSize = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.trunc(limit))) : 100;
    return http.get<GenerationTask[]>("/workbench/tasks", {
        params: { kind, pageSize, activeOnly: activeOnly || undefined },
        signal,
    });
}

export async function listWorkbenchTools(kind: WorkbenchKind, signal?: AbortSignal, admin = false) {
    const response = await http.get<{ tools: WorkbenchTool[] }>(admin ? "/admin/workbench/tools" : "/workbench/tools", { params: { kind }, signal });
    if (admin) return response;
    const tools = await Promise.all(
        response.tools.map(async (tool) => ({
            ...tool,
            iconUrl: tool.iconUrl || (tool.iconResourceId ? await resourceDisplayUrl(tool.iconResourceId) : undefined),
            coverUrl: tool.coverUrl || (tool.coverResourceId ? await resourceDisplayUrl(tool.coverResourceId) : undefined),
            presets: Array.isArray(tool.presets) ? tool.presets.filter((preset) => preset.enabled !== false) : [],
        })),
    );
    return { tools };
}

async function resourceDisplayUrl(resourceId: string, variant: "thumbnail" | "original" = "thumbnail") {
    const access = await getResourceAccess(resourceStorageKey(resourceId), "display", variant);
    return resolveResourceAccessURL(access.url);
}

export async function resolveWorkbenchResourceURL(resourceId?: string, variant: "thumbnail" | "original" = "thumbnail") {
    if (!resourceId?.trim()) return undefined;
    try {
        return await resourceDisplayUrl(resourceId.trim(), variant);
    } catch {
        return undefined;
    }
}

export function capabilitySupportedModes(tool: WorkbenchTool) {
    if (Array.isArray(tool.supportedModes)) return tool.supportedModes;
    const capability = typeof tool.capability === "string" ? parseJSONRecord(tool.capability) : tool.capability;
    const modes = capability && Array.isArray(capability.supportedModes) ? capability.supportedModes : [];
    return modes.filter((item): item is string => typeof item === "string");
}

function parseJSONRecord(value: string): Record<string, unknown> | undefined {
    try {
        const parsed: unknown = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
    } catch {
        return undefined;
    }
}

export function normalizeWorkbenchGuide(guide?: WorkbenchTool["guide"]) {
    if (typeof guide === "string") return guide;
    if (!guide) return "";
    const sections = Array.isArray(guide.sections) ? guide.sections : [];
    const lines = Array.isArray(guide.lines) ? guide.lines : sections.flatMap((section) => (section && typeof section === "object" && Array.isArray(section.items) ? section.items : [section]));
    return lines
        .map((line) => (typeof line === "string" ? line : line && typeof line === "object" && "text" in line ? String(line.text) : ""))
        .filter(Boolean)
        .join("\n");
}

export type SaveAdminWorkbenchToolInput = Pick<WorkbenchTool, "kind" | "categoryId" | "name" | "subtitle" | "description" | "sortOrder" | "enabled"> & {
    id?: string;
    iconResourceId?: string;
    coverResourceId?: string;
    capability?: Record<string, unknown>;
    guide?: Record<string, unknown>;
    presets?: WorkbenchPromptPreset[];
};

export function saveAdminWorkbenchTool(input: SaveAdminWorkbenchToolInput) {
    const { id, capability = {}, guide = {}, presets, ...tool } = input;
    const payload = {
        ...tool,
        capability,
        guide,
        ...(presets
            ? {
                  presets: presets.map((preset) => ({
                      id: preset.id || undefined,
                      name: preset.name,
                      summary: preset.summary || "",
                      promptTemplate: preset.promptTemplate,
                      enabled: preset.enabled !== false,
                      sortOrder: preset.sortOrder || 0,
                      defaultParameters: preset.defaultParameters || {},
                  })),
              }
            : {}),
    };
    return id ? http.patch<{ tool: WorkbenchTool }>(`/admin/workbench/tools/${encodeURIComponent(id)}`, payload).then(({ tool: saved }) => saved) : http.post<{ tool: WorkbenchTool }>("/admin/workbench/tools", payload).then(({ tool: saved }) => saved);
}

export type SaveAdminWorkbenchPresetInput = {
    toolId: string;
    name: string;
    summary?: string;
    promptTemplate: string;
    defaultParameters?: Record<string, unknown>;
    sortOrder: number;
    enabled: boolean;
};

export function createAdminWorkbenchPreset(input: SaveAdminWorkbenchPresetInput) {
    return http.post<{ preset: WorkbenchPromptPreset }>(`/admin/workbench/tools/${encodeURIComponent(input.toolId)}/presets`, input).then(({ preset }) => preset);
}

export function updateAdminWorkbenchPreset(id: string, input: SaveAdminWorkbenchPresetInput) {
    return http.patch<{ preset: WorkbenchPromptPreset }>(`/admin/workbench/tools/${encodeURIComponent(input.toolId)}/presets/${encodeURIComponent(id)}`, input).then(({ preset }) => preset);
}

export function setAdminWorkbenchPresetEnabled(id: string, enabled: boolean) {
    return http.post<{ id: string; enabled: boolean }>(`/admin/workbench/tools/presets/${encodeURIComponent(id)}/${enabled ? "publish" : "unpublish"}`).then((result) => result.enabled);
}

export function setAdminWorkbenchToolEnabled(id: string, enabled: boolean) {
    return http.post<{ id: string; enabled: boolean }>(`/admin/workbench/tools/${encodeURIComponent(id)}/${enabled ? "publish" : "unpublish"}`).then((result) => result.enabled);
}

export type WorkbenchTaskIntent = CreateWorkbenchTaskInput;

export async function createWorkbenchTask(input: WorkbenchTaskIntent) {
    const result = await http.post<WorkbenchTaskReceipt | WorkbenchTaskReceipt["task"]>("/workbench/tasks", input);
    const task = result && "task" in result ? result.task : result;
    if (!task?.id) throw new Error("任务已提交，但没有返回任务编号");
    return task;
}

export type WorkbenchTaskReceipt = {
    task: {
        id: string;
        status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
        createdAt?: string;
    };
};
