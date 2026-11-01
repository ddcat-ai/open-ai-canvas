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
    const started = Date.parse(task?.startedAt || task?.createdAt || "") || openedAt;
    const seconds = Math.max(0, Math.floor((now - started) / 1000));
    const status = !task ? "正在提交策划资料" : task.status === "queued" ? "已排队，等待模型处理" : task.status === "succeeded" ? "正在校验图片方案" : "正在分析商品与构建方案";
    return (
        <section className="commerce-planning-activity" aria-label="Agent 策划进行中" aria-busy="true" role="status">
            <div className="commerce-planning-emblem" aria-hidden="true">
                <span />
                <Sparkles size={24} strokeWidth={1.5} />
            </div>
            <div className="commerce-planning-title">
                <strong>{status}</strong>
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
                        <strong>{task?.status === "succeeded" ? "校验结构与图片数量" : "商品理解与视觉策划"}</strong>
                        <small>{task?.status === "queued" ? "模型任务已排队，完成后自动展示方案" : task?.textDraft ? `已收到 ${task.textDraft.length} 字策划输出，等待完整方案` : "正在等待模型返回可审阅的策划内容"}</small>
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
