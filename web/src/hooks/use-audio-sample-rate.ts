import { useEffect, useState } from "react";

import { probeAudioSampleRate } from "@/services/audio-sample-rate-probe";

/** 按需读取音频源采样率（Hz）；读取中或无法识别时为 undefined。 */
export function useAudioSampleRate(storageKey: string | undefined, url: string) {
    const key = storageKey || url;
    const [result, setResult] = useState<{ key: string; sampleRate?: number } | null>(null);
    useEffect(() => {
        if (!key) return;
        let cancelled = false;
        void probeAudioSampleRate(storageKey, url).then((sampleRate) => {
            if (!cancelled) setResult({ key, sampleRate });
        });
        return () => {
            cancelled = true;
        };
    }, [key, storageKey, url]);
    return result?.key === key ? result.sampleRate : undefined;
}
