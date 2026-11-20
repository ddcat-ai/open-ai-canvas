import { InputNumber, Slider, Switch } from "antd";
import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSun, Globe2, Shuffle, Snowflake, Sun, type LucideIcon } from "lucide-react";

import { formatPrevisSize, PREVIS_LAYOUT_TEMPLATES, resolvePrevisCatalogProp, resolvePrevisLayoutTemplate, resolvePrevisPropParams, resolvePrevisPropSize } from "@/lib/canvas/previs/previs-prop-catalog";
import { formatPrevisTimeOfDay, PREVIS_DEFAULT_WORLD, PREVIS_GROUND_OPTIONS, PREVIS_GROUND_SIZES, PREVIS_TIME_PRESETS, PREVIS_WEATHER_OPTIONS } from "@/lib/canvas/previs/previs-world";
import type { PrevisLayout, PrevisObject, PrevisPropParams, PrevisWeather, PrevisWorld } from "@/types/previs";
import { InspectorGroup } from "./previs-inspectors";
import "./previs-world-panel.css";

const WEATHER_ICONS: Record<PrevisWeather, LucideIcon> = { clear: Sun, cloudy: CloudSun, overcast: Cloud, rain: CloudRain, storm: CloudLightning, snow: Snowflake, fog: CloudFog };

/** 右侧「世界」页：光照时刻、天气、远景、地面范围。未开启时只给一个开启入口。 */
export function PrevisWorldPanel({ world, onChange }: { world?: PrevisWorld; onChange: (world: PrevisWorld | undefined) => void }) {
    if (!world) {
        return (
            <div className="pv-world-empty">
                <Globe2 className="size-6" aria-hidden />
                <div className="pv-world-empty__title">开启世界环境</div>
                <p className="pv-world-empty__text">用真实天空、太阳和天气照明场景，地面扩展到 1–4 km，远处有连绵山体。适合外景、城市与大场面。</p>
                <button type="button" className="pv-btn pv-btn--accent" onClick={() => onChange({ ...PREVIS_DEFAULT_WORLD })}>
                    开启世界环境
                </button>
            </div>
        );
    }
    const patch = (value: Partial<PrevisWorld>) => onChange({ ...world, ...value });
    return (
        <div className="pv-world">
            <InspectorGroup title="光照" hint={formatPrevisTimeOfDay(world.timeOfDay)}>
                <Slider className="pv-world__time" min={0} max={24} step={0.25} value={world.timeOfDay} tooltip={{ formatter: (value) => formatPrevisTimeOfDay(value ?? 0) }} onChange={(timeOfDay) => patch({ timeOfDay })} />
                <div className="pv-world__presets" role="group" aria-label="时间预设">
                    {PREVIS_TIME_PRESETS.map((preset) => {
                        const active = Math.abs(world.timeOfDay - preset.value) < 0.3;
                        return (
                            <button key={preset.label} type="button" aria-pressed={active} className={`pv-world__chip ${active ? "is-active" : ""}`} onClick={() => patch({ timeOfDay: preset.value })}>
                                {preset.label}
                            </button>
                        );
                    })}
                </div>
            </InspectorGroup>
            <InspectorGroup title="天气" hint={PREVIS_WEATHER_OPTIONS.find((item) => item.value === world.weather)?.label}>
                <div className="pv-world__weather" role="group" aria-label="天气">
                    {PREVIS_WEATHER_OPTIONS.map((option) => {
                        const Icon = WEATHER_ICONS[option.value];
                        const active = world.weather === option.value;
                        return (
                            <button key={option.value} type="button" aria-pressed={active} className={`pv-world__weather-btn ${active ? "is-active" : ""}`} onClick={() => patch({ weather: option.value })}>
                                <Icon className="size-4" aria-hidden />
                                <span>{option.label}</span>
                            </button>
                        );
                    })}
                </div>
            </InspectorGroup>
            <InspectorGroup title="远景" hint={PREVIS_GROUND_OPTIONS.find((item) => item.value === world.ground)?.label}>
                <div className="pv-world__grounds" role="group" aria-label="远景地表">
                    {PREVIS_GROUND_OPTIONS.map((option) => {
                        const active = world.ground === option.value;
                        return (
                            <button key={option.value} type="button" aria-pressed={active} className={`pv-world__ground ${active ? "is-active" : ""}`} onClick={() => patch({ ground: option.value })}>
                                <span className="pv-world__ground-swatch" style={{ background: `linear-gradient(180deg, ${option.far} 0%, ${option.near} 100%)` }} />
                                <span>{option.label}</span>
                            </button>
                        );
                    })}
                </div>
                <label className="previs-inspector-toggle">
                    <span>远山</span>
                    <Switch size="small" checked={world.horizon} onChange={(horizon) => patch({ horizon })} />
                </label>
            </InspectorGroup>
            <InspectorGroup title="地面" hint={`${world.groundSize / 1000} km`}>
                <div className="pv-world__segmented" role="group" aria-label="地面范围">
                    {PREVIS_GROUND_SIZES.map((option) => (
                        <button key={option.value} type="button" aria-pressed={world.groundSize === option.value} className={world.groundSize === option.value ? "is-active" : ""} onClick={() => patch({ groundSize: option.value })}>
                            {option.label}
                        </button>
                    ))}
                </div>
            </InspectorGroup>
            <div className="previs-inspector-note">世界环境由太阳与天光照明，场景里的方向光、环境光暂停生效，点光与聚光照常工作。</div>
            <button type="button" className="pv-world__off" onClick={() => onChange(undefined)}>
                关闭世界环境
            </button>
        </div>
    );
}

/** 布景对象检查器：模板、随机种子、范围、密度、路人。 */
export function PrevisLayoutInspectorGroup({ object, onUpdate }: { object: PrevisObject; onUpdate: (patch: Partial<PrevisObject>) => void }) {
    const layout = object.layout;
    if (!layout) return null;
    const info = resolvePrevisLayoutTemplate(layout.template);
    // 模板 / 种子 / 范围 / 密度一变，实例序号整体重排，已拆出的序号失效，必须清空。
    const patch = (value: Partial<PrevisLayout>) => onUpdate({ layout: { ...layout, ...value, removed: undefined } });
    return (
        <InspectorGroup title="布景" hint={info?.name}>
            <div className="pv-world__presets" role="group" aria-label="布景模板">
                {PREVIS_LAYOUT_TEMPLATES.map((template) => (
                    <button
                        key={template.id}
                        type="button"
                        aria-pressed={layout.template === template.id}
                        className={`pv-world__chip ${layout.template === template.id ? "is-active" : ""}`}
                        title={template.hint}
                        onClick={() => patch({ template: template.id, size: Math.min(template.maxSize, Math.max(template.minSize, layout.size)) })}
                    >
                        {template.name}
                    </button>
                ))}
            </div>
            <div className="pv-world__row">
                <span>随机性</span>
                <button type="button" className="pv-btn" onClick={() => patch({ seed: Math.floor(Math.random() * 1_000_000) })}>
                    <Shuffle className="size-3.5" aria-hidden />
                    换一版
                </button>
                <span className="pv-world__seed">#{layout.seed}</span>
            </div>
            <div className="pv-world__row pv-world__row--slider">
                <span>范围</span>
                <Slider min={info?.minSize ?? 50} max={info?.maxSize ?? 1200} step={10} value={layout.size} onChange={(size) => patch({ size })} />
                <span className="pv-world__value">{Math.round(layout.size)}m</span>
            </div>
            <div className="pv-world__row pv-world__row--slider">
                <span>密度</span>
                <Slider min={0.2} max={1} step={0.05} value={layout.density} onChange={(density) => patch({ density })} />
                <span className="pv-world__value">{Math.round(layout.density * 100)}%</span>
            </div>
            <label className="previs-inspector-toggle">
                <span>街上路人</span>
                <Switch size="small" checked={layout.crowd} onChange={(crowd) => patch({ crowd })} />
            </label>
            {layout.removed?.length ? <div className="previs-inspector-note">已拆出 {layout.removed.length} 个实例为独立对象。调整上面的参数会重新生成整片布景，已拆出的对象保留。</div> : null}
            <div className="previs-inspector-note">在视口里点击任意一栋建筑或一棵树，会把它拆出来单独编辑；拖动空地是旋转视角，不会挪动整片布景。整体移动请用坐标轴。</div>
        </InspectorGroup>
    );
}

/** 参数化组件的参数控件：数值用滑杆 + 数字，枚举用分段按钮。检查器与添加弹窗共用。 */
export function PrevisPropParamFields({ propId, params, onChange }: { propId?: string; params?: PrevisPropParams; onChange: (params: PrevisPropParams) => void }) {
    const defs = resolvePrevisCatalogProp(propId)?.params;
    if (!defs) return null;
    const values = resolvePrevisPropParams(propId, params);
    return (
        <div className="pv-param-fields">
            {defs.map((def) =>
                def.type === "number" ? (
                    <div key={def.key} className="pv-world__row pv-world__row--slider">
                        <span>{def.label}</span>
                        <Slider min={def.min} max={def.max} step={def.step} value={Number(values[def.key])} onChange={(value) => onChange({ ...values, [def.key]: value })} />
                        <InputNumber
                            className="pv-param-fields__number"
                            size="small"
                            min={def.min}
                            max={def.max}
                            step={def.step}
                            value={Number(values[def.key])}
                            onChange={(value) => value !== null && onChange({ ...values, [def.key]: value })}
                            suffix={def.unit}
                            controls={false}
                        />
                    </div>
                ) : (
                    <div key={def.key} className="pv-param-fields__enum">
                        <span>{def.label}</span>
                        <div className="pv-world__presets" role="group" aria-label={def.label}>
                            {def.options.map((option) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    aria-pressed={values[def.key] === option.value}
                                    className={`pv-world__chip ${values[def.key] === option.value ? "is-active" : ""}`}
                                    onClick={() => onChange({ ...values, [def.key]: option.value })}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </div>
                ),
            )}
        </div>
    );
}

/** 目录道具：组件参数与造型变体。 */
export function PrevisPropVariantGroup({ object, onUpdate }: { object: PrevisObject; onUpdate: (patch: Partial<PrevisObject>) => void }) {
    const prop = resolvePrevisCatalogProp(object.propId);
    if (!prop) return null;
    const size = resolvePrevisPropSize(object.propId, object.params);
    return (
        <InspectorGroup title={prop.params ? "参数" : "道具"} hint={size ? `${prop.name} · ${formatPrevisSize(size)}` : prop.name}>
            <PrevisPropParamFields propId={object.propId} params={object.params} onChange={(params) => onUpdate({ params })} />
            {prop.variants ? (
                <div className="pv-world__row">
                    <span>造型</span>
                    <button type="button" className="pv-btn" onClick={() => onUpdate({ variant: ((object.variant ?? 0) + 1) % 8 })}>
                        <Shuffle className="size-3.5" aria-hidden />
                        换个造型
                    </button>
                    <span className="pv-world__seed">{(object.variant ?? 0) + 1} / 8</span>
                </div>
            ) : null}
            {prop.accent ? <div className="previs-inspector-note">下方「外观」颜色作用于{prop.accent}。</div> : null}
        </InspectorGroup>
    );
}
