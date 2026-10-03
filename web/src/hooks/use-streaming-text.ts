import { useCallback, useEffect, useRef, useState } from "react";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** 将网络文本块按帧连续展开；积压越多越快，收尾最多再显示 180ms。 */
export function useStreamingText(targetText: string, isStreaming: boolean, enabled: boolean) {
    const [visibleText, setVisibleText] = useState(enabled && isStreaming ? "" : targetText);
    const playbackRef = useRef({
        target: targetText,
        visible: visibleText,
        ends: [] as number[],
        progress: 0,
        speed: 0.045,
        previousTime: 0,
        isStreaming,
        hasStreamed: enabled && isStreaming,
        finishBy: null as number | null,
        frame: null as number | null,
    });

    const advance = useCallback(function advance(now: number) {
        const playback = playbackRef.current;
        playback.frame = null;
        const elapsed = now - playback.previousTime;
        if (elapsed >= 15) {
            const remaining = playback.ends.length - playback.progress;
            if (playback.isStreaming) {
                const desiredSpeed = Math.max(0.045, remaining / 180);
                playback.speed += (desiredSpeed - playback.speed) * (1 - Math.exp(-elapsed / 90));
            } else {
                playback.speed = remaining / Math.max(1, (playback.finishBy ?? now) - playback.previousTime);
            }
            playback.progress = Math.min(playback.ends.length, playback.progress + Math.min(elapsed, 64) * playback.speed);
            const count = !playback.isStreaming && now >= (playback.finishBy ?? now) ? playback.ends.length : Math.floor(playback.progress);
            playback.previousTime = now;
            const nextText = count ? playback.target.slice(0, playback.ends[count - 1]) : "";
            if (nextText !== playback.visible) {
                playback.visible = nextText;
                setVisibleText(nextText);
            }
        }
        if (playback.visible !== playback.target) playback.frame = window.requestAnimationFrame(advance);
    }, []);

    useEffect(() => {
        const playback = playbackRef.current;
        playback.isStreaming = isStreaming;
        if (enabled && isStreaming) {
            playback.hasStreamed = true;
            playback.finishBy = null;
        }
        if (!enabled || !playback.hasStreamed || !targetText.startsWith(playback.visible)) {
            if (playback.frame !== null) window.cancelAnimationFrame(playback.frame);
            playback.frame = null;
            playback.target = playback.visible = targetText;
            setVisibleText(targetText);
            return;
        }
        // 新增量只更新目标，保留当前帧时钟、速度与小数进度。
        if (targetText !== playback.target || !playback.ends.length) {
            playback.ends = Array.from(segmenter.segment(targetText), (part) => part.index + part.segment.length);
            const index = playback.ends.findIndex((end) => end > playback.visible.length);
            playback.progress = index < 0 ? playback.ends.length : index + playback.progress % 1;
            playback.target = targetText;
        }
        if (playback.visible === targetText) return;
        if (!isStreaming) playback.finishBy ??= performance.now() + 180;
        if (playback.frame === null) {
            playback.previousTime = performance.now();
            playback.frame = window.requestAnimationFrame(advance);
        }
    }, [advance, enabled, isStreaming, targetText]);

    useEffect(() => () => {
        const playback = playbackRef.current;
        if (playback.frame !== null) window.cancelAnimationFrame(playback.frame);
        playback.frame = null;
    }, []);

    // 服务端修正正文或调用方切换到静态内容时，直接采用完整内容。
    return !enabled || !playbackRef.current.hasStreamed || !targetText.startsWith(visibleText) ? targetText : visibleText;
}
