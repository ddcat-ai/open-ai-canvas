import { afterEach, beforeEach, expect, test } from "bun:test";
import { bindCanvasVideoHoverPreview, VIDEO_HOVER_DELAY_MS } from "../src/lib/canvas/canvas-video-hover-preview";

const wait = (ms = VIDEO_HOVER_DELAY_MS + 30) => new Promise((resolve) => setTimeout(resolve, ms));
const originals = new Map<string, PropertyDescriptor | undefined>();
let videos: FakeVideo[];
let reduced = false;
let interacting = false;
let mutation: () => void;
let visibility: (entries: { isIntersecting: boolean }[]) => void;
const cleanups: (() => void)[] = [];
class FakeVideo extends EventTarget {
    paused = true; currentTime = 0; src = ""; muted = false; playsInline = false; preload = "";
    className = ""; dataset: Record<string, string> = {}; removed = false; loads = 0;
    setAttribute() {}
    removeAttribute() { this.src = ""; }
    load() { this.loads++; }
    remove() { this.removed = true; }
    pause() { this.paused = true; }
    async play() { this.paused = false; this.dispatchEvent(new Event("playing")); }
}
class FakeElement extends EventTarget {
    isConnected = true;
    closest(selector: string) { return selector.includes('="true"') ? (interacting ? this : null) : this; }
    getAttribute() { return interacting ? "true" : null; }
    appendChild(video: FakeVideo) { videos.push(video); }
}
function stub(key: string, value: unknown) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
function setup(resolve: () => Promise<string> = async () => "test.mp4") {
    const element = new FakeElement();
    cleanups.push(bindCanvasVideoHoverPreview(element as unknown as HTMLElement, resolve));
    return element;
}
function enter(element: FakeElement, pointerType = "mouse", buttons = 0) {
    element.dispatchEvent(Object.assign(new Event("pointerenter"), { pointerType, buttons }));
}
beforeEach(() => {
    videos = []; reduced = false; interacting = false;
    stub("window", Object.assign(new EventTarget(), { matchMedia: () => ({ matches: reduced }) }));
    stub("document", Object.assign(new EventTarget(), { hidden: false, querySelectorAll: () => videos.filter((v) => !v.removed), createElement: () => new FakeVideo() }));
    stub("MutationObserver", class { constructor(callback: () => void) { mutation = callback; } observe() {} disconnect() {} });
    stub("IntersectionObserver", class { constructor(callback: typeof visibility) { visibility = callback; } observe() {} disconnect() {} });
});
afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear();
});

test("quick pass, touch, dragging and reduced motion never resolve media", async () => {
    let calls = 0;
    const element = setup(async () => { calls++; return "test.mp4"; });
    enter(element); element.dispatchEvent(new Event("pointerleave"));
    enter(element, "touch"); enter(element, "mouse", 1);
    reduced = true; enter(element);
    await wait();
    expect(calls).toBe(0);
});
test("hover is muted and capped at first three seconds; resources are released", async () => {
    const element = setup(); enter(element); await wait();
    const video = videos[0];
    expect(video.muted).toBe(true); expect(video.playsInline).toBe(true);
    video.currentTime = 3; video.dispatchEvent(new Event("timeupdate"));
    expect(video.paused).toBe(true); expect(video.src).toBe(""); expect(video.loads).toBe(1); expect(video.removed).toBe(true);
});
test("new hover cancels previous decoder and ignores stale URL resolution", async () => {
    let resolve!: (value: string) => void;
    const slow = setup(() => new Promise<string>((done) => { resolve = done; }));
    enter(slow); await wait();
    const next = setup(); enter(next); resolve("stale.mp4"); await wait();
    expect(videos.length).toBe(1); expect(videos[0].src).toBe("test.mp4");
    enter(slow); expect(videos[0].removed).toBe(true);
});
test("wheel, viewport interaction and leaving viewport cancel playback", async () => {
    const element = setup(); enter(element); await wait();
    window.dispatchEvent(new Event("wheel")); expect(videos[0].removed).toBe(true);
    enter(element); await wait(); interacting = true; mutation(); expect(videos[1].removed).toBe(true);
    interacting = false; enter(element); await wait(); visibility([{ isIntersecting: false }]); expect(videos[2].removed).toBe(true);
});
test("manual playback is never competing with hover", async () => {
    const manual = new FakeVideo(); manual.paused = false; videos.push(manual);
    let calls = 0; const element = setup(async () => { calls++; return "test.mp4"; });
    enter(element); await wait(); expect(calls).toBe(0); expect(manual.paused).toBe(false);
});
