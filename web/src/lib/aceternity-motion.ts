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
} as const;
