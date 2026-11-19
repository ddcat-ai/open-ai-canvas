import { Check, ChevronDown } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type LL2SelectOption = { value: string; label: string };

type Props = {
    value: string;
    options: LL2SelectOption[];
    onChange: (value: string) => void;
    ariaLabel: string;
    disabled?: boolean;
    title?: string;
    /** chip：自己带浅底胶囊；plain：交给外层容器（首页参数 chip）出底。 */
    variant?: "chip" | "plain";
};

/**
 * C 端统一的小下拉：替代原生 <select>，弹出层可以做出圆角、浅底、选中勾，
 * 原生 select 的弹层是系统绘制的，没法跟整体风格统一（2026-11-19 用户反馈）。
 */
export function LL2Select({ value, options, onChange, ariaLabel, disabled, title, variant = "chip" }: Props) {
    const [open, setOpen] = useState(false);
    const [menuBox, setMenuBox] = useState<{ left: number; top: number; width: number } | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: MouseEvent) => {
            const target = event.target as Node;
            if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
            setOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("mousedown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open]);

    const current = options.find((option) => option.value === value);

    /** 弹层挂到 body 上（portal）：卡片的 overflow:hidden 不会再把它裁掉一半。 */
    const measure = () => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const width = Math.max(190, rect.width);
        const menuHeight = Math.min(204, options.length * 32 + 12);
        const spaceBelow = window.innerHeight - rect.bottom - 10;
        const flipUp = spaceBelow < menuHeight && rect.top > menuHeight;
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
        const top = flipUp ? Math.max(8, rect.top - menuHeight - 6) : rect.bottom + 6;
        setMenuBox({ left, top, width });
    };

    const toggle = () => {
        if (open) {
            setOpen(false);
            return;
        }
        measure();
        setOpen(true);
    };

    useLayoutEffect(() => {
        if (!open) return;
        const onViewportChange = () => measure();
        window.addEventListener("resize", onViewportChange);
        window.addEventListener("scroll", onViewportChange, true);
        return () => {
            window.removeEventListener("resize", onViewportChange);
            window.removeEventListener("scroll", onViewportChange, true);
        };
    }, [open]);

    return (
        <div className={`ll2-select is-${variant}${open ? " is-open" : ""}`} ref={rootRef}>
            <button
                ref={triggerRef}
                type="button"
                className="ll2-select-trigger"
                aria-label={ariaLabel}
                aria-haspopup="listbox"
                aria-expanded={open}
                disabled={disabled}
                title={title}
                onClick={toggle}
            >
                <span className="ll2-select-value">{current?.label || "请选择"}</span>
                <ChevronDown className="ll2-select-arrow" aria-hidden />
            </button>
            {open && menuBox
                ? createPortal(
                      <div
                          ref={menuRef}
                          className="ll2-select-menu is-portal"
                          role="listbox"
                          aria-label={ariaLabel}
                          style={{ left: menuBox.left, top: menuBox.top, width: menuBox.width }}
                      >
                          {options.map((option) => {
                              const selected = option.value === value;
                              return (
                                  <button
                                      key={option.value}
                                      type="button"
                                      role="option"
                                      aria-selected={selected}
                                      className={`ll2-select-item${selected ? " is-selected" : ""}`}
                                      onClick={() => {
                                          onChange(option.value);
                                          setOpen(false);
                                      }}
                                  >
                                      <span>{option.label}</span>
                                      {selected ? <Check className="size-3.5" aria-hidden /> : null}
                                  </button>
                              );
                          })}
                      </div>,
                      document.body,
                  )
                : null}
        </div>
    );
}