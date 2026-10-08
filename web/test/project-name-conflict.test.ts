import { describe, expect, test } from "bun:test";

import { ApiError } from "../src/services/api/request";
import { shouldRetryProjectNameConflict } from "../src/lib/project-name-conflict";

describe("project name conflict retries", () => {
    test("retries only the structured project-name conflict", () => {
        const projectNameConflict = new ApiError("文案可能变化", {
            status: 409,
            reason: "project_name_conflict",
        });

        expect(shouldRetryProjectNameConflict(projectNameConflict, 0)).toBe(true);
        expect(shouldRetryProjectNameConflict(new ApiError("项目名称已存在", {
            status: 409,
            reason: "conflict",
        }), 0)).toBe(false);
        expect(shouldRetryProjectNameConflict(new Error("项目名称已存在"), 0)).toBe(false);
    });

    test("stops after the configured number of name retries", () => {
        const projectNameConflict = new ApiError("项目名称已存在", {
            status: 409,
            reason: "project_name_conflict",
        });

        expect(shouldRetryProjectNameConflict(projectNameConflict, 4)).toBe(true);
        expect(shouldRetryProjectNameConflict(projectNameConflict, 5)).toBe(false);
    });

    test("错误文案、非 409 状态和缺少专用原因的错误不能触发重试", () => {
        for (const error of [
            new ApiError("项目名称已存在", { status: 500, reason: "project_name_conflict" }),
            new ApiError("UNIQUE constraint failed: projects.user_id, projects.name", { status: 409 }),
            new Error("UNIQUE constraint failed: projects.user_id, projects.name"),
            { status: 409, reason: "project_name_conflict" },
        ]) {
            expect(shouldRetryProjectNameConflict(error, 0)).toBe(false);
        }
    });
});
