import { useState } from "react";

import type { CreationInspiration } from "@/lib/inspirations/catalog";

export function InspirationMediaPreview({ item }: { item: CreationInspiration }) {
    const [failed, setFailed] = useState(false);
    const videoUrl = item.mode === "video" && /^https?:\/\//i.test(item.videoUrl ?? "") ? item.videoUrl : undefined;

    return (
        <div className="relative shrink-0 overflow-hidden" style={{ borderRadius: "var(--r-xl)", background: "var(--user-surface-muted)" }}>
            {videoUrl && !failed ? (
                <video className="block h-56 max-h-[36vh] w-full object-contain sm:h-64" src={videoUrl} poster={item.image} controls playsInline preload="none" aria-label={`${item.title} 视频预览`} onError={() => setFailed(true)} />
            ) : (
                <img src={item.image} alt="" className="h-56 max-h-[36vh] w-full object-cover sm:h-64" referrerPolicy="no-referrer" />
            )}
            {item.mode === "video" ? (
                <p className="px-5 py-2 text-xs text-foreground/60" role={failed ? "status" : undefined}>
                    {failed ? (item.sourceUrl ? "视频暂时无法加载，可通过下方「查看上游内容」访问原案例。" : "视频暂时无法加载，请稍后重新打开重试。") : videoUrl ? "上游案例视频，点击播放预览。" : "此灵感仅提供提示词与封面，暂无视频预览。"}
                </p>
            ) : null}
        </div>
    );
}
