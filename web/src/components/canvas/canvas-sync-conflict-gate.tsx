import { Button, Popconfirm } from "antd";
import { Link } from "react-router";
import type { CanvasSyncConflictError } from "@/services/user-data-sync";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

type CanvasSyncConflictGateProps = {
    /** 加载失败的完整提示（冲突错误自带退路说明，普通错误原样展示）。 */
    message: string;
    /** 结构化冲突对象；为 null 表示普通加载失败（仅重试，无冲突分支）。 */
    conflict: CanvasSyncConflictError | null;
    /** 普通加载失败的重试。 */
    onRetry: () => void;
    /** 冲突态"加载云端版本"：调用方先放弃本地该画布再重跑加载。 */
    onLoadRemote: () => void;
    projectId: string;
};

/**
 * 画布加载失败/同步冲突阻断页。
 * 冲突态给用户两条真实退路：导出本地备份（完整 JSON 落盘）与确认后放弃本地加载云端；
 * 不提供双向分歧下的"覆盖云端"——单用户多设备场景下一键覆盖必然丢另一端的修改。
 */
export function CanvasSyncConflictGate({ message, conflict, onRetry, onLoadRemote, projectId }: CanvasSyncConflictGateProps) {
    const exportLocalCanvas = () => {
        const local = useCanvasStore.getState().projects.find((candidate) => candidate.id === projectId);
        if (!local) return;
        const blob = new Blob([JSON.stringify(local, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `canvas-conflict-${projectId}-${Date.now()}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
    };
    return (
        <main className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            <p role="alert" className="max-w-[420px]">{message}</p>
            {conflict ? (
                <>
                    <div className="flex items-center gap-3">
                        <Button onClick={exportLocalCanvas}>导出本地备份</Button>
                        <Popconfirm
                            title="加载云端版本？"
                            description="本地这份画布（含未同步的修改）将被放弃，云端版本会覆盖本地。可先导出备份。"
                            okText="加载云端版本"
                            cancelText="取消"
                            onConfirm={onLoadRemote}
                        >
                            <Button danger>加载云端版本</Button>
                        </Popconfirm>
                    </div>
                    <Link to="/canvas">返回画布库</Link>
                </>
            ) : (
                <>
                    <Button onClick={onRetry}>重新加载</Button>
                    <Link to="/canvas">返回画布库</Link>
                </>
            )}
        </main>
    );
}
