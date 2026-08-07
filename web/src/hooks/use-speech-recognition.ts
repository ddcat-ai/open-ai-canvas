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
    const interimTextRef = useRef("");
    const lastResultIndexRef = useRef(0);
    const stopResolveRef = useRef<((text: string) => void) | null>(null);
    const stopTimerRef = useRef<number | null>(null);
    const [supported] = useState(() => Boolean(getSpeechRecognition()));
    const [error, setError] = useState<SpeechRecognitionError | null>(null);

    const currentText = useCallback(() => {
        const final = finalTextRef.current.trim();
        const interim = interimTextRef.current.trim();
        return final ? (interim ? `${final} ${interim}` : final) : interim;
    }, []);

    const start = useCallback(() => {
        const Constructor = getSpeechRecognition();
        if (!Constructor) {
            setError({ code: "unsupported", message: "当前浏览器不支持语音识别，请使用 Chrome 或 Edge" });
            return;
        }
        finalTextRef.current = "";
        interimTextRef.current = "";
        lastResultIndexRef.current = 0;
        const recognition = new Constructor();
        recognition.lang = lang;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.onstart = () => setError(null);
        recognition.onresult = (event) => {
            // 浏览器每次回调都会携带完整结果列表，只处理新增的条目，避免最终文本重复追加。
            for (let index = lastResultIndexRef.current; index < event.results.length; index += 1) {
                const result = event.results[index];
                const transcript = result[0]?.transcript?.trim();
                if (!transcript) continue;
                if (result.isFinal) {
                    finalTextRef.current = [finalTextRef.current, transcript].filter(Boolean).join(" ");
                    interimTextRef.current = "";
                } else {
                    interimTextRef.current = transcript;
                }
            }
            lastResultIndexRef.current = event.results.length;
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
            resolve?.(currentText());
        };
        recognitionRef.current = recognition;
        try {
            recognition.start();
        } catch {
            setError({ code: "start-failed", message: "语音识别启动失败，请重试" });
        }
    }, [currentText, lang]);

    const stop = useCallback((): Promise<string> => {
        return new Promise((resolve) => {
            const recognition = recognitionRef.current;
            if (!recognition) {
                resolve(currentText());
                return;
            }
            stopResolveRef.current = resolve;
            // 兜底：部分浏览器 stop() 后 onend 触发较慢，预留足够时间等最终结果，避免提前判空。
            stopTimerRef.current = window.setTimeout(() => {
                if (stopResolveRef.current) {
                    stopResolveRef.current = null;
                    resolve(currentText());
                }
            }, 5000);
            try {
                recognition.stop();
            } catch {
                if (stopTimerRef.current !== null) {
                    window.clearTimeout(stopTimerRef.current);
                    stopTimerRef.current = null;
                }
                stopResolveRef.current = null;
                resolve(currentText());
            }
        });
    }, [currentText]);

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
        interimTextRef.current = "";
        lastResultIndexRef.current = 0;
    }, []);

    useEffect(() => cancel, [cancel]);

    return { supported, error, start, stop, cancel };
}
