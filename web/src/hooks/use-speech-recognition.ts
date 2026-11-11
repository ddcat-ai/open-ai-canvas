import { useCallback, useEffect, useRef, useState } from "react";

type Recognition = {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;
    onstart: (() => void) | null;
    onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0?: { transcript: string } }> }) => void) | null;
    onerror: ((event: { error: string }) => void) | null;
    onend: (() => void) | null;
    start: () => void;
    stop: () => void;
    abort: () => void;
};
type RecognitionConstructor = new () => Recognition;
function getRecognition(): RecognitionConstructor | undefined {
    if (typeof window === "undefined") return;
    const browser = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    return browser.SpeechRecognition || browser.webkitSpeechRecognition;
}
export type SpeechRecognitionError = { code: string; message: string };

/** 文字输入直接使用浏览器识别，不额外录制一份不会使用的音频。 */
export function useSpeechRecognition({ lang = "zh-CN" }: { lang?: string } = {}) {
    const active = useRef<Recognition | null>(null);
    const finalText = useRef("");
    const pendingStop = useRef<{ promise: Promise<string>; resolve: (text: string) => void } | null>(null);
    const deadline = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const mounted = useRef(true);
    const [supported] = useState(() => Boolean(getRecognition()));
    const [listening, setListening] = useState(false);
    const [error, setError] = useState<SpeechRecognitionError | null>(null);

    const finish = useCallback((recognition: Recognition, abort = false) => {
        if (active.current !== recognition) return;
        active.current = null;
        clearTimeout(deadline.current);
        deadline.current = undefined;
        recognition.onstart = null;
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        if (abort) {
            try {
                recognition.abort();
            } catch {
                /* 已结束的识别器无需再次停止。 */
            }
        }
        const pending = pendingStop.current;
        pendingStop.current = null;
        pending?.resolve(finalText.current);
        if (mounted.current) setListening(false);
    }, []);
    const cancel = useCallback(() => {
        finalText.current = "";
        if (active.current) finish(active.current, true);
        else {
            clearTimeout(deadline.current);
            pendingStop.current?.resolve("");
            pendingStop.current = null;
        }
    }, [finish]);
    const start = useCallback(() => {
        cancel();
        const Constructor = getRecognition();
        if (!Constructor) {
            setError({ code: "unsupported", message: "当前浏览器不支持语音识别，请使用 Chrome 或 Edge" });
            return;
        }
        const recognition = new Constructor();
        active.current = recognition;
        recognition.lang = lang;
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        setError(null);
        setListening(true);
        recognition.onstart = () => {
            if (active.current === recognition) setListening(true);
        };
        recognition.onresult = ({ results }) => {
            if (active.current !== recognition) return;
            // Web Speech 每次返回累计结果，直接重建，避免每个事件重复追加旧句子。
            finalText.current = Array.from(results)
                .filter((result) => result.isFinal)
                .map((result) => result[0]?.transcript.trim() || "")
                .filter(Boolean)
                .join(" ");
        };
        recognition.onerror = ({ error: code }) => {
            if (active.current !== recognition) return;
            const message =
                code === "not-allowed" || code === "service-not-allowed"
                    ? "麦克风权限被拒绝，请在浏览器设置中允许访问麦克风"
                    : code === "no-speech"
                      ? "未检测到语音，请重试"
                      : code === "network"
                        ? "语音识别服务不可用，请检查网络后重试"
                        : `语音识别失败（${code}）`;
            setError({ code, message });
            finish(recognition, true);
        };
        recognition.onend = () => finish(recognition);
        try {
            recognition.start();
        } catch (cause) {
            setError({ code: "start-failed", message: cause instanceof Error ? cause.message : "语音识别启动失败" });
            finish(recognition, true);
        }
    }, [cancel, finish, lang]);
    const stop = useCallback((): Promise<string> => {
        if (pendingStop.current) return pendingStop.current.promise;
        const recognition = active.current;
        if (!recognition) return Promise.resolve(finalText.current);
        let resolve!: (text: string) => void;
        const promise = new Promise<string>((done) => {
            resolve = done;
        });
        pendingStop.current = { promise, resolve };
        deadline.current = setTimeout(() => finish(recognition, true), 1500);
        try {
            recognition.stop();
        } catch {
            finish(recognition, true);
        }
        return promise;
    }, [finish]);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            cancel();
        };
    }, [cancel]);
    return { supported, listening, error, start, stop, cancel };
}
