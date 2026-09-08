#!/usr/bin/env python3
"""Build Heyroute Images and the shared frontend/backend capability defaults."""
import copy
import json
from pathlib import Path
import runpy
import subprocess

ROOT = Path(__file__).resolve().parent
helpers = runpy.run_path(str(ROOT.parent / "heyroute-video/build.py"))
ref, op, unary, iff = [helpers[n] for n in ("ref", "op", "unary", "iff")]
each, select, length, omit = [helpers[n] for n in ("each", "select", "length", "omit")]
MODELS = ["gpt-image-2", "grok-imagine-image", "flux-klein-2", "gemini-3-pro-image", "gemini-3.1-flash-image", "nano-banana-pro", "nano-banana-2"]
SIZES = ["1024x1024", "1536x1024", "1024x1536", "1536x864", "864x1536", "2048x2048"]


def image_capabilities():
    result = []
    for name in MODELS:
        sized = name in ["gpt-image-2", "flux-klein-2"]
        image = {"references": {"promptMaxChars": 32000, "maxImages": 16, "maxImageBytes": 30*1024*1024, "maskSupported": True}, "size": {"parameter": "size" if sized else "none", "values": (["auto"] if name == "gpt-image-2" else []) + SIZES if sized else ["auto"], "default": "1024x1024" if sized else "auto", "allowCustom": False}, "quality": {"supported": name == "gpt-image-2", "values": ["auto", "low", "medium", "high"], "default": "auto"}, "transparentBackground": {"supported": False, "default": False}, "responseFormat": {"supported": True}, "outputFormat": {"supported": False}, "maxOutputs": 10 if name == "grok-imagine-image" else 1}
        result.append({"model": name, "protocol": "heyroute-image", "capabilityConfig": {"version": 1, "image": image}})
    return {"models": result}


def main():
    model = ref("request.model")
    is_gpt = op("eq", model, "gpt-image-2")
    sized = op("in", model, ["gpt-image-2", "flux-klein-2"])
    sources = select(ref("request.images"), op("ne", ref("item.role"), "mask"))
    masks = select(ref("request.images"), op("eq", ref("item.role"), "mask"))
    editing = op("gt", length(sources), 0)
    count = iff(op("gt", ref("request.imageCount"), 0), ref("request.imageCount"), 1)
    size = op("coalesce", ref("request.aspectRatio"), "1024x1024")
    quality = op("coalesce", ref("request.quality"), "auto")
    validations = [
        (op("in", model, MODELS), "未知图片模型 ID。"),
        (op("gt", length(unary("trim", ref("request.prompt"))), 0), "提示词不能为空。"),
        (op("and", op("gte", count, 1), op("lte", count, iff(op("eq", model, "grok-imagine-image"), 10, 1))), "仅 Grok 图片支持 1～10 张，其余模型每次 1 张。"),
        (op("or", unary("not", sized), op("in", size, ["auto"] + SIZES)), "图片尺寸未在此协议配置中声明。"),
        (op("or", unary("not", is_gpt), op("in", quality, ["auto", "low", "medium", "high"])), "GPT 图片 quality 必须为 auto/low/medium/high。"),
        (op("lte", length(masks), 1), "最多一张 PNG 蒙版。"),
        (op("or", op("eq", length(masks), 0), editing), "蒙版编辑必须提供原图。"),
        (op("lte", length(sources), 16), "本协议最多 16 张参考图。"),
        (op("eq", op("add", length(ref("request.videos")), length(ref("request.audios"))), 0), "图片模型不接收视频或音频。"),
        (op("in", unary("json", ref("request.providerOptions")), ["null", "{}"]), "图片协议不接受额外参数覆盖。"),
    ]
    provider = {"id": "heyroute-image", "label": "Heyroute 图片（SSE）", "capabilities": ["image"], "scopes": ["admin.system-channel", "user.custom-channel", "canvas", "creation", "agent"], "baseUrl": "https://heyroute.ai", "auth": {"type": "bearer", "field": "apiKey"}, "parameters": [{"name": "model", "type": "string", "required": True, "values": MODELS, "mapping": "model"}, {"name": "prompt", "type": "string", "required": True, "mapping": "prompt"}, {"name": "images", "type": "media[]", "mapping": "image / mask"}, {"name": "imageCount", "type": "integer", "mapping": "n"}, {"name": "aspectRatio", "type": "string", "mapping": "size"}, {"name": "quality", "type": "string", "mapping": "quality"}], "validations": [{"assert": a, "message": "Heyroute：" + msg} for a, msg in validations], "create": {"method": "POST", "path": "/v1/images/generations", "pathTemplate": iff(editing, "/v1/images/edits", "/v1/images/generations"), "contentType": "application/json", "contentTypeTemplate": iff(editing, "multipart/form-data", "application/json"), "responseMode": "sse-json", "headers": {"Accept": "text/event-stream"}, "body": {"model": model, "prompt": ref("request.prompt"), "n": count, "size": iff(sized, size), "quality": iff(is_gpt, quality), "response_format": "b64_json", "stream": True}, "files": [{"name": "image", "source": sources}, {"name": "mask", "source": masks, "mimeType": "image/png", "filename": "mask.png"}]}, "response": {"status": iff(op("gt", length(ref("response.data")), 0), "succeeded", "failed"), "errorPaths": ["error.code", "error.message"], "messagePaths": ["error.message", "message"], "images": each(ref("response.data"), {"url": omit(ref("item.url")), "dataUrl": iff(op("gt", length(ref("item.b64_json")), 0), op("concat", "data:image/png;base64,", ref("item.b64_json")))}), "resultEphemeral": True}}
    manifest = {"apiVersion": "yingce.plugin/v2", "id": "heyroute-image-v1", "name": "Heyroute Images", "version": "1.0.0", "author": "Himastudio", "description": "Heyroute 五款图片模型及两个别名的文生图、参考图与蒙版编辑，需支持 sse-json 的宿主。", "permissions": ["generation.run", "media.read"], "runtime": {"backend": "declarative"}, "configuration": {"fields": [{"name": "apiKey", "type": "secret", "label": "Heyroute 图片分组 API Key", "required": True}]}, "contributes": {"providers": [provider]}}
    helpers["write_package"](ROOT, manifest, image_capabilities())
    defaults = {"heyroute-video": {}, "heyroute-video-sequential": {}, "heyroute-image": {}}
    for entry in helpers["capability_examples"]()["models"]:
        defaults["heyroute-video"][entry["model"]] = entry["capabilityConfig"]
        if entry["model"].startswith("seedance-"):
            config = copy.deepcopy(entry["capabilityConfig"])
            config["video"]["references"].update(minImages=1, maxVideos=0, maxAudios=0)
            config["video"]["operations"] = ["image_to_video"]
            config["video"]["defaultOperation"] = "image_to_video"
            defaults["heyroute-video-sequential"][entry["model"]] = config
    for entry in image_capabilities()["models"]:
        defaults["heyroute-image"][entry["model"]] = entry["capabilityConfig"]
    serialized = json.dumps(defaults, ensure_ascii=False, indent=2) + "\n"
    web_root = ROOT.parents[1] / "web"
    web_target = web_root / "src/lib/heyroute-capabilities.json"
    prettier = web_root / "node_modules/prettier/bin/prettier.cjs"
    if not prettier.is_file():
        raise SystemExit("Run bun install --frozen-lockfile in web before generating capability defaults.")
    formatted = subprocess.run(
        ["node", str(prettier), "--stdin-filepath", str(web_target)],
        input=serialized, text=True, capture_output=True, check=True, cwd=web_root,
    ).stdout
    (ROOT.parents[1] / "backend/internal/protocol/heyroute-capabilities.json").write_text(serialized)
    web_target.write_text(formatted)


if __name__ == "__main__": main()
