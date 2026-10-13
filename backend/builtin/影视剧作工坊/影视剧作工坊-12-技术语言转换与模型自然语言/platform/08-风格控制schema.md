# 导演风格控制协议 V2

> **落位说明**（并入影视剧作工坊时添加，正文保留原文）
> 来源：director-production-agent · style-control-schema
> 原文文件名：`style-control-schema.txt`
> 链路归位：见第四批提取索引 `INDEX.md`（镜头→光影→物理→分镜连续→提示词→声音BGM→连续性）

## 信息层

- `VERIFIED_FACT`：有来源的影片级或镜头级技术事实。
- `OBSERVED_PATTERN`：可从多张真实画面反复观察的电影语言。
- `GENERATION_TRANSLATION`：供 Seedance 2.0 执行的视觉与时间语义。
- `UNKNOWN`：没有足够证据；禁止补全具体型号或数值。

## JSON 结构

`data/verified-style-profiles.json` 顶层包含 `schema_version=2.0` 与 `profiles`。

每个 profile：

- `id`、`director_zh`、`director_en`、`default_lane`。
- `lanes`：按具体影片或兼容影片群分支，不设导演终身器材配置。

每个 lane：

- `lane_id`、`film`、`year`、`cinematographers`、`scope`。
- `technical_facts`：`capture_medium`、`camera`、`lens`、`focal_length`、`aspect_ratio`、`base_frame_rate`、`shutter`。
- `controls`：摄影机空间、镜头行为、景别语法、运动、灯光、调度、美术色彩、剪辑声音、硬锁、旋钮和冲突项。
- `shot_blueprint`：`start_state`、`action_trigger`、`camera_path`、`environment_response`、`stop_frame`。
- `generation_translation`：技术事实对应的透视、景深、运动模糊、光线和材质后果。
- `evidence`：技术事实引用的证据条目。

## 精确事实

每个技术字段写成：

```json
{
  "status": "VERIFIED_FACT",
  "value": "具体事实",
  "evidence_ids": ["E001"]
}
```

未知时必须写：

```json
{
  "status": "UNKNOWN",
  "value": "UNKNOWN",
  "evidence_ids": []
}
```

## 十个可调旋钮

整数范围 0—100：`occlusion`、`camera_proximity`、`camera_activity`、`perspective_compression`、`depth_of_field`、`motion_blur`、`contrast`、`saturation`、`performance_restraint`、`shot_duration`。

## Prompt 编译

最终生成正文只读取 `controls`、`shot_blueprint` 与 `generation_translation`。`technical_facts` 只用于单独的事实报告；`UNKNOWN`、证据等级和器材清单不得进入 Seedance 正文。

## AIGC 技术执行配方

`scripts/director_agent_core.py` 从十个旋钮和影片分支控制项确定性生成以下建议：

- 焦段等效行为：描述约 24–135mm 范围内的视觉行为，但明确属于生成建议。
- 机位距离与高度：从人物/环境比例和相机接近度推导。
- 景深策略：浅、中、深景深的可见结果与必要清晰对象。
- 帧率节奏：默认 24fps，允许项目文件覆盖；升降格必须逐镜声明。
- 快门/运动模糊：用 90°–216° 等效范围说明清晰度与拖曳，不冒充原片参数。
- 承托方式：固定、受控轨道/稳定器感或动作驱动手持。
- 镜长节奏：短镜单动作、中镜五段式或长镜等待与余韵。

这一配方属于 `GENERATION_TRANSLATION` 的执行层，不写回 `technical_facts`，也不得作为真实制作资料引用。

## AIGC 项目协议 V3

项目 JSON 使用 `schema_version=3.0`，包括：交付格式、创作意图、素材引用、角色、场景、道具、项目硬锁和镜头列表。每个镜头必须有 `beat`、`scene_id`、`scene`、`start_state`、`action`、`duration`、`camera_trigger`、`camera_path`、`environment_response`、`stop_frame`、`sound`、`handoff` 与 `locks`。旧项目仍可快速编译，但批量生产必须升级到 V3。
