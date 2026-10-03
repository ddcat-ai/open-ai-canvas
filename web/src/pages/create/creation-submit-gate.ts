export function createCreationSubmitGate() {
    let locked = false;

    return {
        tryAcquire() {
            if (locked) return false;
            locked = true;
            return true;
        },
        release() {
            locked = false;
        },
    };
}

export function createCreationSubmitGateRelease(gate: ReturnType<typeof createCreationSubmitGate>) {
    let released = false;
    return () => {
        if (released) return;
        released = true;
        gate.release();
    };
}

export async function withCreationSubmitGate<T>(gate: ReturnType<typeof createCreationSubmitGate>, task: () => Promise<T> | T) {
    if (!gate.tryAcquire()) return { accepted: false as const };
    try {
        return { accepted: true as const, value: await task() };
    } finally {
        gate.release();
    }
}
