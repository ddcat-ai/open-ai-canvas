import { Scissors } from "lucide-react";

import type { ProjectDetail } from "@/services/api/projects";
import { useEditorSlots } from "@/lib/plugins/editor-slot-registry";

export default function ProjectEditorView({ detail }: { detail: ProjectDetail }) {
    const timelineSlots = useEditorSlots("timeline-panel");

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1">
                {timelineSlots.length === 0 ? (
                    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 text-center">
                        <div className="grid size-14 place-items-center rounded-2xl bg-[var(--workspace-accent-soft)]">
                            <Scissors className="size-6 text-[var(--workspace-accent)]" />
                        </div>
                        <div>
                            <h2 className="text-[var(--fs-body)] font-semibold text-foreground">剪辑工作台</h2>
                            <p className="mt-1 max-w-md text-[var(--fs-caption)] leading-5 text-foreground/52">
                                时间线、预览、检查器等编辑面板由编辑器预设插件贡献，将在后续里程碑接入。
                                项目「{detail.project.name}」的成片将在这里剪辑输出。
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="h-full w-full">
                        {timelineSlots.map((slot) => (
                            <div key={slot.id} className="h-full w-full">
                                {slot.render({ pluginId: slot.pluginId })}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
