import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SpriteAvatar } from "../src/components/canvas/sprite-avatar";
import type { SpritePet } from "../src/lib/canvas/sprite-pet";
import { PetAvatar } from "../src/components/canvas/pet-avatar";
import { DEFAULT_CANVAS_APPEARANCE } from "../src/lib/canvas/agent-appearance";

test("upstream bundle stays in a stable loading stage until its manifest resolves", () => {
    const html = renderToStaticMarkup(<PetAvatar appearance={{ ...DEFAULT_CANVAS_APPEARANCE, avatarType: "bundle" }} height={120} paused={false} reducedMotion />);
    expect(html).toContain("data-pet-avatar-stage");
    expect(html).toContain("width:120px;height:120px");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("正在加载助手形象");
});

test("sprite first render preserves the cell ratio and loads only one atlas", () => {
    const pet: SpritePet = {
        displayName: "任何角色",
        spritesheetPath: "atlas.webp",
        atlasWidth: 1536,
        atlasHeight: 2288,
        frameWidth: 192,
        frameHeight: 208,
        neutralFrame: 6,
        lookStartFrame: 72,
        lookDirections: 16,
        speed: 1,
        sleepAfterSeconds: 0,
        author: "",
        source: "",
        license: "",
        actions: [{ id: "idle", label: "待机", row: 0, start: 0, frames: 6, fps: 4, loop: true }],
        bindings: { idle: "idle", working: "", waiting: "", failed: "", completed: "", moveLeft: "", moveRight: "", hover: "", greeting: "", sleep: "", wake: "" },
    };
    const html = renderToStaticMarkup(<SpriteAvatar pet={pet} url="/api/public/appearance/sprite/id" height={208} reducedMotion paused />);
    expect(html).toContain("width:192px;height:208px");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("正在加载精灵宠物");
    expect(html).toContain('data-paused="true"');
    expect(html.match(/<img /g)?.length).toBe(1);
});
