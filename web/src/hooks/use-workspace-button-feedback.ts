import { useEffect } from "react";

/** 一次点击的触觉式反馈，不表达请求成功，也不接管业务回调或画布事件。 */
export function useWorkspaceButtonFeedback(enabled: boolean) {
    useEffect(() => {
        if (!enabled) return;
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
        const animations = new Set<Animation>();
        const clicked = (event: MouseEvent) => {
            if (reduced.matches || !(event.target instanceof Element)) return;
            const button = event.target.closest<HTMLElement>('button, [role="button"]');
            if (!button || button.matches(':disabled, [aria-disabled="true"], .ant-btn-loading') || !button.closest(".app-product-workspace, .ant-popover, .ant-dropdown, .ant-modal, .ant-drawer")) return;
            if (typeof button.animate === "function") {
                const press = button.animate([{ scale: ".98" }, { scale: "1" }], { duration: 180, easing: "cubic-bezier(.16,1,.3,1)" });
                animations.add(press);
                press.onfinish = press.oncancel = () => animations.delete(press);
            }
            const icon = button.querySelector<SVGElement>("svg:not(.animate-spin)");
            if (!icon || typeof icon.animate !== "function" || getComputedStyle(icon).animationName !== "none") return;
            const animation = icon.animate([
                { translate: "0 0", scale: "1" },
                { translate: "0 -2px", scale: ".88", offset: .35 },
                { translate: "0 0", scale: "1" },
            ], { duration: 360, easing: "cubic-bezier(.16,1,.3,1)" });
            animations.add(animation);
            animation.onfinish = animation.oncancel = () => animations.delete(animation);
        };
        document.addEventListener("click", clicked, true);
        return () => { document.removeEventListener("click", clicked, true); animations.forEach((animation) => animation.cancel()); };
    }, [enabled]);
}
