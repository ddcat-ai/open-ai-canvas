export type VideoDurationScaleTick = {
    value: number;
    position: number;
};

export function videoDurationScalePosition(value: number, min: number, max: number) {
    if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0;
    return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
}

export function videoDurationScaleTicks(min: number, max: number, step = 1): VideoDurationScaleTick[] {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [{ value: min, position: 0 }];

    const safeStep = Math.max(1, Math.floor(step) || 1);
    const span = max - min;
    const preferredInterval = span > 20 ? 5 : span > 8 ? 2 : 1;
    const values = [min];

    if (safeStep === 1) {
        for (let value = Math.ceil(min / preferredInterval) * preferredInterval; value < max; value += preferredInterval) {
            if (value > min) values.push(value);
        }
    } else {
        const interval = Math.ceil(preferredInterval / safeStep) * safeStep;
        for (let value = min + interval; value < max; value += interval) values.push(value);
    }

    values.push(max);
    const minimumGap = span * 0.09;
    const readable = values.filter((value, index) => {
        if (index === 0 || index === values.length - 1) return true;
        return value - min >= minimumGap && max - value >= minimumGap;
    });

    return Array.from(new Set(readable)).map((value) => ({
        value,
        position: videoDurationScalePosition(value, min, max),
    }));
}
