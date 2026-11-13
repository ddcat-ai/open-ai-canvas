import { Check, LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { GenerationTask } from "@/services/api/task-center";
import "./planning-activity.css";

export function PlanningActivity({ task, references, count, automaticScreens = false }: { task?: GenerationTask; references: number; count: number; automaticScreens?: boolean }) {
    const [openedAt] = useState(Date.now);
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    // Only timestamps the server sent are trusted; a missing or invalid time
    // starts counting from this mount instead of inventing an earlier start.
    const parsedStartedAt = Date.parse(task?.startedAt || "");
    const parsedCreatedAt = Date.parse(task?.createdAt || "");
    const started = Number.isFinite(parsedStartedAt) ? parsedStartedAt : Number.isFinite(parsedCreatedAt) ? parsedCreatedAt : openedAt;
    const seconds = Math.max(0, Math.floor((now - started) / 1000));
    const ended = task?.status === "failed" || task?.status === "cancelled";
    const status = !task ? "正在读取策划进度" : task.status === "queued" ? "已排队，等待模型处理" : task.status === "succeeded" ? "正在校验图片方案" : ended ? "策划任务已结束，正在整理结果" : "正在分析商品与构建方案";
    const activity = ended
        ? "任务未成功完成，正在整理可保留的内容"
        : task?.status === "queued"
          ? "模型任务已排队，完成后自动展示方案"
          : task?.status === "succeeded"
            ? task.textDraft
                ? `已收到 ${task.textDraft.length} 字策划输出，正在校验完整方案`
                : "正在核对方案结构与图片数量"
            : task?.textDraft
              ? `已收到 ${task.textDraft.length} 字策划输出，等待完整方案`
              : "正在等待模型返回可审阅的策划内容";
    return (
        <section className="commerce-planning-activity" aria-label={ended ? "Agent 策划已结束" : "Agent 策划进行中"} aria-busy={!ended}>
            <div className="commerce-planning-emblem" aria-hidden="true">
                <span />
                <Sparkles size={24} strokeWidth={1.5} />
            </div>
            <div className="commerce-planning-title">
                {/* The live region holds only the status line: the ticking clock and
                    the received-character count update without being re-announced. */}
                <strong role="status">{status}</strong>
                <span>{seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds} 秒`}</span>
            </div>
            <p>以真实商品为起点，为每一张图找到清晰的表达。</p>
            <ol>
                <li>
                    <Check size={14} />
                    <div>
                        <strong>本次创作资料</strong>
                        <small>
                            {references} 张参考图 · {automaticScreens ? "自动识别长图屏数" : `${count} 张图片方案`}
                        </small>
                    </div>
                </li>
                <li>
                    <LoaderCircle className="commerce-planning-spin" size={14} />
                    <div>
                        <strong>{ended ? "任务已结束" : task?.status === "succeeded" ? "校验结构与图片数量" : task?.status === "queued" ? "等待模型处理" : "商品理解与视觉策划"}</strong>
                        <small>{activity}</small>
                    </div>
                </li>
                <li className="is-pending">
                    <span className="commerce-planning-dot" />
                    <div>
                        <strong>审阅方案，确认生成</strong>
                        <small>完成后可逐张修改构图、文案与提示词</small>
                    </div>
                </li>
            </ol>
            <small className="commerce-planning-footnote">任务在服务端持续执行，刷新页面后可恢复。</small>
        </section>
    );
}
