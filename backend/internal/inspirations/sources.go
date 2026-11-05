package inspirations

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"

	"yingce/backend/internal/model"
)

// 解析规则与 web/scripts/import-inspirations.mjs 保持一致，两边生成的条目 ID 必须相同，前端才能去重。
const (
	githubRaw    = "https://raw.githubusercontent.com/"
	seedanceRepo = "LearnPrompt/awesome-seedance"

	maxCasesBytes    int64 = 32 << 20
	maxTaxonomyBytes int64 = 4 << 20
	maxReadmeBytes   int64 = 8 << 20

	// 卡片描述最多两行，完整内容仍在正文里。
	descriptionLimit = 44
	titleLimit       = 120
	creditLimit      = 120
	maxIDLength      = 200
	maxURLLength     = 1000
	maxTags          = 6
	tagLimit         = 40
)

var youmindRepos = []string{
	"YouMind-OpenLab/awesome-nano-banana-pro-prompts",
	"YouMind-OpenLab/awesome-gpt-image-2",
}

// 封面是影片片头白板的条目，与静态目录导入脚本排除同一批。
var excludedSeedanceSlugs = map[string]bool{
	"seedance-make-a-modern-slick-and-punchy-video-for-a-modern-startup-that-works-on-infere-07ba4673539c": true,
}

var (
	categoryCodePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,79}$`)
	// templateArgument 是 YouMind 提示词里的参数占位，例如 {argument name="主题" default="猫"}。
	templateArgument = regexp.MustCompile(`\{argument name="[^"]*" default="([^"]*)"\}`)
	whitespaceRun    = regexp.MustCompile(`\s+`)

	youmindCategoryLink = regexp.MustCompile(`\[([^\]]+)\]\(https://youmind\.com/[^)]*\?categories=([a-z0-9-]+)\)`)
	youmindBlockSplit   = regexp.MustCompile(`\n### No\. \d+:`)
	youmindPrompt       = regexp.MustCompile(`#### 📝 提示词\s*\n+` + "```" + `[a-z]*\s*\n([\s\S]*?)\n` + "```")
	youmindImage        = regexp.MustCompile(`<img src="(https?:[^"]+)"`)
	youmindDescription  = regexp.MustCompile(`#### 📖 描述\s*\n+([\s\S]*?)\n+#### 📝 提示词`)
	youmindID           = regexp.MustCompile(`youmind\.com/[^)]*\?id=(\d+)`)
	youmindAuthor       = regexp.MustCompile(`- \*\*作者:\*\*\s*\[([^\]]+)\]`)
	youmindSourceURL    = regexp.MustCompile(`- \*\*来源:\*\*\s*\[[^\]]+\]\((https?:[^)]+)\)`)
	youmindPublished    = regexp.MustCompile(`- \*\*发布时间:\*\*\s*(\d{4})年(\d{1,2})月(\d{1,2})日`)
)

type fetchFunc func(ctx context.Context, rawURL string, maxBytes int64) ([]byte, error)

// batch 是一个来源本次解析的结果：upstream 是上游可用条目数，entries 只含正文为中文的条目。
type batch struct {
	upstream   int
	entries    []model.InspirationFeedEntry
	categories map[string]string
}

type source struct {
	id   string
	name string
	load func(ctx context.Context, fetch fetchFunc) (batch, error)
}

func defaultSources() []source {
	return []source{
		{id: "youmind", name: "YouMind", load: loadYoumind},
		{id: "seedance", name: "awesome-seedance", load: loadSeedance},
	}
}

// ── awesome-seedance ────────────────────────────────────────────────────────

type seedanceCase struct {
	Slug              string   `json:"slug"`
	Title             string   `json:"title"`
	Summary           string   `json:"summary"`
	PosterURL         string   `json:"posterUrl"`
	PromptFull        string   `json:"promptFull"`
	Tags              []string `json:"tags"`
	Creator           string   `json:"creator"`
	SourceURL         string   `json:"sourceUrl"`
	SourcePublishedAt string   `json:"sourcePublishedAt"`
}

func loadSeedance(ctx context.Context, fetch fetchFunc) (batch, error) {
	data, err := fetch(ctx, githubRaw+seedanceRepo+"/main/data/cases.json", maxCasesBytes)
	if err != nil {
		return batch{}, err
	}
	cases, err := decodeSeedanceCases(data)
	if err != nil {
		return batch{}, fmt.Errorf("解析 cases.json 失败：%w", err)
	}
	taxonomyData, err := fetch(ctx, githubRaw+seedanceRepo+"/main/data/case-taxonomy.json", maxTaxonomyBytes)
	if err != nil {
		return batch{}, err
	}
	var taxonomy struct {
		Assignments map[string]string `json:"assignments"`
	}
	if err := json.Unmarshal(taxonomyData, &taxonomy); err != nil {
		return batch{}, fmt.Errorf("解析 case-taxonomy.json 失败：%w", err)
	}
	return buildSeedanceBatch(cases, taxonomy.Assignments)
}

func decodeSeedanceCases(data []byte) ([]seedanceCase, error) {
	data = bytes.TrimSpace(data)
	if len(data) > 0 && data[0] == '[' {
		var cases []seedanceCase
		err := json.Unmarshal(data, &cases)
		return cases, err
	}
	var wrapped struct {
		Cases []seedanceCase `json:"cases"`
	}
	err := json.Unmarshal(data, &wrapped)
	return wrapped.Cases, err
}

// buildSeedanceBatch 只收中文标题的条目（与静态目录一致），再从中挑出正文已是中文的。
// 描述只用中文摘要；英文摘要里常混着样板文字，留空后由前端按静态目录的做法补上分类名。
func buildSeedanceBatch(cases []seedanceCase, assignments map[string]string) (batch, error) {
	result := batch{}
	seen := map[string]bool{}
	for _, item := range cases {
		slug := strings.TrimSpace(item.Slug)
		title := strings.TrimSpace(item.Title)
		prompt := strings.TrimSpace(item.PromptFull)
		if slug == "" || strings.TrimSpace(item.PosterURL) == "" || prompt == "" || !hasHan(title) || excludedSeedanceSlugs[slug] {
			continue
		}
		result.upstream++
		image, ok := httpsURL(item.PosterURL)
		id := "seedance:" + slug
		if !ok || len(id) > maxIDLength || seen[id] || !chineseText(prompt) {
			continue
		}
		seen[id] = true
		entry := model.InspirationFeedEntry{
			ID:          id,
			SourceID:    "seedance",
			Mode:        "video",
			Title:       clipText(title, titleLimit),
			Image:       image,
			Prompt:      prompt,
			Category:    categoryCode(assignments[slug]),
			Tags:        cleanTags(item.Tags),
			Credit:      clipText(item.Creator, creditLimit),
			SourceURL:   optionalURL(item.SourceURL),
			PublishedAt: parseTimestamp(item.SourcePublishedAt),
		}
		if hasHan(item.Summary) {
			entry.Description = clipText(item.Summary, descriptionLimit)
		}
		result.entries = append(result.entries, withContentHash(entry))
	}
	if result.upstream == 0 {
		return batch{}, errors.New("cases.json 没有可用条目，上游格式可能已变化")
	}
	return result, nil
}

// ── YouMind 提示词库（nano-banana-pro / gpt-image-2） ──────────────────────

func loadYoumind(ctx context.Context, fetch fetchFunc) (batch, error) {
	result := batch{categories: map[string]string{}}
	seenIDs := map[string]bool{}
	seenTitles := map[string]bool{}
	for _, repo := range youmindRepos {
		data, err := fetch(ctx, githubRaw+repo+"/main/README_zh.md", maxReadmeBytes)
		if err != nil {
			return batch{}, err
		}
		parsed := parseYoumindReadme(string(data))
		if parsed.upstream == 0 {
			return batch{}, fmt.Errorf("%s 的 README_zh.md 没有解析出条目，上游格式可能已变化", repo)
		}
		result.upstream += parsed.upstream
		for _, entry := range parsed.entries {
			// 两个姊妹库偶尔互相转载同一条，按 ID 和标题去重，先出现的为准。
			if seenIDs[entry.ID] || seenTitles[entry.Title] {
				continue
			}
			seenIDs[entry.ID] = true
			seenTitles[entry.Title] = true
			result.entries = append(result.entries, entry)
		}
		maps.Copy(result.categories, parsed.categories)
	}
	return result, nil
}

// parseYoumindReadme 解析脚本生成的 README_zh.md：
//
//	### No. N: <分类标签> - <标题>
//	#### 📖 描述 / #### 📝 提示词（代码块）/ <img src> / #### 📌 详情（作者、来源、发布时间）
//
// 分类标签先按同一文件里「按分类浏览」的链接换成稳定的英文 code。没有站内 ID 的条目无法稳定去重，不收录。
func parseYoumindReadme(markdown string) batch {
	labelToCode := map[string]string{}
	for _, match := range youmindCategoryLink.FindAllStringSubmatch(markdown, -1) {
		labelToCode[strings.TrimSpace(match[1])] = match[2]
	}
	result := batch{categories: make(map[string]string, len(labelToCode))}
	for label, code := range labelToCode {
		result.categories[code] = label
	}
	// Split 至少返回一段：第一段是条目之前的目录与说明。
	for _, block := range youmindBlockSplit.Split(markdown, -1)[1:] {
		heading, _, _ := strings.Cut(block, "\n")
		heading = strings.TrimSpace(heading)
		prompt := strings.TrimSpace(firstSubmatch(youmindPrompt, block))
		rawImage := firstSubmatch(youmindImage, block)
		id := firstSubmatch(youmindID, block)
		if heading == "" || prompt == "" || rawImage == "" || id == "" {
			continue
		}
		// 标题本身可能带 " - "，只有前缀是已知分类时才切开。
		title, category := heading, ""
		if prefix, rest, found := strings.Cut(heading, " - "); found {
			if code, known := labelToCode[strings.TrimSpace(prefix)]; known {
				title, category = strings.TrimSpace(rest), code
			}
		}
		if title == "" {
			continue
		}
		result.upstream++
		image, ok := httpsURL(rawImage)
		if !ok || !chineseText(prompt) {
			continue
		}
		entry := model.InspirationFeedEntry{
			ID:          "youmind:" + id,
			SourceID:    "youmind",
			Mode:        "image",
			Title:       clipText(title, titleLimit),
			Description: clipText(firstSubmatch(youmindDescription, block), descriptionLimit),
			Image:       image,
			Prompt:      prompt,
			Category:    categoryCode(category),
			Credit:      clipText(firstSubmatch(youmindAuthor, block), creditLimit),
			SourceURL:   optionalURL(firstSubmatch(youmindSourceURL, block)),
			PublishedAt: parseChineseDate(youmindPublished.FindStringSubmatch(block)),
		}
		result.entries = append(result.entries, withContentHash(entry))
	}
	return result
}

// ── 字段清洗 ────────────────────────────────────────────────────────────────

// chineseText 判断正文是否已是中文：汉字占字母类字符的三成以上，且至少 8 个汉字。
// 中文提示词常夹杂模型名、参数和英文术语，所以按比例判断，而不是看有没有汉字。
func chineseText(text string) bool {
	text = templateArgument.ReplaceAllString(text, "$1")
	han, latin := 0, 0
	for _, r := range text {
		switch {
		case unicode.Is(unicode.Han, r):
			han++
		case r < unicode.MaxASCII && unicode.IsLetter(r):
			latin++
		}
	}
	return han >= 8 && han*10 >= (han+latin)*3
}

func hasHan(text string) bool {
	for _, r := range text {
		if unicode.Is(unicode.Han, r) {
			return true
		}
	}
	return false
}

// clipText 合并空白后按字符数截断，超出时以省略号结尾。
func clipText(text string, limit int) string {
	text = strings.TrimSpace(whitespaceRun.ReplaceAllString(text, " "))
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return string(runes[:limit-1]) + "…"
}

func cleanTags(tags []string) []string {
	var cleaned []string
	for _, tag := range tags {
		if tag = clipText(tag, tagLimit); tag != "" {
			cleaned = append(cleaned, tag)
		}
		if len(cleaned) == maxTags {
			break
		}
	}
	return cleaned
}

func categoryCode(value string) string {
	value = strings.TrimSpace(value)
	if categoryCodePattern.MatchString(value) {
		return value
	}
	return ""
}

// httpsURL 只接受 https 封面：页面走 HTTPS，混合内容的图片会被浏览器拦下。
func httpsURL(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	parsed, err := url.Parse(raw)
	if err != nil || len(raw) > maxURLLength || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
		return "", false
	}
	return parsed.String(), true
}

// optionalURL 是详情页「原页」链接：只放行 http/https，其他协议（如 javascript:）一律丢弃。
func optionalURL(raw string) string {
	raw = strings.TrimSpace(raw)
	parsed, err := url.Parse(raw)
	if err != nil || len(raw) > maxURLLength || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" || parsed.User != nil {
		return ""
	}
	return parsed.String()
}

func parseTimestamp(value string) *time.Time {
	parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(value))
	if err != nil {
		return nil
	}
	parsed = parsed.UTC()
	return &parsed
}

func parseChineseDate(match []string) *time.Time {
	if len(match) != 4 {
		return nil
	}
	year, _ := strconv.Atoi(match[1])
	month, _ := strconv.Atoi(match[2])
	day, _ := strconv.Atoi(match[3])
	if month < 1 || month > 12 || day < 1 || day > 31 {
		return nil
	}
	date := time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.UTC)
	return &date
}

func firstSubmatch(pattern *regexp.Regexp, text string) string {
	match := pattern.FindStringSubmatch(text)
	if len(match) < 2 {
		return ""
	}
	return strings.TrimSpace(match[1])
}

// withContentHash 记录条目内容的摘要，同步时内容没变就不改写数据库。
func withContentHash(entry model.InspirationFeedEntry) model.InspirationFeedEntry {
	payload, _ := json.Marshal([]any{entry.SourceID, entry.Mode, entry.Title, entry.Description, entry.Image, entry.Prompt, entry.Category, entry.Tags, entry.Credit, entry.SourceURL, entry.PublishedAt})
	digest := sha256.Sum256(payload)
	entry.ContentHash = hex.EncodeToString(digest[:])
	return entry
}
