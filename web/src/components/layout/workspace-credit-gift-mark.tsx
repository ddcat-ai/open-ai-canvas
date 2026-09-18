import { useId } from "react";

import { cn } from "@/lib/utils";

export function WorkspaceCreditGiftMark({ className }: { className?: string }) {
    const uid = useId().replace(/:/g, "");
    const box = `${uid}-box`;
    const lid = `${uid}-lid`;
    const ribbon = `${uid}-ribbon`;

    return (
        <span className={cn("app-workspace-credit-gift", className)} aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
                <defs>
                    <linearGradient id={box} x1="8" y1="14" x2="24" y2="28" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#FFB34A" />
                        <stop offset="1" stopColor="#F26B12" />
                    </linearGradient>
                    <linearGradient id={lid} x1="6" y1="10" x2="26" y2="16" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#FFC66A" />
                        <stop offset="1" stopColor="#FF8A28" />
                    </linearGradient>
                    <linearGradient id={ribbon} x1="16" y1="6" x2="16" y2="28" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#5FE8D8" />
                        <stop offset="1" stopColor="#12B8A8" />
                    </linearGradient>
                </defs>
                <ellipse cx="16" cy="28.5" rx="9.2" ry="1.6" fill="#7A3A00" opacity=".22" />
                <rect x="6.5" y="14" width="19" height="13.2" rx="2.4" fill={`url(#${box})`} />
                <path d="M23.4 16.4v8.4c0 1.3-1 2.4-2.3 2.4h.1V14c1.3.2 2.2 1.2 2.2 2.4Z" fill="#7A3A00" opacity=".16" />
                <rect x="14.4" y="14" width="3.2" height="13.2" fill={`url(#${ribbon})`} />
                <rect x="6.5" y="19.3" width="19" height="2.8" fill={`url(#${ribbon})`} />
                <rect x="5.4" y="10.3" width="21.2" height="5.5" rx="2.1" fill={`url(#${lid})`} />
                <rect x="5.4" y="10.3" width="21.2" height="2.1" rx="2.1" fill="#fff" opacity=".24" />
                <rect x="14.4" y="10.3" width="3.2" height="5.5" fill={`url(#${ribbon})`} />
                <path d="M15.8 11.1C10.4 5.6 7.2 11.8 12.8 13.7c1.6.5 2.4 0 3-1.2Z" fill="#4FE3D4" />
                <path d="M16.2 11.1C21.6 5.6 24.8 11.8 19.2 13.7c-1.6.5-2.4 0-3-1.2Z" fill="#14C4B4" />
                <rect x="14.7" y="9.3" width="2.6" height="2.6" rx=".8" fill="#0E9E92" />
                <path d="M14.9 12.1 11.6 16.4l3.8-3.1Z" fill="#3FDDD0" />
                <path d="M17.1 12.1 20.4 16.4l-3.8-3.1Z" fill="#12B6A6" />
            </svg>
        </span>
    );
}
