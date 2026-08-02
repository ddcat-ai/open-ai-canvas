export const aceternityMotion = {
    duration: {
        instant: 0.12,
        state: 0.2,
        panel: 0.32,
    },
    spring: {
        dock: { mass: 0.12, stiffness: 220, damping: 18 },
        surface: { mass: 0.32, stiffness: 280, damping: 26 },
        panel: { mass: 0.42, stiffness: 320, damping: 28 },
    },
    easing: {
        enter: [0.2, 0.85, 0.18, 1] as const,
        exit: [0.4, 0, 1, 1] as const,
    },
    /** 浮层统一入场基线：轻微上浮 + 缩放 + 弹性过渡，所有 canvas 浮层复用以保持一致的入场语言 */
    panelEnter: {
        initial: { opacity: 0, y: 8, scale: 0.96 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: 6, scale: 0.98 },
        transition: { mass: 0.42, stiffness: 320, damping: 28 },
    },
} as const;
