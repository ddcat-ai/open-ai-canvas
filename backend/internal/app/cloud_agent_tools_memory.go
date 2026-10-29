package app

import (
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const (
	cloudAgentMarketSearchDefault       = 3
	cloudAgentMarketSearchMax           = 5
	cloudAgentMarketSuggestionsMax      = 20
	cloudAgentSkillRecommendMax         = 3
	cloudAgentSkillRecommendPerRun      = 1
	cloudAgentSkillRecommendReasonRunes = 200
)

// cloudAgentMarketSuggestion 记录本轮技能市场检索返回过的候选，skill_recommend 只能推荐其中的技能。
type cloudAgentMarketSuggestion struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Summary string `json:"summary,omitempty"`
	Tag     string `json:"tag,omitempty"`
}

func cloudAgentRuntimeRunID(state *cloudAgentRuntime) string {
	if state == nil {
		return ""
	}
	if state.RuntimeRunID != "" {
		return state.RuntimeRunID
	}
	if len(state.TaskIDs) > 0 {
		return state.TaskIDs[0]
	}
	return ""
}

func cloudAgentToolService(services []*Service) *Service {
	if len(services) == 0 {
		return nil
	}
	return services[0]
}

func cloudAgentMemoryChangeItems(changes []AgentMemoryDocChange) []any {
	items := make([]any, 0, len(changes))
	for _, change := range changes {
		item := map[string]any{"kind": change.Kind, "id": change.ID, "section": change.Section}
		if change.Before != "" {
			item["before"] = change.Before
		}
		if change.After != "" {
			item["after"] = change.After
		}
		items = append(items, item)
	}
	return items
}

func cloudAgentHandleMemoryUpdate(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	service := cloudAgentToolService(services)
	if service == nil || state == nil {
		return nil, BadAuthRequest("记忆服务不可用")
	}
	if state.Request.PermissionMode == "read_only" {
		return nil, BadAuthRequest("只读模式不能修改长期记忆")
	}
	if mode := strings.TrimSpace(state.Request.MemoryMode); mode == "" || mode == model.AgentMemoryDocumentModeOff {
		return nil, BadAuthRequest("本轮没有开启长期记忆，不要调用 memory_update")
	}
	if state.MemoryWriteCalls >= agentMemoryCallsPerRun {
		return nil, BadAuthRequest(fmt.Sprintf("本轮修改记忆已达 %d 次上限；需要的修改请合并到一次调用里", agentMemoryCallsPerRun))
	}
	state.MemoryWriteCalls++
	var args struct {
		Operations []agentMemoryOperation `json:"operations"`
		Reason     string                 `json:"reason"`
	}
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if utf8.RuneCountInString(args.Reason) > agentMemoryReasonMaxRunes {
		return nil, BadAuthRequest(fmt.Sprintf("reason 不超过 %d 字", agentMemoryReasonMaxRunes))
	}
	if strings.TrimSpace(args.Reason) != "" {
		if _, err := agentMemoryValidateText(args.Reason, "reason"); err != nil {
			return nil, err
		}
	}
	runID := cloudAgentRuntimeRunID(state)
	outcome, detail, err := service.agentMemoryAgentWrite(userID, runID, call.ID, args.Operations, args.Reason)
	if err != nil {
		if detail != nil {
			return detail, err
		}
		return nil, err
	}
	result := map[string]any{
		"status":  outcome.Status,
		"usage":   fmt.Sprintf("%d/%d", outcome.CharCount, outcome.Capacity),
		"changes": cloudAgentMemoryChangeItems(outcome.Changes),
	}
	if outcome.Duplicates > 0 {
		result["duplicates"] = outcome.Duplicates
	}
	switch outcome.Status {
	case agentMemoryOutcomeApplied:
		result["text"] = "已写入长期记忆，下一轮对话起出现在记忆快照里；本轮快照不会刷新，以本结果为准。用户可以在聊天里撤销。"
	case agentMemoryOutcomePending:
		result["text"] = "已提交给用户确认，确认前不会生效；不要对用户说已经记住。"
	default:
		result["text"] = "没有变化：这些内容已经在记忆里。"
		return result, nil
	}
	event := map[string]any{
		"status": outcome.Status, "revisionId": outcome.RevisionID, "summary": outcome.Summary,
		"changes": cloudAgentMemoryChangeItems(outcome.Changes), "charCount": outcome.CharCount, "capacity": outcome.Capacity,
		"text": "长期记忆已更新",
	}
	if outcome.Status == agentMemoryOutcomePending {
		event["text"] = "Agent 想修改长期记忆，等你确认"
	}
	state.event(runID, "memory_updated", event)
	return result, nil
}

// cloudAgentHandleSkillMarketSearch 只在技能市场里找用户还没安装的公开技能；结果只是候选元数据，
// 不授予读取正文的权限。命中的候选记入本轮状态，供 skill_recommend 校验。
func cloudAgentHandleSkillMarketSearch(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	service := cloudAgentToolService(services)
	if service == nil || state == nil {
		return nil, BadAuthRequest("技能市场服务不可用")
	}
	var args struct {
		Keyword string `json:"keyword"`
		Limit   int    `json:"limit"`
	}
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	keyword := strings.TrimSpace(args.Keyword)
	if keyword == "" || utf8.RuneCountInString(keyword) > 100 {
		return nil, BadAuthRequest("keyword 需要 1-100 字：用一两个词描述需要的工作法，例如“带货脚本”“分镜”")
	}
	limit := args.Limit
	if limit <= 0 {
		limit = cloudAgentMarketSearchDefault
	}
	limit = min(limit, cloudAgentMarketSearchMax)
	entries, err := service.skillDomain().MarketSkillCatalog(userID)
	if err != nil {
		return nil, err
	}
	candidates := make([]cloudAgentSkill, 0, len(entries))
	for _, entry := range entries {
		candidates = append(candidates, cloudAgentSkill{ID: entry.SkillID, Name: entry.Name, Description: entry.Description})
	}
	tokens := cloudAgentSkillRecallTokens(keyword, candidates)
	if len(tokens) == 0 {
		tokens = cloudAgentSkillSearchTokens(keyword)
	}
	type scored struct {
		index int
		score int
	}
	ranked := make([]scored, 0, len(candidates))
	for index, candidate := range candidates {
		if score, _ := cloudAgentSkillMatch(candidate, tokens); score >= 2 {
			ranked = append(ranked, scored{index: index, score: score})
		}
	}
	sort.SliceStable(ranked, func(i, j int) bool {
		if ranked[i].score != ranked[j].score {
			return ranked[i].score > ranked[j].score
		}
		return entries[ranked[i].index].AddedCount > entries[ranked[j].index].AddedCount
	})
	matches := make([]map[string]any, 0, limit)
	for _, item := range ranked {
		if len(matches) >= limit {
			break
		}
		entry := entries[item.index]
		suggestion := cloudAgentMarketSuggestion{ID: entry.SkillID, Name: cloudAgentSkillCatalogText(entry.Name, 40), Summary: cloudAgentSkillCatalogText(entry.Description, 120), Tag: entry.Tag}
		cloudAgentRememberMarketSuggestion(state, suggestion)
		matches = append(matches, map[string]any{"skillId": suggestion.ID, "name": suggestion.Name, "summary": suggestion.Summary, "tag": suggestion.Tag, "installs": entry.AddedCount})
	}
	if len(matches) == 0 {
		return map[string]any{"matches": matches, "guidance": "技能市场里没有直接匹配的技能；按通用方法继续，不要反复搜索。"}, nil
	}
	return map[string]any{"matches": matches, "guidance": "这些技能用户还没安装，不能读取正文。确实能明显改善结果时，用 skill_recommend 推荐给用户（每轮一次）并说明理由；用户安装前按通用方法继续。"}, nil
}

func cloudAgentRememberMarketSuggestion(state *cloudAgentRuntime, suggestion cloudAgentMarketSuggestion) {
	for _, existing := range state.MarketSuggestions {
		if existing.ID == suggestion.ID {
			return
		}
	}
	if len(state.MarketSuggestions) >= cloudAgentMarketSuggestionsMax {
		state.MarketSuggestions = state.MarketSuggestions[1:]
	}
	state.MarketSuggestions = append(state.MarketSuggestions, suggestion)
}

// cloudAgentHandleSkillRecommend 只发出“推荐安装”卡片事件，安装与否由用户在界面决定，Agent 不能自行安装。
func cloudAgentHandleSkillRecommend(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	if state == nil || repo == nil {
		return nil, BadAuthRequest("当前运行状态无效")
	}
	if state.SkillRecommendations >= cloudAgentSkillRecommendPerRun {
		return nil, BadAuthRequest("本轮已经推荐过技能，不要重复推荐；继续完成当前任务")
	}
	var args struct {
		SkillIDs []string `json:"skillIds"`
		Reason   string   `json:"reason"`
	}
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if len(args.SkillIDs) == 0 || len(args.SkillIDs) > cloudAgentSkillRecommendMax {
		return nil, BadAuthRequest(fmt.Sprintf("skillIds 需要 1-%d 个", cloudAgentSkillRecommendMax))
	}
	if utf8.RuneCountInString(strings.TrimSpace(args.Reason)) > cloudAgentSkillRecommendReasonRunes {
		return nil, BadAuthRequest(fmt.Sprintf("reason 不超过 %d 字", cloudAgentSkillRecommendReasonRunes))
	}
	reason, err := agentMemoryValidateText(args.Reason, "reason")
	if err != nil {
		return nil, err
	}
	known := make(map[string]cloudAgentMarketSuggestion, len(state.MarketSuggestions))
	for _, suggestion := range state.MarketSuggestions {
		known[suggestion.ID] = suggestion
	}
	skills := make([]any, 0, len(args.SkillIDs))
	seen := map[string]bool{}
	for _, id := range args.SkillIDs {
		id = strings.TrimSpace(id)
		suggestion, ok := known[id]
		if !ok {
			return nil, BadAuthRequest("只能推荐本轮 skill_market_search 返回过的技能：" + truncateRunes(id, 80))
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		installed, err := repo.UserSkillState(userID, id)
		if err != nil {
			return nil, err
		}
		if installed != nil && installed.Added {
			return nil, BadAuthRequest("技能「" + suggestion.Name + "」用户已经安装，可以直接用 skill_search 找到它")
		}
		skills = append(skills, map[string]any{"skillId": suggestion.ID, "name": suggestion.Name, "summary": suggestion.Summary, "tag": suggestion.Tag})
	}
	state.SkillRecommendations++
	state.event(cloudAgentRuntimeRunID(state), "skill_install_suggested", map[string]any{
		"skills": skills, "reason": reason, "text": "Agent 推荐安装技能",
	})
	return map[string]any{
		"status": "shown",
		"text":   "已在界面显示安装卡片，由用户决定是否安装。不要假设用户会安装，也不要催促；继续按通用方法完成当前任务。用户安装后，下一条消息起可以自动使用。",
	}, nil
}
