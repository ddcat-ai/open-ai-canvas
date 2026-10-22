import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/components/canvas/canvas-node-media-content.tsx", import.meta.url), "utf8").replace(/\s+/g, " ");
const start = source.indexOf("export function VideoNodeContent(");
const videoNode = source.slice(start, source.indexOf("export function inferVideoHasAudio", start));

// 画布视频节点的签名地址会续签（同一 storageKey 换一个 expires/signature）。
// 以地址作为 React key 会让播放器整个卸载重建：画面先退回静态预览、从头加载并重复下载。
test("视频节点播放器以媒体身份作 key，续签只换 src", () => {
    expect(videoNode).not.toContain("key={url}");
    expect(videoNode).toContain("const playerKey = node.metadata?.storageKey || node.id;");
    expect(videoNode).toContain("<VideoPlayer key={playerKey} src={url}");
});

test("续签地址不把播放器淡出回静态预览，只在换媒体或地址清空时重置", () => {
    expect(videoNode).not.toMatch(/useEffect\(\(\) => \{ setVideoReady\(false\); \}, \[url\]\);/);
    expect(videoNode).toContain("useEffect(() => { setVideoReady(false); }, [playerKey]);");
    expect(videoNode).toContain("useEffect(() => { if (!url) setVideoReady(false); }, [url]);");
});
