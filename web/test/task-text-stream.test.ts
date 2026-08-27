import { describe, expect, test } from "bun:test";

import { consumeTaskTextStream, createTaskTextStreamParser, type TaskTextStreamEvent } from "../src/services/api/task-text-stream";

describe("task text SSE parser", () => {
    test("reassembles split frames and keeps event ids for reconnect cursors", () => {
        const parser = createTaskTextStreamParser();
        const events: TaskTextStreamEvent[] = [];
        const stream = `: connected\n\nevent: progress\ndata: {"status":"running","stage":"生成中","progress":30}\n\nid: 8\nevent: delta\ndata: {"sequence":8,"content":"第一段"}\n\nid: 9\nevent: delta\ndata: {"sequence":9,"content":"第二段"}\n\nevent: terminal\ndata: {"status":"succeeded","complete":true,"finalText":"第一段第二段"}\n\n`;

        consumeTaskTextStream(parser, stream.slice(0, 73), (event) => events.push(event));
        consumeTaskTextStream(parser, stream.slice(73), (event) => events.push(event), true);

        expect(events.map((event) => [event.event, event.id])).toEqual([
            ["progress", undefined],
            ["delta", 8],
            ["delta", 9],
            ["terminal", undefined],
        ]);
        expect(events[2]?.data).toEqual({ sequence: 9, content: "第二段" });
    });

    test("rejects malformed JSON instead of silently dropping task output", () => {
        const parser = createTaskTextStreamParser();
        expect(() => consumeTaskTextStream(parser, "event: delta\ndata: {broken}\n\n", () => undefined)).toThrow("任务文本流返回了无效数据");
    });
});
