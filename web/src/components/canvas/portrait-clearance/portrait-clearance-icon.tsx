import type { SVGProps } from "react";

/** 肖像排查插件图标：人脸轮廓 + 扫描框 + 校验标记。 */
export function PortraitClearanceIcon({ className, strokeWidth = 1.8, ...props }: SVGProps<SVGSVGElement>) {
    return (
        <svg
            {...props}
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            focusable="false"
        >
            <path d="M8 3.75H5.5A1.75 1.75 0 0 0 3.75 5.5V8" />
            <path d="M16 3.75h2.5A1.75 1.75 0 0 1 20.25 5.5V8" />
            <path d="M3.75 16v2.5A1.75 1.75 0 0 0 5.5 20.25H8" />
            <path d="M16 20.25h2.5a1.75 1.75 0 0 0 1.75-1.75V16" />
            <path d="M8.25 11.25a3.75 3.75 0 1 1 7.5 0V12a3.75 3.75 0 1 1-7.5 0Z" />
            <path d="M10 11h.01M14 11h.01M10.5 13c.9.65 2.1.65 3 0" />
            <path d="m15.8 17.7 1.25 1.25 2.35-2.35" />
        </svg>
    );
}
