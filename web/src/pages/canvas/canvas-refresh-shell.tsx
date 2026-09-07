import { FullScreenLoader } from "@/components/ui/aceternity/full-screen-loader";
import { useEffect, useState } from "react";

const CANVAS_LOADING_STAGES = [
    { label: "正在准备创作环境", detail: "连接本地能力与模型配置" },
    { label: "正在恢复工作区", detail: "读取画布、素材和插件缓存" },
    { label: "正在恢复画布", detail: "读取画布布局与项目数据" },
];

export function CanvasRefreshShell() {
    const [stageIndex, setStageIndex] = useState(0);

    useEffect(() => {
        const timer = window.setInterval(() => setStageIndex((current) => (current + 1) % CANVAS_LOADING_STAGES.length), 900);
        return () => window.clearInterval(timer);
    }, []);

    const stage = CANVAS_LOADING_STAGES[stageIndex];
    return <FullScreenLoader kind="route" label={stage.label} detail={stage.detail} />;
}
