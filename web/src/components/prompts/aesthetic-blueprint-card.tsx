import React from "react";
import { 
    Aperture, 
    Camera, 
    Film, 
    ZoomIn
} from "lucide-react";
import type { PromptPresetItem } from "@/pages/prompts/prompt-data";

interface AestheticBlueprintCardProps {
    preset: PromptPresetItem;
    variant?: "card" | "hero"; // "card" for grid item, "hero" for lightbox inspector
    onInspect?: () => void;
}

export const AestheticBlueprintCard: React.FC<AestheticBlueprintCardProps> = ({
    preset,
    variant = "card",
    onInspect,
}) => {
    const isVideo = preset.kind === "video";
    const isHero = variant === "hero";

    // 推断焦段与摄影环境元数据
    const getLensMeta = () => {
        const text = (preset.category + " " + preset.tags.join(" ") + " " + preset.positivePrompt).toLowerCase();
        if (isVideo) {
            return {
                optics: "CINE ANAMORPHIC 35mm",
                aperture: "T/2.0 DYNAMIC",
                lighting: "CINEMATIC VOLUMETRIC",
                framing: preset.recommendedParams?.aspectRatio || "16:9 4K",
                engine: "SEEDANCE 2.0 HD",
            };
        }
        if (text.includes("微距") || text.includes("特写") || text.includes("质地") || text.includes("细节")) {
            return {
                optics: "MACRO 100mm PRIME",
                aperture: "f/2.8 ULTRA-SHARP",
                lighting: "STUDIO 5500K SOFTBOX",
                framing: preset.recommendedParams?.aspectRatio || "1:1 8K",
                engine: "GPT-IMAGE-2 RAW",
            };
        }
        if (text.includes("人像") || text.includes("模特") || text.includes("穿搭") || text.includes("写真")) {
            return {
                optics: "PORTRAIT 85mm PRIME",
                aperture: "f/1.4 CREAMY BOKEH",
                lighting: "NATURAL WINDOW LIGHT",
                framing: preset.recommendedParams?.aspectRatio || "3:4 RAW",
                engine: "FLUX.1 / MIDJOURNEY",
            };
        }
        if (text.includes("建筑") || text.includes("空间") || text.includes("全景") || text.includes("场景")) {
            return {
                optics: "WIDE 24mm TILT-SHIFT",
                aperture: "f/8.0 DEEP FOCUS",
                lighting: "GOLDEN HOUR AMBIENT",
                framing: preset.recommendedParams?.aspectRatio || "16:9 RAW",
                engine: "COMMERCIAL RENDER",
            };
        }
        return {
            optics: "STUDIO 50mm PRIME",
            aperture: "f/4.0 PRECISION",
            lighting: "DIFFUSED PRODUCT TENT",
            framing: preset.recommendedParams?.aspectRatio || "1:1 8K",
            engine: "COMMERCIAL RAW",
        };
    };

    const meta = getLensMeta();

    return (
        <div
            onClick={onInspect}
            className={`relative overflow-hidden cursor-pointer select-none group/blueprint transition-all duration-300 ${
                isHero 
                    ? "w-full max-w-2xl aspect-[16/10] rounded-2xl border border-white/20 shadow-2xl bg-[#0d0e12]" 
                    : "w-full aspect-[16/10] bg-[#0c0d11] group-hover/img:scale-[1.01]"
            }`}
        >
            {/* 1. 底层工程网格与极细暗色坐标系 (Blueprint Grid) */}
            <div 
                className="absolute inset-0 opacity-25 pointer-events-none"
                style={{
                    backgroundImage: `
                        linear-gradient(to right, rgba(255, 255, 255, 0.08) 1px, transparent 1px),
                        linear-gradient(to bottom, rgba(255, 255, 255, 0.08) 1px, transparent 1px)
                    `,
                    backgroundSize: isHero ? "32px 32px" : "20px 20px"
                }}
            />

            {/* 2. 局部环境光晕与渐变辉光 */}
            <div 
                className="absolute -inset-10 opacity-30 blur-3xl pointer-events-none transition-opacity duration-500 group-hover/blueprint:opacity-50"
                style={{ background: preset.gradient }}
            />

            {/* 3. 电影工业取景器四角刻度与中心十字准星 */}
            <div className="absolute top-2.5 left-2.5 w-3.5 h-3.5 border-t-2 border-l-2 border-white/40 pointer-events-none" />
            <div className="absolute top-2.5 right-2.5 w-3.5 h-3.5 border-t-2 border-r-2 border-white/40 pointer-events-none" />
            <div className="absolute bottom-2.5 left-2.5 w-3.5 h-3.5 border-b-2 border-l-2 border-white/40 pointer-events-none" />
            <div className="absolute bottom-2.5 right-2.5 w-3.5 h-3.5 border-b-2 border-r-2 border-white/40 pointer-events-none" />

            {/* 4. 黄金分割辅助圆环 / 光圈几何 */}
            <div className="absolute right-6 -bottom-8 pointer-events-none opacity-15 text-white scale-125 transition-transform duration-700 group-hover/blueprint:rotate-45">
                <Aperture className="size-44" strokeWidth={1} />
            </div>

            {/* 5. 顶部光学参数读数 */}
            <div className="absolute top-2.5 left-3 right-3 flex items-center justify-between text-[10px] font-mono tracking-wider text-stone-400 pointer-events-none z-10">
                <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1 text-amber-400 font-semibold">
                        <span className="inline-block size-1.5 rounded-full bg-amber-400 animate-pulse" />
                        BLUEPRINT
                    </span>
                    <span className="hidden sm:inline text-stone-500">|</span>
                    <span className="hidden sm:inline text-stone-400">{meta.optics}</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded bg-white/10 text-stone-300 border border-white/10 text-[9px]">
                        {meta.framing}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-black/40 text-stone-400 border border-white/5 text-[9px]">
                        {meta.engine}
                    </span>
                </div>
            </div>

            {/* 6. 中央核心内容区：类别徽标 + 核心标题 + 提示词插槽速览 */}
            <div className="relative z-10 h-full flex flex-col justify-center items-center px-6 text-center">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.08] border border-white/15 backdrop-blur-md mb-2 shadow-inner">
                    {isVideo ? (
                        <Film className="size-3 text-indigo-400" />
                    ) : (
                        <Camera className="size-3 text-amber-400" />
                    )}
                    <span className="text-[11px] font-medium text-stone-200">
                        {preset.category}
                    </span>
                    <span className="text-[10px] text-stone-500 font-mono">
                        · {isVideo ? "视频分镜" : "生图蓝图"}
                    </span>
                </div>

                <h3 className={`font-bold text-white tracking-wide text-shadow ${isHero ? "text-xl mb-3" : "text-sm line-clamp-1 mb-1.5"}`}>
                    {preset.title}
                </h3>

                {/* 提取提示词中的核心插槽与关键字 */}
                <p className={`font-mono text-stone-300/90 leading-relaxed max-w-[88%] text-left px-3 py-1.5 rounded-lg bg-black/50 border border-white/10 backdrop-blur-sm ${
                    isHero ? "text-xs" : "text-[11px] line-clamp-2"
                }`}>
                    <span className="text-amber-400 font-medium mr-1.5">PROMPT:</span>
                    {preset.positivePrompt.slice(0, 160)}...
                </p>

                {/* 底部技术标签阵列 */}
                <div className="flex items-center justify-center gap-1.5 mt-2.5 flex-wrap">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-stone-400 border border-white/10">
                        {meta.lighting}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-stone-400 border border-white/10">
                        {meta.aperture}
                    </span>
                    {preset.styleTokens.slice(0, isHero ? 4 : 2).map((token) => (
                        <span key={token} className="text-[10px] px-1.5 py-0.5 rounded bg-black/40 text-stone-400 border border-white/5">
                            #{token}
                        </span>
                    ))}
                </div>
            </div>

            {/* 7. 悬浮居中交互按钮 (无黑幕，仅在卡片列表态显示) */}
            {!isHero && (
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/blueprint:opacity-100 transition-all duration-200 pointer-events-none z-20">
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onInspect?.();
                        }}
                        className={`pointer-events-auto flex items-center gap-1.5 px-4 py-2 rounded-full text-white text-xs font-semibold backdrop-blur-md shadow-2xl transition-all scale-95 group-hover/blueprint:scale-100 hover:scale-105 active:scale-95 cursor-pointer ${
                            isVideo
                                ? "bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 shadow-indigo-600/50 border border-indigo-300/40"
                                : "bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 shadow-amber-600/50 border border-amber-300/40"
                        }`}
                    >
                        <ZoomIn className="size-3.5" />
                        <span>查看参数蓝图</span>
                    </button>
                </div>
            )}
        </div>
    );
};
