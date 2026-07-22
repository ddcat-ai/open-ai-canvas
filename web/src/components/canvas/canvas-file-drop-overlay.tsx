import { AnimatePresence, motion } from "motion/react";
import { FileImage, Film, Music2, UploadCloud } from "lucide-react";

import type { CanvasTheme } from "@/lib/canvas-theme";
import { aceternityMotion } from "@/lib/aceternity-motion";

export function CanvasFileDropOverlay({ active, theme }: { active: boolean; theme: CanvasTheme }) {
    return (
        <AnimatePresence>
            {active ? (
                <motion.div
                    data-canvas-no-zoom
                    aria-live="polite"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: aceternityMotion.duration.state }}
                    className="pointer-events-none absolute inset-3 z-[110] grid place-items-center overflow-hidden rounded-[28px] border backdrop-blur-2xl"
                    style={{ background: theme.spatial.dropzone, borderColor: theme.spatial.glowStrong, color: theme.node.text, boxShadow: `inset 0 0 0 1px ${theme.spatial.glow}, 0 30px 100px rgba(0,0,0,.22)` }}
                >
                    <div className="aceternity-drop-grid absolute inset-0 opacity-70" style={{ color: theme.spatial.glowStrong }} />
                    <motion.div initial={{ y: 20, scale: 0.94 }} animate={{ y: 0, scale: 1 }} exit={{ y: 12, scale: 0.96 }} transition={aceternityMotion.spring.panel} className="relative flex w-[min(480px,calc(100vw-48px))] flex-col items-center px-8 py-10 text-center">
                        <div className="relative mb-8 h-32 w-44">
                            <motion.div animate={{ x: -22, y: 10, rotate: -8 }} className="absolute inset-0 rounded-[20px] border backdrop-blur-xl" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border }} />
                            <motion.div animate={{ x: 22, y: 10, rotate: 8 }} className="absolute inset-0 rounded-[20px] border backdrop-blur-xl" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border }} />
                            <motion.div animate={{ y: -10, scale: 1.04 }} transition={aceternityMotion.spring.panel} className="absolute inset-0 grid place-items-center rounded-[20px] border" style={{ background: theme.node.panel, borderColor: theme.spatial.glowStrong, boxShadow: `0 24px 60px ${theme.spatial.shadow}` }}>
                                <UploadCloud className="size-10" style={{ color: theme.accent.primary }} />
                            </motion.div>
                        </div>
                        <h2 className="text-2xl font-semibold tracking-normal">释放文件，放入创作空间</h2>
                        <p className="mt-2 text-sm leading-6" style={{ color: theme.node.muted }}>图片、视频和音频会在当前位置创建为可继续连接的节点</p>
                        <div className="mt-6 flex items-center gap-2 text-xs font-medium" style={{ color: theme.node.muted }}>
                            <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5" style={{ borderColor: theme.toolbar.border, background: theme.spatial.surface }}><FileImage className="size-3.5" />图片</span>
                            <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5" style={{ borderColor: theme.toolbar.border, background: theme.spatial.surface }}><Film className="size-3.5" />视频</span>
                            <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5" style={{ borderColor: theme.toolbar.border, background: theme.spatial.surface }}><Music2 className="size-3.5" />音频</span>
                        </div>
                    </motion.div>
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}
