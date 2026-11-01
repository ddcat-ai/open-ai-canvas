import type { SVGProps } from "react";

/** 全站统一的积分符号：单色四角星，跟随文字颜色（参考即梦“✦ 8/张”），不使用渐变。 */
export function CreditStar({ className, ...props }: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" className={className} aria-hidden="true" {...props}>
            <path d="M12 3.05c.95 5.1 3.85 8 8.95 8.95-5.1.95-8 3.85-8.95 8.95-.95-5.1-3.85-8-8.95-8.95 5.1-.95 8-3.85 8.95-8.95Z" />
        </svg>
    );
}
