// 画布 Agent 的技能（Skills）检索：按关键词在已启用技能的名称、描述与方法卡文件名中
// 打分（含中文 2-gram 展开）、截取片段。
//
// 检索完全在内存中进行，不调用模型；结果按预算裁剪，避免把整份技能正文塞进上下文。
//
// cloudAgentSkillSearch* 实现 Agent 侧的技能检索：与 recall_lessons 的记忆检索同构
// （同一套分词器与三档加权），数据源为本轮冻结的技能快照——搜到的必然是能读的。
// 只返回「哪张卡值得读 + 路径」，正文仍走 skill_read_file 的渐进披露，技能内容永不整体内联。

package app

import (
	"encoding/json"
	"fmt"
	"log"
	"slices"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	agenttool "yingce/backend/internal/agent/tool"
)

type cloudAgentSkill struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Description string            `json:"description,omitempty"`
	Version     string            `json:"version"`
	Hash        string            `json:"hash"`
	Instruction string            `json:"instruction,omitempty"`
	Files       map[string]string `json:"files,omitempty"`
}

const cloudAgentSkillEntryPath = "SKILL.md"

func cloudAgentSkillPaths(skill cloudAgentSkill) []string {
	paths := make([]string, 0, len(skill.Files)+1)
	seen := make(map[string]struct{}, len(skill.Files)+1)
	if strings.TrimSpace(skill.Instruction) != "" {
		paths = append(paths, cloudAgentSkillEntryPath)
		seen[cloudAgentSkillEntryPath] = struct{}{}
	}
	for path := range skill.Files {
		if _, exists := seen[path]; exists {
			continue
		}
		paths = append(paths, path)
		seen[path] = struct{}{}
	}
	sort.Strings(paths)
	return paths
}

const (
	cloudAgentSkillSearchTokenMax = 8
	cloudAgentSkillSearchDefault  = 8
	cloudAgentSkillSearchMax      = 20
	cloudAgentSkillSnippetRunes   = 120
	// 一次检索最多下发多少条卡路径（所有命中条目共享预算），防止大包把上下文撑爆。
	cloudAgentSkillSearchCardBudget = 40
	// 单次检索的最终 JSON 响应上限。卡片索引只是导航，超限时从低排名结果开始裁剪。
	cloudAgentSkillSearchResponseBudget = 4096
	// 2-gram 展开后 token 总量上限（含原始 token）：防止超长关键词放大打分开销。
	// 不并入 tokenMax——长句尾部的 gram 往往才是关键命中词，不能因字段数上限截掉。
	cloudAgentSkillSearchGramMax = 56
	// Exact trigger aliases point at a card in the same frozen skill pool.
	// They only apply when both the skill ID and the referenced card exist.
	cloudAgentSkillAliasScore = 12
)

type cloudAgentSkillAliasRule struct {
	SkillID   string
	Path      string
	Exclusive bool
	Exclude   []string
	Triggers  []string
}

// 旧工位已压缩进现有技能包。这里只保留完整、具体的用户说法，用于直达对应卡片；
// 泛词（如“视频”“分镜”“商品图”）不能作为别名，否则会把无关请求吸进固定包。
var cloudAgentSkillAliasRules = []cloudAgentSkillAliasRule{
	{
		SkillID: "14811816982284",
		Path:    "cards/drama-character-asset-board.md",
		Triggers: []string{
			"做角色三视图",
			"生成角色设定图",
			"能复用的资产板",
			"角色衣服和脸总是不一样",
			"做个角色档案",
			"角色资产解耦",
		},
	},
	{
		SkillID:   "14811816983052",
		Path:      "cards/story-structure-engine-migration.md",
		Exclusive: true,
		Triggers: []string{
			"故事结构引擎",
			"16000000000084",
		},
	},
	{
		SkillID:   "14811816983052",
		Path:      cloudAgentSkillEntryPath,
		Exclusive: true,
		Triggers: []string{
			"故事开发",
		},
	},
	{
		SkillID:   "14811816983052",
		Path:      "cards/short-narrative-structure.md",
		Exclusive: true,
		Triggers: []string{
			"短片五阶段结构",
			"16000000000080",
			"五段式短片提示词",
			"电影感短片提示词",
			"竖屏短剧三件套",
			"多镜主体登记",
			"多镜氛围锁定",
			"21类型模板分支",
			"IP安全处置",
		},
	},
	{
		SkillID:   "14811816982284",
		Path:      "cards/character-forge-migration.md",
		Exclusive: true,
		Triggers: []string{
			"角色锻造工坊",
			"16000000000073",
		},
	},
	{
		SkillID:   "14811816982796",
		Path:      "cards/factory-script-machine-migration.md",
		Exclusive: true,
		Triggers: []string{
			"剧本工业化机器",
			"16000000000076",
		},
	},
	{
		SkillID:   "14811816982796",
		Path:      "cards/dialogue-workshop-migration.md",
		Exclusive: true,
		Triggers: []string{
			"对白工坊",
			"16000000000075",
		},
	},
	{
		SkillID:   "16000000000095",
		Path:      "cards/prompt-engineering-patterns-migration.md",
		Exclusive: true,
		Triggers: []string{
			"提示词工程模式",
			"16000000000103",
		},
	},
	{
		SkillID:   "16000000000095",
		Path:      "cards/freestyle-style-library-migration.md",
		Exclusive: true,
		Triggers: []string{
			"Freestyle 风格库",
			"freestyle-风格库",
			"16000000000089",
		},
	},
	{
		SkillID:   "16000000000095",
		Path:      "cards/video-reversal-prompt-migration.md",
		Exclusive: true,
		Triggers: []string{
			"15秒极致夸张反转提示词",
			"一五秒极致夸张反转提示词",
			"14811816981260",
		},
	},
	{
		SkillID:   "16000000000095",
		Path:      "cards/video-visual-effect-prompt-migration.md",
		Exclusive: true,
		Triggers: []string{
			"15秒视觉特效",
			"一五秒视觉特效",
			"14811816981004",
		},
	},
	{
		SkillID:   "16000000000086",
		Path:      "cards/microexpression-director-migration.md",
		Exclusive: true,
		Triggers: []string{
			"AI演员微表情导演",
			"AI 演员微表情导演",
			"14889899552012",
		},
	},
	{
		SkillID: "16000000000074",
		Path:    "cards/comedy-general-index.md",
		Triggers: []string{
			"笑点诊断",
			"段子结构",
		},
	},
	{
		SkillID: "16000000000074",
		Path:    "cards/sitcom-index.md",
		Triggers: []string{
			"情景喜剧",
		},
	},
	{
		SkillID: "16000000000074",
		Path:    "cards/standup-index.md",
		Triggers: []string{
			"脱口秀",
			"开放麦",
		},
	},
	{
		SkillID: "16000000000074",
		Path:    "cards/xiangsheng-index.md",
		Triggers: []string{
			"相声",
			"捧逗",
		},
	},
	{
		SkillID:   "16000000000074",
		Path:      "cards/sitcom-lab-migration.md",
		Exclusive: true,
		Triggers: []string{
			"情景喜剧工坊",
			"16000000000082",
		},
	},
	{
		SkillID:   "16000000000074",
		Path:      "cards/standup-craft-migration.md",
		Exclusive: true,
		Triggers: []string{
			"脱口秀手艺",
			"16000000000083",
		},
	},
	{
		SkillID:   "16000000000074",
		Path:      "cards/xiangsheng-craft-migration.md",
		Exclusive: true,
		Triggers: []string{
			"相声手艺",
			"16000000000085",
		},
	},
	{
		SkillID:   "14811816969484",
		Path:      "cards/evolution-migration.md",
		Exclusive: true,
		Triggers: []string{
			"珠宝设计进化",
			"14811816969740",
		},
	},
	{
		SkillID:   "yingce-image-editing",
		Path:      "cards/image-annotation-migration.md",
		Exclusive: true,
		Triggers: []string{
			"图片标注编辑",
			"yingce-image-annotation",
		},
	},
	{
		SkillID:   "yingce-image-editing",
		Path:      "cards/image-layer-split-migration.md",
		Exclusive: true,
		Triggers: []string{
			"图片图层拆分",
			"yingce-image-layer-split",
		},
	},
	{
		SkillID: "yingce-image-editing",
		Path:    cloudAgentSkillEntryPath,
		Exclude: []string{"背景音乐"},
		Triggers: []string{
			"把这张图的背景换成纯白",
			"背景换成纯白",
			"图片换背景",
			"照片换背景",
			"更换图片背景",
			"换背景",
			"文字描述改图",
		},
	},
	{
		SkillID: "yingce-image-editing",
		Path:    "cards/image-layer-split.md",
		Triggers: []string{
			"拆成独立图层",
			"拆成图层",
			"拆分图层",
			"主体提取",
			"抠主体",
			"透明背景",
		},
	},
	{
		SkillID:   "16000000000105",
		Path:      cloudAgentSkillEntryPath,
		Exclusive: true,
		Triggers: []string{
			"广告全链路打法",
		},
	},
	{
		SkillID:   "16000000000107",
		Path:      cloudAgentSkillEntryPath,
		Exclusive: true,
		Triggers: []string{
			"选包门房",
		},
	},
	{
		SkillID: "16000000000094",
		Path:    "cards/drama-shot-card-14.md",
		Triggers: []string{
			"把这段拆成分镜",
			"写个分镜表",
			"14字段分镜",
			"帮我排镜头",
			"60秒的分镜",
			"剧本怎么分镜",
			"群戏分镜",
		},
	},
	{
		SkillID: "16000000000093",
		Path:    "cards/drama-four-tier-prompt.md",
		Triggers: []string{
			"帮我写这段的画面提示词",
			"这段怎么写成提示词",
			"让这个镜头动起来",
			"提示词总是不稳定",
			"提示词不稳定",
			"让ai自己切镜头",
			"打戏提示词怎么写",
			"打戏视频提示词",
		},
	},
	{
		SkillID: "16000000000092",
		Path:    "cards/drama-frame-bridge.md",
		Triggers: []string{
			"两段怎么接",
			"帮我做个转场",
			"镜头怎么过渡",
			"想要时间静止",
			"能循环的画面",
		},
	},
	{
		SkillID: "16000000000092",
		Path:    "cards/sd25-continuity-locks.md",
		Triggers: []string{
			"把视频里的人换成另一个人",
			"把这段视频换个背景",
			"氛围和音乐不搭",
			"想让视频接着往下演",
			"同一个角色在另一条素材里变形了",
			"角色伤口不连贯",
			"道具忽大忽小",
		},
	},
	{
		SkillID: "16000000000088",
		Path:    "cards/drama-assembly-acceptance.md",
		Triggers: []string{
			"把这些片段剪成一条",
			"帮我出剪辑单",
			"字幕怎么对",
			"成片总感觉不完整",
			"交付前要检查什么",
		},
	},
	{
		SkillID: "14811816982028",
		Path:    "cards/ec-product-image.md",
		Triggers: []string{
			"做主图",
			"白底商品图",
			"商品图打光",
			"把手去掉",
			"主图不合规",
			"出4k主图",
			"做三视图",
			"要多角度图",
			"一张出完所有角度",
			"出九个机位",
			"角度图糊了",
			"换个颜色看看",
			"出几个配色",
			"改个材质",
			"批量出变体",
			"所有配色都要同一个杯子",
			"做张海报",
			"海报",
			"出小红书图",
			"做个宣传图",
			"多张图拼一张好看的",
			"把商品放到场景里",
			"做个使用场景图",
			"氛围高级一点",
			"背景太假",
			"ins风场景图",
			"主图",
		},
	},
	{
		SkillID: "14811816982028",
		Path:    "cards/ec-detail-page.md",
		Triggers: []string{
			"做详情页",
			"详情长图",
			"对标复刻竞品",
			"参考竞品做详情",
			"详情页模块规划",
		},
	},
	{
		SkillID: "14811816982028",
		Path:    "cards/ec-quality-scrub.md",
		Triggers: []string{
			"画质油腻",
			"画面油腻",
			"塑料感",
			"ai味",
			"噪点",
			"过锐化",
			"色块脏",
			"画质净化",
		},
	},
	{
		SkillID: "14811816981772",
		Path:    "cards/ec-product-video.md",
		Triggers: []string{
			"让产品转起来",
			"做个产品视频",
			"做个变形动画",
			"跟着音乐切换",
			"产品展示短片",
		},
	},
}

func cloudAgentSkillSearchTokens(keyword string) []string {
	tokens := make([]string, 0, cloudAgentSkillSearchTokenMax)
	seen := make(map[string]bool, cloudAgentSkillSearchTokenMax)
	addToken := func(token string) {
		if seen[token] {
			return
		}
		seen[token] = true
		tokens = append(tokens, token)
	}
	fields := 0
	for _, raw := range strings.FieldsFunc(keyword, cloudAgentSkillTokenSeparator) {
		if fields >= cloudAgentSkillSearchTokenMax {
			break
		}
		token := strings.ToLower(strings.TrimSpace(raw))
		// 单字停用词过滤照拿的是英文逻辑（a / I）；汉字单字「梗」「钩」「戏」本身是完整
		// 语义的最小单位。一刀切丢后 tokens 为空，检索会退化成「列全部已启用技能索引」。
		// 这里只放行单个汉字的 token，英文/数字单字与空串仍按停用词丢掉。
		first, size := utf8.DecodeRuneInString(token)
		singleHan := size == len(token) && unicode.Is(unicode.Han, first)
		if (!singleHan && utf8.RuneCountInString(token) < 2) || seen[token] {
			continue
		}
		fields++
		addToken(token)
		// 模型常把中文自然语句整句当关键词（无分隔符时上面切不开），整串 Contains
		// 几乎必然落空，模型随即把「没搜到」当成「没有适用技能」。含汉字且超过
		// 2 字的 token 展开成重叠 2-gram：「反转结尾」→ 反转/转结/结尾，名称、
		// 描述或卡名含任一片段即可参与排序；整串命中时全部 gram 命中，得分自然
		// 更高。英文等纯 ASCII token 保持整串匹配，避免 gram 噪声。
		runes := []rune(token)
		if singleHan || !cloudAgentSkillContainsHan(runes) {
			continue
		}
		for i := 0; i+1 < len(runes) && len(tokens) < cloudAgentSkillSearchTokenMax+cloudAgentSkillSearchGramMax; i++ {
			gram := runes[i : i+2]
			// 只展开“中中”二字词。英文嵌入在中文句里时（如“IP”“3D”）
			// 会让 i/p 这种字母片段误撞英文卡名，把无关请求吸进固定包。
			if unicode.Is(unicode.Han, gram[0]) && unicode.Is(unicode.Han, gram[1]) {
				addToken(string(gram))
			}
		}
	}
	return tokens
}

func cloudAgentSkillContainsHan(runes []rune) bool {
	for _, r := range runes {
		if unicode.Is(unicode.Han, r) {
			return true
		}
	}
	return false
}

func cloudAgentSkillTokenSeparator(r rune) bool {
	return unicode.IsSpace(r) || strings.ContainsRune(",，、。;；:：/\\|()（）[]【】{}<>\"'“”‘’!！?？+*&", r)
}

// cloudAgentSkillCardSlug 取卡路径的文件名（去目录与扩展名），用于关键词匹配。
// 例：cards/czks-hook-paywall.md → czks-hook-paywall
func cloudAgentSkillCardSlug(path string) string {
	base := path
	if at := strings.LastIndex(base, "/"); at >= 0 {
		base = base[at+1:]
	}
	for _, ext := range []string{".md", ".txt", ".json"} {
		if strings.HasSuffix(base, ext) {
			base = strings.TrimSuffix(base, ext)
			break
		}
	}
	return strings.ToLower(base)
}

// cloudAgentSkillContainsToken 对英文检索词要求单词边界，避免 ai 命中 fail、
// art 命中 start 这类片段误撞。中文仍按子串匹配，因为中文卡片名不以空格分词。
func cloudAgentSkillContainsToken(haystack, token string) bool {
	if token == "" {
		return false
	}
	ascii := true
	for _, r := range token {
		if r > unicode.MaxASCII {
			ascii = false
			break
		}
	}
	if !ascii {
		return strings.Contains(haystack, token)
	}
	for offset := 0; offset <= len(haystack)-len(token); {
		index := strings.Index(haystack[offset:], token)
		if index < 0 {
			return false
		}
		index += offset
		beforeOK := index == 0
		if !beforeOK {
			before, _ := utf8.DecodeLastRuneInString(haystack[:index])
			beforeOK = !unicode.IsLetter(before) && !unicode.IsDigit(before)
		}
		end := index + len(token)
		afterOK := end == len(haystack)
		if !afterOK {
			after, _ := utf8.DecodeRuneInString(haystack[end:])
			afterOK = !unicode.IsLetter(after) && !unicode.IsDigit(after)
		}
		if beforeOK && afterOK {
			return true
		}
		offset = index + 1
	}
	return false
}

// cloudAgentSkillCardPaths 返回技能包内除入口以外的全部卡路径（有序）。
// 这些路径在快照里本来就有（Files 已载入），下发索引不需要读取任何正文。
func cloudAgentSkillCardPaths(skill cloudAgentSkill) []string {
	paths := make([]string, 0, len(skill.Files))
	for path := range skill.Files {
		if path == cloudAgentSkillEntryPath {
			continue
		}
		paths = append(paths, path)
	}
	sort.Strings(paths)
	return paths
}

func cloudAgentSkillAliasText(value string) string {
	var normalized strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(value)) {
		if unicode.IsSpace(r) || cloudAgentSkillTokenSeparator(r) {
			continue
		}
		normalized.WriteRune(r)
	}
	return normalized.String()
}

type cloudAgentSkillAliasMatch struct {
	SkillID   string
	Path      string
	Length    int
	Order     int
	Exclusive bool
}

func cloudAgentSkillAliasBetter(candidate, current cloudAgentSkillAliasMatch) bool {
	if candidate.Length != current.Length {
		return candidate.Length > current.Length
	}
	if candidate.Exclusive != current.Exclusive {
		return candidate.Exclusive
	}
	return candidate.Order < current.Order
}

// cloudAgentSkillAliasMatches 返回每个已安装技能最多一条最具体的精确别名。
// 独占别名用于旧工位名和旧 ID；普通题材词可以跨技能共存，交由检索层保留协作候选。
func cloudAgentSkillAliasMatches(skills []cloudAgentSkill, keyword string) []cloudAgentSkillAliasMatch {
	normalized := cloudAgentSkillAliasText(keyword)
	if normalized == "" {
		return nil
	}
	available := make(map[string]map[string]struct{}, len(skills))
	for _, skill := range skills {
		paths := make(map[string]struct{}, len(skill.Files))
		for path := range skill.Files {
			paths[path] = struct{}{}
		}
		available[skill.ID] = paths
	}
	matches := make([]cloudAgentSkillAliasMatch, 0, len(available))
	bySkill := make(map[string]int, len(available))
	for order, rule := range cloudAgentSkillAliasRules {
		paths, ok := available[rule.SkillID]
		if !ok {
			continue
		}
		if _, ok := paths[rule.Path]; !ok {
			continue
		}
		excluded := false
		for _, phrase := range rule.Exclude {
			excludedText := cloudAgentSkillAliasText(phrase)
			if excludedText != "" && strings.Contains(normalized, excludedText) {
				excluded = true
				break
			}
		}
		if excluded {
			continue
		}
		for _, trigger := range rule.Triggers {
			triggerText := cloudAgentSkillAliasText(trigger)
			if triggerText == "" || !strings.Contains(normalized, triggerText) {
				continue
			}
			candidate := cloudAgentSkillAliasMatch{
				SkillID: rule.SkillID, Path: rule.Path, Length: utf8.RuneCountInString(triggerText),
				Order: order, Exclusive: rule.Exclusive,
			}
			if index, exists := bySkill[rule.SkillID]; exists {
				if cloudAgentSkillAliasBetter(candidate, matches[index]) {
					matches[index] = candidate
				}
				continue
			}
			bySkill[rule.SkillID] = len(matches)
			matches = append(matches, candidate)
		}
	}
	sort.SliceStable(matches, func(i, j int) bool {
		return cloudAgentSkillAliasBetter(matches[i], matches[j])
	})
	return matches
}

// cloudAgentSkillBestAlias 保留旧测试接口：返回匹配到的最具体别名。
func cloudAgentSkillBestAlias(skills []cloudAgentSkill, keyword string) (cloudAgentSkillAliasMatch, bool) {
	matches := cloudAgentSkillAliasMatches(skills, keyword)
	if len(matches) == 0 {
		return cloudAgentSkillAliasMatch{}, false
	}
	return matches[0], true
}

// cloudAgentSkillMatch 同时给技能与其卡片打分，返回总分与最具体的命中路径。
// 卡片命中 4 分 > 技能名 3 分 > 描述 2 分：命中最具体的那一层，Agent 才不必先读总纲。
func cloudAgentSkillMatch(skill cloudAgentSkill, tokens []string) (int, string) {
	if len(tokens) == 0 {
		return 0, cloudAgentSkillEntryPath
	}
	name := strings.ToLower(skill.Name)
	description := strings.ToLower(skill.Description)
	score := 0
	for _, token := range tokens {
		switch {
		case cloudAgentSkillContainsToken(name, token):
			score += 3
		case cloudAgentSkillContainsToken(description, token):
			score += 2
		}
	}
	cards := cloudAgentSkillCardPaths(skill)
	bestCard := ""
	cardScore := 0
	for _, path := range cards {
		slug := cloudAgentSkillCardSlug(path)
		hit := 0
		for _, token := range tokens {
			if cloudAgentSkillContainsToken(slug, token) {
				hit += 4
			}
		}
		if hit > cardScore {
			cardScore = hit
			bestCard = path
		}
	}
	score += cardScore
	if bestCard != "" {
		return score, bestCard
	}
	return score, cloudAgentSkillEntryPath
}

// cloudAgentSkillHasStrongMatch 只认可技能名或具体卡名命中。描述命中常来自
// “镜头、视频、广告、AI”等泛词；若仅凭描述就把重型生产包设为主控，普通
// 运镜问答或表演诊断会被整条生产链接管。
func cloudAgentSkillHasStrongMatch(skill cloudAgentSkill, tokens []string) bool {
	name := strings.ToLower(skill.Name)
	for _, token := range tokens {
		if cloudAgentSkillContainsToken(name, token) {
			return true
		}
	}
	for _, path := range cloudAgentSkillCardPaths(skill) {
		slug := cloudAgentSkillCardSlug(path)
		for _, token := range tokens {
			if cloudAgentSkillContainsToken(slug, token) {
				return true
			}
		}
	}
	return false
}

// cloudAgentSkillRuneIndex 在 rune 序列里做朴素子串查找，返回 rune 下标（未命中 -1）。
// 描述只有数百字、token 最多 8 个，朴素查找足够，且避免字节/rune 下标混用。
func cloudAgentSkillRuneIndex(hay, needle []rune) int {
	if len(needle) == 0 || len(needle) > len(hay) {
		return -1
	}
	for i := 0; i+len(needle) <= len(hay); i++ {
		matched := true
		for j := range needle {
			if unicode.ToLower(hay[i+j]) != unicode.ToLower(needle[j]) {
				matched = false
				break
			}
		}
		if matched {
			return i
		}
	}
	return -1
}

func cloudAgentSkillSnippet(skill cloudAgentSkill, tokens []string) string {
	description := strings.TrimSpace(skill.Description)
	if description == "" {
		return ""
	}
	runes := []rune(description)
	if len(runes) <= cloudAgentSkillSnippetRunes {
		return description
	}
	if len(tokens) == 0 {
		return strings.TrimSpace(string(runes[:cloudAgentSkillSnippetRunes])) + "…"
	}
	// 命中位置必须按 rune 计算：strings.Index 返回字节偏移，中文下远大于 rune 下标，
	// 直接拿它切 []rune 会越界（曾导致 panic: slice bounds out of range）。
	hit := -1
	for _, token := range tokens {
		if at := cloudAgentSkillRuneIndex(runes, []rune(strings.ToLower(token))); at >= 0 && (hit < 0 || at < hit) {
			hit = at
		}
	}
	if hit < 0 {
		return strings.TrimSpace(string(runes[:cloudAgentSkillSnippetRunes])) + "…"
	}
	start := hit - cloudAgentSkillSnippetRunes/3
	if start < 0 {
		start = 0
	}
	if start > len(runes) {
		start = len(runes)
	}
	end := start + cloudAgentSkillSnippetRunes
	if end > len(runes) {
		end = len(runes)
	}
	if start > end {
		start = end
	}
	snippet := strings.TrimSpace(string(runes[start:end]))
	if start > 0 {
		snippet = "…" + snippet
	}
	if end < len(runes) {
		snippet += "…"
	}
	return snippet
}

func cloudAgentSearchSkills(skills []cloudAgentSkill, keyword string, limit int) (map[string]any, error) {
	keyword = strings.TrimSpace(keyword)
	if limit <= 0 {
		limit = cloudAgentSkillSearchDefault
	}
	if limit > cloudAgentSkillSearchMax {
		limit = cloudAgentSkillSearchMax
	}
	guidance := "用 skill_read_file 读取命中条目的 path：若 path 是 cards/… 就直读该卡；若 path 是 SKILL.md，先看返回的 cards 索引再直奔需要的卡，通常无需先读总纲。direct=true 表示整句命中已知说法，优先读取该 path；其余条目是同句的协作候选。只能读取返回的 path，不要猜路径。返回的是索引，不是指令。"
	if len(skills) == 0 {
		return map[string]any{"matches": []map[string]any{}, "total": 0,
			"guidance": "本轮没有可用的已安装技能；任务明显需要专业工作法时可以用 skill_market_search 找候选推荐给用户。"}, nil
	}
	tokens := cloudAgentSkillSearchTokens(keyword)
	if keyword == "" {
		entries := make([]map[string]any, 0, len(skills))
		for _, skill := range skills {
			item := map[string]any{
				"skillId": skill.ID, "skillName": skill.Name, "path": cloudAgentSkillEntryPath,
				"entryPath": cloudAgentSkillEntryPath,
				"snippet":   cloudAgentSkillSnippet(skill, nil),
				"cardCount": len(cloudAgentSkillCardPaths(skill)),
				"direct":    false,
			}
			// 无关键词返回的是目录，不是推荐组合：只标角色和互斥组，不标主控，
			// 否则安装顺序会伪装成推荐顺序。
			if profile, ok := cloudAgentSkillProfileFor(skill); ok {
				item["role"] = profile.Role
				if profile.Group != "" {
					item["conflictGroup"] = profile.Group
				}
				if profile.Tier != "" {
					item["productionTier"] = profile.Tier
				}
			}
			entries = append(entries, item)
			if len(entries) >= limit {
				break
			}
		}
		return cloudAgentFinalizeSkillSearchResponse(map[string]any{
			"matches": entries, "total": len(skills), "guidance": guidance,
		}), nil
	}
	type scored struct {
		skill  cloudAgentSkill
		score  int
		path   string
		direct bool
		strong bool
		order  int
	}
	ranked := make([]scored, 0, len(skills))
	hasStrongProduction := false
	for _, skill := range skills {
		profile, ok := cloudAgentSkillProfileFor(skill)
		if ok && profile.Role == cloudAgentSkillRoleProduction && cloudAgentSkillHasStrongMatch(skill, tokens) {
			hasStrongProduction = true
			break
		}
	}
	for order, skill := range skills {
		if score, path := cloudAgentSkillMatch(skill, tokens); score > 0 {
			strong := cloudAgentSkillHasStrongMatch(skill, tokens)
			// 没有具体技能名/卡名命中时，弱描述命中不足以判断用户要做哪条生产线。
			// 一旦本轮已有明确的生产包，其他重型主控仍保留为候选，方便换方案。
			if profile, ok := cloudAgentSkillProfileFor(skill); ok &&
				profile.Role == cloudAgentSkillRoleProduction && !strong && !hasStrongProduction {
				continue
			}
			ranked = append(ranked, scored{skill: skill, score: score, path: path, strong: strong, order: order})
		}
	}
	aliases := cloudAgentSkillAliasMatches(skills, keyword)
	var exclusive *cloudAgentSkillAliasMatch
	for index := range aliases {
		if aliases[index].Exclusive {
			exclusive = &aliases[index]
			break
		}
	}
	// 旧工位名和旧 ID 是独占直达层：命中后不再附带普通关键词候选，
	// 否则同一句话里的短别名或泛词会瓜分旧入口。
	if exclusive != nil {
		for order, skill := range skills {
			if skill.ID != exclusive.SkillID {
				continue
			}
			score, _ := cloudAgentSkillMatch(skill, tokens)
			ranked = []scored{{
				skill: skill, score: score + cloudAgentSkillAliasScore,
				path: exclusive.Path, direct: true, strong: true, order: order,
			}}
			break
		}
	} else if len(aliases) > 0 {
		// 普通题材词只替换目标技能的 path 并置顶，不清空同句里的其他工位。
		rankedBySkill := make(map[string]int, len(ranked))
		for index, entry := range ranked {
			rankedBySkill[entry.skill.ID] = index
		}
		for _, alias := range aliases {
			index, exists := rankedBySkill[alias.SkillID]
			if !exists {
				for order, skill := range skills {
					if skill.ID != alias.SkillID {
						continue
					}
					score, _ := cloudAgentSkillMatch(skill, tokens)
					rankedBySkill[alias.SkillID] = len(ranked)
					ranked = append(ranked, scored{
						skill: skill, score: score + cloudAgentSkillAliasScore,
						path: alias.Path, direct: true, strong: true, order: order,
					})
					break
				}
				continue
			}
			ranked[index].path = alias.Path
			ranked[index].score += cloudAgentSkillAliasScore
			ranked[index].direct = true
			ranked[index].strong = true
		}
	}
	sort.SliceStable(ranked, func(i, j int) bool {
		if ranked[i].direct != ranked[j].direct {
			return ranked[i].direct
		}
		if ranked[i].score != ranked[j].score {
			return ranked[i].score > ranked[j].score
		}
		return ranked[i].order < ranked[j].order
	})
	entries := make([]map[string]any, 0, limit)
	// 卡索引按排名分配预算：命中卡片时 path 已是卡路径，不必再下发索引；
	// 只命中技能时下发卡路径，Agent 可以直奔某张卡，不必先读 SKILL.md 总纲。
	cardBudget := cloudAgentSkillSearchCardBudget
	// 同组只在排名最高的一条上标 primary，其余明确降为候选。
	// 这里按已排序结果顺序登记，保证「主控」永远只有一个。
	primaryGroups := make(map[string]struct{}, 4)
	hasGroupConflict := false
	for _, entry := range ranked {
		if len(entries) >= limit {
			break
		}
		cards := cloudAgentSkillCardPaths(entry.skill)
		item := map[string]any{
			"skillId":   entry.skill.ID,
			"skillName": entry.skill.Name,
			"path":      entry.path,
			"entryPath": cloudAgentSkillEntryPath,
			"score":     entry.score,
			"snippet":   cloudAgentSkillSnippet(entry.skill, tokens),
			"cardCount": len(cards),
			"direct":    entry.direct,
		}
		if profile, ok := cloudAgentSkillProfileFor(entry.skill); ok {
			item["role"] = profile.Role
			if profile.Tier != "" {
				item["productionTier"] = profile.Tier
			}
			if profile.Group != "" {
				item["conflictGroup"] = profile.Group
				if _, exists := primaryGroups[profile.Group]; exists {
					item["primary"] = false
					hasGroupConflict = true
				} else {
					primaryGroups[profile.Group] = struct{}{}
					item["primary"] = true
				}
			}
		}
		if entry.path == cloudAgentSkillEntryPath && len(cards) > 0 && cardBudget > 0 {
			shown := cards
			if len(shown) > cardBudget {
				shown = shown[:cardBudget]
			}
			cardBudget -= len(shown)
			item["cards"] = shown
		}
		entries = append(entries, item)
	}
	if len(entries) == 0 {
		guidance = "没有匹配的已安装技能，可直接按任务需求继续。"
	} else if hasGroupConflict {
		guidance += " " + cloudAgentSkillConflictGuidance
	}
	// total counts all matched candidates before limit; matches contains only this response page.
	return cloudAgentFinalizeSkillSearchResponse(map[string]any{
		"matches": entries, "total": len(ranked), "keyword": keyword, "guidance": guidance,
	}), nil
}

func cloudAgentSkillSearchResponseFits(response map[string]any) bool {
	encoded, err := json.Marshal(response)
	return err == nil && len(encoded) <= cloudAgentSkillSearchResponseBudget
}

func cloudAgentShortenSkillSnippet(snippet string, maxRunes int) string {
	runes := []rune(strings.TrimSpace(snippet))
	if maxRunes <= 0 || len(runes) <= maxRunes {
		return string(runes)
	}
	return strings.TrimSpace(string(runes[:maxRunes])) + "…"
}

// cloudAgentFinalizeSkillSearchResponse 在保留 total 的前提下裁剪导航信息：
// 先撤低排名条目的卡索引，再缩短 snippet，最后才移除低排名条目。
func cloudAgentFinalizeSkillSearchResponse(response map[string]any) map[string]any {
	if cloudAgentSkillSearchResponseFits(response) {
		return response
	}
	matches, _ := response["matches"].([]map[string]any)
	for index := len(matches) - 1; index >= 0; index-- {
		if _, ok := matches[index]["cards"]; !ok {
			continue
		}
		delete(matches[index], "cards")
		if cloudAgentSkillSearchResponseFits(response) {
			return response
		}
	}
	for _, limit := range []int{96, 64, 32} {
		for index := len(matches) - 1; index >= 0; index-- {
			snippet, _ := matches[index]["snippet"].(string)
			if len([]rune(snippet)) <= limit {
				continue
			}
			matches[index]["snippet"] = cloudAgentShortenSkillSnippet(snippet, limit)
			if cloudAgentSkillSearchResponseFits(response) {
				return response
			}
		}
	}
	for index := len(matches) - 1; index >= 0; index-- {
		if _, ok := matches[index]["snippet"]; !ok {
			continue
		}
		delete(matches[index], "snippet")
		if cloudAgentSkillSearchResponseFits(response) {
			return response
		}
	}
	for len(matches) > 1 {
		matches = matches[:len(matches)-1]
		response["matches"] = matches
		if cloudAgentSkillSearchResponseFits(response) {
			return response
		}
	}
	// keyword 是回显字段，极端超长输入下先舍弃它，再对最后一条做最小化。
	delete(response, "keyword")
	if cloudAgentSkillSearchResponseFits(response) {
		return response
	}
	for _, match := range matches {
		delete(match, "cards")
		delete(match, "snippet")
	}
	if cloudAgentSkillSearchResponseFits(response) {
		return response
	}
	response["matches"] = []map[string]any{}
	return response
}

// cloudAgentSkillPoolForSearch 取本轮可读技能的检索视图：只保留仍已安装、版本与建 run 时一致的技能，
// 文件清单按冻结版本读取（不含正文）。用户在运行中卸载或更新的技能本轮不再出现在检索结果里。
func (s *Service) cloudAgentSkillPoolForSearch(userID string, state *cloudAgentRuntime) ([]cloudAgentSkill, error) {
	if err := s.RequireSkillAccess(userID); err != nil {
		return nil, err
	}
	if state == nil || len(state.SkillVersions) == 0 {
		return []cloudAgentSkill{}, nil
	}
	ids := make([]string, 0, len(state.SkillVersions))
	for id := range state.SkillVersions {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	entries, err := s.skillDomain().AgentSkillCatalogByIDs(userID, ids)
	if err != nil {
		return nil, err
	}
	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].Name != entries[j].Name {
			return entries[i].Name < entries[j].Name
		}
		return entries[i].SkillID < entries[j].SkillID
	})
	versionIDs := make([]string, 0, len(entries))
	usable := entries[:0]
	for _, entry := range entries {
		if entry.Installed && entry.VersionID == state.SkillVersions[entry.SkillID] {
			usable = append(usable, entry)
			versionIDs = append(versionIDs, entry.VersionID)
		}
	}
	paths, err := s.skillDomain().SkillVersionTextPaths(versionIDs)
	if err != nil {
		return nil, err
	}
	pool := make([]cloudAgentSkill, 0, len(usable))
	for _, entry := range usable {
		files := map[string]string{cloudAgentSkillEntryPath: ""}
		for _, path := range paths[entry.VersionID] {
			files[path] = ""
		}
		pool = append(pool, cloudAgentSkill{ID: entry.SkillID, Name: entry.Name, Description: entry.Description, Version: entry.VersionID, Hash: entry.ContentHash, Files: files})
	}
	return pool, nil
}

// Fresh reads and cache replays share the same installed-skill and frozen-version boundary.
func (s *Service) cloudAgentSkillForRead(userID string, state *cloudAgentRuntime, id string) (*SkillItem, error) {
	id = strings.TrimSpace(id)
	version := ""
	if state != nil {
		version = state.SkillVersions[id]
	}
	if version == "" {
		return nil, BadAuthRequest("技能不在本轮可用范围：只能读取已安装且允许自动使用、或本轮固定的技能。可用 skill_search 找到 skillId")
	}
	detail, err := s.SkillDetail(userID, id)
	if err != nil {
		return nil, err
	}
	if !detail.IsAdded || detail.Status != 1 {
		return nil, BadAuthRequest("技能已被卸载或停用，本轮不能再读取")
	}
	if detail.VersionID != version {
		return nil, creationConflict("技能在本轮开始后更新了；为避免混读两个版本，本轮不再读取它，下一条消息会使用新版本")
	}
	return detail, nil
}

// cloudAgentReadSkillFile 读取本轮可读技能的文件。版本以建 run 时冻结的为准：技能在运行中更新后
// 本轮不再读取，避免把同一技能两个版本的内容混在一起。读取成功会计入技能使用次数，用于目录排序。
func (s *Service) cloudAgentReadSkillFile(userID string, state *cloudAgentRuntime, args agenttool.SkillReadArgs) (any, error) {
	detail, err := s.cloudAgentSkillForRead(userID, state, args.SkillID)
	if err != nil {
		return nil, err
	}
	id, version := detail.SkillID, detail.VersionID
	paths, err := s.skillDomain().SkillVersionTextPaths([]string{version})
	if err != nil {
		return nil, err
	}
	files := []string{cloudAgentSkillEntryPath}
	for _, path := range paths[version] {
		if path != cloudAgentSkillEntryPath {
			files = append(files, path)
		}
	}
	if args.Path == "" {
		return map[string]any{"skillId": id, "skillName": detail.SkillName, "version": version, "entryPath": cloudAgentSkillEntryPath, "files": files,
			"guidance": "先读取 SKILL.md，再只读取入口明确引用且当前任务需要的参考文件。只能读取 files 中列出的路径；不要重复列目录或猜测路径"}, nil
	}
	content := detail.Instruction
	if args.Path != cloudAgentSkillEntryPath {
		if !slices.Contains(files, args.Path) {
			shown := files
			if len(shown) > 40 {
				shown = shown[:40]
			}
			return nil, BadAuthRequest(fmt.Sprintf("技能里没有这个可读文件；可读路径：%s。不要猜路径", strings.Join(shown, ", ")))
		}
		file, err := s.SkillPackageFile(userID, id, args.Path)
		if err != nil {
			return nil, err
		}
		if file.Binary {
			return nil, BadAuthRequest("不支持读取二进制技能文件")
		}
		latest, err := s.SkillDetail(userID, id)
		if err != nil {
			return nil, err
		}
		if !latest.IsAdded || latest.Status != 1 || latest.VersionID != version {
			return nil, creationConflict("技能在读取过程中更新或被卸载，本轮不再读取它")
		}
		content = file.Content
	}
	page, err := cloudAgentSkillPage(version, args.Path, content, args.Offset)
	if err != nil {
		return nil, err
	}
	if fields, ok := page.(map[string]any); ok {
		fields["skillId"], fields["skillName"] = id, detail.SkillName
	}
	if err := s.skillDomain().RecordSkillAgentUse(userID, []string{id}); err != nil {
		log.Printf("agent skill usage record: %v", err)
	}
	return page, nil
}
