import { Button } from "antd";
import { Home, RefreshCw } from "lucide-react";
import { useNavigate, useRouteError } from "react-router";

export default function RouteErrorPage() {
    const error = useRouteError();
    const navigate = useNavigate();
    const message = error instanceof Error ? error.message : "页面暂时无法显示";

    return (
        <main className="grid h-dvh place-items-center bg-background px-6 text-foreground">
            <section className="w-full max-w-md text-center">
                <p className="text-xs font-medium text-muted-foreground">页面运行异常</p>
                <h1 className="mt-3 text-2xl font-semibold">当前页面没有正常加载</h1>
                <p className="mt-3 break-words text-sm leading-6 text-muted-foreground">{message}</p>
                <div className="mt-6 flex justify-center gap-3">
                    <Button icon={<RefreshCw className="size-4" />} onClick={() => window.location.reload()}>重新加载</Button>
                    <Button type="primary" icon={<Home className="size-4" />} onClick={() => navigate("/")}>返回主页</Button>
                </div>
            </section>
        </main>
    );
}
