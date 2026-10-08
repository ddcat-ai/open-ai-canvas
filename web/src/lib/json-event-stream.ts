type EventBuffer = { buffer: string };

/** Feed complete JSON data frames to a protocol adapter; retain a partial tail. */
export function consumeJsonEvents(state: EventBuffer, chunk: string, receive: (payload: unknown) => void, flush = false) {
    state.buffer += chunk;
    const input = state.buffer;
    let offset = 0;
    const boundaries = input.matchAll(/\r?\n\r?\n/g);
    for (const boundary of boundaries) {
        deliver(input.slice(offset, boundary.index), receive);
        offset = boundary.index + boundary[0].length;
        // Advance only after parsing succeeds, so an invalid frame isn't silently lost.
        state.buffer = input.slice(offset);
    }
    if (flush) {
        deliver(input.slice(offset), receive);
        state.buffer = "";
    }
}

function deliver(frame: string, receive: (payload: unknown) => void) {
    const values: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
        if (line.slice(0, 5) !== "data:") continue;
        values.push(line.charAt(5) === " " ? line.slice(6) : line.slice(5));
    }
    const data = values.join("\n").trim();
    if (data.length && data !== "[DONE]") receive(JSON.parse(data));
}
