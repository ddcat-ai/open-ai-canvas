import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionAlternative = { transcript: string; confidence: number };
type SpeechRecognitionResult = { isFinal: boolean; length: number; [index: number]: SpeechRecognitionAlternative };
type SpeechRecognitionResultList = { length: number; item(index: number): SpeechRecognitionResult; [index: number]: SpeechRecognitionResult };

type SpeechRecognitionLike = {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;
    onstart: (() => void) | null;
    onresult: ((event: { results: SpeechRecognitionResultList }) => void) | null;
    onerror: ((event: { error: string }) => void) | null;
    onend: (() => void) | null;
    start: () => void;
    stop: () => void;
    abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
    if (typeof window === "undefined") return null;
    const globalWithSpeech = window as unknown as {
        SpeechRecognition?: SpeechRecognitionConstructor;
        webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    return globalWithSpeech.SpeechRecognition || globalWithSpeech.webkitSpeechRecognition || null;
}

export type SpeechRecognitionError = {
    code: string;
    message: string;
};

type UseSpeechRecognitionOptions = {
    /** 语言代码，默认 zh-CN */
    lang?: string;
};

export type UseSpeechRecognitionReturn = {
    /** 浏览器是否支持 Web Speech API */
    supported: boolean;
    /** 识别错误（权限、网络、不支持等） */
    error: SpeechRecognitionError | null;
    /** 开始识别，挂载后自动调用 */
    start: () => void;
    /** 停止识别并返回已累积的最终文本 */
    stop: () => Promise<string>;
    /** 取消识别并清空累积文本 */
    cancel: () => void;
};

/**
 * 浏览器内置语音识别 Hook（Web Speech API）
 * 第一阶段 MVP 使用：不依赖后端、模型渠道或 API Key，零配置可用
 */
export function useSpeechRecognition(options: UseSpeechRecognitionOptions = {}): UseSpeechRecognitionReturn {
    const { lang = "zh-CN" } = options;
    const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
    const finalTextRef = useRef("");
    const stopResolveRef = useRef<((text: string) => void) | null>(null);
    const stopTimerRef = useRef<number | null>(null);
    const [supported] = useState(() => Boolean(getSpeechRecognition()));
    const [error, setError] = useState<SpeechRecognitionError | null>(null);

    const start = useCallback(() => {
        const Constructor = getSpeechRecognition();
        if (!Constructor) {
            setError({ code: "unsupported", message: "当前浏览器不支持语音识别，请使用 Chrome 或 Edge" });
            return;
        }
        finalTextRef.current = "";
        const recognition = new Constructor();
        recognition.lang = lang;
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        recognition.onstart = () => setError(null);
        recognition.onresult = (event) => {
            let text = finalTextRef.current;
            for (let i = 0; i < event.results.length; i += 1) {
                const result = event.results[i];
                if (result.isFinal && result[0]?.transcript) {
                    text = [text, result[0].transcript.trim()].filter(Boolean).join(" ");
                }
            }
            finalTextRef.current = text;
        };
        recognition.onerror = (event) => {
            if (event.error === "not-allowed" || event.error === "service-not-allowed") {
                setError({ code: event.error, message: "麦克风权限被拒绝，请在浏览器设置中允许访问麦克风" });
            } else if (event.error === "no-speech") {
                setError({ code: event.error, message: "未检测到语音，请重试" });
            } else if (event.error === "network") {
                setError({ code: event.error, message: "语音识别服务不可用，请检查网络后重试" });
            } else {
                setError({ code: event.error, message: `语音识别失败（${event.error}）` });
            }
        };
        recognition.onend = () => {
            if (stopTimerRef.current !== null) {
                window.clearTimeout(stopTimerRef.current);
                stopTimerRef.current = null;
            }
            const resolve = stopResolveRef.current;
            stopResolveRef.current = null;
            resolve?.(finalTextRef.current);
        };
        recognitionRef.current = recognition;
        recognition.start();
    }, [lang]);

    const stop = useCallback((): Promise<string> => {
        return new Promise((resolve) => {
            const recognition = recognitionRef.current;
            if (!recognition) {
                resolve(finalTextRef.current);
                return;
            }
            stopResolveRef.current = resolve;
            // 兜底：部分浏览器 stop() 后 onend 可能不触发，超时后返回已识别文本
            stopTimerRef.current = window.setTimeout(() => {
                if (stopResolveRef.current) {
                    stopResolveRef.current = null;
                    resolve(finalTextRef.current);
                }
            }, 1500);
            try {
                recognition.stop();
            } catch {
                if (stopTimerRef.current !== null) {
                    window.clearTimeout(stopTimerRef.current);
                    stopTimerRef.current = null;
                }
                stopResolveRef.current = null;
                resolve(finalTextRef.current);
            }
        });
    }, []);

    const cancel = useCallback(() => {
        if (stopTimerRef.current !== null) {
            window.clearTimeout(stopTimerRef.current);
            stopTimerRef.current = null;
        }
        stopResolveRef.current = null;
        const recognition = recognitionRef.current;
        recognitionRef.current = null;
        if (recognition) {
            recognition.onend = null;
            try {
                recognition.abort();
            } catch { /* ignore */ }
        }
        finalTextRef.current = "";
    }, []);

    useEffect(() => cancel, [cancel]);

    return { supported, error, start, stop, cancel };
}
