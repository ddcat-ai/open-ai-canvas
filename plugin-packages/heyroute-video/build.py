#!/usr/bin/env python3
"""Build only the standalone Heyroute package; never rebuild shipped plugins."""
import copy
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent
RATIOS = ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]
GROK_RATIOS = ["auto", "16:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16"]
# Fixed-output entries constrain the UI without sending ignored ratio/resolution fields.
MODELS = [
    ("grok-imagine-video", 1, 15, 8, ["480p", "720p"], GROK_RATIOS, 1, 0, 0, True),
    ("grok-imagine-video-1.5", 1, 15, 8, ["480p", "720p", "1080p"], GROK_RATIOS, 1, 0, 0, True),
    ("grok-video", 6, 15, 6, ["720x405"], ["16:9"], 0, 0, 0, False),
    ("minimax-h3-quantized-768p", 4, 10, 4, ["768p"], ["auto", "16:9"], 1, 0, 0, False),
    ("minimax-h3-original-768p", 4, 15, 4, ["768p"], ["auto", "16:9"], 1, 1, 1, False),
    ("minimax-h3-original-1080p", 4, 15, 4, ["1080p"], ["auto", "16:9"], 1, 1, 1, False),
    ("minimax-h3-original-cf-2k", 4, 15, 4, ["2k"], ["auto", "9:16"], 1, 1, 1, False),
    ("MiniMax-H3", 4, 15, 4, ["480p", "720p"], RATIOS, 9, 3, 3, True),
    ("seedance-2.5", 4, 30, 4, ["720p", "480p", "1080p"], RATIOS, 30, 10, 10, True),
    ("seedance-2.0", 15, 15, 15, ["480p", "720p"], RATIOS, 15, 15, 15, True),
    ("seedance-2.0-fast", 15, 15, 15, ["480p", "720p"], RATIOS, 15, 15, 15, True),
]


def ref(s): return {"$ref": s}
def op(name, *args): return {"$" + name: list(args)}
def unary(name, value): return {"$" + name: value}
def iff(condition, then, otherwise=None):
    return {"$if": {"condition": condition, "then": then, "else": otherwise}}
def each(source, value): return {"$map": {"from": source, "as": "item", "in": value}}
def select(source, condition): return {"$filter": {"from": source, "as": "item", "where": condition}}
def length(value): return unary("len", value)
def empty(value): return op("eq", length(value), 0)
def present(value): return unary("not", empty(value))
def omit(value): return unary("omitEmpty", value)
def option(key): return ref("request.providerOptions.heyroute-video." + key)
def model_is(*names): return op("in", ref("request.model"), list(names))
def one_of(items, default):
    return {"$switch": {"cases": [{"when": model_is(m[0]), "then": value} for m, value in items], "default": default}}


def make_provider(sequential=False):
    ids = [m[0] for m in MODELS]
    lower = model_is(*ids[3:7])
    simple = model_is(*ids[:7])
    fixed = model_is("grok-video")
    seed = model_is(*ids[8:])
    seed20 = model_is(*ids[9:])
    ordered = {kind: unary("sortByOrder", ref("request." + kind)) for kind in ("images", "videos", "audios")}
    counts = {kind: length(ref("request." + kind)) for kind in ordered}
    all_media = op("concatArrays", *ordered.values())
    total = op("add", *counts.values())
    frames = select(ordered["images"], op("in", ref("item.role"), ["first_frame", "last_frame"]))
    first = select(frames, op("eq", ref("item.role"), "first_frame"))
    last = select(frames, op("eq", ref("item.role"), "last_frame"))
    has_frames = present(frames)
    duration = iff(op("gt", ref("request.duration"), 0), ref("request.duration"), one_of([(m, m[3]) for m in MODELS], 4))
    resolution = unary("lower", op("coalesce", ref("request.resolution"), one_of([(m, m[4][0]) for m in MODELS], "480p")))
    ratio = op("coalesce", ref("request.aspectRatio"), "auto")
    validations = []

    def require(condition, message): validations.append({"assert": condition, "message": "Heyroute：" + message})

    require(model_is(*(ids[8:] if sequential else ids)), "模型 ID 不受当前协议支持；按序转场协议仅支持 Seedance 三款，MiniMax-H3 区分大小写。")
    require(present(unary("trim", ref("request.prompt"))), "prompt 不能为空。")
    require(op("gte", ref("request.duration"), 0), "时长不能为负数。")
    require(one_of([(m, op("in", duration, [6, 10, 15]) if m[0] == "grok-video" else op("and", op("gte", duration, m[1]), op("lte", duration, m[2]))) for m in MODELS], False), "时长超出模型范围；grok-video 仅 6/10/15 秒，Seedance 2.0 两档固定 15 秒。")
    require(one_of([(m, op("in", resolution, m[4])) for m in MODELS], False), "分辨率不受此模型支持，请按配置表填写；不自动降级画质。")
    require(one_of([(m, op("in", ratio, list(dict.fromkeys(["auto"] + m[5])))) for m in MODELS], False), "画幅不受此模型支持；四款小写 minimax-h3 模型不能控制画幅。")
    for index, kind in enumerate(ordered):
        require(one_of([(m, op("lte", counts[kind], m[6 + index])) for m in MODELS], False), kind + " 数量超过该模型限制。")
    require(op("or", unary("not", lower), op("lte", total, 1)), "小写 minimax-h3 一次只支持一个素材，不能混传图片、视频和音频。")
    require(op("or", unary("not", seed20), op("lte", total, 15)), "Seedance 2.0 图片、视频和音频合计最多 15 个。")
    require(op("or", unary("not", model_is("MiniMax-H3")), op("eq", counts["audios"], 0), op("gt", op("add", counts["images"], counts["videos"]), 0)), "MiniMax-H3 不能仅用音频生成。")
    require(empty(select(ordered["images"], unary("not", op("in", ref("item.role"), ["", "reference_image", "subject_reference", "style_reference", "first_frame", "last_frame"])))), "不支持的图片角色（不能传蒙版）。")
    require(op("and", op("lte", length(first), 1), op("lte", length(last), 1)), "最多一张首帧和一张尾帧。")
    require(op("or", empty(last), op("eq", length(first), 1)), "尾帧必须与首帧一起使用。")
    require(op("or", unary("not", has_frames), op("eq", length(frames), total)), "首尾帧不能与普通参考图、参考视频或参考音频混用。")
    require(op("or", unary("not", has_frames), unary("not", simple), empty(last)), "此模型不支持尾帧。")
    require(op("or", unary("not", op("and", model_is("seedance-2.5"), has_frames)), op("eq", ratio, "auto")), "Seedance 2.5 首尾帧画幅跟随原图，请选 auto，不能指定其他比例。")
    require(op("or", unary("not", sequential), op("and", seed, op("gt", counts["images"], 0), op("eq", counts["videos"], 0), op("eq", counts["audios"], 0), unary("not", has_frames))), "按序转场只支持 Seedance 普通图片序列，不能混用首尾帧、视频或音频。")
    require(op("in", ref("request.operation"), ["", "generate", "text_to_video", "image_to_video", "reference_to_video", "first_last_frame"]), "首版不开放视频编辑/延长，需先接入实际时长结算和操作入口。")
    allowed_options = {key: option(key) for key in ["seed", "negative_prompt", "shots"]}
    require(op("eq", omit(ref("request.providerOptions.heyroute-video")), omit(allowed_options)), "只支持 seed、negative_prompt、shots，不接受额外 body 或模型覆盖。")
    require(op("or", op("eq", option("seed"), None), seed), "seed 仅对 Seedance 开放；Grok 不支持，MiniMax 种子效果未确认。")
    require(op("or", op("eq", option("seed"), None), op("and", op("eq", option("seed"), unary("toInt", option("seed"))), op("gte", option("seed"), iff(seed20, 0, -1)), op("lte", option("seed"), 2147483647))), "Seedance seed 必须为整数；2.0 为 0～2147483647，2.5 另允许 -1。")
    require(op("or", op("eq", option("negative_prompt"), None), seed20), "negative_prompt 仅 Seedance 2.0 两档支持。")
    require(op("lte", length(option("negative_prompt")), 2500), "negative_prompt 最多 2500 字。")
    valid_shot = op("and", op("gt", length(unary("trim", ref("item.prompt"))), 0), op("gt", ref("item.duration"), 0), op("eq", ref("item.duration"), unary("toInt", ref("item.duration"))))
    durations = each(option("shots"), ref("item.duration"))
    total_seconds = op("add", *[op("at", durations, i) for i in range(15)])
    valid_shots = op("and", seed20, op("gte", length(option("shots")), 2), op("lte", length(option("shots")), 15), op("eq", total_seconds, 15), empty(select(option("shots"), unary("not", valid_shot))))
    require(op("or", op("eq", option("shots"), None), valid_shots), "shots 仅限 Seedance 2.0：2～15 段，正整数 duration 合计 15 秒。")
    require(op("or", unary("not", op("or", lower, fixed)), op("eq", ref("request.generateAudio"), False)), "此固定输出线路没有已验证的音轨开关，请关闭该开关。")
    require(op("eq", ref("request.watermark"), False), "不提供水印开关。")
    require(op("lte", op("coalesce", ref("request.output.count"), 1), 1), "一次任务只生成一个视频。")

    def typed(kind):
        role = {"images": "reference_image", "videos": "reference_video", "audios": "reference_audio"}[kind]
        return omit(each(ordered[kind], {"url": ref("item.value"), "role": iff(op("in", ref("item.role"), ["first_frame", "last_frame"]), ref("item.role"), role)}))

    body = {
        "model": ref("request.model"), "prompt": ref("request.prompt"), "seconds": unary("toString", duration),
        "ratio": iff(unary("not", op("or", fixed, lower, op("and", model_is("seedance-2.5"), has_frames))), ratio),
        "resolution": iff(unary("not", op("or", fixed, lower)), resolution),
        "generate_audio": iff(unary("not", op("or", fixed, lower)), ref("request.generateAudio")),
        "input_reference": iff(simple, unary("first", each(all_media, ref("item.value"))), iff(sequential, each(ordered["images"], ref("item.value")))),
        **{kind: iff(unary("not", op("or", simple, sequential)), typed(kind)) for kind in ordered},
        "seed": option("seed"), "negative_prompt": option("negative_prompt"), "shots": option("shots"),
    }
    success = op("eq", ref("response.status"), "completed")
    return {
        "id": "heyroute-video-sequential" if sequential else "heyroute-video", "label": "Heyroute Seedance 按序转场" if sequential else "Heyroute 视频（11 款模型）", "capabilities": ["video"],
        "scopes": ["admin.system-channel", "user.custom-channel", "canvas", "creation", "agent"],
        "baseUrl": "https://heyroute.ai", "requiresPublicMediaUrls": True,
        "auth": {"type": "bearer", "field": "apiKey"},
        "parameters": [
            {"name": "model", "type": "string", "required": True, "values": ids[8:] if sequential else ids, "mapping": "model", "description": "按文档核对的模型 ID，区分大小写。"},
            {"name": "prompt", "type": "string", "required": True, "mapping": "prompt"},
            {"name": "duration", "type": "integer", "mapping": "seconds", "description": "每个模型时长范围不同，详见安装说明。"},
            {"name": "aspectRatio", "type": "string", "mapping": "ratio"},
            {"name": "resolution", "type": "string", "mapping": "resolution"},
            {"name": "images", "type": "media[]", "mapping": "input_reference / images"},
            {"name": "videos", "type": "media[]", "mapping": "input_reference / videos"},
            {"name": "audios", "type": "media[]", "mapping": "input_reference / audios"},
            {"name": "generateAudio", "type": "boolean", "mapping": "generate_audio"},
        ],
        "validations": validations,
        "create": {"method": "POST", "path": "/v1/videos", "contentType": "application/json", "body": body},
        "poll": {"method": "GET", "path": "/v1/videos/{{taskId}}"},
        "result": {"method": "GET", "path": "/v1/videos/{{taskId}}/content", "headers": {"Accept": "video/mp4"}},
        "response": {
            "taskIdPaths": ["task_id", "id"], "errorPaths": ["error.code", "error.message"],
            "status": iff(op("in", ref("response.status"), ["queued", "in_progress", "completed", "failed"]), ref("response.status"), "failed"),
            "message": op("coalesce", ref("response.error.message"), ref("response.message"), ref("response.fail_reason"), iff(unary("not", op("in", ref("response.status"), ["queued", "in_progress", "completed", "failed"])), "Heyroute 返回了缺失或未知的任务状态。")),
            "videos": iff(success, omit(ref("response.video_url"))), "resultEphemeral": True,
        },
    }


def capability_examples():
    result = []
    for m in MODELS:
        name, lo, hi, default, resolutions, ratios, ni, nv, na, audio = m
        fixed = name == "grok-video"
        video = {
            "references": {"promptMaxChars": 1000, "minImages": 0, "maxImages": ni, "maxImageBytes": 30*1024*1024 if ni else 0, "maxVideos": nv, "maxVideoBytes": 50*1024*1024 if nv else 0, "maxVideoDurationSeconds": 30 if nv else 0, "maxAudios": na, "maxAudioBytes": 20*1024*1024 if na else 0, "maxAudioDurationSeconds": 30 if na else 0},
            "duration": {"selection": "enum", "values": [6, 10, 15] if fixed else [15], "default": default} if fixed or lo == hi else {"selection": "range", "min": lo, "max": hi, "step": 1, "default": default},
            "ratios": ratios, "defaultRatio": ratios[0], "resolutions": resolutions, "defaultResolution": resolutions[0],
            "generateAudio": {"supported": audio, "default": name in ["grok-imagine-video", "grok-imagine-video-1.5", "seedance-2.5"]},
            "watermark": {"supported": False, "default": False}, "operations": ["text_to_video"] + (["image_to_video"] if ni else []), "defaultOperation": "text_to_video",
        }
        result.append({"model": name, "protocol": "heyroute-video", "capabilityConfig": {"version": 1, "video": video}})
    return {"purpose": "人工配置参考，不是后台导入包；字节/素材时长/prompt 上限是本站保守配置，不代表 Heyroute 官方上限。价格须另设。", "models": result}


def main():
    manifest = {"apiVersion": "yingce.plugin/v2", "id": "heyroute-video-v1", "name": "Heyroute Video", "version": "1.1.0", "author": "Himastudio", "description": "Heyroute 11 款视频模型的 JSON 异步生成与 Seedance 按序转场协议。", "enabled": True, "installable": True, "permissions": ["generation.run", "media.read"], "runtime": {"backend": "declarative"}, "configuration": {"fields": [{"name": "apiKey", "type": "secret", "label": "Heyroute 视频分组 API Key", "required": True}]}, "contributes": {"providers": [make_provider(), make_provider(sequential=True)]}}
    write_package(ROOT, manifest, capability_examples())


def write_package(ROOT, manifest, capabilities):
    readme = (ROOT / "README.md").read_text()
    descriptions = {"prompt": "画面及运动提示词，不可为空。", "aspectRatio": "画幅比例，按模型和首尾帧约束验证。", "resolution": "输出画质，固定线路由模型 ID 决定。", "images": "图片参考，保留素材顺序与首尾帧角色。", "videos": "参考视频，按模型限制数量。", "audios": "参考音频，按模型限制数量。", "generateAudio": "音轨开关，保留显式 true/false；不支持的线路禁止开启。"}
    for provider in manifest["contributes"]["providers"]:
        for parameter in provider["parameters"]:
            parameter.setdefault("description", descriptions.get(parameter["name"], "详见模型配置表。"))
    documented = copy.deepcopy(manifest)
    documented["documentation"] = "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
    interface = (ROOT / "interface-intro.md").read_text().strip() + "\n\n<!-- YINGCE_MANIFEST_CONTRACT_START -->\n```json\n" + json.dumps(documented, ensure_ascii=False) + "\n```\n<!-- YINGCE_MANIFEST_CONTRACT_END -->\n"
    (ROOT / "interface.md").write_text(interface)
    manifest["documentation"] = readme.strip() + "\n\n---\n\n" + interface.strip()
    for name, value in [("manifest.json", manifest), ("model-capabilities.json", capabilities)]:
        # The host limits the uncompressed manifest to 512 KiB. Keep generated
        # expressions compact; build.py remains the readable source of truth.
        (ROOT / name).write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n" if name == "manifest.json" else json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    target = ROOT.parent / (manifest["id"] + ".yingce-plugin")
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for name, data in [("manifest.json", (ROOT / "manifest.json").read_bytes()), ("README.md", readme.encode()), ("docs/interface.md", interface.encode()), ("docs/model-capabilities.json", (ROOT / "model-capabilities.json").read_bytes())]:
            info = zipfile.ZipInfo(name, date_time=(2026, 9, 8, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            z.writestr(info, data)
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    (ROOT / "SHA256SUMS").write_text(digest + "  " + target.name + "\n")
    print(f"{target.name}: {target.stat().st_size} bytes; sha256 {digest}")


if __name__ == "__main__":
    main()
