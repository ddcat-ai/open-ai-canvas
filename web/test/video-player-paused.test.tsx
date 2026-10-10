import { expect, test } from "bun:test";

test("只有画布紧凑播放器增加独立入口，并使用原播放器的播放按钮", async () => {
    const source = await Bun.file(new URL("../src/components/video-player.tsx", import.meta.url)).text();
    expect(source).toMatch(/compactControls && \([\s\S]*?<PlayButton className="canvas-video-paused-play vds-button"/);
    expect(source).toContain('aria-label={`播放 ${title}`}');
    expect(source).toContain('aria-hidden="true"');
});

test("中央按钮按暂停或结束状态显示，不依赖自动隐藏的控件栏", async () => {
    const css = await Bun.file(new URL("../src/components/video-player.css", import.meta.url)).text();
    expect(css).toContain(':not([data-fullscreen]):is([data-paused], [data-ended]) .canvas-video-paused-play');
    expect(css).toMatch(/\.canvas-video-player \.canvas-video-paused-play\s*\{\s*display: none;/);
    const source = await Bun.file(new URL("../src/components/video-player.tsx", import.meta.url)).text();
    expect(source).toContain('event.target.closest(".canvas-video-paused-play")');
});

test("地址解析后显示真实播放器，不使用独立就绪状态遮挡播放中的画面", async () => {
    const source = await Bun.file(new URL("../src/components/canvas/canvas-node-media-content.tsx", import.meta.url)).text();
    const active = source.slice(source.indexOf("export function VideoNodeContent"), source.indexOf("export function inferVideoHasAudio"));
    expect(active).not.toContain("videoReady");
    expect(active).toContain("preview && !url");
    expect(active).toContain('<div className="relative z-[1]"');
    const css = await Bun.file(new URL("../src/components/video-player.css", import.meta.url)).text();
    expect(css).not.toContain("canvas-video-player-loading");
});
