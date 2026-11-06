import { Select } from "antd";
import { mediaTransportLabel, type ReferenceMediaTransport } from "@/lib/media-transport";

export function MediaTransportFields({ value = {}, onChange, channel }: { value?: ReferenceMediaTransport; onChange?: (value: ReferenceMediaTransport) => void; channel?: ReferenceMediaTransport }) {
    const model = channel !== undefined;
    return (
        <div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {(
                    [
                        ["image", "参考图片"],
                        ["audio", "参考音频"],
                        ["video", "参考视频"],
                    ] as const
                ).map(([kind, label]) => (
                    <label key={kind} className="flex flex-col gap-2">
                        <span>{label}</span>
                        <Select
                            aria-label={`${label}发送方式`}
                            value={value[kind] || (model ? "inherit" : "protocol")}
                            onChange={(mode) => onChange?.({ ...value, [kind]: mode })}
                            options={[...(model ? [{ value: "inherit", label: `跟随渠道（${mediaTransportLabel(channel?.[kind])}）` }] : []), { value: "protocol", label: "协议默认" }, { value: "url", label: "URL" }, { value: "base64", label: "Base64" }]}
                        />
                    </label>
                ))}
            </div>
            <p className="mt-3 text-sm text-muted-foreground">设置发给上游的参考素材，不影响生成结果的返回格式。URL 使用素材访问链接；Base64 内嵌文件内容。需要文件上传的协议请用协议默认；助手识图保持原有发送方式。</p>
        </div>
    );
}
