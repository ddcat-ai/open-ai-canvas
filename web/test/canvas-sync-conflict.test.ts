import { describe, expect, test } from "bun:test";

import { CanvasSyncConflictError } from "@/services/user-data-sync";

describe("画布同步冲突错误", () => {
    test("携带冲突方向与画布 id, 消息说明退路", () => {
        const error = new CanvasSyncConflictError("proj-1", "diverged");
        expect(error.name).toBe("CanvasSyncConflictError");
        expect(error.kind).toBe("diverged");
        expect(error.projectId).toBe("proj-1");
        expect(error.message).toContain("导出本地备份");
        expect(error.message).toContain("加载云端版本");
    });

    test("instanceof 判定成立, 普通错误不误判", () => {
        expect(new CanvasSyncConflictError("p", "diverged") instanceof CanvasSyncConflictError).toBe(true);
        expect(new Error("画布已在其他端修改") instanceof CanvasSyncConflictError).toBe(false);
    });
});
