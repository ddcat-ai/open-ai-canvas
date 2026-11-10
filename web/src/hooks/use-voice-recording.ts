import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceRecordingState = "idle" | "recording" | "paused";
type UseVoiceRecordingOptions = { maxDuration?: number; onComplete?: (blob: Blob) => void };
type Recording = {
    recorder: MediaRecorder;
    stream: MediaStream;
    chunks: Blob[];
    done: Promise<Blob | null>;
    resolve: (blob: Blob | null) => void;
    clock?: ReturnType<typeof setInterval>;
    deadline?: ReturnType<typeof setTimeout>;
    stopDeadline?: ReturnType<typeof setTimeout>;
    stopping: boolean;
};

/** 样本录制只保留 MediaRecorder，不为未展示的波形创建 AudioContext 或逐帧采样。 */
export function useVoiceRecording({ maxDuration = 60, onComplete }: UseVoiceRecordingOptions = {}) {
    const [state, setState] = useState<VoiceRecordingState>("idle");
    const [starting, setStarting] = useState(false);
    const [duration, setDuration] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const active = useRef<Recording | null>(null);
    const generation = useRef(0);
    const pending = useRef(false);
    const mounted = useRef(true);
    const completed = useRef(onComplete);
    completed.current = onComplete;

    const finish = useCallback((session: Recording, keep: boolean) => {
        if (active.current !== session) return;
        active.current = null;
        clearInterval(session.clock);
        clearTimeout(session.deadline);
        clearTimeout(session.stopDeadline);
        session.recorder.ondataavailable = null;
        session.recorder.onstop = null;
        session.recorder.onerror = null;
        if (session.recorder.state !== "inactive") {
            try {
                session.recorder.stop();
            } catch {
                /* 设备可能已断开，仍需释放音轨。 */
            }
        }
        session.stream.getTracks().forEach((track) => track.stop());
        const blob = keep && session.chunks.length ? new Blob(session.chunks, { type: session.recorder.mimeType || session.chunks[0].type || "audio/webm" }) : null;
        session.chunks = [];
        session.resolve(blob);
        if (mounted.current) {
            setState("idle");
            if (blob) completed.current?.(blob);
        }
    }, []);

    const stop = useCallback(async (): Promise<Blob | null> => {
        const session = active.current;
        if (!session) {
            generation.current++;
            pending.current = false;
            if (mounted.current) setStarting(false);
            return null;
        }
        if (!session.stopping) {
            session.stopping = true;
            clearInterval(session.clock);
            clearTimeout(session.deadline);
            // 正常等最后一个 dataavailable/onstop；设备异常时仍要释放音轨并完成等待者。
            session.stopDeadline = setTimeout(() => finish(session, true), 1500);
            try {
                session.recorder.stop();
            } catch {
                finish(session, true);
            }
        }
        return session.done;
    }, [finish]);

    const cancel = useCallback(() => {
        generation.current++;
        pending.current = false;
        if (active.current) finish(active.current, false);
        if (mounted.current) {
            setStarting(false);
            setState("idle");
            setDuration(0);
        }
    }, [finish]);

    const start = useCallback(async () => {
        if (pending.current || active.current) return;
        const token = ++generation.current;
        pending.current = true;
        setStarting(true);
        setError(null);
        setDuration(0);
        let stream: MediaStream | undefined;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (!mounted.current || token !== generation.current) {
                stream.getTracks().forEach((track) => track.stop());
                return;
            }
            const recorder = new MediaRecorder(stream);
            let resolve!: (blob: Blob | null) => void;
            const done = new Promise<Blob | null>((complete) => {
                resolve = complete;
            });
            const session: Recording = { recorder, stream, chunks: [], done, resolve, stopping: false };
            active.current = session;
            recorder.ondataavailable = ({ data }) => {
                if (active.current === session && data.size) session.chunks.push(data);
            };
            recorder.onstop = () => finish(session, true);
            recorder.onerror = () => {
                if (mounted.current) setError("录音失败，请检查麦克风后重试");
                finish(session, false);
            };
            recorder.start(250);
            const startedAt = Date.now();
            const limit = Number.isFinite(maxDuration) && maxDuration > 0 ? maxDuration : 60;
            session.clock = setInterval(() => {
                if (mounted.current && active.current === session) setDuration(Math.min(limit, (Date.now() - startedAt) / 1000));
            }, 1000);
            session.deadline = setTimeout(() => {
                if (mounted.current) setDuration(limit);
                void stop();
            }, limit * 1000);
            setState("recording");
        } catch (cause) {
            if (token === generation.current) {
                if (active.current) finish(active.current, false);
                else stream?.getTracks().forEach((track) => track.stop());
                if (mounted.current) {
                    setError(cause instanceof Error ? cause.message : "无法访问麦克风");
                    setState("idle");
                }
            }
        } finally {
            if (token === generation.current) {
                pending.current = false;
                if (mounted.current) setStarting(false);
            }
        }
    }, [finish, maxDuration, stop]);

    const reset = useCallback(() => {
        cancel();
        setError(null);
    }, [cancel]);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            cancel();
        };
    }, [cancel]);
    return { state, starting, duration, error, start, stop, cancel, reset };
}
