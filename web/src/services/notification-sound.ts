type AudioContextConstructor = typeof AudioContext;

let audioContext: AudioContext | null = null;
let unlockInstalled = false;

function audioContextConstructor(): AudioContextConstructor | undefined {
    if (typeof window === "undefined") return undefined;
    return window.AudioContext || (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
}

function ensureAudioContext() {
    if (audioContext) return audioContext;
    const Context = audioContextConstructor();
    if (!Context) return null;
    try {
        audioContext = new Context();
    } catch {
        return null;
    }
    return audioContext;
}

/**
 * 浏览器要求用户手势后才能出声。首次点击或按键时预先解锁音频，之后标签页在后台也能播放提示音。
 */
export function installNotificationAudioUnlock() {
    if (unlockInstalled || typeof window === "undefined") return;
    unlockInstalled = true;
    const unlock = () => {
        const context = ensureAudioContext();
        if (!context) return;
        void context
            .resume()
            .then(() => {
                if (context.state !== "running") return;
                window.removeEventListener("pointerdown", unlock, true);
                window.removeEventListener("keydown", unlock, true);
            })
            .catch(() => undefined);
    };
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
}

/** 生成完成提示音：两个上行的柔和正弦音，约 0.5 秒，音量较低，不使用音频文件。 */
export function playGenerationSuccessSound() {
    const context = ensureAudioContext();
    if (!context) return;
    const play = () => {
        const start = context.currentTime + 0.02;
        const master = context.createGain();
        master.gain.value = 0.16;
        master.connect(context.destination);
        [
            { frequency: 784, at: 0, length: 0.32 },
            { frequency: 1175, at: 0.11, length: 0.42 },
        ].forEach(({ frequency, at, length }) => {
            const oscillator = context.createOscillator();
            const gain = context.createGain();
            oscillator.type = "sine";
            oscillator.frequency.value = frequency;
            gain.gain.setValueAtTime(0.0001, start + at);
            gain.gain.exponentialRampToValueAtTime(0.9, start + at + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + at + length);
            oscillator.connect(gain);
            gain.connect(master);
            oscillator.start(start + at);
            oscillator.stop(start + at + length + 0.02);
        });
    };
    if (context.state === "running") {
        play();
        return;
    }
    // 尚未解锁时 resume 会被浏览器拒绝，静默跳过；不能为了出声弹出任何授权提示。
    void context
        .resume()
        .then(() => {
            if (context.state === "running") play();
        })
        .catch(() => undefined);
}
