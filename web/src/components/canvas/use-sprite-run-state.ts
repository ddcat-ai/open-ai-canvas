import { useEffect, useRef, useState } from "react";
import { spriteCompletedTransition, type SpriteRunState } from "@/lib/canvas/sprite-pet";

// Keep the completion cue above both views so opening the panel cannot replay or lose it.
export function useSpriteRunState(state: SpriteRunState): SpriteRunState {
    const previous = useRef<SpriteRunState | undefined>(undefined);
    const [completion, setCompletion] = useState<{ runId?: string; at: number }>({ at: 0 });
    useEffect(() => {
        if (spriteCompletedTransition(previous.current, state)) setCompletion({ runId: state.runId, at: Date.now() });
        previous.current = state;
    }, [state.runId, state.status, state.cleanupPending, state.waitingUser, state.approvalPending, state.connected]);
    return { ...state, completedAt: completion.runId === state.runId ? completion.at : undefined };
}
