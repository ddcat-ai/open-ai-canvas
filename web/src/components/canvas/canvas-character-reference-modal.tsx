import { Modal } from "antd";
import { AudioLines, BadgeCheck, Image as ImageIcon, UserRound, Volume2 } from "lucide-react";
import type { ReactNode } from "react";

import type { CanvasNodeData } from "@/types/canvas";

export function CanvasCharacterReferenceModal({ node, open, onClose }: { node: CanvasNodeData | null; open: boolean; onClose: () => void }) {
    if (!node) return null;
    const metadata = node.metadata;
    const definition = metadata?.characterDefinition || {};
    const name = metadata?.characterName || node.title || "未命名角色";
    const aliases = metadata?.characterAliases || stringList(definition.aliases);
    const visualReady = metadata?.characterVisualStatus === "ready";
    const voiceReady = metadata?.characterVoiceStatus === "ready";
    const voiceProfile = metadata?.characterVoiceProfile;

    return (
        <Modal
            open={open}
            title={null}
            footer={null}
            destroyOnHidden
            width="min(1180px, calc(100vw - 32px))"
            onCancel={onClose}
            styles={{ container: { padding: 0, overflow: "hidden" }, body: { padding: 0 } }}
        >
            <div className="grid h-[min(720px,calc(100dvh-48px))] min-h-0 grid-rows-[minmax(240px,42vh)_minmax(0,1fr)] overflow-hidden bg-background text-foreground md:grid-cols-[minmax(0,1.55fr)_minmax(360px,.85fr)] md:grid-rows-1">
                <section className="relative min-h-0 overflow-hidden border-b border-border bg-foreground/[.035] md:border-b-0 md:border-r" aria-label="角色三视图">
                    <div className="absolute inset-x-0 top-0 z-10 flex h-14 items-center justify-between px-5 pr-14">
                        <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/80 bg-background/80 px-2.5 text-[var(--fs-label)] font-medium shadow-sm backdrop-blur-xl">
                            <ImageIcon className="size-3.5" />
                            人物三视图
                        </span>
                        <StatusDot icon={<ImageIcon />} ready={visualReady} readyLabel="形象已绑定" emptyLabel="形象待完善" />
                    </div>
                    {metadata?.characterCoverUrl ? (
                        <div className="flex h-full w-full items-center justify-center p-5 pt-16 md:p-8 md:pt-20">
                            <img
                                src={metadata.characterCoverUrl}
                                alt={`${name}人物三视图`}
                                className="max-h-full max-w-full select-none object-contain drop-shadow-[0_22px_42px_rgba(0,0,0,.14)]"
                                draggable={false}
                            />
                        </div>
                    ) : (
                        <div className="grid h-full place-items-center px-8 text-center text-foreground/35">
                            <div>
                                <UserRound className="mx-auto size-14 stroke-[1.25]" />
                                <p className="mt-3 text-xs">尚未绑定人物三视图</p>
                            </div>
                        </div>
                    )}
                </section>

                <aside className="thin-scrollbar min-h-0 overflow-y-auto">
                    <header className="border-b border-border px-6 pb-5 pt-7 pr-14">
                        <div className="flex items-start gap-3">
                            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-md bg-foreground/[.07]">
                                <UserRound className="size-4.5" />
                            </span>
                            <div className="min-w-0">
                                <h2 className="truncate text-xl font-semibold leading-7">{name}</h2>
                                <p className="mt-1 text-[var(--fs-label)] text-foreground/45">项目角色引用 · 当前版本</p>
                            </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-1.5">
                            <StatusDot icon={<ImageIcon />} ready={visualReady} readyLabel="图片已绑定" emptyLabel="图片未绑定" />
                            <StatusDot icon={<Volume2 />} ready={voiceReady} readyLabel="声音已绑定" emptyLabel="声音未绑定" />
                        </div>
                    </header>

                    <div className="space-y-7 px-6 py-6">
                        <DetailSection icon={<BadgeCheck />} title="身份与外观">
                            <DetailRow label="剧情身份" value={stringValue(definition.role)} />
                            <DetailRow label="别名" value={aliases.join("、")} />
                            <DetailRow label="外貌特征" value={stringValue(definition.appearance)} />
                            <DetailRow label="体型姿态" value={stringValue(definition.physique)} />
                            <DetailRow label="服装造型" value={stringValue(definition.clothing)} />
                            <DetailRow label="性格气质" value={stringValue(definition.personality)} />
                            <DetailRow label="标志道具" value={stringValue(definition.props)} />
                            <DetailRow label="一致性要求" value={stringValue(definition.consistencyPrompt)} />
                        </DetailSection>

                        <DetailSection icon={<AudioLines />} title="音色">
                            <DetailRow label="语言口音" value={stringValue(definition.voiceLanguage) || voiceProfile?.language} />
                            <DetailRow label="声音年龄感" value={stringValue(definition.voiceAge)} />
                            <DetailRow label="音色气质" value={stringValue(definition.voiceTimbre) || voiceProfile?.timbre} />
                            <DetailRow label="绑定声音" value={metadata?.characterVoiceName} emphasis={voiceReady} />
                            <DetailRow label="朗读要求" value={metadata?.characterVoiceInstructions} />
                        </DetailSection>
                    </div>
                </aside>
            </div>
        </Modal>
    );
}

function DetailSection({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
    return (
        <section>
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold">
                <span className="grid size-6 place-items-center rounded bg-foreground/[.06] [&_svg]:size-3.5">{icon}</span>
                {title}
            </div>
            <dl className="divide-y divide-border/65 border-y border-border/65">{children}</dl>
        </section>
    );
}

function DetailRow({ label, value, emphasis = false }: { label: string; value?: string; emphasis?: boolean }) {
    return (
        <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-3 py-3 text-[var(--fs-caption)] leading-5">
            <dt className="text-foreground/42">{label}</dt>
            <dd className={value ? (emphasis ? "font-medium text-emerald-600 dark:text-emerald-300" : "text-foreground/78") : "text-foreground/28"}>{value || "未设置"}</dd>
        </div>
    );
}

function StatusDot({ icon, ready, readyLabel, emptyLabel }: { icon: ReactNode; ready: boolean; readyLabel: string; emptyLabel: string }) {
    return (
        <span className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[var(--fs-tiny)] font-medium ${ready ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-border bg-background/65 text-foreground/42"}`}>
            <span className="[&_svg]:size-3">{icon}</span>
            {ready ? readyLabel : emptyLabel}
        </span>
    );
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown) {
    return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}
