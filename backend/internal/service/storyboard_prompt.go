package service

import (
	"encoding/json"
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/model"
)

type StoryboardPromptTemplateRequest struct {
	Name    string `json:"name"`
	Content string `json:"content"`
	Enabled *bool  `json:"enabled"`
}

type StoryboardPromptVariable struct {
	Label       string `json:"label"`
	Placeholder string `json:"placeholder"`
}

var storyboardPromptVariables = []StoryboardPromptVariable{
	{Label: "剧情", Placeholder: "{{剧情}}"},
	{Label: "用户要求", Placeholder: "{{用户要求}}"},
	{Label: "画布资产", Placeholder: "{{画布资产}}"},
}

func (s *Service) EnsureDefaultStoryboardPromptTemplate() error {
	count, err := s.repo.StoryboardPromptTemplateCount()
	if err != nil {
		return err
	}
	if count > 0 {
		// 只升级仍保留旧占位符的内置模板，避免覆盖管理员创建或修改的版本。
		templates, err := s.repo.StoryboardPromptTemplates()
		if err != nil {
			return err
		}
		for index := range templates {
			template := &templates[index]
			if template.Name == "默认影视分镜提示词" && strings.Contains(template.Content, "\n....\n") {
				template.Content = defaultStoryboardPromptTemplate()
				return s.repo.SaveStoryboardPromptTemplate(template)
			}
		}
		return nil
	}
	return s.repo.SaveStoryboardPromptTemplate(&model.StoryboardPromptTemplate{
		ID:      newID(),
		Name:    "默认影视分镜提示词",
		Content: defaultStoryboardPromptTemplate(),
		Enabled: true,
	})
}

func (s *Service) AdminStoryboardPromptTemplates(actor *model.User) ([]model.StoryboardPromptTemplate, []StoryboardPromptVariable, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, nil, err
	}
	templates, err := s.repo.StoryboardPromptTemplates()
	if err != nil {
		return nil, nil, err
	}
	return templates, storyboardPromptVariables, nil
}

func (s *Service) CreateStoryboardPromptTemplate(actor *model.User, req StoryboardPromptTemplateRequest) (*model.StoryboardPromptTemplate, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	template, err := storyboardPromptTemplateFromRequest(req, model.StoryboardPromptTemplate{ID: newID(), CreatedBy: actor.ID})
	if err != nil {
		return nil, err
	}
	if req.Enabled == nil {
		template.Enabled = false
	}
	if err := s.repo.SaveStoryboardPromptTemplate(&template); err != nil {
		return nil, err
	}
	return &template, nil
}

func (s *Service) UpdateStoryboardPromptTemplate(actor *model.User, id string, req StoryboardPromptTemplateRequest) (*model.StoryboardPromptTemplate, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	template, err := s.repo.StoryboardPromptTemplate(id)
	if err != nil {
		return nil, err
	}
	if template.Enabled && req.Enabled != nil && !*req.Enabled {
		return nil, BadAuthRequest("至少需要保留一个启用的分镜提示词")
	}
	next, err := storyboardPromptTemplateFromRequest(req, *template)
	if err != nil {
		return nil, err
	}
	if err := s.repo.SaveStoryboardPromptTemplate(&next); err != nil {
		return nil, err
	}
	return &next, nil
}

func (s *Service) DeleteStoryboardPromptTemplate(actor *model.User, id string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	template, err := s.repo.StoryboardPromptTemplate(id)
	if err != nil {
		return err
	}
	if template.Enabled {
		return BadAuthRequest("启用中的分镜提示词不能删除，请先启用其他版本")
	}
	return s.repo.DeleteStoryboardPromptTemplate(id)
}

func (s *Service) buildAgentStoryboardPlannerPrompt(brief string, requirements string, assets []storyboardAsset, shotDuration int, shotCount int) string {
	template := defaultStoryboardPromptTemplate()
	if active, err := s.repo.ActiveStoryboardPromptTemplate(); err == nil && strings.TrimSpace(active.Content) != "" {
		template = active.Content
	}
	return renderStoryboardPromptTemplate(template, brief, requirements, assets) + "\n\n" + storyboardCinematicQualityContract(shotDuration, shotCount)
}

func storyboardCinematicQualityContract(shotDuration int, shotCount int) string {
	durationRule := "单个镜头时长由剧情节奏决定，必须是 1 到 60 秒的整数。"
	if shotDuration == 5 || shotDuration == 10 || shotDuration == 15 || shotDuration == 30 {
		durationRule = fmt.Sprintf("本次生成单个镜头时长必须严格等于 %d 秒；模型只决定镜头数量和总时长，不得修改单镜头时长。", shotDuration)
	}
	countRule := "镜头数量由模型按剧情节奏自动决定。"
	if shotCount >= 1 && shotCount <= 10 {
		countRule = fmt.Sprintf("shots 数组必须严格输出 %d 个镜头，不得多于或少于 %d 个；该规则覆盖模板中的默认镜头数量范围。", shotCount, shotCount)
	}
	contract := `强制电影化质量契约（优先级高于用户 brief 中的泛化叙述）：
- ` + durationRule + `
- ` + countRule + `
- 不要把剧情段落直接改写成镜头摘要。每一行必须是一个可执行、可拍摄的连续镜头，必须写清主体在画面中的具体动作、空间关系、视觉焦点和可见结果。
- 每个镜头必须有摄影机设计：shotSize、camera（机位高度/角度/焦段/景别/构图）、motion（推拉摇移跟/环绕/升降/手持及起止方向）。镜头之间要有远近景、角度或运动变化，避免同质中景。
- timeBeats 必须按时间码拆解该镜头内部动作，例如“0-1.2秒：...；1.2-4.5秒：...；4.5-8秒：...”，覆盖完整 durationSeconds，包含开始画面、中段变化和结尾停点。
- description 只写可见画面与动作，不使用“意识到、回忆起、感到、关系建立、命运转折”等不可直接拍摄的剧情总结；这些内容必须转译成眼神、停顿、手部动作、走位、道具反应或环境变化。
- visualPrompt 必须包含主体、前中后景、构图、光线、材质、色彩和真实摄影质感；videoPrompt 必须补充主体运动、环境运动、连续性、时长和转场逻辑。
- styleGuide、visualPrompt 和 videoPrompt 禁止写入 2.39:1、16:9 等具体画幅比例，也不要讨论画幅配置。
- negativePrompt 必须针对本镜头列出换脸、服装变化、手部错误、乱码、闪烁、风格突变、动作僵硬等风险，不要只写“无”。
- 只返回 JSON。shots 中每项必须包含：title、description、durationSeconds、dialogue、shotSize、emotion、lightingAndAtmosphere、audioEffects、visualPrompt、videoPrompt、camera、motion、timeBeats、negativePrompt、assetTags。`

	return contract + "\n\n" + storyboardCameraLanguageGuide()
}

func storyboardCameraLanguageGuide() string {
	return `分镜镜头语言规则（必须融入每个镜头的设计，服务叙事而非炫技）：
- 景别必须从以下六类中选择并写入 shotSize：S01 大远景 ELS（环境/宏大空间）、S02 远景 LS（人物全身与处境）、S03 全景 FS（完整动作）、S04 中景 MS（自然叙事/对话首选）、S05 近景 CU（表情与反应）、S06 特写 ECU（眼睛、手或关键细节）。同一场景按叙事需要渐进变化，避免无逻辑跳跃。
- 机位角度按叙事需要选择：A01 平视 Eye Level（中性客观）、A02 仰角 Low Angle（强大/压迫）、A03 俯角 High Angle（弱小/脆弱）、A04 鸟瞰 Bird's Eye/Top Down（全知/构图）、A05 倾斜角 Dutch Angle（失衡/不安）、A06 蜗牛视角 Worm's Eye（极度崇高或压迫）。无动机不得突变视角。
- 运镜从以下体系中按情绪和空间目的选择，并在 motion 写清起止状态：M01 推、M02 拉、M03 横移、M04 水平摇、M05 垂直倾斜、M06 升降、M07 环绕、M08 甩镜、M09 手持、M10 稳定器跟拍、M11 主观跟进、M12 航拍推进、M13 航拍拉升、M14 变焦、M15 希区柯克变焦、M16 过肩。运动镜头必须有动机；以静制动，固定镜头与运动镜头要形成对比。
- 构图优先从以下方法选择并写入 camera 或 visualPrompt：C01 三分法、C02 框中框、C03 引导线、C04 对称构图、C05 负空间、C06 前景叠层。必须交代主体、前景/中景/远景和视觉焦点。
- 叙事手法按需要使用：N01 主观镜头、N02 反应镜头、N03 空镜/插入、N04 匹配剪辑、N05 交叉剪辑、N06 跳切。对话优先 MS + OTS（过肩）+ 反应镜头，不要用复杂运动掩盖表演。
- 节奏约束：推/拉/横移/升降等运动镜头通常保持 5-8 秒以上；甩镜和希区柯克变焦全片各不超过 1-2 次；手持只用于纪实、紧迫或混乱等明确情绪；航拍主要用于开篇或高潮；ECU 每场景最多 2 个。
- 禁止每 3-5 秒更换一次运镜，禁止同类技法连续重复，禁止无叙事动机的角度突变；希区柯克变焦仅用于顿悟、恐惧或心理扭转等关键时刻。`
}

func storyboardPromptTemplateFromRequest(req StoryboardPromptTemplateRequest, template model.StoryboardPromptTemplate) (model.StoryboardPromptTemplate, error) {
	name := strings.TrimSpace(req.Name)
	content := strings.TrimSpace(req.Content)
	if name == "" {
		return template, BadAuthRequest("请填写提示词名称")
	}
	if content == "" {
		return template, BadAuthRequest("请填写提示词内容")
	}
	template.Name = name
	template.Content = content
	if req.Enabled != nil {
		template.Enabled = *req.Enabled
	}
	return template, nil
}

func renderStoryboardPromptTemplate(template string, brief string, requirements string, assets []storyboardAsset) string {
	assetJSON, _ := json.MarshalIndent(assets, "", "  ")
	replacer := strings.NewReplacer(
		"{{剧情}}", strings.TrimSpace(brief),
		"{{用户brief}}", strings.TrimSpace(brief),
		"{{用户要求}}", strings.TrimSpace(requirements),
		"{{画布资产}}", string(assetJSON),
		"{{获取当前画布资产}}", string(assetJSON),
	)
	return replacer.Replace(template)
}

func defaultStoryboardPromptTemplate() string {
	codeFence := "```"
	return `你是影视分镜导演和 AI 视频提示词专家。
	请根据用户剧情 brief 和当前画布资产标签，生成可直接用于 AI 视频生成的分镜 JSON。

创作方法参考成熟分镜提示词实践：
- 先理解故事目标、人物动机、冲突、情绪曲线和结尾。
- 每个镜头都要明确主体、动作、场景、景别、构图、镜头焦段、机位、运镜、光线、色彩、质感、时长感和转场。
- durationSeconds 必须是 1 到 60 的整数；没有台词、旁白或音效时返回空字符串。
	- 需要保持角色、服装、道具、空间和风格一致；能复用画布资产时，在 assetTags 中引用对应标签。
	- characters 必须逐角色输出，格式固定为“角色名：剧情定位、外貌、服装、体态、道具、性格动机和跨镜头一致性约束”，不要把多个角色合并成一项。
- videoPrompt 必须是完整中文视频生成提示词，不要只写关键词。
- videoPrompt 必须包含镜头时长、开始画面、中段变化、结尾画面、摄影机运动、主体运动、环境运动、可信光源、色彩基调、真实摄影质感和负面视觉约束。
- 优先使用真实电影机语言：低机位/平视/俯拍、焦段、景深、自然曝光、空气介质、胶片颗粒、真实高光滚降。
- 不要把主体完整居中平铺；需要有前景/中景/远景和人、物、空间尺度参照。
- 不要在 visualPrompt 或 videoPrompt 中使用 3D动漫、动画、二次元、游戏CG、游戏截图、角色原画、概念设计图、手办感、卡通渲染、插画风等媒介限定词。
- assetTags 只能引用当前画布资产里已有的标签或标签值；没有可复用资产时返回空数组。

	用户brief：
` + codeFence + `
{{剧情}}
` + codeFence + `

用户要求：
` + codeFence + `
{{用户要求}}
` + codeFence + `

当前画布资产：{{画布资产}}

	格式：
{"title":"项目标题","logline":"一句话故事","styleGuide":"整体摄影、光线、色彩、质感和一致性规则","characters":["张三：男主角，28岁，短黑发，深灰夹克，清瘦挺拔，随身旧怀表，克制果断；所有镜头保持五官、发型、服装和怀表一致"],"locations":["场景与空间描述"],"shots":[{"title":"镜头标题","description":"可拍摄的主体动作、空间关系和可见结果","durationSeconds":8,"dialogue":"台词或旁白","shotSize":"中近景","emotion":"克制紧张","lightingAndAtmosphere":"侧逆光与薄雾","audioEffects":"环境风声","visualPrompt":"包含前中后景、构图、光线、材质和真实摄影质感的图片提示词","videoPrompt":"补充主体运动、环境运动、连续性、时长和转场逻辑","camera":"平视略低机位，50mm，中近景，前景遮挡，三分法构图","motion":"0-1秒固定，1-5秒缓慢推近，5-8秒轻微横移后停住","timeBeats":"0-1秒：建立画面；1-5秒：主体完成关键动作；5-8秒：反应和结尾停点","negativePrompt":"禁止换脸、服装变化、手部畸形、乱码、闪烁、风格突变、动作僵硬","assetTags":["角色:张三"]}]}

特别注意：
- 只返回 JSON，不要 markdown，不要解释。
- shots 输出 3 到 8 个；如果后续强制电影化质量契约指定了镜头数量，以契约为准。`
}
