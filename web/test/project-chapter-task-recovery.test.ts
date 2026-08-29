import { describe, expect, test } from "bun:test";

import { chapterTaskIdentity } from "@/pages/projects/detail/project-chapter-ai";
import type { GenerationTask } from "@/services/api/task-center";

describe("章节生成任务刷新恢复", () => {
    test("优先从任务列表的安全客户端上下文识别章节与操作", () => {
        expect(chapterTaskIdentity(task({
            clientContext: {
                domainProjectId: "project-1",
                chapterId: "chapter-1",
                chapterOperation: "characters",
            },
        }))).toEqual({ chapterId: "chapter-1", kind: "characters" });
    });

    test("任务详情可从脱敏输入 metadata 恢复分镜操作", () => {
        expect(chapterTaskIdentity(task({
            inputJson: JSON.stringify({
                metadata: {
                    domainProjectId: "project-1",
                    chapterId: "chapter-2",
                    source: "short-drama-chapter-storyboard",
                },
            }),
        }))).toEqual({ chapterId: "chapter-2", kind: "storyboard" });
    });

    test("无关、缺少章节或损坏的任务输入不会关联章节按钮", () => {
        expect(chapterTaskIdentity(task({ inputJson: "{" }))).toBeNull();
        expect(chapterTaskIdentity(task({ inputJson: JSON.stringify({ metadata: { operation: "chapter_character_breakdown" } }) }))).toBeNull();
        expect(chapterTaskIdentity(task({ inputJson: JSON.stringify({ metadata: { chapterId: "chapter-1", operation: "other" } }) }))).toBeNull();
    });
});

function task(overrides: Partial<GenerationTask>): GenerationTask {
    return {
        id: "task-1",
        type: "text",
        status: "running",
        prompt: "",
        attempts: 1,
        createdAt: "2026-08-29T00:00:00.000Z",
        updatedAt: "2026-08-29T00:00:00.000Z",
        ...overrides,
    };
}
