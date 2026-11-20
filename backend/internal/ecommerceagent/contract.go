package ecommerceagent

import (
	"fmt"
	"html"
	"math"
	"net/url"
	"regexp"
	"strings"
)

type FileInfo struct {
	URL string `json:"url"`
}
type Brand struct {
	BrandName   string `json:"brandName"`
	StyleDesc   string `json:"styleDesc"`
	ThemeColors string `json:"themeColors"`
}
type Request struct {
	FileInfoList             []FileInfo `json:"fileInfoList"`
	Query                    string     `json:"query"`
	Platform                 string     `json:"platform"`
	Language                 string     `json:"language"`
	PanelType                string     `json:"panelType"`
	GenerateType             int        `json:"generateType"`
	ImageCount               int        `json:"imageCount"`
	AspectRatio              string     `json:"aspectRatio"`
	SelectedRecommendationID string     `json:"selectedRecommendationId"`
	ModelKey                 string     `json:"modelKey"`
	Channel                  string     `json:"channel"`
	NeedText                 *bool      `json:"needText"`
	UserSellingPoints        string     `json:"userSellingPoints"`
	Brand                    Brand      `json:"brand"`
	ProjectID                string     `json:"projectId"`
	IdempotencyKey           string     `json:"idempotencyKey"`
}
type Brief struct {
	Category    string   `json:"category"`
	Confidence  float64  `json:"confidence"`
	Material    []string `json:"material"`
	Structure   []string `json:"structure"`
	Colorway    []string `json:"colorway"`
	Surface     string   `json:"surface"`
	Craft       []string `json:"craft"`
	KeywordsZh  []string `json:"keywordsZh"`
	KeywordsEn  []string `json:"keywordsEn"`
	TargetUser  string   `json:"targetUser"`
	UsageScenes []string `json:"usageScenes"`
	PainPoints  []string `json:"painPoints"`
	VisualRisks []string `json:"visualRisks"`
	TextOnImage string   `json:"textOnImage"`
	// SellingPoints are short visible selling points observed by the fast
	// directions stage; planning turns them into copy when the user wrote none.
	SellingPoints []string `json:"sellingPoints,omitempty"`
}
type Recommendation struct {
	ID            string        `json:"id"`
	Label         string        `json:"label"`
	Style         string        `json:"style"`
	Why           string        `json:"why"`
	AspectRatio   string        `json:"aspectRatio"`
	Pages         int           `json:"pages"`
	NeedText      bool          `json:"needText"`
	PreviewPrompt string        `json:"previewPrompt"`
	VisualSystem  *VisualSystem `json:"visualSystem,omitempty"`
}
type Style struct {
	Name string `json:"name"`
	Desc string `json:"desc"`
}
type Analysis struct {
	Brief           Brief            `json:"brief"`
	Recommendations []Recommendation `json:"recommendations"`
	StyleLibrary    []Style          `json:"styleLibrary"`
}
type Page struct {
	Index          int      `json:"index"`
	Role           string   `json:"role"`
	Title          string   `json:"title"`
	Goal           string   `json:"goal,omitempty"`
	Shot           string   `json:"shot,omitempty"`
	TextZone       string   `json:"textZone,omitempty"`
	MustShow       []string `json:"mustShow,omitempty"`
	Avoid          []string `json:"avoid,omitempty"`
	Headline       string   `json:"headline,omitempty"`
	Subline        string   `json:"subline,omitempty"`
	Bullets        []string `json:"bullets,omitempty"`
	URL            string   `json:"url"`
	Error          string   `json:"error"`
	AspectRatio    string   `json:"aspectRatio"`
	NeedText       bool     `json:"needText"`
	Prompt         string   `json:"prompt,omitempty"`
	ImagePrompt    string   `json:"imagePrompt,omitempty"`
	NegativePrompt string   `json:"negativePrompt,omitempty"`
}
type CanvasObject struct {
	Type       string  `json:"type"`
	Name       string  `json:"name"`
	Src        string  `json:"src,omitempty"`
	Text       string  `json:"text,omitempty"`
	Left       int     `json:"left"`
	Top        int     `json:"top"`
	Width      int     `json:"width,omitempty"`
	Height     int     `json:"height,omitempty"`
	FontSize   int     `json:"fontSize,omitempty"`
	Fill       string  `json:"fill,omitempty"`
	Opacity    float64 `json:"opacity,omitempty"`
	FontFamily string  `json:"fontFamily,omitempty"`
	OriginX    string  `json:"originX,omitempty"`
	OriginY    string  `json:"originY,omitempty"`
	Selectable *bool   `json:"selectable,omitempty"`
	Editable   bool    `json:"editable,omitempty"`
}
type PosterCanvas struct {
	Version        string         `json:"version"`
	CanvasProtocol string         `json:"canvasProtocol"`
	Width          int            `json:"width"`
	Height         int            `json:"height"`
	Background     string         `json:"background"`
	Objects        []CanvasObject `json:"objects"`
	Meta           map[string]any `json:"meta"`
}
type Event struct {
	Event          string `json:"event"`
	TaskID         string `json:"task_id,omitempty"`
	ConversationID string `json:"conversation_id,omitempty"`
	Answer         string `json:"answer,omitempty"`
	Data           any    `json:"data,omitempty"`
}

type Platform struct {
	Label            string
	MainSize         [2]int
	Ratio            string
	ProductOccupancy float64
	TitleMax         int
	BulletMax        int
	AplusSize        [2]int
	DetailRatio      string
	WhiteBG          bool
	ForbidTextOnMain bool
	Tone             string
	Rules            []string
}

var Platforms = map[string]Platform{
	"淘宝":          {Label: "淘宝 / 天猫", MainSize: [2]int{800, 800}, Ratio: "1:1", ProductOccupancy: .7, WhiteBG: false, ForbidTextOnMain: false, TitleMax: 60, BulletMax: 6, AplusSize: [2]int{750, 1000}, DetailRatio: "3:4", Tone: "卖点前置、利益点密集、可带促销角标与价格锚点", Rules: []string{"首图可带促销角标（满减/包邮/限时），但不得遮挡商品主体", "避免深色压抑背景，移动端小图要一眼看清主体", "不得使用\"国家级\"\"最高级\"\"第一\"等极限词", "不得虚构原价、销量、评价"}},
	"1688":        {Label: "1688 批发", MainSize: [2]int{800, 800}, Ratio: "1:1", ProductOccupancy: .75, WhiteBG: false, ForbidTextOnMain: false, TitleMax: 60, BulletMax: 6, AplusSize: [2]int{750, 1000}, DetailRatio: "3:4", Tone: "批发导向：起订量、单价阶梯、供货能力、工厂实力", Rules: []string{"突出起订量与阶梯价", "可带工厂/产线元素", "不得虚构产能与认证"}},
	"拼多多":         {Label: "拼多多", MainSize: [2]int{800, 800}, Ratio: "1:1", ProductOccupancy: .8, WhiteBG: true, ForbidTextOnMain: true, TitleMax: 60, BulletMax: 5, AplusSize: [2]int{750, 1000}, DetailRatio: "3:4", Tone: "极致性价比、直给卖点、价格锚点强", Rules: []string{"首图纯白底无文字", "强调性价比与包邮", "避免品牌侵权元素"}},
	"Amazon":      {Label: "Amazon 亚马逊", MainSize: [2]int{2000, 2000}, Ratio: "1:1", ProductOccupancy: .85, WhiteBG: true, ForbidTextOnMain: true, TitleMax: 200, BulletMax: 5, AplusSize: [2]int{970, 600}, DetailRatio: "1:1", Tone: "功能导向、参数清晰、克制专业，突出可量化卖点", Rules: []string{"主图必须纯白背景 RGB(255,255,255)，不得出现水印、Logo、边框、文字、促销标", "商品需占画面 85% 以上，展示完整商品，不得裁切", "附图可使用场景图、尺寸图、对比图、细节图，可带少量说明文字", "禁止出现 Best Seller / No.1 / FDA Approved 等未授权宣称"}},
	"Temu":        {Label: "Temu 跨境", MainSize: [2]int{1600, 1600}, Ratio: "1:1", ProductOccupancy: .8, WhiteBG: true, ForbidTextOnMain: true, TitleMax: 120, BulletMax: 5, AplusSize: [2]int{1200, 1200}, DetailRatio: "1:1", Tone: "极致性价比、直给卖点", Rules: []string{"首图纯白底无文字", "强调低价包邮", "避免品牌侵权元素"}},
	"Shopee":      {Label: "Shopee 虾皮", MainSize: [2]int{1024, 1024}, Ratio: "1:1", ProductOccupancy: .7, WhiteBG: false, ForbidTextOnMain: false, TitleMax: 120, BulletMax: 6, AplusSize: [2]int{1024, 1024}, DetailRatio: "1:1", Tone: "东南亚风格：明快高饱和、活泼、带促销角标", Rules: []string{"首图可带促销角标", "色彩明亮适合移动端小图", "避免深色压抑背景"}},
	"TikTok Shop": {Label: "TikTok Shop", MainSize: [2]int{1080, 1920}, Ratio: "9:16", ProductOccupancy: .6, WhiteBG: false, ForbidTextOnMain: false, TitleMax: 60, BulletMax: 4, AplusSize: [2]int{1080, 1920}, DetailRatio: "9:16", Tone: "短视频封面感：强视觉冲击、大字钩子、人物出镜", Rules: []string{"9:16 竖版优先", "必须有 3 秒可读的核心钩子大字", "避免硬广感，要像内容不像广告"}},
	"AliExpress":  {Label: "AliExpress 速卖通", MainSize: [2]int{1000, 1000}, Ratio: "1:1", ProductOccupancy: .8, WhiteBG: true, ForbidTextOnMain: true, TitleMax: 128, BulletMax: 5, AplusSize: [2]int{970, 600}, DetailRatio: "1:1", Tone: "国际通用、参数表格式、卖点条列", Rules: []string{"主图白底", "附图适合参数对照表", "文案避免文化专属梗"}},
	"OZON":        {Label: "OZON", MainSize: [2]int{1200, 1600}, Ratio: "3:4", ProductOccupancy: .75, WhiteBG: true, ForbidTextOnMain: true, TitleMax: 200, BulletMax: 6, AplusSize: [2]int{1200, 1600}, DetailRatio: "3:4", Tone: "俄语市场：参数详尽、规格表、耐用性强调", Rules: []string{"3:4 竖版", "俄语长单词需留字号余量", "强调耐寒、用料、保修"}},
}

func PlatformFor(name string) (Platform, bool) {
	p, legacy := Platforms[name]
	k, known := PlatformKnowledgeFor(name)
	if !known {
		return p, legacy
	}
	if !legacy {
		legacyName := map[string]string{"taobao": "淘宝", "tmall": "淘宝", "1688": "1688", "pdd": "拼多多", "amazon": "Amazon", "temu": "Temu", "shopee": "Shopee", "tiktok": "TikTok Shop", "aliexpress": "AliExpress", "ozon": "OZON"}[k.ID]
		p, legacy = Platforms[legacyName]
	}
	if !legacy {
		p = Platform{Label: k.Label, Ratio: k.RecommendedRatio, DetailRatio: k.RecommendedRatio, TitleMax: 120, BulletMax: 5}
	}
	p.Label = k.Label
	p.WhiteBG, p.ForbidTextOnMain = k.WhiteMain, k.MainNoText || k.AllListingNoText
	p.Tone = k.Style
	// Legacy marketing defaults (e.g. TikTok video covers) are not listing rules.
	p.Rules = []string{PlatformKnowledgePrompt(k.ID, "", "set", "")}
	if k.ID == "tiktok" {
		p.Ratio, p.DetailRatio = "1:1", "1:1"
	}
	return p, true
}

func MockBrief(query string) Brief {
	category := "待确认商品"
	for _, item := range []struct{ re, cat string }{{"行李箱|箱包|拉杆箱|luggage", "行李箱"}, {"耳机|earbud|headphone", "耳机"}, {"猫|狗|宠物|pet", "宠物用品"}, {"杯|壶|mug|bottle", "杯壶"}, {"衣服|服装|服饰|cloth|dress", "服饰"}, {"灯|lamp|light", "灯具"}} {
		if regexp.MustCompile("(?i)" + item.re).MatchString(query) {
			category = item.cat
			break
		}
	}
	return Brief{Category: category, Confidence: 0, Material: []string{}, Structure: []string{}, Colorway: []string{}, Surface: "未知", Craft: []string{}, KeywordsZh: []string{category}, KeywordsEn: []string{}, TargetUser: "待卖家确认", UsageScenes: []string{}, PainPoints: []string{}, VisualRisks: []string{"mock 模式未查看图片；材质、结构、性能和商业卖点均待确认"}, TextOnImage: ""}
}

func Recommend(b Brief, p Platform, count int) []Recommendation {
	anchor := "same product as reference image, identical shape/color/logo placement"
	cat := b.Category
	if cat == "" {
		cat = "商品"
	}
	type idea struct {
		label, style, why, ratio string
		text                     bool
	}
	ideas := []idea{
		{"白底合规主图", "纯白无缝背景 · 均匀影棚光 · 平视全貌 · 中性白平衡", "完整展示商品且符合首图规则", p.Ratio, false},
		{"核心卖点特写", "干净背景 · 侧向柔光 · 45 度近景 · 克制配色", "展示可见结构，不添加未证实参数", p.DetailRatio, true},
		{"真实使用场景", "生活化环境 · 自然光 · 平视中景 · 温和色调", "帮助买家理解使用情境", p.DetailRatio, false},
		{"工艺细节观察", "低干扰背景 · 侧光 · 微距 · 中性色", "让买家查看图片中可见的细节", p.DetailRatio, false},
		{"多角度产品套图", "一致背景 · 均匀光线 · 多角度机位 · 统一色彩", "从不同方向交代商品外观", p.DetailRatio, true},
	}
	if !p.ForbidTextOnMain {
		ideas[0] = idea{"完整商品首图", "简洁背景 · 影棚柔光 · 平视全貌 · 清晰配色", "移动端清楚展示完整商品", p.Ratio, false}
	}
	if strings.Contains(cat, "服") {
		ideas[3] = idea{"面料纹理细节", "简洁背景 · 柔侧光 · 面料微距 · 真实色彩", "展示可见纹理和缝线", p.DetailRatio, false}
	}
	if strings.Contains(cat, "行李") {
		ideas[3] = idea{"轮组与拉杆细节", "简洁背景 · 侧光 · 轮组近景 · 中性色", "展示可见轮组与拉杆结构", p.DetailRatio, false}
	}
	_ = count
	out := make([]Recommendation, 0, len(ideas))
	for i, v := range ideas {
		out = append(out, Recommendation{ID: fmt.Sprintf("r%d", i+1), Label: v.label, Style: v.style, Why: v.why, AspectRatio: v.ratio, Pages: 1, NeedText: v.text, PreviewPrompt: fmt.Sprintf("%s, %s, %s, clean commercial product photography, faithful visible details, no invented claims, no text, no watermark", anchor, cat, v.style)})
	}
	return out
}

func Plan(count, generateType int, platform Platform, selected *Recommendation, brief Brief) []Page {
	blueprint := []Page{
		{Role: "hero", Title: "主图 / 首图", Goal: "3 秒内让人知道这是什么、长什么样", Shot: "eye-level full product, centered", TextZone: "none", MustShow: []string{"完整商品全貌", "真实颜色与比例"}, Avoid: []string{"裁切", "道具抢戏", "任何文字"}},
		{Role: "selling", Title: "核心卖点一图流", Goal: "把最大卖点用一句话+一个画面说清", Shot: "45-degree three-quarter, shallow depth of field", TextZone: "left", MustShow: []string{"最大卖点的视觉证据"}, Avoid: []string{"堆叠3个以上卖点"}, NeedText: true},
		{Role: "scene", Title: "使用场景图", Goal: "让买家代入使用画面", Shot: "wide environmental shot, eye level", TextZone: "bottom", MustShow: []string{"真实使用环境", "人在使用中或刚使用完"}, Avoid: []string{"空荡无生活痕迹的样板间"}},
		{Role: "detail", Title: "细节质感图", Goal: "微距展示可见材质、工艺、做工", Shot: "macro close-up, hard side light", TextZone: "right", MustShow: []string{"照片可见的材质纹理"}, Avoid: []string{"过度磨皮失真的假质感"}},
		{Role: "dimension", Title: "尺寸规格图", Goal: "标清已确认的尺寸与型号", Shot: "flat overhead, technical orthographic feel", TextZone: "right", MustShow: []string{"完整商品+可标注的尺寸基准点"}, Avoid: []string{"透视夸张导致尺寸失真", "未经确认的尺寸数字"}, NeedText: true},
		{Role: "compare", Title: "对比图 / 痛点图", Goal: "同类方案与商品的可见外观对照", Shot: "split-frame symmetric, identical lighting both sides", TextZone: "top", MustShow: []string{"左右两侧同一机位同一光线"}, Avoid: []string{"未经证实的性能对比"}, NeedText: true},
		{Role: "package", Title: "包装清单图", Goal: "只展示卖家已确认的包装内容", Shot: "flat lay knolling, overhead", TextZone: "bottom", MustShow: []string{"已确认配件平铺"}, Avoid: []string{"虚构配件", "配件重叠遮挡"}, NeedText: true},
		{Role: "trust", Title: "信任背书图", Goal: "展示可核实的商品信息", Shot: "clean studio, soft top light", TextZone: "bottom", MustShow: []string{"商品真实细节"}, Avoid: []string{"伪造证书编号", "未授权的官方标志"}, NeedText: true},
		{Role: "aplus1", Title: "A+ 首屏情绪图", Goal: "A+ 首屏情绪图，无文字或极少文字", Shot: "cinematic wide, atmospheric", TextZone: "none", MustShow: []string{"品牌情绪与场景氛围"}, Avoid: []string{"任何卖点文字"}},
		{Role: "aplus2", Title: "A+ 卖点模块", Goal: "A+ 三栏已确认卖点对照", Shot: "three-panel grid, consistent camera per panel", TextZone: "bottom", MustShow: []string{"三个模块机位风格统一"}, Avoid: []string{"三格风格割裂"}, NeedText: true},
		{Role: "aplus3", Title: "A+ 品牌模块", Goal: "品牌调性收尾图", Shot: "minimal studio with brand color gradient", TextZone: "none", MustShow: []string{"品牌色与品牌气质"}, Avoid: []string{"堆叠产品参数"}},
		{Role: "lifestyle", Title: "生活方式图", Goal: "目标人群生活方式氛围", Shot: "candid documentary style, natural light", TextZone: "bottom", MustShow: []string{"目标人群的生活切片"}, Avoid: []string{"摆拍感过强的假笑"}},
		{Role: "gift", Title: "送礼场景图", Goal: "节日氛围与商品呈现", Shot: "warm close shot with bokeh lights", TextZone: "bottom", MustShow: []string{"节日氛围与商品"}, Avoid: []string{"虚构礼盒配件", "节日元素压过商品"}},
		{Role: "closeup", Title: "材质特写图", Goal: "更细的可见工艺特写", Shot: "extreme macro, raking light", TextZone: "right", MustShow: []string{"可见纹理与边缘处理"}, Avoid: []string{"过度锐化出现白边"}},
		{Role: "banner", Title: "促销 Banner", Goal: "活动画面留白，价格由卖家确认", Shot: "product on brand color background, centered", TextZone: "top", MustShow: []string{"商品主体+留白给利益点"}, Avoid: []string{"把价格写进图像模型"}, NeedText: true},
	}
	switch generateType {
	case 100, 101:
		count = 1
		if generateType == 100 {
			blueprint[0].Title = "单图"
		}
	case 102:
		count = 5
	case 103:
		if count < 5 {
			count = 5
		}
		if count > 9 {
			count = 9
		}
	case 400:
		poster := []Page{blueprint[0], blueprint[1], blueprint[14], blueprint[11]}
		blueprint = poster
		if count > 4 {
			count = 4
		}
		if count < 1 {
			count = 1
		}
	default:
		if count < 5 {
			count = 5
		}
		if count > 15 {
			count = 15
		}
	}
	out := make([]Page, 0, count)
	for i := 0; i < count; i++ {
		page := blueprint[i]
		page.Index = i + 1
		page.AspectRatio = platform.DetailRatio
		if page.Role == "hero" {
			page.AspectRatio = platform.Ratio
		}
		if strings.HasPrefix(page.Role, "aplus") {
			if platform.Ratio == "9:16" {
				page.AspectRatio = "9:16"
			} else {
				page.AspectRatio = "1:1"
			}
		}
		if page.Role == "banner" {
			page.AspectRatio = "16:9"
		}
		if selected != nil && i > 0 && selected.AspectRatio != "" {
			page.AspectRatio = selected.AspectRatio
		}
		if page.Role == "hero" && platform.ForbidTextOnMain {
			page.NeedText = false
		}
		if selected != nil && !selected.NeedText {
			page.NeedText = false
		}
		if page.NeedText {
			page.Headline = "A closer look"
			page.Subline = "Explore visible details"
		}
		out = append(out, page)
	}
	_ = brief
	return out
}

// ApplyTextPreference keeps editable canvas copy in the requested language and
// honors an explicit no-text choice without changing the default page plan.
func ApplyTextPreference(pages []Page, needText *bool, language string) {
	chinese := strings.Contains(language, "中文") || strings.EqualFold(language, "zh") || strings.HasPrefix(strings.ToLower(language), "zh-")
	for i := range pages {
		if needText != nil && !*needText {
			pages[i].NeedText = false
			pages[i].Headline = ""
			pages[i].Subline = ""
			pages[i].Bullets = nil
			continue
		}
		if pages[i].NeedText && chinese {
			pages[i].Headline = "细节展示"
			pages[i].Subline = "查看商品可见细节"
		}
	}
}

func BuildCanvas(pages []Page, platform Platform) PosterCanvas {
	const width = 1200
	objects := make([]CanvasObject, 0, len(pages)*6)
	y := 0
	success := 0
	for _, p := range pages {
		parts := strings.Split(p.AspectRatio, ":")
		w, h := 1.0, 1.0
		if len(parts) == 2 {
			fmt.Sscan(parts[0], &w)
			fmt.Sscan(parts[1], &h)
		}
		if w <= 0 || h <= 0 {
			w, h = 1, 1
		}
		height := int(math.Round(float64(width) * h / w))
		objects = append(objects, CanvasObject{Type: "rect", Name: fmt.Sprintf("pageBg_%d", p.Index), Left: 0, Top: y, Width: width, Height: height, Fill: "#ffffff"})
		if p.URL != "" {
			objects = append(objects, CanvasObject{Type: "image", Name: fmt.Sprintf("pageImage_%d", p.Index), Src: p.URL, Left: 0, Top: y, Width: width, Height: height})
			success++
			if p.NeedText && !(p.Role == "hero" && platform.ForbidTextOnMain) && p.Headline != "" {
				textTop := y + height*2/3
				objects = append(objects, CanvasObject{Type: "rect", Name: fmt.Sprintf("scrim_%d", p.Index), Left: 0, Top: textTop - 56, Width: width, Height: height - (textTop - y) + 56, Fill: "#000000", Opacity: .34, Selectable: boolPointer(false)})
				font := "PingFang SC, Microsoft YaHei, sans-serif"
				objects = append(objects, CanvasObject{Type: "i-text", Name: fmt.Sprintf("headline_%d", p.Index), Text: p.Headline, Left: 56, Top: textTop, FontSize: 52, FontFamily: font, Fill: "#ffffff", OriginX: "left", OriginY: "top", Selectable: boolPointer(true), Editable: true})
				textTop += 76
				if p.Subline != "" {
					objects = append(objects, CanvasObject{Type: "i-text", Name: fmt.Sprintf("subline_%d", p.Index), Text: p.Subline, Left: 56, Top: textTop, FontSize: 32, FontFamily: font, Fill: "#ffffff", OriginX: "left", OriginY: "top", Selectable: boolPointer(true), Editable: true})
					textTop += 52
				}
				for i, bullet := range p.Bullets {
					if i >= 3 || strings.TrimSpace(bullet) == "" || textTop+36 > y+height-24 {
						break
					}
					objects = append(objects, CanvasObject{Type: "i-text", Name: fmt.Sprintf("bullet_%d_%d", p.Index, i+1), Text: bullet, Left: 56, Top: textTop, FontSize: 26, FontFamily: font, Fill: "#ffffff", OriginX: "left", OriginY: "top", Selectable: boolPointer(true), Editable: true})
					textTop += 42
				}
			}
		}
		y += height + 24
	}
	return PosterCanvas{Version: "6.0.0", CanvasProtocol: "SNAPSHOT", Width: width, Height: y, Background: "#f5f6f8", Objects: objects, Meta: map[string]any{"platform": platform.Label, "pageCount": len(pages), "successPages": success}}
}

func boolPointer(value bool) *bool { return &value }

func Placeholder(count int, ratio string) PosterCanvas {
	pages := make([]Page, count)
	for i := range pages {
		pages[i] = Page{Index: i + 1, AspectRatio: ratio}
	}
	c := BuildCanvas(pages, Platform{Label: "占位", Ratio: ratio, DetailRatio: ratio})
	for i := range c.Objects {
		c.Objects[i].Fill = "#e5e7eb"
	}
	return c
}

func MockImage(page Page, category string) string {
	label := html.EscapeString(fmt.Sprintf("%s · %s · MOCK", category, page.Title))
	svg := fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#f1f5f9"/><rect x="120" y="120" width="784" height="784" fill="#e2e8f0" stroke="#94a3b8" stroke-width="3"/><text x="512" y="512" text-anchor="middle" fill="#334155" font-size="35">%s</text></svg>`, label)
	return "data:image/svg+xml," + url.PathEscape(svg)
}
