import { motion, useMotionValue, useMotionValueEvent, useReducedMotion, useSpring, useTransform, type MotionValue } from "motion/react";
import { useLayoutEffect } from "react";

export function useCanvasZoomPercent(scale: number) {
    const target = useMotionValue(Math.round(scale * 100));
    useLayoutEffect(() => target.set(Math.round(scale * 100)), [scale, target]);
    return target;
}

function ZoomDigit({ percent, place }: { percent: MotionValue<number>; place: number }) {
    const position = useTransform(percent, (value) => {
        const digit = Math.floor(value / place) % 10;
        const carry = Math.max(0, (value % place) - (place - 1));
        return `translateY(-${digit + carry}em)`;
    });
    const opacity = useTransform(percent, (value) => Math.min(1, Math.max(0, value - place + 1)));
    return (
        <motion.span className="canvas-zoom-digit" style={{ opacity }}>
            <motion.span style={{ transform: position }}>{"0\n1\n2\n3\n4\n5\n6\n7\n8\n9\n0"}</motion.span>
        </motion.span>
    );
}

export function CanvasZoomReadout({ target }: { target: MotionValue<number> }) {
    const reduced = useReducedMotion();
    const percent = useSpring(target.get(), { stiffness: 500, damping: 45, mass: 0.5, restDelta: 0.01 });
    useMotionValueEvent(target, "change", (value) => {
        if (reduced) percent.jump(value);
        else percent.set(value);
    });
    return (
        <span aria-hidden="true" className="canvas-zoom-readout">
            <ZoomDigit percent={percent} place={100} />
            <ZoomDigit percent={percent} place={10} />
            <ZoomDigit percent={percent} place={1} />%
        </span>
    );
}
