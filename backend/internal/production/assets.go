package production

import (
	"regexp"
	"sort"
	"strings"
)

// 角色与场景参考图方案。参考图是后续每个镜头首帧的身份锚点，方案决定它的版式、
// 比例和约束提示词。模板在作品设置里保存为全文，用户看到的就是实际发送的内容。

const (
	AssetModePortrait   = "portrait"
	AssetModeTurnaround = "turnaround"
	AssetModeFourView   = "fourview"
	AssetModeCustom     = "custom"
)

// 可用变量。保存时校验，未知变量直接拒绝，避免把 {{xxx}} 原样发给模型。
var (
	CharacterAssetVariables = []string{"{{角色名称}}", "{{角色设定}}", "{{项目画风}}", "{{画面规则}}"}
	SceneAssetVariables     = []string{"{{场景名称}}", "{{场景设定}}", "{{项目画风}}", "{{画面规则}}"}
)

// AssetImageRatio 是资产参考图（场景、道具与内置角色方案）的统一画幅。
const AssetImageRatio = "16:9"

type AssetScheme struct {
	Mode        string `json:"mode"`
	Name        string `json:"name"`
	Description string `json:"description"`
	// Ratio 是参考图期望画幅；实际像素由所选图片模型的档位决定。
	Ratio string `json:"ratio"`
	// FrameHint 告诉首帧模型参考图是什么版式，避免把设定板的排版带进镜头。
	FrameHint       string `json:"frameHint"`
	CharacterPrompt string `json:"characterPrompt"`
}

const defaultScenePrompt = `{{项目画风}}。场景概念设定图：{{场景名称}}。{{场景设定}}。
横版宽景构图，无人物，空镜，构图完整，主体空间与出入口清晰，前中后景层次分明；光源方向明确，色调与时代服化道统一。
禁止文字、水印、边框。{{画面规则}}`

// propPrompt 是关键道具参考图模板：单件道具居中、无人物，供视频生成时保持道具外观一致。
const propPrompt = `{{项目画风}}。道具设定图：{{道具名称}}。{{道具设定}}。
横版构图，单件道具居中完整展示，四周留白，干净浅灰背景，柔和棚拍光，外形、材质、颜色与细节清晰；无人物、无手部。
禁止文字、水印、边框。{{画面规则}}`

var assetSchemes = []AssetScheme{
	{
		Mode: AssetModePortrait, Name: "定妆照", Ratio: AssetImageRatio,
		Description: "单人正面半身，五官最清晰。出图快、成本低，适合角色多、以对话为主的短剧。",
		FrameHint:   "参考图为角色定妆照，只沿用其五官、发型与服装",
		CharacterPrompt: `{{项目画风}}。角色定妆照：{{角色名称}}。{{角色设定}}。
横版构图，单人居中，正面半身，中性表情，目视镜头；干净浅色纯背景，柔和均匀的正面光，五官、发型与服装细节清晰。
禁止文字、水印、道具遮挡面部、额外人物。{{画面规则}}`,
	},
	{
		Mode: AssetModeTurnaround, Name: "三视图设定板", Ratio: AssetImageRatio,
		Description: "正面、侧面、背面全身同一张图，服装与体型一致性最好，适合打戏和全身镜头多的作品。",
		FrameHint:   "参考图为角色三视图设定板，只沿用其外貌、服装与体型，不要复制排版",
		CharacterPrompt: `{{项目画风}}。专业人物三视图设定板：{{角色名称}}。{{角色设定}}。
画面严格分成三个等宽竖向区域，从左到右依次为正面全身、右侧面全身、背面全身；三个视角是同一角色、同一服装、同一发型、同一体型与比例。
站立中性姿势，完整显示头顶到脚底，不裁切头部和脚。纯净中性浅色背景，均匀设定稿光线，不改变项目画风的绘画或渲染媒介。
禁止文字、边框、道具说明、表情变化和额外人物。{{画面规则}}`,
	},
	{
		Mode: AssetModeFourView, Name: "四格资产板 · 声纹", Ratio: AssetImageRatio,
		Description: "面部特写 + 正 / 侧 / 背无脸全身四格，底部附声纹条。脸只在特写里出现一次，跨集换脸最少，适合长剧。",
		FrameHint:   "参考图为角色四格资产板：面部以特写格为准，服装与体型以全身格为准，不要复制排版与声纹条",
		CharacterPrompt: `{{项目画风}}。角色四格资产参考图：{{角色名称}}。{{角色设定}}。
横版白色纯背景，全图共 4 格，等高排列：
① 面部特写：唯一一张清晰的脸，五官、脸型、发际线、眉眼、鼻唇、肤色、痣与疤痕等特征完整锁定；
② 正面全身（面部弱化）；③ 90° 侧面全身（面部弱化）；④ 背面全身。
全身格从头顶到鞋底完整入画，不裁切头部；四格中的服装、发型、体型与配饰完全一致。
画面底部一条细横带：声纹波形 / 频谱可视化图形，旁边一行不超过 8 个英文单词的音色标签。
除音色标签外不出现任何文字。负面：全身格出现清晰五官、第二张可辨认的脸、马赛克或像素化遮挡、额外人物。{{画面规则}}`,
	},
}

// AssetSchemes 返回内置方案（含默认提示词），供创建页与设置页展示。
func AssetSchemes() []AssetScheme {
	result := make([]AssetScheme, len(assetSchemes))
	copy(result, assetSchemes)
	return result
}

func DefaultScenePrompt() string { return defaultScenePrompt }

func assetScheme(mode string) (AssetScheme, bool) {
	for _, scheme := range assetSchemes {
		if scheme.Mode == mode {
			return scheme, true
		}
	}
	return AssetScheme{}, false
}

// AssetSettings 是作品的参考图方案。Source* 只记录提示词来源（例如从某个技能导入），不参与执行。
type AssetSettings struct {
	Mode            string `json:"mode"`
	CharacterPrompt string `json:"characterPrompt"`
	ScenePrompt     string `json:"scenePrompt"`
	CharacterRatio  string `json:"characterRatio"`
	// Resolution 是参考图分辨率档位（1k / 1.5k / 2k / 4k），空串按图片模型默认档位。
	Resolution      string `json:"resolution,omitempty"`
	SourceSkillID   string `json:"sourceSkillId,omitempty"`
	SourceSkillName string `json:"sourceSkillName,omitempty"`
	SourcePath      string `json:"sourcePath,omitempty"`
}

const assetPromptLimit = 4000

func (a AssetSettings) Normalized() AssetSettings {
	scheme, known := assetScheme(a.Mode)
	if !known && a.Mode != AssetModeCustom {
		a.Mode = AssetModePortrait
		scheme, _ = assetScheme(AssetModePortrait)
	}
	a.CharacterPrompt = truncateRunes(strings.TrimSpace(a.CharacterPrompt), assetPromptLimit)
	a.ScenePrompt = truncateRunes(strings.TrimSpace(a.ScenePrompt), assetPromptLimit)
	if a.CharacterPrompt == "" {
		if a.Mode == AssetModeCustom {
			a.Mode = AssetModePortrait
			scheme, _ = assetScheme(AssetModePortrait)
		}
		a.CharacterPrompt = scheme.CharacterPrompt
	}
	if a.ScenePrompt == "" {
		a.ScenePrompt = defaultScenePrompt
	}
	switch a.CharacterRatio {
	case "3:4", "9:16", "1:1", "16:9", "4:3":
	default:
		a.CharacterRatio = firstNonEmpty(scheme.Ratio, AssetImageRatio)
	}
	if a.Mode != AssetModeCustom {
		a.CharacterRatio = scheme.Ratio
	}
	switch a.Resolution = strings.ToLower(strings.TrimSpace(a.Resolution)); a.Resolution {
	case "", "1k", "1.5k", "2k", "4k":
	default:
		a.Resolution = ""
	}
	a.SourceSkillID = truncateRunes(strings.TrimSpace(a.SourceSkillID), 64)
	a.SourceSkillName = truncateRunes(strings.TrimSpace(a.SourceSkillName), 120)
	a.SourcePath = truncateRunes(strings.TrimSpace(a.SourcePath), 240)
	return a
}

// FrameHint 返回首帧提示词里对参考图版式的说明。
func (a AssetSettings) FrameHint() string {
	if scheme, ok := assetScheme(a.Mode); ok {
		return scheme.FrameHint
	}
	return "人物外貌严格参考对应参考图，不要复制参考图的排版与文字"
}

var assetPlaceholderPattern = regexp.MustCompile(`\{\{[^{}]+\}\}`)

// ValidateAssetPrompts 拒绝未知变量；返回第一个问题的说明。
func ValidateAssetPrompts(a AssetSettings) string {
	check := func(label string, content string, allowed []string) string {
		known := map[string]bool{}
		for _, item := range allowed {
			known[item] = true
		}
		unknown := []string{}
		for _, placeholder := range assetPlaceholderPattern.FindAllString(content, -1) {
			if !known[placeholder] {
				unknown = append(unknown, placeholder)
			}
		}
		if len(unknown) == 0 {
			return ""
		}
		sort.Strings(unknown)
		return label + "包含不支持的变量：" + strings.Join(unknown, "、") + "；可用变量：" + strings.Join(allowed, "、")
	}
	if problem := check("角色参考图提示词", a.CharacterPrompt, CharacterAssetVariables); problem != "" {
		return problem
	}
	return check("场景参考图提示词", a.ScenePrompt, SceneAssetVariables)
}

func renderAssetTemplate(template string, values map[string]string) string {
	rendered := template
	for key, value := range values {
		rendered = strings.ReplaceAll(rendered, "{{"+key+"}}", strings.TrimSpace(value))
	}
	// 变量为空时清掉残留的孤立句号，避免出现“。。”。
	rendered = strings.NewReplacer("。。", "。", "：。", "。").Replace(rendered)
	return strings.TrimSpace(rendered)
}
