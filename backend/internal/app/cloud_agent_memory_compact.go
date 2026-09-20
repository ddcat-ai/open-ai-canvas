package app

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"strings"
	"time"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const (
	cloudAgentMemoryCompactOp         = "agent_memory_compact"
	cloudAgentMemoryCompactMaxItems   = 80
	cloudAgentMemoryCompactStaleAfter = 30 * time.Minute
	cloudAgentMemoryCompactTick       = 5 * time.Minute
	cloudAgentMemoryCompactPerTick    = 3
)

type AgentMemoryCompactRequest struct {
	LogicalModelID  string `json:"logicalModelId"`
	ChannelID       string `json:"channelId"`
	ChannelModelKey string `json:"channelModelKey"`
	Model           string `json:"model"`
}

type AgentMemorySettingRequest struct {
	CompactInterval string `json:"compactInterval"`
	LogicalModelID  string `json:"logicalModelId"`
	ChannelID       string `json:"channelId"`
	ChannelModelKey string `json:"channelModelKey"`
	Model           string `json:"model"`
}

type AgentMemoryCompactView struct {
	CompactInterval string                     `json:"compactInterval"`
	LogicalModelID  string                     `json:"logicalModelId,omitempty"`
	ChannelID       string                     `json:"channelId,omitempty"`
	ChannelModelKey string                     `json:"channelModelKey,omitempty"`
	Model           string                     `json:"model,omitempty"`
	LastCompactAt   *time.Time                 `json:"lastCompactAt,omitempty"`
	LastStatus      string                     `json:"lastStatus"`
	LastError       string                     `json:"lastError,omitempty"`
	TaskID          string                     `json:"taskId,omitempty"`
	Summary         *AgentMemoryCompactSummary `json:"summary,omitempty"`
}

type AgentMemoryCompactSummary struct {
	Rewritten int `json:"rewritten"`
	Merged    int `json:"merged"`
	Removed   int `json:"removed"`
	Skipped   int `json:"skipped"`
}

type agentMemoryCompactPlan struct {
	Rewrites []agentMemoryCompactRewrite `json:"rewrites"`
	Merges   []agentMemoryCompactMerge   `json:"merges"`
}

type agentMemoryCompactRewrite struct {
	ID        string                  `json:"id"`
	Topic     string                  `json:"topic"`
	Category  string                  `json:"category"`
	Situation string                  `json:"situation"`
	Lesson    string                  `json:"lesson"`
	Steps     []model.AgentLessonStep `json:"steps"`
	Source    string                  `json:"source"`
}

type agentMemoryCompactMerge struct {
	IDs       []string                `json:"ids"`
	Topic     string                  `json:"topic"`
	Category  string                  `json:"category"`
	Situation string                  `json:"situation"`
	Lesson    string                  `json:"lesson"`
	Steps     []model.AgentLessonStep `json:"steps"`
	Source    string                  `json:"source"`
}

func (s *Service) UserAgentMemoryCompact(userID string) (AgentMemoryCompactView, error) {
	if strings.TrimSpace(userID) == "" {
		return AgentMemoryCompactView{}, kernel.Unauthorized("请先登录")
	}
	setting, err := s.ensureAgentMemorySetting(userID)
	if err != nil {
		return AgentMemoryCompactView{}, err
	}
	return agentMemoryCompactViewOf(*setting), nil
}

func (s *Service) UpdateUserAgentMemorySetting(userID string, req AgentMemorySettingRequest) (AgentMemoryCompactView, error) {
	if strings.TrimSpace(userID) == "" {
		return AgentMemoryCompactView{}, kernel.Unauthorized("请先登录")
	}
	interval, err := normalizeAgentMemoryCompactInterval(req.CompactInterval)
	if err != nil {
		return AgentMemoryCompactView{}, err
	}
	setting, err := s.ensureAgentMemorySetting(userID)
	if err != nil {
		return AgentMemoryCompactView{}, err
	}
	setting.CompactInterval = interval
	applyCompactModel(setting, AgentMemoryCompactRequest{
		LogicalModelID: req.LogicalModelID, ChannelID: req.ChannelID,
		ChannelModelKey: req.ChannelModelKey, Model: req.Model,
	})
	setting.UpdatedAt = time.Now()
	if err := s.repo.SaveAgentMemorySetting(setting); err != nil {
		return AgentMemoryCompactView{}, err
	}
	return agentMemoryCompactViewOf(*setting), nil
}

func (s *Service) CompactUserAgentMemories(userID string, req AgentMemoryCompactRequest) (AgentMemoryCompactView, error) {
	if strings.TrimSpace(userID) == "" {
		return AgentMemoryCompactView{}, kernel.Unauthorized("请先登录")
	}
	setting, err := s.ensureAgentMemorySetting(userID)
	if err != nil {
		return AgentMemoryCompactView{}, err
	}
	applyCompactModel(setting, req)
	setting.UpdatedAt = time.Now()
	if err := s.repo.SaveAgentMemorySetting(setting); err != nil {
		return AgentMemoryCompactView{}, err
	}
	if err := s.startUserAgentMemoryCompact(setting, false); err != nil {
		return AgentMemoryCompactView{}, err
	}
	return agentMemoryCompactViewOf(*setting), nil
}

func (s *Service) startUserAgentMemoryCompact(setting *model.AgentMemorySetting, scheduled bool) error {
	if setting == nil || strings.TrimSpace(setting.UserID) == "" {
		return kernel.Unauthorized("请先登录")
	}
	now := time.Now()
	if agentMemoryCompactBusy(*setting, now) {
		if scheduled {
			return nil
		}
		return BadAuthRequest("已有压缩任务在进行，请稍后再试")
	}
	lessons, err := s.repo.ApprovedAgentLessons(setting.UserID, cloudAgentMemoryCompactMaxItems)
	if err != nil {
		return err
	}
	if len(lessons) == 0 {
		if scheduled {
			return nil
		}
		return BadAuthRequest("没有可压缩的已批准记忆")
	}
	if strings.TrimSpace(setting.LogicalModelID) == "" && strings.TrimSpace(setting.ChannelID) == "" && strings.TrimSpace(setting.Model) == "" && strings.TrimSpace(setting.ChannelModelKey) == "" {
		return BadAuthRequest("请先选择用于压缩的文本模型")
	}
	prompt := buildAgentMemoryCompactUserPrompt(lessons)
	config := map[string]any{}
	if setting.ChannelID != "" {
		config["channelId"] = setting.ChannelID
	}
	if key := firstNonEmpty(setting.ChannelModelKey, setting.Model); key != "" {
		config["model"] = key
		config["channelModelKey"] = key
	}
	config["systemPrompt"] = agentMemoryCompactSystemPrompt()
	input := map[string]any{
		"mode":        "text",
		"prompt":      prompt,
		"textOptions": map[string]any{"stream": false},
		"config":      config,
		"metadata":    map[string]any{"source": cloudAgentMemoryCompactOp},
	}
	task, err := s.CreateTask(setting.UserID, CreateTaskRequest{
		Type:           "canvas_text",
		Operation:      cloudAgentMemoryCompactOp,
		Prompt:         "压缩优化个人 Agent 记忆",
		Model:          firstNonEmpty(setting.ChannelModelKey, setting.Model),
		LogicalModelID: setting.LogicalModelID,
		Input:          input,
	})
	if err != nil {
		return err
	}
	started := now
	setting.CompactStartedAt = &started
	setting.CompactTaskID = task.ID
	setting.LastStatus = model.AgentMemoryCompactStatusQueued
	setting.LastError = ""
	setting.UpdatedAt = now
	return s.repo.SaveAgentMemorySetting(setting)
}

func (s *Service) startAgentMemoryCompactScheduler() {
	s.runWorkerLoop(func(ctx context.Context) {
		s.dispatchDueAgentMemoryCompacts()
		ticker := time.NewTicker(cloudAgentMemoryCompactTick)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if ctx.Err() != nil || s.IsDraining() {
					return
				}
				s.dispatchDueAgentMemoryCompacts()
			}
		}
	})
}

func (s *Service) dispatchDueAgentMemoryCompacts() {
	rows, err := s.repo.ScheduledAgentMemorySettings(50)
	if err != nil {
		log.Printf("agent memory compact schedule: %v", err)
		return
	}
	now := time.Now()
	started := 0
	for index := range rows {
		setting := rows[index]
		if !agentMemoryCompactDue(setting, now) || agentMemoryCompactBusy(setting, now) {
			continue
		}
		if err := s.startUserAgentMemoryCompact(&setting, true); err != nil {
			log.Printf("agent memory compact schedule user=%s: %v", setting.UserID, err)
			setting.LastStatus = model.AgentMemoryCompactStatusFailed
			setting.LastError = truncateRunes(err.Error(), 500)
			setting.UpdatedAt = now
			_ = s.repo.SaveAgentMemorySetting(&setting)
			continue
		}
		started++
		if started >= cloudAgentMemoryCompactPerTick {
			return
		}
	}
}

func (s *Service) markAgentMemoryCompactRunning(task model.Task) {
	if strings.TrimSpace(task.Operation) != cloudAgentMemoryCompactOp {
		return
	}
	setting, err := s.repo.AgentMemorySetting(task.UserID)
	if err != nil {
		return
	}
	if setting.CompactTaskID != "" && setting.CompactTaskID != task.ID {
		return
	}
	setting.LastStatus = model.AgentMemoryCompactStatusRunning
	setting.UpdatedAt = time.Now()
	_ = s.repo.SaveAgentMemorySetting(setting)
}

func (s *Service) noteAgentMemoryCompactTask(task model.Task, result map[string]any, execErr error) {
	if strings.TrimSpace(task.Operation) != cloudAgentMemoryCompactOp {
		return
	}
	setting, err := s.repo.AgentMemorySetting(task.UserID)
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			log.Printf("agent memory compact status: %v", err)
		}
		return
	}
	if setting.CompactTaskID != "" && setting.CompactTaskID != task.ID {
		return
	}
	now := time.Now()
	setting.UpdatedAt = now
	if execErr != nil {
		setting.LastStatus = model.AgentMemoryCompactStatusFailed
		setting.LastError = truncateRunes(execErr.Error(), 500)
		_ = s.repo.SaveAgentMemorySetting(setting)
		return
	}
	text := agentMemoryCompactResultText(result)
	summary, applyErr := s.applyAgentMemoryCompactText(task.UserID, text)
	if applyErr != nil {
		setting.LastStatus = model.AgentMemoryCompactStatusFailed
		setting.LastError = truncateRunes(applyErr.Error(), 500)
		_ = s.repo.SaveAgentMemorySetting(setting)
		return
	}
	raw, _ := json.Marshal(summary)
	setting.LastSummaryJSON = string(raw)
	setting.LastStatus = model.AgentMemoryCompactStatusSucceeded
	setting.LastError = ""
	setting.LastCompactAt = &now
	_ = s.repo.SaveAgentMemorySetting(setting)
}

func (s *Service) applyAgentMemoryCompactText(userID, text string) (AgentMemoryCompactSummary, error) {
	plan, err := parseAgentMemoryCompactPlan(text)
	if err != nil {
		return AgentMemoryCompactSummary{}, err
	}
	return s.applyAgentMemoryCompactPlan(userID, plan)
}

func (s *Service) applyAgentMemoryCompactPlan(userID string, plan agentMemoryCompactPlan) (AgentMemoryCompactSummary, error) {
	owned, err := s.repo.ApprovedAgentLessons(userID, 0)
	if err != nil {
		return AgentMemoryCompactSummary{}, err
	}
	byID := map[string]model.AgentLesson{}
	for _, lesson := range owned {
		byID[lesson.ID] = lesson
	}
	now := time.Now()
	var updates []model.AgentLesson
	var deleteIDs []string
	used := map[string]bool{}
	summary := AgentMemoryCompactSummary{}

	for _, merge := range plan.Merges {
		ids := make([]string, 0, len(merge.IDs))
		seen := map[string]bool{}
		for _, raw := range merge.IDs {
			id := strings.TrimSpace(raw)
			if id == "" || seen[id] {
				continue
			}
			seen[id] = true
			ids = append(ids, id)
		}
		if len(ids) < 2 {
			summary.Skipped++
			continue
		}
		sources := make([]model.AgentLesson, 0, len(ids))
		valid := true
		for _, id := range ids {
			if used[id] {
				valid = false
				break
			}
			lesson, ok := byID[id]
			if !ok {
				valid = false
				break
			}
			sources = append(sources, lesson)
		}
		if !valid {
			summary.Skipped++
			continue
		}
		next, buildErr := s.buildUserAgentMemory(userID, AgentMemoryRequest{
			Topic: merge.Topic, Category: merge.Category, Situation: merge.Situation,
			Lesson: merge.Lesson, Steps: merge.Steps, Source: firstNonEmpty(merge.Source, "compact"),
		}, model.AgentLessonStatusApproved)
		if buildErr != nil {
			summary.Skipped++
			continue
		}
		for _, id := range ids {
			used[id] = true
		}
		current := sources[0]
		current.Topic, current.Category, current.Situation = next.Topic, next.Category, next.Situation
		current.Lesson, current.Source, current.StepsJSON = next.Lesson, next.Source, next.StepsJSON
		current.LastVerifiedAt = &now
		current.UpdatedAt = now
		updates = append(updates, current)
		byID[current.ID] = current
		deleteIDs = append(deleteIDs, ids[1:]...)
		summary.Merged++
		summary.Removed += len(ids) - 1
	}

	for _, rewrite := range plan.Rewrites {
		id := strings.TrimSpace(rewrite.ID)
		if id == "" || used[id] {
			summary.Skipped++
			continue
		}
		current, ok := byID[id]
		if !ok {
			summary.Skipped++
			continue
		}
		next, buildErr := s.buildUserAgentMemory(userID, AgentMemoryRequest{
			Topic: rewrite.Topic, Category: rewrite.Category, Situation: rewrite.Situation,
			Lesson: rewrite.Lesson, Steps: rewrite.Steps, Source: rewrite.Source,
		}, current.Status)
		if buildErr != nil {
			summary.Skipped++
			continue
		}
		current.Topic, current.Category, current.Situation = next.Topic, next.Category, next.Situation
		current.Lesson, current.Source, current.StepsJSON = next.Lesson, next.Source, next.StepsJSON
		current.LastVerifiedAt = &now
		current.UpdatedAt = now
		updates = append(updates, current)
		used[id] = true
		summary.Rewritten++
	}

	if len(updates) == 0 && len(deleteIDs) == 0 {
		return summary, nil
	}
	if err := s.repo.ApplyUserAgentMemoryCompact(userID, updates, deleteIDs); err != nil {
		return AgentMemoryCompactSummary{}, err
	}
	return summary, nil
}

func (s *Service) ensureAgentMemorySetting(userID string) (*model.AgentMemorySetting, error) {
	setting, err := s.repo.AgentMemorySetting(userID)
	if err == nil {
		return setting, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	now := time.Now()
	setting = &model.AgentMemorySetting{
		UserID: userID, CompactInterval: model.AgentMemoryCompactIntervalOff,
		LastStatus: model.AgentMemoryCompactStatusIdle, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.repo.SaveAgentMemorySetting(setting); err != nil {
		return nil, err
	}
	return setting, nil
}

func applyCompactModel(setting *model.AgentMemorySetting, req AgentMemoryCompactRequest) {
	if strings.TrimSpace(req.LogicalModelID) != "" {
		setting.LogicalModelID = strings.TrimSpace(req.LogicalModelID)
	}
	if strings.TrimSpace(req.ChannelID) != "" {
		setting.ChannelID = strings.TrimSpace(req.ChannelID)
	}
	if strings.TrimSpace(req.ChannelModelKey) != "" {
		setting.ChannelModelKey = strings.TrimSpace(req.ChannelModelKey)
	}
	if strings.TrimSpace(req.Model) != "" {
		setting.Model = strings.TrimSpace(req.Model)
	}
}

func normalizeAgentMemoryCompactInterval(value string) (string, error) {
	switch strings.TrimSpace(value) {
	case "", model.AgentMemoryCompactIntervalOff:
		return model.AgentMemoryCompactIntervalOff, nil
	case model.AgentMemoryCompactIntervalDaily, model.AgentMemoryCompactIntervalWeekly, model.AgentMemoryCompactIntervalMonthly:
		return strings.TrimSpace(value), nil
	default:
		return "", BadAuthRequest("压缩周期必须是 off / daily / weekly / monthly")
	}
}

func agentMemoryCompactBusy(setting model.AgentMemorySetting, now time.Time) bool {
	switch setting.LastStatus {
	case model.AgentMemoryCompactStatusQueued, model.AgentMemoryCompactStatusRunning:
	default:
		return false
	}
	if setting.CompactStartedAt == nil {
		return true
	}
	return now.Sub(*setting.CompactStartedAt) < cloudAgentMemoryCompactStaleAfter
}

func agentMemoryCompactDue(setting model.AgentMemorySetting, now time.Time) bool {
	interval := time.Duration(0)
	switch setting.CompactInterval {
	case model.AgentMemoryCompactIntervalDaily:
		interval = 24 * time.Hour
	case model.AgentMemoryCompactIntervalWeekly:
		interval = 7 * 24 * time.Hour
	case model.AgentMemoryCompactIntervalMonthly:
		interval = 30 * 24 * time.Hour
	default:
		return false
	}
	if setting.LastCompactAt == nil {
		return true
	}
	return !setting.LastCompactAt.Add(interval).After(now)
}

func agentMemoryCompactViewOf(setting model.AgentMemorySetting) AgentMemoryCompactView {
	view := AgentMemoryCompactView{
		CompactInterval: firstNonEmpty(setting.CompactInterval, model.AgentMemoryCompactIntervalOff),
		LogicalModelID:  setting.LogicalModelID,
		ChannelID:       setting.ChannelID,
		ChannelModelKey: setting.ChannelModelKey,
		Model:           setting.Model,
		LastCompactAt:   setting.LastCompactAt,
		LastStatus:      firstNonEmpty(setting.LastStatus, model.AgentMemoryCompactStatusIdle),
		LastError:       setting.LastError,
		TaskID:          setting.CompactTaskID,
	}
	if strings.TrimSpace(setting.LastSummaryJSON) != "" {
		var summary AgentMemoryCompactSummary
		if json.Unmarshal([]byte(setting.LastSummaryJSON), &summary) == nil {
			view.Summary = &summary
		}
	}
	return view
}

func parseAgentMemoryCompactPlan(text string) (agentMemoryCompactPlan, error) {
	raw := strings.TrimSpace(text)
	if raw == "" {
		return agentMemoryCompactPlan{}, BadAuthRequest("模型没有返回可应用的压缩结果")
	}
	if i := strings.Index(raw, "```"); i >= 0 {
		raw = raw[i+3:]
		raw = strings.TrimPrefix(raw, "json")
		if j := strings.Index(raw, "```"); j >= 0 {
			raw = raw[:j]
		}
	}
	start := strings.Index(raw, "{")
	end := strings.LastIndex(raw, "}")
	if start < 0 || end <= start {
		return agentMemoryCompactPlan{}, BadAuthRequest("模型返回不是压缩 JSON")
	}
	var plan agentMemoryCompactPlan
	if err := json.Unmarshal([]byte(raw[start:end+1]), &plan); err != nil {
		return agentMemoryCompactPlan{}, BadAuthRequest("模型返回的压缩 JSON 无法解析")
	}
	return plan, nil
}

func agentMemoryCompactResultText(result map[string]any) string {
	if result == nil {
		return ""
	}
	if text, _ := result["text"].(string); strings.TrimSpace(text) != "" {
		return text
	}
	if content, _ := result["content"].(string); strings.TrimSpace(content) != "" {
		return content
	}
	return ""
}

func agentMemoryCompactSystemPrompt() string {
	return strings.Join([]string{
		"你在整理用户自己的 Agent 个人记忆。只输出一个 JSON 对象，不要解释。",
		`格式：{"rewrites":[{"id":"...","topic":"...","category":"...","situation":"...","lesson":"...","steps":[{"tool":"...","action":"..."}],"source":"..."}],"merges":[{"ids":["id1","id2"],"topic":"...","category":"...","situation":"...","lesson":"...","steps":[],"source":"compact"}]}`,
		"规则：",
		"1. 只使用输入里出现过的 id，禁止编造。",
		"2. 意思接近或重复的条目放进 merges，ids 至少 2 个；保留通用做法，去掉具体对象名。",
		"3. 表述含糊、过长或夹带一次性细节的条目放进 rewrites，改成脱离当前画布也成立的短句。",
		"4. category 只能是 storyboard/video/image/canvas/asset/model/workflow/billing/other。",
		"5. 不要删除没有被 merges 覆盖的条目；没有改动就返回空数组。",
		"6. 不要写链接、资源键、UUID、任务/节点 ID。",
	}, "\n")
}

func buildAgentMemoryCompactUserPrompt(lessons []model.AgentLesson) string {
	type item struct {
		ID        string                  `json:"id"`
		Topic     string                  `json:"topic"`
		Category  string                  `json:"category"`
		Situation string                  `json:"situation"`
		Lesson    string                  `json:"lesson,omitempty"`
		Steps     []model.AgentLessonStep `json:"steps,omitempty"`
		Source    string                  `json:"source,omitempty"`
	}
	items := make([]item, 0, len(lessons))
	for _, lesson := range lessons {
		view := agentLessonViewOf(lesson)
		items = append(items, item{
			ID: view.ID, Topic: view.Topic, Category: view.Category, Situation: view.Situation,
			Lesson: view.Lesson, Steps: view.Steps, Source: view.Source,
		})
	}
	raw, err := json.Marshal(items)
	if err != nil {
		return "[]"
	}
	return "请压缩并优化下面这些已批准记忆：\n" + string(raw)
}
