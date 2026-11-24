import { useCallback, useSyncExternalStore } from "react";
import { LoaderCircle, Pause, Play } from "lucide-react";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { getCanvasAudioPlaybackSnapshot, getCanvasAudioCurrentTimeMs, seekCanvasAudio, subscribeCanvasAudioNode, toggleCanvasAudio } from "@/services/canvas-audio-playback";

export function CanvasReferenceAudioPreview({ reference, compact = false, buttonOnly = false }: { reference: CanvasResourceReference; compact?: boolean; buttonOnly?: boolean }) {
    const subscribe = useCallback((listener: () => void) => subscribeCanvasAudioNode(reference.id, listener), [reference.id]);
    const getSnapshot = useCallback(() => getCanvasAudioPlaybackSnapshot(reference.id), [reference.id]);
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const source = { nodeId: reference.id, content: reference.mediaUrl || "", storageKey: reference.storageKey, durationMs: reference.durationMs };
    const duration = snapshot.durationMs || reference.durationMs || 0;
    const progress = duration ? Math.min(1, snapshot.currentTimeMs / duration) : 0;
    return (
        <div className={`canvas-reference-audio-preview ${compact ? "is-compact" : ""} ${buttonOnly ? "is-button-only" : ""}`} onPointerDown={(event) => event.stopPropagation()}>
            <button
                type="button"
                disabled={snapshot.phase === "loading"}
                aria-label={`${snapshot.phase === "playing" ? "暂停" : "试听"} ${reference.title || reference.label}`}
                onClick={(event) => {
                    event.stopPropagation();
                    void toggleCanvasAudio(source);
                }}
            >
                {snapshot.phase === "loading" ? <LoaderCircle className="animate-spin" /> : snapshot.phase === "playing" ? <Pause /> : <Play />}
            </button>
            {!buttonOnly ? (
                <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.001}
                    value={progress}
                    aria-label={`${reference.title || reference.label} 播放进度`}
                    onChange={(event) => void seekCanvasAudio(reference.id, Number(event.target.value) * duration, source)}
                    onClick={(event) => event.stopPropagation()}
                />
            ) : null}
            {!compact && !buttonOnly ? (
                <span>
                    {formatAudioTime(getCanvasAudioCurrentTimeMs(reference.id))} / {formatAudioTime(duration)}
                </span>
            ) : null}
        </div>
    );
}

function formatAudioTime(value: number) {
    const seconds = Math.floor(value / 1000);
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
