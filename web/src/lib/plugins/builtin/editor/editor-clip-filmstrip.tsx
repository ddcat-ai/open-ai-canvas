import { memo, useEffect, useMemo, useState } from "react";
import { Film } from "lucide-react";
import { getFilmstripTiles } from "@/lib/timeline/timeline-clip-view";
import { getActiveUserScope } from "@/lib/user-scope";
import { resolveMediaUrl } from "@/services/file-storage";
import type { TimelineClip } from "@/types/timeline";
import { readTimelineFrames } from "./editor-filmstrip-media";

export const EditorClipFilmstrip = memo(function EditorClipFilmstrip({ clip, pxPerMs, visibleStartPx, visibleEndPx }: { clip: TimelineClip; pxPerMs: number; visibleStartPx: number; visibleEndPx: number }) {
    const [frames, setFrames] = useState<Record<number, string>>({});
    const [failed, setFailed] = useState(false);
    const [tileWidth, setTileWidth] = useState(64);
    const scope = getActiveUserScope();
    const media = clip.directMedia;
    const source = media?.storageKey || media?.url || media?.dataUrl;
    const tiles = useMemo(
        () => getFilmstripTiles({ durationMs: clip.durationMs, sourceStartMs: clip.sourceStartMs ?? 0, pxPerMs, visibleStartPx, visibleEndPx, tileWidth }),
        [clip.durationMs, clip.sourceStartMs, pxPerMs, visibleStartPx, visibleEndPx, tileWidth],
    );
    const times = tiles.map((tile) => tile.timeMs).join(",");

    useEffect(() => setTileWidth(64), [source]);

    useEffect(() => {
        const controller = new AbortController();
        setFrames({});
        setFailed(false);
        if (!media || !times) return;
        const requested = times.split(",").map(Number);
        const publish = (time: number, url: string) => {
            if (!controller.signal.aborted) setFrames((previous) => ({ ...previous, [time]: url }));
        };
        const read =
            clip.kind === "image"
                ? (media.storageKey ? resolveMediaUrl(media.storageKey, media.url || media.dataUrl || "") : Promise.resolve(media.url || media.dataUrl || "")).then((url) => {
                      if (!url) throw new Error("图片不可用");
                      requested.forEach((time) => publish(time, url));
                  })
                : readTimelineFrames(media, requested, controller.signal, publish);
        void read.catch(() => {
            if (!controller.signal.aborted) setFailed(true);
        });
        return () => controller.abort();
        // 仅画面来源或可见采样点变化时取帧，播放时钟不会重启解码。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [source, scope, clip.kind, times]);

    return (
        <div className="editor-filmstrip" aria-label={clip.kind === "image" ? "图片缩略图" : "视频帧缩略图"} title={failed ? "画面缩略图暂不可用，仍可选择和预览片段" : undefined}>
            {tiles.map((tile) => (
                <div key={tile.left} className="editor-filmstrip-tile" data-source-time-ms={tile.timeMs} style={{ left: tile.left, width: tile.width }}>
                    {frames[tile.timeMs] ? (
                        <img
                            src={frames[tile.timeMs]}
                            alt=""
                            draggable={false}
                            onLoad={(event) => {
                                const image = event.currentTarget;
                                setTileWidth(Math.max(24, Math.min(144, Math.round((46 * image.naturalWidth) / image.naturalHeight))));
                            }}
                        />
                    ) : (
                        <Film className="size-3 opacity-40" />
                    )}
                </div>
            ))}
        </div>
    );
});
