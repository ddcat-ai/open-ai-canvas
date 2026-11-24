import { Button } from "antd";
import { Component, type ReactNode } from "react";

import { WorkspaceState } from "@/components/layout/workspace-state";
import { reloadAfterChunkFailure } from "@/lib/chunk-recovery";
import { PageResourceError } from "@/lib/module-preload";

export function PageResourceErrorState({ error, onRetry }: { error: PageResourceError; onRetry?: () => void }) {
    const missing = error.status === 404 || error.status === 410;
    const offline = typeof navigator !== "undefined" && !navigator.onLine;
    return (
        <WorkspaceState
            kind="error"
            icon="error"
            title={offline ? "网络连接中断" : "页面资源加载失败"}
            description={missing ? "页面文件已找不到。可以重试，或保存手头的内容后重新加载页面。" : offline ? "连接恢复后，请重试。" : error.message}
            action={onRetry ? <Button onClick={onRetry}>重试</Button> : undefined}
            secondaryAction={missing || !onRetry ? <Button onClick={reloadAfterChunkFailure}>重新加载页面</Button> : undefined}
        />
    );
}

export class PageResourceBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failure: { error: unknown } | null }> {
    state: { failure: { error: unknown } | null } = { failure: null };

    static getDerivedStateFromError(error: unknown) {
        return { failure: { error } };
    }

    render() {
        const { failure } = this.state;
        if (!failure) return this.props.children;
        if (!(failure.error instanceof PageResourceError)) throw failure.error;
        return (
            <PageResourceErrorState
                error={failure.error}
                onRetry={() => {
                    this.props.onRetry();
                    this.setState({ failure: null });
                }}
            />
        );
    }
}
