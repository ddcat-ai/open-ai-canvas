import { expect, test } from "bun:test";
import { startCanvasSyncPolling } from "../src/services/canvas-sync-polling";

const settle = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
};

function fixture(poll: (signal: AbortSignal) => Promise<void> = async () => {}, initiallyOffline = false) {
    let now = 0;
    let hidden = false;
    let online = !initiallyOffline;
    let sequence = 0;
    let listener: (() => void) | undefined;
    const calls: number[] = [];
    const signals: AbortSignal[] = [];
    const timers = new Map<number, { at: number; callback: () => void }>();
    const stop = startCanvasSyncPolling(
        async (signal) => {
            calls.push(now);
            signals.push(signal);
            await poll(signal);
        },
        {
            hidden: () => hidden,
            online: () => online,
            listen(wake) {
                listener = wake;
                return () => {
                    listener = undefined;
                };
            },
            schedule(callback, delay) {
                const id = ++sequence;
                timers.set(id, { at: now + delay, callback });
                return id as unknown as ReturnType<typeof setTimeout>;
            },
            clear(timer) {
                timers.delete(timer as unknown as number);
            },
        },
    );
    return {
        calls,
        signals,
        timers,
        stop,
        hidden(value: boolean) {
            hidden = value;
            listener?.();
        },
        online(value: boolean) {
            online = value;
            listener?.();
        },
        async advance(ms: number) {
            await settle();
            const target = now + ms;
            for (;;) {
                const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
                if (!next || next[1].at > target) break;
                now = next[1].at;
                timers.delete(next[0]);
                next[1].callback();
                await settle();
            }
            now = target;
        },
    };
}

test("visible canvas polls every two seconds after the previous request completes", async () => {
    const f = fixture();
    await f.advance(6000);
    expect(f.calls).toEqual([0, 2000, 4000, 6000]);
    f.stop();
    await f.advance(60000);
    expect(f.calls).toHaveLength(4);
    expect(f.timers.size).toBe(0);
});

test("hidden canvases slow to fifteen seconds and foreground resumes immediately", async () => {
    const f = fixture();
    await settle();
    f.hidden(true);
    await f.advance(14999);
    expect(f.calls).toEqual([0]);
    await f.advance(1);
    expect(f.calls).toEqual([0, 15000]);
    f.hidden(false);
    await settle();
    expect(f.calls).toEqual([0, 15000, 15000]);
    await f.advance(2000);
    expect(f.calls.at(-1)).toBe(17000);
    f.stop();
});

test("offline pauses requests; reconnect wakes once and normal polling resumes", async () => {
    const f = fixture(undefined, true);
    await f.advance(60000);
    expect(f.calls).toEqual([]);
    f.online(true);
    await settle();
    expect(f.calls).toEqual([60000]);
    f.online(false);
    await f.advance(60000);
    expect(f.calls).toHaveLength(1);
    f.online(true);
    await f.advance(2000);
    expect(f.calls).toEqual([60000, 120000, 122000]);
    f.stop();
});

test("failures back off to thirty seconds and successful recovery resets cadence", async () => {
    let failing = true;
    const f = fixture(async () => {
        if (failing) throw { status: 503 };
    });
    await f.advance(90000);
    expect(f.calls).toEqual([0, 2000, 6000, 14000, 30000, 60000, 90000]);
    failing = false;
    await f.advance(32000);
    expect(f.calls.slice(-2)).toEqual([120000, 122000]);
    f.stop();
});

test("authorization or deleted canvas responses stop automatic requests", async () => {
    for (const status of [401, 403, 404]) {
        const f = fixture(async () => {
            throw { status };
        });
        await f.advance(60000);
        f.hidden(true);
        f.hidden(false);
        f.online(true);
        await settle();
        expect(f.calls).toEqual([0]);
        expect(f.timers.size).toBe(0);
        f.stop();
    }
});

test("slow requests and repeated wake events never overlap; coalesce into one follow-up", async () => {
    let resolve!: () => void;
    let first = true;
    const f = fixture(async () => {
        if (first) {
            first = false;
            await new Promise<void>((done) => {
                resolve = done;
            });
        }
    });
    await f.advance(60000);
    f.hidden(true);
    f.hidden(false);
    f.online(true);
    f.online(true);
    expect(f.calls).toEqual([0]);
    resolve();
    await settle();
    expect(f.calls).toEqual([0, 60000]);
    expect(f.timers.size).toBe(1);
    f.stop();
});

test("disconnect aborts an in-flight read without overlapping the reconnect", async () => {
    let resolve!: () => void;
    let first = true;
    const f = fixture(async () => {
        if (first) {
            first = false;
            await new Promise<void>((done) => {
                resolve = done;
            });
        }
    });
    f.online(false);
    expect(f.signals[0].aborted).toBe(true);
    f.online(true);
    expect(f.calls).toHaveLength(1);
    resolve();
    await settle();
    expect(f.calls).toHaveLength(2);
    f.stop();
});

test("unmount aborts and ignores late responses and later wake events", async () => {
    let resolve!: () => void;
    const f = fixture(
        () =>
            new Promise<void>((done) => {
                resolve = done;
            }),
    );
    f.stop();
    expect(f.signals[0].aborted).toBe(true);
    resolve();
    f.hidden(false);
    f.online(true);
    await f.advance(60000);
    expect(f.calls).toEqual([0]);
    expect(f.timers.size).toBe(0);
});
