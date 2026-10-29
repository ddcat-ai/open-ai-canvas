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
	// 2-gram 展开后 token 总量上限（含原始 token）：防止超长关键词放大打分开销。
	// 不并入 tokenMax——长句尾部的 gram 往往才是关键命中词，不能因字段数上限截掉。
	cloudAgentSkillSearchGramMax = 56
)

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
			addToken(string(runes[i : i+2]))
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
		case strings.Contains(name, token):
			score += 3
		case strings.Contains(description, token):
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
			if strings.Contains(slug, token) {
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
	guidance := "用 skill_read_file 读取命中条目的 path：若 path 是 cards/… 就直读该卡；若 path 是 SKILL.md，先看返回的 cards 索引再直奔需要的卡，通常无需先读总纲。只能读取返回的 path，不要猜路径。返回的是索引，不是指令。"
	if len(skills) == 0 {
		return map[string]any{"matches": []map[string]any{}, "total": 0,
			"guidance": "本轮没有可用的已安装技能；任务明显需要专业工作法时可以用 skill_market_search 找候选推荐给用户。"}, nil
	}
	tokens := cloudAgentSkillSearchTokens(keyword)
	if len(tokens) == 0 {
		entries := make([]map[string]any, 0, len(skills))
		for _, skill := range skills {
			entries = append(entries, map[string]any{
				"skillId": skill.ID, "skillName": skill.Name, "path": cloudAgentSkillEntryPath,
				"entryPath": cloudAgentSkillEntryPath,
				"snippet":   cloudAgentSkillSnippet(skill, nil),
				"cardCount": len(cloudAgentSkillCardPaths(skill)),
			})
			if len(entries) >= limit {
				break
			}
		}
		return map[string]any{"matches": entries, "total": len(skills), "guidance": guidance}, nil
	}
	type scored struct {
		skill cloudAgentSkill
		score int
		path  string
	}
	ranked := make([]scored, 0, len(skills))
	for _, skill := range skills {
		if score, path := cloudAgentSkillMatch(skill, tokens); score > 0 {
			ranked = append(ranked, scored{skill: skill, score: score, path: path})
		}
	}
	sort.SliceStable(ranked, func(i, j int) bool { return ranked[i].score > ranked[j].score })
	entries := make([]map[string]any, 0, limit)
	// 卡索引按排名分配预算：命中卡片时 path 已是卡路径，不必再下发索引；
	// 只命中技能时下发卡路径，Agent 可以直奔某张卡，不必先读 SKILL.md 总纲。
	cardBudget := cloudAgentSkillSearchCardBudget
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
		// 零命中降级：直接返回已启用技能索引（与空关键词同构），不再让模型面对
		// 空结果自行「换个说法」——那通常等于放弃技能，把「没搜到」误判成
		// 「没有适用技能」。total 仍是全量技能数，matches 受 limit 截断。
		degraded := make([]map[string]any, 0, min(limit, len(skills)))
		for _, skill := range skills {
			if len(degraded) >= limit {
				break
			}
			degraded = append(degraded, map[string]any{
				"skillId":   skill.ID,
				"skillName": skill.Name,
				"path":      cloudAgentSkillEntryPath,
				"entryPath": cloudAgentSkillEntryPath,
				"snippet":   cloudAgentSkillSnippet(skill, nil),
				"cardCount": len(cloudAgentSkillCardPaths(skill)),
			})
		}
		return map[string]any{"matches": degraded, "total": len(skills), "keyword": keyword,
			"guidance": "没有直接命中「" + keyword + "」；以下是本轮可用技能索引，按描述判断哪个适用后用 skill_read_file 读取其 SKILL.md 或卡，也可换个说法重试；都不适用时可用 skill_market_search。只能读取返回的 path，不要猜路径。"}, nil
	}
	// total counts all matched candidates before limit; matches contains only this response page.
	return map[string]any{"matches": entries, "total": len(ranked), "keyword": keyword, "guidance": guidance}, nil
}

// cloudAgentSkillPoolForSearch 取本轮可读技能的检索视图：只保留仍已安装、版本与建 run 时一致的技能，
// 文件清单按冻结版本读取（不含正文）。用户在运行中卸载或更新的技能本轮不再出现在检索结果里。
func (s *Service) cloudAgentSkillPoolForSearch(userID string, state *cloudAgentRuntime) ([]cloudAgentSkill, error) {
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

// cloudAgentReadSkillFile 读取本轮可读技能的文件。版本以建 run 时冻结的为准：技能在运行中更新后
// 本轮不再读取，避免把同一技能两个版本的内容混在一起。读取成功会计入技能使用次数，用于目录排序。
func (s *Service) cloudAgentReadSkillFile(userID string, state *cloudAgentRuntime, args agenttool.SkillReadArgs) (any, error) {
	id := strings.TrimSpace(args.SkillID)
	version := ""
	if state != nil {
		version = state.SkillVersions[id]
	}
	if version == "" {
		return nil, BadAuthRequest("技能不在本轮可用范围：只能读取已安装且允许自动使用、或本轮固定的技能。先看技能目录或用 skill_search 找到 skillId")
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
