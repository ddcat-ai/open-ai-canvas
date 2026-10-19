import { useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";

export function useCreationHomeNavigation(ready: boolean, startNewConversation: () => void) {
    const location = useLocation();
    const navigate = useNavigate();
    const handledKey = useRef<string | null>(null);

    useLayoutEffect(() => {
        if (!ready || location.state?.creationHome !== true || handledKey.current === location.key) return;
        // 等账号偏好和本地历史恢复后再切换，避免晚到的恢复结果选回旧会话。
        handledKey.current = location.key;
        startNewConversation();
        const { creationHome: _, ...rest } = location.state;
        void navigate(
            { pathname: location.pathname, search: location.search, hash: location.hash },
            {
                replace: true,
                state: Object.keys(rest).length ? rest : null,
            },
        );
    }, [ready, location, navigate, startNewConversation]);
}
