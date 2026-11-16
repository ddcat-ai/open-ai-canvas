package app

import (
	"encoding/json"
	"strings"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/skills"
)

// RequireSkillAdministrator shares the skill domain's current database-backed authorization.
func (s *Service) RequireSkillAdministrator(userID string) error {
	return s.skillDomain().RequireAdministrator(userID)
}

// CloudAgentSkillCapabilities never derives skill access from client flags or cached roles.
func (s *Service) CloudAgentSkillCapabilities(userID string) (bool, []string, error) {
	admin, err := s.skillDomain().IsAdministrator(userID)
	if err != nil {
		return false, nil, err
	}
	names := []string{}
	for _, name := range CloudAgentSupportedToolNames() {
		if admin || !cloudAgentIsSkillTool(name) {
			names = append(names, name)
		}
	}
	return admin, names, nil
}

func cloudAgentIsSkillTool(name string) bool {
	name = strings.TrimSpace(strings.TrimPrefix(name, "functions."))
	return strings.HasPrefix(name, "skill_") || name == "skills_load"
}

func cloudAgentRequireSkillToolAdministrator(repo *repository.Repository, userID, name string, services ...*Service) error {
	if !cloudAgentIsSkillTool(name) {
		return nil
	}
	if repo == nil {
		if service := cloudAgentToolService(services); service != nil {
			repo = service.repo
		}
	}
	if repo == nil {
		return kernel.Forbidden("无法确认管理员技能权限")
	}
	return skills.New(repo, "", nil).RequireAdministrator(userID)
}

func cloudAgentToolsWithoutSkills(tools []map[string]any) []map[string]any {
	filtered := make([]map[string]any, 0, len(tools))
	for _, tool := range tools {
		function, _ := tool["function"].(map[string]any)
		name := firstNonEmpty(stringField(function, "name"), stringField(tool, "name"))
		if !cloudAgentIsSkillTool(name) {
			filtered = append(filtered, tool)
		}
	}
	return filtered
}

func cloudAgentSkillHistoryError() error {
	return kernel.Forbidden("当前账号没有技能权限，此对话包含技能上下文，不能继续执行；请另开无技能对话，已有记录和生成结果仍保留")
}

// Only skill-bearing history is blocked after role revocation. Old tool declarations
// alone are filtered, so ordinary conversations with no skill use remain resumable.
func (s *Service) cloudAgentCheckSkillExecution(userID string, state *cloudAgentRuntime, canonical *canonicalAgentRequest, sessionJSONL string) error {
	admin, err := s.skillDomain().IsAdministrator(userID)
	if err != nil {
		return err
	}
	if admin {
		return nil
	}
	if cloudAgentRuntimeHasSkillContext(state) || cloudAgentCanonicalHasSkillContext(canonical) || cloudAgentPiSessionHasSkillContext(sessionJSONL) {
		return cloudAgentSkillHistoryError()
	}
	if state != nil {
		state.Request.SkillsEnabled = false
		state.Canonical.Tools = cloudAgentToolsWithoutSkills(state.Canonical.Tools)
	}
	if canonical != nil {
		canonical.Tools = cloudAgentToolsWithoutSkills(canonical.Tools)
	}
	return nil
}

func cloudAgentRuntimeHasSkillContext(state *cloudAgentRuntime) bool {
	if state == nil {
		return false
	}
	if state.Request.SkillsEnabled || len(state.Request.PinnedSkillIDs) > 0 || len(cloudAgentPromptSkillMentions(state.Request.Prompt)) > 0 || len(state.Skills) > 0 || len(state.SkillVersions) > 0 || strings.TrimSpace(state.SkillHints) != "" || len(state.MarketSuggestions) > 0 || state.SkillRecommendations > 0 {
		return true
	}
	for key := range state.ToolReadResults {
		name, _, _ := strings.Cut(key, ":")
		if cloudAgentIsSkillTool(name) {
			return true
		}
	}
	for _, call := range state.Calls {
		if cloudAgentIsSkillTool(call.Function.Name) {
			return true
		}
	}
	for _, message := range state.TextHistory {
		if cloudAgentIsSkillContextSource(message.AgentContextSource) || (message.Role == "system" && cloudAgentSystemHasSkillCatalog(message.Content)) {
			return true
		}
	}
	return cloudAgentCanonicalHasSkillContext(&state.Canonical)
}

func cloudAgentIsSkillContextSource(source string) bool {
	return source == "skills" || source == "skills_load" || strings.HasPrefix(source, "skill_")
}

func cloudAgentSystemHasSkillCatalog(text string) bool {
	_, catalog, found := strings.Cut(text, cloudAgentSkillCatalogHeader)
	return found && !strings.HasPrefix(strings.TrimSpace(catalog), "用户还没有安装可自动使用的技能。")
}

func cloudAgentCanonicalHasSkillContext(canonical *canonicalAgentRequest) bool {
	if canonical == nil {
		return false
	}
	if cloudAgentSystemHasSkillCatalog(canonical.SystemPrompt) {
		return true
	}
	for _, message := range canonical.Messages {
		if cloudAgentValueHasSkillContext(message) {
			return true
		}
	}
	return false
}

// Runtime snapshots are structured JSONL; inspect provenance and tool identities,
// not ordinary prose containing the word "skill".
func cloudAgentPiSessionHasSkillContext(session string) bool {
	for _, line := range strings.Split(session, "\n") {
		var entry any
		if json.Unmarshal([]byte(line), &entry) == nil && cloudAgentValueHasSkillContext(entry) {
			return true
		}
	}
	return false
}

func cloudAgentValueHasSkillContext(value any) bool {
	switch item := value.(type) {
	case map[string]any:
		if cloudAgentIsSkillContextSource(stringField(item, cloudAgentContextSourceKey)) || cloudAgentIsSkillTool(stringField(item, "toolName")) {
			return true
		}
		if function, ok := item["function"].(map[string]any); ok && cloudAgentIsSkillTool(stringField(function, "name")) {
			return true
		}
		kind, role := stringField(item, "type"), stringField(item, "role")
		if (kind == "toolCall" || role == "toolResult" || role == "tool") && cloudAgentIsSkillTool(stringField(item, "name")) {
			return true
		}
		if role == "system" && cloudAgentSystemHasSkillCatalog(stringField(item, "content")) {
			return true
		}
		if cloudAgentSystemHasSkillCatalog(stringField(item, "systemPrompt")) {
			return true
		}
		for _, key := range []string{"skills", "enabledSkills", "skillVersions", "skillHints"} {
			if raw, ok := item[key]; ok && raw != nil {
				encoded, _ := json.Marshal(raw)
				if string(encoded) != "[]" && string(encoded) != "{}" && string(encoded) != `""` && string(encoded) != "null" && string(encoded) != "false" {
					return true
				}
			}
		}
		for _, nested := range item {
			if cloudAgentValueHasSkillContext(nested) {
				return true
			}
		}
	case []any:
		for _, nested := range item {
			if cloudAgentValueHasSkillContext(nested) {
				return true
			}
		}
	}
	return false
}

func (s *Service) cloudAgentDecodeForExecution(run *model.CloudAgentExecution) (cloudAgentRuntime, error) {
	state, err := cloudAgentDecodeForExecution(run)
	if err != nil {
		return state, err
	}
	if err := s.cloudAgentCheckSkillExecution(run.UserID, &state, nil, ""); err != nil {
		return state, err
	}
	return state, nil
}
