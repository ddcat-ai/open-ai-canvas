import { describe, expect, test } from "bun:test";

import { filterWorkbenchTools, taskMediaUrls, workbenchTaskSnapshot } from "../src/pages/workbench/image-workbench-page";
import type { GenerationTask } from "@/services/api/task-center";
import type { WorkbenchTool } from "@/services/api/workbench";

(globalThis as Record<string, unknown>).__APP_VERSION__ ??= "0.0.0";

const tools: WorkbenchTool[] = [
    { id: "face", kind: "image", categoryId: "people", name: "脸部三视图", subtitle: "生成正脸、侧脸", description: "角色参考", sortOrder: 0, enabled: true, supportedModes: ["image"], presets: [] },
    { id: "product", kind: "image", categoryId: "product", name: "商品白底图", subtitle: "生成商品图", description: "电商产品", sortOrder: 1, enabled: true, supportedModes: ["image"], presets: [] },
];

describe("workbenchTaskSnapshot", () => {
    test("restores video settings and reference identity from safe task details", () => {
        const task = {
            inputJson: JSON.stringify({
                metadata: {
                    source: "workbench",
                    workbenchKind: "video",
                    workbenchToolId: "tool-video",
                    workbenchPresetId: "preset-video",
                    workbench: {
                        kind: "video",
                        parameters: { seconds: 8, ratio: "16:9", resolution: "1080p", generateAudio: true, watermark: false },
                        references: [{ resourceId: "resource-1", kind: "image", role: "first_frame", slotKey: "subject" }],
                    },
                },
            }),
        } as GenerationTask;

        expect(workbenchTaskSnapshot(task)).toEqual({
            kind: "video",
            toolId: "tool-video",
            presetId: "preset-video",
            parameters: { seconds: 8, ratio: "16:9", resolution: "1080p", generateAudio: true, watermark: false },
            references: [{ resourceId: "resource-1", kind: "image", role: "first_frame", slotKey: "subject" }],
        });
    });

    test("does not treat a task-list summary as loaded restore data", () => {
        expect(workbenchTaskSnapshot({ id: "summary" } as GenerationTask)).toBeNull();
    });
});

describe("filterWorkbenchTools", () => {
    test("combines category and case-insensitive text search", () => {
        expect(filterWorkbenchTools(tools, "people", "侧脸").map((tool) => tool.id)).toEqual(["face"]);
        expect(filterWorkbenchTools(tools, "people", "商品")).toEqual([]);
    });

    test("searches tool description and returns all tools for blank query", () => {
        expect(filterWorkbenchTools(tools, "all", "电商").map((tool) => tool.id)).toEqual(["product"]);
        expect(filterWorkbenchTools(tools, "all", "  ")).toHaveLength(2);
    });
});

describe("workspaceNavActiveId for unified toolbox entry", () => {
    test("highlights the unified toolbox entry for image and video workbench routes", async () => {
        const { workspaceNavActiveId } = await import("../src/components/layout/workspace-sidebar-nav");
        expect(workspaceNavActiveId("/toolbox")).toBe("toolbox");
        expect(workspaceNavActiveId("/toolbox/image")).toBe("toolbox");
        expect(workspaceNavActiveId("/toolbox/video")).toBe("toolbox");
    });
});

describe("taskMediaUrls for multi-image workbench results", () => {
    test("returns all generated image URLs from resultJson and falls back to previewUrl", () => {
        const multiImageTask = {
            id: "task-multi",
            previewUrl: "/api/resources/1/file",
            resultJson: JSON.stringify({
                mode: "image",
                images: [{ url: "/api/resources/1/file" }, { dataUrl: "/api/resources/2/file" }, { url: "/api/resources/3/file" }],
            }),
        } as GenerationTask;

        expect(taskMediaUrls(multiImageTask)).toEqual(["/api/resources/1/file", "/api/resources/2/file", "/api/resources/3/file"]);
        expect(taskMediaUrls({ id: "summary-only", previewUrl: "/api/resources/summary/file" } as GenerationTask)).toEqual(["/api/resources/summary/file"]);
    });
});
