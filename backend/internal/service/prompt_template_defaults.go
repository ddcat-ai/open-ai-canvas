package service

import (
	"fmt"
	"strings"
)

const (
	promptOperationStoryboardPlan       = "storyboard_plan"
	promptOperationStoryboardRepair     = "storyboard_repair"
	promptOperationStoryboardFirstFrame = "storyboard_first_frame"
	promptOperationStoryboardVideo      = "storyboard_video"
	promptOperationCharacterExtract     = "character_extract"
	promptOperationCharacterTurnaround  = "character_turnaround"
)

func defaultPromptDefinitions() []PromptOperationDefinition {
	return []PromptOperationDefinition{
		{
			Operation: promptOperationStoryboardPlan, Label: "分镜规划", Category: "分镜", OutputType: "json", SchemaKey: "storyboard-plan/v3",
			Description:    "把剧情、项目画风和当前角色版本规划为可执行镜头。",
			Variables:      []PromptTemplateVariable{{Label: "项目名称", Placeholder: "{{项目名称}}"}, {Label: "项目画风", Placeholder: "{{项目画风}}"}, {Label: "用户要求", Placeholder: "{{用户要求}}"}},
			DefaultContent: defaultStoryboardPromptTemplate(),
		},
		{
			Operation: promptOperationStoryboardRepair, Label: "分镜修复", Category: "分镜", OutputType: "json", SchemaKey: "storyboard-plan/v3",
			Description:    "修复模型返回的分镜结构、字段和镜头复杂度。",
			Variables:      []PromptTemplateVariable{{Label: "校验错误", Placeholder: "{{校验错误}}"}, {Label: "项目画风", Placeholder: "{{项目画风}}"}},
			DefaultContent: `你是影视分镜 JSON 修复导演。修复结构时必须保留剧情信息，通过拆镜或重新分配内容解决复杂度超限，不得用删除关键剧情掩盖错误。若校验错误是台词/旁白超长，必须拆镜或精简为单镜头可念完的台词，保留关键情节，不要把超长 dialogue 原样放回。保持原项目的视觉媒介、角色身份、服装、道具和连续性，不要擅自改写画风。只修复校验错误和由此引发的镜头组织问题。`,
		},
		{
			Operation: promptOperationStoryboardFirstFrame, Label: "分镜首帧", Category: "生成", OutputType: "text",
			Description: "把单镜头结构转换为图片模型使用的首帧提示词。",
			Variables:   []PromptTemplateVariable{{Label: "项目视觉", Placeholder: "{{项目视觉}}"}, {Label: "首帧构图", Placeholder: "{{首帧构图}}"}, {Label: "表演起始状态", Placeholder: "{{表演起始状态}}"}, {Label: "负面要求", Placeholder: "{{负面要求}}"}},
			DefaultContent: `生成单一、可执行的分镜首帧。严格继承项目视觉媒介和角色资产；画面明确主体左右位置、视线、前中后景、遮挡、视觉焦点、可信光源与材质。只描述静止首帧，不提前写后续运动，不添加画外人物、无来源光线、文字或水印。

【项目视觉】
{{项目视觉}}

【首帧构图】
{{首帧构图}}

【表演起始状态】
{{表演起始状态}}

【负面要求】
{{负面要求}}`,
		},
		{
			Operation: promptOperationStoryboardVideo, Label: "分镜视频", Category: "生成", OutputType: "text",
			Description: "把单镜头结构转换为视频模型使用的紧凑执行提示词。",
			Variables:   []PromptTemplateVariable{{Label: "项目视觉", Placeholder: "{{项目视觉}}"}, {Label: "镜头意图", Placeholder: "{{镜头意图}}"}, {Label: "首帧构图", Placeholder: "{{首帧构图}}"}, {Label: "表演与调度", Placeholder: "{{表演与调度}}"}, {Label: "摄影机", Placeholder: "{{摄影机}}"}, {Label: "时间节拍", Placeholder: "{{时间节拍}}"}, {Label: "运动与结尾", Placeholder: "{{运动与结尾}}"}, {Label: "声音", Placeholder: "{{声音}}"}, {Label: "执行优先级", Placeholder: "{{执行优先级}}"}, {Label: "负面要求", Placeholder: "{{负面要求}}"}},
			DefaultContent: `生成单一连续镜头的视频执行提示词。一个镜头只保留一个叙事目标、一个主运镜和一条主要动作链；摄影机运动必须有起点、动机和停止点。优先保证角色身份、表演、关键动作和连续性，次要环境效果可以简化。

【项目视觉】
{{项目视觉}}

【镜头意图】
{{镜头意图}}

【首帧构图】
{{首帧构图}}

【表演与调度】
{{表演与调度}}

【摄影机】
{{摄影机}}

【时间节拍】
{{时间节拍}}

【运动与结尾】
{{运动与结尾}}

【台词与声音】
{{声音}}

【执行优先级】
{{执行优先级}}

【负面要求】
{{负面要求}}`,
		},
		{
			Operation: promptOperationCharacterExtract, Label: "角色卡提取", Category: "角色", OutputType: "json", SchemaKey: "character-breakdown/v1",
			Description:    "从章节正文提取需要跨镜头保持一致的角色资产。",
			Variables:      []PromptTemplateVariable{{Label: "项目名称", Placeholder: "{{项目名称}}"}, {Label: "章节名称", Placeholder: "{{章节名称}}"}, {Label: "项目画风", Placeholder: "{{项目画风}}"}},
			DefaultContent: `你是短剧角色资产导演。只提取章节中实际出场、发言或对剧情产生明确作用，并且后续制作需要保持视觉或声音一致的角色。忽略系统播报、纯物件、无身份群众和没有持续角色价值的一次性路人；合并同一角色的姓名、专属称谓和别名。正文未明确的信息必须写“正文未明确”，不得自行改变人物关系、时代背景或编造编号式姓名。角色设定要具体、稳定、可用于后续三视图和视频一致性控制。`,
		},
		{
			Operation: promptOperationCharacterTurnaround, Label: "角色三视图", Category: "角色", OutputType: "text",
			Description:    "按当前角色版本和项目画风生成正、侧、背三视图。",
			Variables:      []PromptTemplateVariable{{Label: "角色名称", Placeholder: "{{角色名称}}"}, {Label: "项目画风", Placeholder: "{{项目画风}}"}, {Label: "角色设定", Placeholder: "{{角色设定}}"}},
			DefaultContent: `制作专业人物三视图设定表。画面严格分成三个等宽竖向区域，从左到右依次为正面全身、右侧面全身、背面全身。三个视角必须是同一角色、同一服装、同一发型、同一体型和同一比例，采用站立中性姿势，完整显示头顶到脚底。背景使用纯净中性浅色和均匀设定稿光线，只负责分离轮廓，不得改变项目画风的绘画或渲染媒介。禁止文字、边框、道具说明、表情变化和额外人物。`,
		},
	}
}

func protectedPromptContext(operation string, values map[string]string) string {
	switch operation {
	case promptOperationStoryboardPlan:
		return storyboardProtectedContext(values)
	case promptOperationStoryboardRepair:
		return storyboardRepairProtectedContext(values)
	case promptOperationCharacterExtract:
		return characterExtractProtectedContext(values)
	case promptOperationCharacterTurnaround:
		return strings.Join([]string{"【角色名称】\n" + values["角色名称"], "【项目画风】\n" + values["项目画风"], "【角色设定】\n" + values["角色设定"]}, "\n\n")
	default:
		return ""
	}
}

func promptOutputContract(operation string) string {
	switch operation {
	case promptOperationStoryboardPlan, promptOperationStoryboardRepair:
		return "服务端固定 JSON Schema storyboard-plan/v3（不可由运营模板或用户定制覆盖）：\n" + storyboardPlanJSONSchema
	case promptOperationCharacterExtract:
		return "服务端固定 JSON Schema character-breakdown/v1（不可由运营模板或用户定制覆盖）：\n" + characterBreakdownJSONSchema
	default:
		return "当前操作输出普通文本提示词，没有 JSON Schema。"
	}
}

const storyboardPlanJSONSchema = `{
  "type": "object",
  "additionalProperties": false,
  "required": ["title", "logline", "styleGuide", "characters", "locations", "shots"],
  "properties": {
    "title": {"type": "string"},
    "logline": {"type": "string"},
    "styleGuide": {"type": "string", "maxLength": 120},
    "characters": {"type": "array", "items": {"type": "string"}},
    "locations": {"type": "array", "items": {"type": "string"}},
    "shots": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["title", "description", "durationSeconds", "dialogue", "characterIds", "narrativeIntent", "viewerPOV", "performanceBlocking", "shotSize", "emotion", "lightingAndAtmosphere", "audioEffects", "visualPrompt", "videoPrompt", "camera", "motion", "timeBeats", "mustHave", "optionalDetails", "continuityOut", "negativePrompt", "assetTags"],
        "properties": {
          "title": {"type": "string"},
          "description": {"type": "string"},
          "durationSeconds": {"type": "integer", "minimum": 1, "maximum": 60},
          "dialogue": {"type": "string"},
          "characterIds": {"type": "array", "items": {"type": "string"}},
          "narrativeIntent": {"type": "string"},
          "viewerPOV": {"type": "string"},
          "performanceBlocking": {"type": "string"},
          "shotSize": {"type": "string"},
          "emotion": {"type": "string"},
          "lightingAndAtmosphere": {"type": "string"},
          "audioEffects": {"type": "string"},
          "visualPrompt": {"type": "string"},
          "videoPrompt": {"type": "string"},
          "camera": {"type": "string"},
          "motion": {"type": "string"},
          "timeBeats": {"type": "string"},
          "mustHave": {"type": "array", "maxItems": 3, "items": {"type": "string"}},
          "optionalDetails": {"type": "array", "items": {"type": "string"}},
          "continuityOut": {"type": "string"},
          "negativePrompt": {"type": "string"},
          "assetTags": {"type": "array", "items": {"type": "string"}}
        }
      }
    }
  }
}`

const characterBreakdownJSONSchema = `{
  "type": "object",
  "additionalProperties": false,
  "required": ["characters"],
  "properties": {
    "characters": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["name", "aliases", "role", "appearance", "clothing", "physique", "personality", "props", "consistencyPrompt", "multiViewPrompt", "voiceLanguage", "voiceAge", "voiceTimbre"],
        "properties": {
          "name": {"type": "string"},
          "aliases": {"type": "array", "items": {"type": "string"}},
          "role": {"type": "string"},
          "appearance": {"type": "string"},
          "clothing": {"type": "string"},
          "physique": {"type": "string"},
          "personality": {"type": "string"},
          "props": {"type": "string"},
          "consistencyPrompt": {"type": "string"},
          "multiViewPrompt": {"type": "string"},
          "voiceLanguage": {"type": "string"},
          "voiceAge": {"type": "string"},
          "voiceTimbre": {"type": "string"}
        }
      }
    }
  }
}`

func storyboardProtectedContext(values map[string]string) string {
	return strings.Join([]string{
		"【剧情】\n" + values["剧情"],
		"【用户本次要求】\n" + values["用户要求"],
		"【当前画布资产】\n" + values["画布资产"],
		"【当前项目画风】\n" + values["项目画风"],
		"【当前角色版本】\n" + values["角色版本"],
		storyboardExecutionContract(values["单镜头时长规则"], values["镜头数量规则"]),
	}, "\n\n")
}

func storyboardRepairProtectedContext(values map[string]string) string {
	return strings.Join([]string{
		"【剧情】\n" + values["剧情"],
		"【用户本次要求】\n" + values["用户要求"],
		"【当前画布资产】\n" + values["画布资产"],
		"【原始校验错误】\n" + values["校验错误"],
		"【当前项目画风】\n" + values["项目画风"],
		"【当前角色版本】\n" + values["角色版本"],
		storyboardExecutionContract(values["单镜头时长规则"], values["镜头数量规则"]),
		"【需要修复的原始输出】\n" + values["原始输出"],
	}, "\n\n")
}

func storyboardExecutionContract(durationRule string, countRule string) string {
	return `【受保护执行契约】
- ` + durationRule + `
- ` + countRule + `
- 单镜头最多 2 名主要角色、1 个主运镜、1 条主要动作链、3 个 timeBeats 和 3 个 mustHave；超限必须拆镜或在固定镜头数内重新分配。
- dialogue 只写本镜头实际念出的台词或简短旁白，字数上限按 1 秒最多约 5 个中文字符计算（至少 24 字）；超长台词/旁白必须拆镜或精简，不得用 dialogue 承载长段叙述。
- characterIds 只能引用当前角色版本中的 assetId；没有角色时返回空数组。
- styleGuide 最多 120 个中文字符；visualPrompt 只描述首帧，videoPrompt 只描述运动和结尾状态。
- 画幅比例由视频节点参数控制，提示词不得写入具体比例，也不要讨论画幅配置。
- 只返回完整 JSON，不要 Markdown 或解释。
- ` + promptOutputContract(promptOperationStoryboardPlan)
}

func characterExtractProtectedContext(values map[string]string) string {
	return strings.Join([]string{
		fmt.Sprintf("【任务】\n从短剧项目《%s》的章节“%s”提取角色。", values["项目名称"], values["章节名称"]),
		"【项目画风】\n" + values["项目画风"],
		"【章节正文】\n" + values["章节正文"],
		"【受保护输出契约】\n" + promptOutputContract(promptOperationCharacterExtract) + "\n严格 JSON 示例：{\"characters\":[{\"name\":\"角色名\",\"aliases\":[],\"role\":\"剧情定位与人物关系\",\"appearance\":\"稳定外貌\",\"clothing\":\"固定服装\",\"physique\":\"体型体态\",\"personality\":\"表演基线\",\"props\":\"\",\"consistencyPrompt\":\"跨镜头一致性约束\",\"multiViewPrompt\":\"三视图结构重点\",\"voiceLanguage\":\"语言口音\",\"voiceAge\":\"声音年龄感\",\"voiceTimbre\":\"音色语速力度\"}]}",
	}, "\n\n")
}
