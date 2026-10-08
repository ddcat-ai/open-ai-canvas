# 画布产物与资产包结构

## 命名

```text
SRC-01 小说原文
EVT-001 事件
BIB-01 故事圣经
SKL-01 故事骨架
EP-01 分集
SC-01 场次
CH-01 角色
VO-CH-01 角色声音
LOC-01 环境
PROP-01 武器或道具
SH-001 镜头
```

## 小说原文节点

记录 `sourceId`、原文内容、来源、是否用户提供、改编范围、版本和状态。Agent 自己生成的故事只能标记为 `SOURCE_DRAFT`，用户确认后才能标记为 `SOURCE_APPROVED`。

## 故事圣经

```json
{
  "bibleId": "BIB-01",
  "version": 1,
  "characters": [],
  "world": {},
  "relationships": [],
  "tone": {},
  "taboos": [],
  "continuityRules": [],
  "visualRules": [],
  "openQuestions": [],
  "status": "DRAFT"
}
```

## 角色资产背板

使用 `FRAME-CHAR-<id>`，至少包含：

```text
CH-01-character-card（角色卡节点，核心角色必需）
CH-01-character-bible.md
CH-01-turnaround.png
CH-01-portrait.png
VO-CH-01-voice-profile.md
VO-CH-01-reference.wav（用户需要且平台支持时）
```

可选：表情表、姿态表、服装变体、伤势变体。

角色卡由 `canvas_create_character` 创建，台账记录角色卡节点 ID、角色资产 ID 和版本号；分镜行的 `characterAssetIds` 写作 `CH-01@角色卡v1`，生成时引用角色卡节点。

## 环境资产背板

使用 `FRAME-LOC-<id>`，至少包含：

```text
LOC-01-environment-bible.md
LOC-01-master.png
LOC-01-lighting-variants.png
LOC-01-continuity.md
```

## 武器/道具资产背板

使用 `FRAME-PROP-<id>`，至少包含：

```text
PROP-01-spec.md
PROP-01-front-side-detail.png
PROP-01-use-state.png（需要时）
```

## 分镜行

```json
{
  "shotId": "SH-001",
  "sceneId": "SC-01",
  "durationSeconds": 8,
  "sourceVersion": "SRC-01@v1",
  "bibleVersion": "BIB-01@v1",
  "characterAssetIds": ["CH-01@角色卡v1"],
  "locationAssetId": "LOC-01@v1",
  "propAssetIds": ["PROP-01@v1"],
  "startState": {},
  "action": "",
  "endState": {},
  "dialogue": "",
  "audio": "",
  "imagePrompt": "",
  "videoPrompt": "",
  "continuityIn": "",
  "continuityOut": "",
  "status": "DRAFT"
}
```

普通 Markdown 不能替代结构化分镜；一张电影剧照不能替代角色三视图、环境母版或武器结构图。