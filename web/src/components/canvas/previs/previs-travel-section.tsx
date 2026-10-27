import { Button, InputNumber, Select } from "antd";
import { Route, Trash2 } from "lucide-react";
import { useState } from "react";

import { applyPrevisActorTravel, describePrevisTravel, PREVIS_TRAVEL_STYLES, removePrevisActorTravel, resolvePrevisTravelStyle } from "@/lib/canvas/previs/previs-travel";
import type { PrevisMarker, PrevisObject, PrevisTravelStyle } from "@/types/previs";

/**
 * 演员「A 点 → B 点」位移：起点可选当前位置或标记点，终点选标记点；方式、用时、从播放头开始。
 * 右键视口打标记点后在这里组合，或直接用右键菜单「生成移动」。
 */
export function PrevisTravelSection({ object, markers, playhead, shotDuration, onUpdate }: { object: PrevisObject; markers: PrevisMarker[]; playhead: number; shotDuration: number; onUpdate: (patch: Partial<PrevisObject>) => void }) {
    const [from, setFrom] = useState<string>("current");
    const [to, setTo] = useState<string | undefined>(markers[1]?.id ?? markers[0]?.id);
    const [style, setStyle] = useState<PrevisTravelStyle>("run");
    const [duration, setDuration] = useState(3);
    const start = Math.min(playhead, Math.max(0, shotDuration - 0.1));
    const remaining = Math.max(0.1, shotDuration - start);
    const target = markers.find((marker) => marker.id === to);
    const origin = markers.find((marker) => marker.id === from);
    const travels = object.travels ?? [];
    const apply = () => {
        if (!target) return;
        const next = applyPrevisActorTravel(object, { from: origin?.position, to: target.position, start, duration: Math.min(duration, remaining), style });
        onUpdate({ keyframes: next.keyframes, travels: next.travels, motionPath: undefined });
    };
    return (
        <div className="pv-travel">
            {markers.length ? (
                <>
                    <div className="pv-travel__row">
                        <Select
                            size="small"
                            className="pv-travel__select"
                            value={from}
                            onChange={setFrom}
                            options={[{ value: "current", label: "当前位置" }, ...markers.map((marker) => ({ value: marker.id, label: `点 ${marker.label}` }))]}
                            aria-label="起点"
                        />
                        <span className="pv-travel__arrow">→</span>
                        <Select size="small" className="pv-travel__select" value={to} onChange={setTo} placeholder="终点" options={markers.map((marker) => ({ value: marker.id, label: `点 ${marker.label}` }))} aria-label="终点" />
                    </div>
                    <div className="pv-world__presets" role="group" aria-label="移动方式">
                        {PREVIS_TRAVEL_STYLES.map((item) => (
                            <button key={item.value} type="button" aria-pressed={style === item.value} className={`pv-world__chip ${style === item.value ? "is-active" : ""}`} onClick={() => setStyle(item.value)}>
                                {item.label}
                            </button>
                        ))}
                    </div>
                    <div className="pv-travel__row">
                        <span className="pv-travel__hint">{start.toFixed(1)}s 起，用时</span>
                        <InputNumber size="small" min={0.1} max={remaining} step={0.5} value={duration} suffix="秒" onChange={(value) => value !== null && setDuration(value)} />
                        <Button size="small" type="primary" icon={<Route className="size-3.5" />} disabled={!target || target.id === origin?.id} onClick={apply}>
                            {resolvePrevisTravelStyle(style).verb}
                        </Button>
                    </div>
                </>
            ) : (
                <div className="previs-inspector-note">在视口里右键地面打标记点（A、B…），就能在这里让演员从 A 点跑 / 飞 / 闪现到 B 点；也可以直接右键「生成移动」。</div>
            )}
            {travels.length ? (
                <ul className="pv-travel__list">
                    {travels.map((travel) => (
                        <li key={travel.id}>
                            <span>{describePrevisTravel(travel)}</span>
                            <button type="button" aria-label="删除这段移动" title="删除这段移动" onClick={() => onUpdate(removePrevisActorTravel(object, travel.id))}>
                                <Trash2 className="size-3.5" />
                            </button>
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}
