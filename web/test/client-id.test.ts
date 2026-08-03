import { describe, expect, test } from "bun:test";

import { createClientId } from "../src/lib/client-id";

describe("createClientId", () => {
    test("生成不依赖 randomUUID 的唯一客户端标识", () => {
        const ids = Array.from({ length: 100 }, () => createClientId());

        expect(new Set(ids).size).toBe(ids.length);
        ids.forEach((id) => expect(id).toMatch(/^[A-Za-z0-9_-]{21}$/));
    });
});
