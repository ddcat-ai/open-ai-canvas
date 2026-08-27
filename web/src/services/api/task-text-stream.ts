export type TaskTextStreamEvent = {
    event: string;
    id?: number;
    data?: unknown;
};

export type TaskTextStreamParser = {
    buffer: string;
};

export function createTaskTextStreamParser(): TaskTextStreamParser {
    return { buffer: "" };
}

export function consumeTaskTextStream(
    parser: TaskTextStreamParser,
    chunk: string,
    onEvent: (event: TaskTextStreamEvent) => void,
    flush = false,
) {
    parser.buffer += chunk;
    for (;;) {
        const boundary = parser.buffer.match(/\r?\n\r?\n/);
        if (!boundary) break;
        const index = boundary.index ?? 0;
        emitTaskTextStreamBlock(parser.buffer.slice(0, index), onEvent);
        parser.buffer = parser.buffer.slice(index + boundary[0].length);
    }
    if (flush && parser.buffer.trim()) {
        emitTaskTextStreamBlock(parser.buffer, onEvent);
        parser.buffer = "";
    }
}

function emitTaskTextStreamBlock(block: string, onEvent: (event: TaskTextStreamEvent) => void) {
    let event = "message";
    let id: number | undefined;
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
        if (!line || line.startsWith(":")) continue;
        const separator = line.indexOf(":");
        const field = separator >= 0 ? line.slice(0, separator) : line;
        const value = separator >= 0 ? line.slice(separator + 1).replace(/^ /, "") : "";
        if (field === "event") event = value || "message";
        else if (field === "id" && /^\d+$/.test(value)) id = Number(value);
        else if (field === "data") data.push(value);
    }
    if (!data.length) return;
    const raw = data.join("\n");
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error("任务文本流返回了无效数据");
    }
    onEvent({ event, ...(id !== undefined ? { id } : {}), data: parsed });
}
