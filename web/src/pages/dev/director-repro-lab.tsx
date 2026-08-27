import { useCallback, useMemo, useState } from "react";
import { Button, Switch, Table, Tag } from "antd";

import { CanvasDirectorWorkbench } from "@/components/canvas/director/canvas-director-workbench";
import { DIRECTOR_REPRO_MATRIX, createDirectorReproScene, directorReproSceneIsOffline, injectDirectorReproModel, type DirectorReproModelVariant } from "@/lib/canvas/director/director-repro-fixture";
import { readDirectorReproSnapshot, type DirectorReproSnapshot } from "@/lib/canvas/director/director-repro-runtime";
import { resetDirectorDiagnosticDedupe } from "@/lib/canvas/director/director-diagnostics-recorder";
import { getClientDiagnosticEvents } from "@/services/diagnostics/client-diagnostics";
import type { DirectorScene } from "@/types/director";

/**
 * P0 手工复现入口（仅 DEV 注册）。
 *
 * 渲染真实 CanvasDirectorWorkbench + 确定性 fixture，不是静态 mock。
 * 本页自己的 callback 都是本地确定性实现，不调用任何 API：
 * onChange 只写本页 state，onFlush 只在「强制失败」开关打开时抛错，
 * onApply 只累加本地计数。
 *
 * 范围声明：只有「初始 fixture + 本页 callback」保证不发网。
 * 真实工作台自带的新增控件（默认演员 GLB、上传模型、画布图片立牌）
 * 仍可能联网，这是刻意保留的真实行为 —— 不要据此宣称整个工作台永不发网。
 */
export default function DirectorReproLab() {
    const [scene, setScene] = useState<DirectorScene>(() => createDirectorReproScene());
    // workbench 是 fixed inset-0 全屏浮层，会完全遮住本页。默认关闭，
    // 让环境快照 / 事件列表 / 复现矩阵先可读，再由用户显式打开进入复现。
    const [workbenchOpen, setWorkbenchOpen] = useState(false);
    const [forceSaveFailure, setForceSaveFailure] = useState(false);
    const [appliedCount, setAppliedCount] = useState(0);
    const [flushCount, setFlushCount] = useState(0);
    const [events, setEvents] = useState(() => readDirectorEvents());
    const snapshot = useMemo(() => readDirectorReproSnapshot(), []);

    const refreshEvents = useCallback(() => setEvents(readDirectorEvents()), []);

    /** 本地确定性保存：只写本页 state，不触碰项目 store，也不发请求。 */
    const onChange = useCallback((next: DirectorScene) => setScene(next), []);

    /** 强制失败开关用于复现「保存失败 / 关闭恢复」，抛错后由 coordinator 走真实 error 语义。 */
    const onFlush = useCallback(() => {
        setFlushCount((count) => count + 1);
        if (forceSaveFailure) throw new Error("repro forced flush failure");
    }, [forceSaveFailure]);

    const onApply = useCallback(async () => {
        setAppliedCount((count) => count + 1);
    }, []);

    const reset = useCallback(() => {
        resetDirectorDiagnosticDedupe();
        setScene(createDirectorReproScene());
        setForceSaveFailure(false);
        setAppliedCount(0);
        setFlushCount(0);
        setWorkbenchOpen(false);
        refreshEvents();
    }, [refreshEvents]);

    /** 显式注入模型对象：固定 id，重复点击替换同一对象而不是堆叠。 */
    const injectModel = useCallback((variant: DirectorReproModelVariant) => {
        setScene((current) => injectDirectorReproModel(current, variant));
    }, []);

    return (
        <div className="min-h-dvh overflow-y-auto p-5" style={{ background: "var(--bg)", color: "var(--fg)" }}>
            <header className="mb-4 flex flex-wrap items-center gap-3">
                <h1 className="text-lg font-semibold">导演台 P0 复现台</h1>
                <Tag color={directorReproSceneIsOffline(scene) ? "green" : "red"} data-testid="offline-tag">
                    {directorReproSceneIsOffline(scene) ? "fixture 无网络资产" : "已注入模型资产"}
                </Tag>
                <span className="text-[var(--fs-tiny)] opacity-70" data-testid="object-count">
                    对象数 {scene.objects.length}
                </span>
                <span className="ml-auto flex flex-wrap items-center gap-2">
                    <Button size="small" data-testid="inject-local-model" onClick={() => injectModel("local")}>
                        注入本地模型
                    </Button>
                    <Button size="small" data-testid="inject-missing-model" onClick={() => injectModel("missing")}>
                        注入缺失模型
                    </Button>
                    <span className="text-[var(--fs-tiny)] opacity-70">强制保存失败</span>
                    <Switch checked={forceSaveFailure} onChange={setForceSaveFailure} data-testid="force-save-failure" />
                    <Button size="small" data-testid="toggle-workbench" onClick={() => setWorkbenchOpen((open) => !open)}>
                        {workbenchOpen ? "关闭导演台" : "打开导演台"}
                    </Button>
                    <Button size="small" data-testid="refresh-events" onClick={refreshEvents}>
                        刷新事件
                    </Button>
                    <Button size="small" data-testid="reset-lab" onClick={reset}>
                        重置
                    </Button>
                </span>
            </header>

            <EnvironmentSnapshot snapshot={snapshot} appliedCount={appliedCount} flushCount={flushCount} sceneRevisionHint={scene.updatedAt} />
            <DiagnosticEventList events={events} />
            <ReproMatrix />

            {workbenchOpen ? (
                <CanvasDirectorWorkbench open scene={scene} imageNodes={[]} onboardingScope="director-repro-lab" onClose={() => setWorkbenchOpen(false)} onChange={onChange} onApply={onApply} onDeleteImageNode={() => undefined} onFlush={onFlush} />
            ) : null}
        </div>
    );
}

type DirectorEventRow = { id: string; timestamp: string; level: string; code: string; message: string };

/** 只显示导演台自己的稳定码事件，避免整条诊断流噪声淹没复现现场。 */
function readDirectorEvents(): DirectorEventRow[] {
    return getClientDiagnosticEvents()
        .filter((event) => (event.code || "").startsWith("DIRECTOR_"))
        .map((event) => ({ id: event.id, timestamp: event.timestamp, level: event.level, code: event.code || "", message: event.message }))
        .reverse();
}

function EnvironmentSnapshot({ snapshot, appliedCount, flushCount, sceneRevisionHint }: { snapshot: DirectorReproSnapshot; appliedCount: number; flushCount: number; sceneRevisionHint: string }) {
    const { runtime, webgl } = snapshot;
    const rows: Array<[string, string]> = [
        ["应用版本", runtime.appVersion],
        ["构建提交", runtime.buildCommit],
        ["浏览器", runtime.browser || "(不可用)"],
        ["操作系统", runtime.os || "(不可用)"],
        ["时区", runtime.timezone || "(不可用)"],
        ["DPR", String(runtime.devicePixelRatio)],
        ["本地 onApply 次数", String(appliedCount)],
        ["本地 onFlush 次数", String(flushCount)],
        ["场景 updatedAt", sceneRevisionHint],
    ];

    if (webgl.available) {
        rows.push(
            ["WebGL 版本", webgl.version || "(空)"],
            ["WebGL vendor", webgl.vendor || "(空)"],
            ["WebGL renderer", webgl.renderer || "(空)"],
            ["最大纹理尺寸", String(webgl.maxTextureSize)],
            ["最大 renderbuffer", String(webgl.maxRenderbufferSize)],
            ["最大视口", webgl.maxViewportWidth + "×" + webgl.maxViewportHeight],
        );
    } else {
        rows.push(["WebGL", webgl.reason === "unsupported" ? "不支持（已稳定降级）" : "上下文创建失败（已稳定降级）"]);
    }

    return (
        <section className="mb-4">
            <h2 className="mb-2 text-[var(--fs-label)] font-semibold opacity-75">环境快照</h2>
            <p className="mb-2 text-[var(--fs-tiny)] opacity-60">仅本地展示，不上报；字符串已限长并剥离 URL query/hash 与凭证片段。</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 md:grid-cols-3">
                {rows.map(([label, value]) => (
                    <div key={label} className="flex min-w-0 gap-2 text-[var(--fs-tiny)]">
                        <span className="shrink-0 opacity-55">{label}</span>
                        <span className="min-w-0 flex-1 truncate font-mono" title={value}>
                            {value}
                        </span>
                    </div>
                ))}
            </div>
        </section>
    );
}

function DiagnosticEventList({ events }: { events: DirectorEventRow[] }) {
    return (
        <section className="mb-4">
            <h2 className="mb-2 text-[var(--fs-label)] font-semibold opacity-75">结构化事件（{events.length}）</h2>
            <p className="mb-2 text-[var(--fs-tiny)] opacity-60">来自统一 client-diagnostics 缓冲区，只筛选 DIRECTOR_ 稳定码；不含 stack、URL 与业务正文。</p>
            {events.length ? (
                <Table
                    size="small"
                    rowKey="id"
                    dataSource={events}
                    pagination={false}
                    scroll={{ y: 220 }}
                    columns={[
                        { title: "时间", dataIndex: "timestamp", width: 200, render: (value: string) => <span className="font-mono text-[var(--fs-tiny)]">{value}</span> },
                        { title: "级别", dataIndex: "level", width: 88, render: (value: string) => <Tag color={value === "error" ? "red" : value === "warning" ? "orange" : "blue"}>{value}</Tag> },
                        { title: "稳定码", dataIndex: "code", render: (value: string) => <span className="font-mono text-[var(--fs-tiny)]">{value}</span> },
                        { title: "消息", dataIndex: "message" },
                    ]}
                />
            ) : (
                <p className="text-[var(--fs-tiny)] opacity-55">暂无导演台事件。触发下方矩阵中的失败场景后点击「刷新事件」。</p>
            )}
        </section>
    );
}

function ReproMatrix() {
    return (
        <section className="mb-4">
            <h2 className="mb-2 text-[var(--fs-label)] font-semibold opacity-75">P0 手工复现矩阵（{DIRECTOR_REPRO_MATRIX.length}）</h2>
            <Table
                size="small"
                rowKey="id"
                dataSource={[...DIRECTOR_REPRO_MATRIX]}
                pagination={false}
                columns={[
                    { title: "分组", dataIndex: "group", width: 108 },
                    { title: "场景", dataIndex: "title", width: 190 },
                    { title: "操作", dataIndex: "steps" },
                    { title: "预期", dataIndex: "expected" },
                ]}
            />
        </section>
    );
}
