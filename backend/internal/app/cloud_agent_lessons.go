package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
	agentmemory "yingce/backend/internal/agent/memory"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

// 旧版经验库（AgentLesson）：Agent 已改用长期记忆文件（cloud_agent_memory_document.go），
// 不再写入、注入或召回这些条目。这里只保留用户与管理员的查看、编辑、导出和删除；
// 已批准条目在用户第一次启用记忆文件时导入。

var cloudAgentLessonLeakPatterns = []struct {
	name    string
	pattern *regexp.Regexp
}{
	{"链接或接口路径", regexp.MustCompile(`(?i)https?://|/api/|\bdata:`)},
	{"资源键", regexp.MustCompile(`(?i)\bresource:`)},
	{"运行或任务 ID", regexp.MustCompile(`\bag[0-9a-f]{12,}\b`)},
	{"长十六进制 ID", regexp.MustCompile(`\b[0-9a-f]{24,}\b`)},
	{"UUID", regexp.MustCompile(`\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b`)},
	{"节点或连线 ID", regexp.MustCompile(`\b(conn-|agent-edge-|MODEL_)[0-9A-Za-z_-]{4,}\b`)},
}

const (
	cloudAgentLessonTopicMax               = 120
	cloudAgentLessonSituationMax           = 200
	cloudAgentLessonLessonMax              = 400
	cloudAgentLessonSourceMax              = 200
	cloudAgentLessonStepsMax               = 12
	cloudAgentLessonToolMax                = 60
	cloudAgentLessonActionMax              = 200
	cloudAgentLessonNoteMax                = 200
	cloudAgentLessonDedupScanMax           = 500
	cloudAgentRememberLessonPendingPerUser = 50
	cloudAgentPendingLessonTTL             = 30 * 24 * time.Hour
	cloudAgentRememberLessonApprovedMax    = 300
	cloudAgentMemoryImportMax              = 200
)

func cloudAgentLessonScrub(field, text string) error {
	for _, entry := range cloudAgentLessonLeakPatterns {
		if entry.pattern.MatchString(text) {
			return BadAuthRequest(fmt.Sprintf("%s 里不能出现具体链接、资源键、节点/任务 ID（检测到：%s）。请改写成脱离当前画布也成立的通用说法", field, entry.name))
		}
	}
	return nil
}

func cloudAgentLessonField(value, field string, max int) (string, error) {
	text := strings.TrimSpace(value)
	if text == "" {
		return "", BadAuthRequest(field + " 不能为空")
	}
	if utf8.RuneCountInString(text) > max {
		return "", BadAuthRequest(fmt.Sprintf("%s 超过 %d 字上限，请写短一点", field, max))
	}
	if err := cloudAgentLessonScrub(field, text); err != nil {
		return "", err
	}
	return text, nil
}

func cloudAgentLessonNormalize(value string) string {
	const dropped = " \t\r\n，。！？；：、,.!?;:-'\"“”‘’（）()【】[]"
	var builder strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(value)) {
		if strings.ContainsRune(dropped, r) {
			continue
		}
		builder.WriteRune(r)
	}
	return builder.String()
}

func cloudAgentLessonFingerprint(situation, lesson, stepsJSON string) string {
	normalized := cloudAgentLessonNormalize(situation) + "|" + cloudAgentLessonNormalize(lesson)
	var steps []model.AgentLessonStep
	if json.Unmarshal([]byte(stepsJSON), &steps) == nil {
		for _, step := range steps {
			normalized += "|" + cloudAgentLessonNormalize(step.Tool)
		}
	}
	return normalized
}

func cloudAgentFindDuplicateLesson(repo *repository.Repository, userID string, candidate *model.AgentLesson) (*model.AgentLesson, error) {
	existing, err := repo.UserAgentLessons(userID, "", cloudAgentLessonDedupScanMax)
	if err != nil {
		return nil, err
	}
	want := cloudAgentLessonFingerprint(candidate.Situation, candidate.Lesson, candidate.StepsJSON)
	for index := range existing {
		lesson := existing[index]
		if lesson.Status == model.AgentLessonStatusRejected || lesson.Status == model.AgentLessonStatusExpired {
			continue
		}
		if cloudAgentLessonFingerprint(lesson.Situation, lesson.Lesson, lesson.StepsJSON) == want {
			return &lesson, nil
		}
	}
	return nil, nil
}

func cloudAgentLessonSteps(input []model.AgentLessonStep) ([]model.AgentLessonStep, error) {
	if len(input) > cloudAgentLessonStepsMax {
		return nil, BadAuthRequest(fmt.Sprintf("steps 最多 %d 步，请只留关键步骤", cloudAgentLessonStepsMax))
	}
	steps := make([]model.AgentLessonStep, 0, len(input))
	for index, step := range input {
		label := fmt.Sprintf("steps[%d]", index)
		tool, err := cloudAgentLessonField(step.Tool, label+".tool", cloudAgentLessonToolMax)
		if err != nil {
			return nil, err
		}
		action, err := cloudAgentLessonField(step.Action, label+".action", cloudAgentLessonActionMax)
		if err != nil {
			return nil, err
		}
		entry := model.AgentLessonStep{Tool: tool, Action: action}
		if strings.TrimSpace(step.Note) != "" {
			if entry.Note, err = cloudAgentLessonField(step.Note, label+".note", cloudAgentLessonNoteMax); err != nil {
				return nil, err
			}
		}
		steps = append(steps, entry)
	}
	return steps, nil
}

type cloudAgentLessonCategory struct {
	Key   string
	Label string
}

var cloudAgentLessonCategories = []cloudAgentLessonCategory{
	{Key: "storyboard", Label: "分镜"},
	{Key: "video", Label: "视频生成"},
	{Key: "image", Label: "图像生成"},
	{Key: "canvas", Label: "画布操作"},
	{Key: "asset", Label: "资产"},
	{Key: "model", Label: "模型选择"},
	{Key: "workflow", Label: "流程顺序"},
	{Key: "billing", Label: "计费"},
	{Key: "other", Label: "其他"},
}

const cloudAgentLessonCategoryFallback = "other"

func cloudAgentLessonCategoryKeys() []string {
	keys := make([]string, 0, len(cloudAgentLessonCategories))
	for _, category := range cloudAgentLessonCategories {
		keys = append(keys, category.Key)
	}
	return keys
}

func cloudAgentLessonCategoryOf(key string) (string, bool) {
	trimmed := strings.TrimSpace(key)
	for _, category := range cloudAgentLessonCategories {
		if category.Key == trimmed {
			return trimmed, true
		}
	}
	return "", false
}

func cloudAgentNormalizeLessonCategory(key string) string {
	if normalized, ok := cloudAgentLessonCategoryOf(key); ok {
		return normalized
	}
	return cloudAgentLessonCategoryFallback
}

func cloudAgentLessonCategoryLabel(key string) string {
	for _, category := range cloudAgentLessonCategories {
		if category.Key == key {
			return category.Label
		}
	}
	return cloudAgentLessonCategoryFallback
}

type AgentLessonView struct {
	ID             string                  `json:"id"`
	Topic          string                  `json:"topic"`
	Category       string                  `json:"category"`
	Situation      string                  `json:"situation"`
	Lesson         string                  `json:"lesson,omitempty"`
	Steps          []model.AgentLessonStep `json:"steps,omitempty"`
	Source         string                  `json:"source,omitempty"`
	OriginRunID    string                  `json:"originRunId,omitempty"`
	Evidence       []agentmemory.Evidence  `json:"evidence,omitempty"`
	Status         string                  `json:"status"`
	Hits           int64                   `json:"hits"`
	Injected       int64                   `json:"injected"`
	LastVerifiedAt *time.Time              `json:"lastVerifiedAt,omitempty"`
	CreatedAt      time.Time               `json:"createdAt"`
	UpdatedAt      time.Time               `json:"updatedAt"`
}

type AgentLessonAdminView struct {
	AgentLessonView
	AuthorUserID      string `json:"authorUserId,omitempty"`
	AuthorUsername    string `json:"authorUsername,omitempty"`
	AuthorDisplayName string `json:"authorDisplayName,omitempty"`
}

type AgentMemoryRequest struct {
	Topic     string                  `json:"topic"`
	Category  string                  `json:"category"`
	Situation string                  `json:"situation"`
	Lesson    string                  `json:"lesson"`
	Steps     []model.AgentLessonStep `json:"steps"`
	Source    string                  `json:"source"`
}

type AgentMemoryBundle struct {
	Version    int                     `json:"version"`
	Kind       string                  `json:"kind"`
	ExportedAt time.Time               `json:"exportedAt"`
	Memories   []AgentMemoryExportItem `json:"memories"`
}

type AgentMemoryExportItem struct {
	Topic     string                  `json:"topic"`
	Category  string                  `json:"category"`
	Situation string                  `json:"situation"`
	Lesson    string                  `json:"lesson,omitempty"`
	Steps     []model.AgentLessonStep `json:"steps,omitempty"`
	Source    string                  `json:"source,omitempty"`
	Status    string                  `json:"status,omitempty"`
}

type AgentMemoryImportResult struct {
	Imported int `json:"imported"`
	Merged   int `json:"merged"`
	Skipped  int `json:"skipped"`
}

func agentLessonViewOf(lesson model.AgentLesson) AgentLessonView {
	view := AgentLessonView{
		ID: lesson.ID, Topic: lesson.Topic, Category: cloudAgentNormalizeLessonCategory(lesson.Category),
		Situation: lesson.Situation, Lesson: lesson.Lesson, Source: lesson.Source, Status: lesson.Status,
		Hits: lesson.Hits, Injected: lesson.Injected, LastVerifiedAt: lesson.LastVerifiedAt,
		CreatedAt: lesson.CreatedAt, UpdatedAt: lesson.UpdatedAt, OriginRunID: lesson.OriginRunID,
	}
	if lesson.EvidenceJSON != "" {
		_ = json.Unmarshal([]byte(lesson.EvidenceJSON), &view.Evidence)
	}
	if strings.TrimSpace(lesson.StepsJSON) != "" {
		var steps []model.AgentLessonStep
		if json.Unmarshal([]byte(lesson.StepsJSON), &steps) == nil && len(steps) > 0 {
			view.Steps = steps
		}
	}
	return view
}

func agentLessonAdminViewOf(lesson model.AgentLesson) AgentLessonAdminView {
	return AgentLessonAdminView{AgentLessonView: agentLessonViewOf(lesson), AuthorUserID: lesson.AuthorUserID}
}

func (s *Service) UserAgentMemories(userID, status string, limit int) ([]AgentLessonView, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	lessons, err := s.repo.UserAgentLessons(userID, status, limit)
	if err != nil {
		return nil, err
	}
	views := make([]AgentLessonView, 0, len(lessons))
	for _, lesson := range lessons {
		views = append(views, agentLessonViewOf(lesson))
	}
	return views, nil
}

func (s *Service) buildUserAgentMemory(userID string, req AgentMemoryRequest, status string) (*model.AgentLesson, error) {
	if _, known := cloudAgentLessonCategoryOf(req.Category); !known {
		return nil, BadAuthRequest("category 必须是以下之一：" + strings.Join(cloudAgentLessonCategoryKeys(), " / "))
	}
	topic, err := cloudAgentLessonField(req.Topic, "topic", cloudAgentLessonTopicMax)
	if err != nil {
		return nil, err
	}
	situation, err := cloudAgentLessonField(req.Situation, "situation", cloudAgentLessonSituationMax)
	if err != nil {
		return nil, err
	}
	lesson := ""
	if strings.TrimSpace(req.Lesson) != "" {
		if lesson, err = cloudAgentLessonField(req.Lesson, "lesson", cloudAgentLessonLessonMax); err != nil {
			return nil, err
		}
	}
	steps, err := cloudAgentLessonSteps(req.Steps)
	if err != nil {
		return nil, err
	}
	if lesson == "" && len(steps) == 0 {
		return nil, BadAuthRequest("lesson 与 steps 至少要给一个")
	}
	source := ""
	if strings.TrimSpace(req.Source) != "" {
		if source, err = cloudAgentLessonField(req.Source, "source", cloudAgentLessonSourceMax); err != nil {
			return nil, err
		}
	}
	now := time.Now()
	entry := &model.AgentLesson{
		Topic: topic, Situation: situation, Lesson: lesson, Source: source,
		Category: cloudAgentNormalizeLessonCategory(req.Category),
		Status:   status, AuthorUserID: userID,
		UpdatedAt: now,
	}
	if len(steps) > 0 {
		raw, marshalErr := json.Marshal(steps)
		if marshalErr != nil {
			return nil, marshalErr
		}
		entry.StepsJSON = string(raw)
	}
	return entry, nil
}

func (s *Service) CreateUserAgentMemory(userID string, req AgentMemoryRequest) (AgentLessonView, error) {
	if strings.TrimSpace(userID) == "" {
		return AgentLessonView{}, kernel.Unauthorized("请先登录")
	}
	approved, err := s.repo.CountAgentLessonsByAuthor(userID, model.AgentLessonStatusApproved)
	if err != nil {
		return AgentLessonView{}, err
	}
	if approved >= cloudAgentRememberLessonApprovedMax {
		return AgentLessonView{}, BadAuthRequest(fmt.Sprintf("已批准记忆最多 %d 条，请先清理后再添加", cloudAgentRememberLessonApprovedMax))
	}
	entry, err := s.buildUserAgentMemory(userID, req, model.AgentLessonStatusApproved)
	if err != nil {
		return AgentLessonView{}, err
	}
	now := time.Now()
	entry.ID = newID()
	entry.CreatedAt = now
	if duplicate, findErr := cloudAgentFindDuplicateLesson(s.repo, userID, entry); findErr != nil {
		return AgentLessonView{}, findErr
	} else if duplicate != nil {
		if duplicate.Status != model.AgentLessonStatusApproved {
			if err := s.repo.SetAgentLessonStatus(userID, duplicate.ID, model.AgentLessonStatusApproved); err != nil {
				return AgentLessonView{}, err
			}
		}
		existing, err := s.repo.AgentLessonForUser(userID, duplicate.ID)
		if err != nil {
			return AgentLessonView{}, err
		}
		return agentLessonViewOf(*existing), nil
	}
	if err := s.repo.Create(entry); err != nil {
		return AgentLessonView{}, err
	}
	return agentLessonViewOf(*entry), nil
}

func (s *Service) UpdateUserAgentMemory(userID, id string, req AgentMemoryRequest) (AgentLessonView, error) {
	if strings.TrimSpace(userID) == "" {
		return AgentLessonView{}, kernel.Unauthorized("请先登录")
	}
	current, err := s.repo.AgentLessonForUser(userID, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return AgentLessonView{}, kernel.NotFound("记忆不存在")
		}
		return AgentLessonView{}, err
	}
	next, err := s.buildUserAgentMemory(userID, req, current.Status)
	if err != nil {
		return AgentLessonView{}, err
	}
	current.Topic, current.Category, current.Situation = next.Topic, next.Category, next.Situation
	current.Lesson, current.Source, current.StepsJSON = next.Lesson, next.Source, next.StepsJSON
	current.UpdatedAt = time.Now()
	if err := s.repo.SaveAgentLesson(current); err != nil {
		return AgentLessonView{}, err
	}
	return agentLessonViewOf(*current), nil
}

func (s *Service) DecideUserAgentMemory(userID, id, decision string) error {
	if strings.TrimSpace(userID) == "" {
		return kernel.Unauthorized("请先登录")
	}
	status := ""
	switch decision {
	case "approve":
		status = model.AgentLessonStatusApproved
	case "reject":
		status = model.AgentLessonStatusRejected
	default:
		return BadAuthRequest("无效裁决")
	}
	if status == model.AgentLessonStatusApproved {
		approved, err := s.repo.CountAgentLessonsByAuthor(userID, model.AgentLessonStatusApproved)
		if err != nil {
			return err
		}
		if approved >= cloudAgentRememberLessonApprovedMax {
			return BadAuthRequest(fmt.Sprintf("已批准记忆最多 %d 条，请先清理后再批准", cloudAgentRememberLessonApprovedMax))
		}
	}
	if err := s.repo.SetAgentLessonStatus(userID, strings.TrimSpace(id), status); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return kernel.NotFound("记忆不存在")
		}
		return err
	}
	return nil
}

func (s *Service) DeleteUserAgentMemory(userID, id string) error {
	if strings.TrimSpace(userID) == "" {
		return kernel.Unauthorized("请先登录")
	}
	if err := s.repo.DeleteAgentLesson(userID, strings.TrimSpace(id)); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return kernel.NotFound("记忆不存在")
		}
		return err
	}
	return nil
}

func (s *Service) ExportUserAgentMemories(userID string) (AgentMemoryBundle, error) {
	if strings.TrimSpace(userID) == "" {
		return AgentMemoryBundle{}, kernel.Unauthorized("请先登录")
	}
	lessons, err := s.repo.UserAgentLessons(userID, "", 500)
	if err != nil {
		return AgentMemoryBundle{}, err
	}
	items := make([]AgentMemoryExportItem, 0, len(lessons))
	for _, lesson := range lessons {
		view := agentLessonViewOf(lesson)
		items = append(items, AgentMemoryExportItem{
			Topic: view.Topic, Category: view.Category, Situation: view.Situation,
			Lesson: view.Lesson, Steps: view.Steps, Source: view.Source, Status: view.Status,
		})
	}
	return AgentMemoryBundle{Version: 1, Kind: "agent-memories", ExportedAt: time.Now().UTC(), Memories: items}, nil
}

func (s *Service) ImportUserAgentMemories(userID string, bundle AgentMemoryBundle) (AgentMemoryImportResult, error) {
	if strings.TrimSpace(userID) == "" {
		return AgentMemoryImportResult{}, kernel.Unauthorized("请先登录")
	}
	if bundle.Kind != "" && bundle.Kind != "agent-memories" {
		return AgentMemoryImportResult{}, BadAuthRequest("不是 Agent 记忆导出文件")
	}
	if len(bundle.Memories) > cloudAgentMemoryImportMax {
		return AgentMemoryImportResult{}, BadAuthRequest(fmt.Sprintf("一次最多导入 %d 条", cloudAgentMemoryImportMax))
	}
	result := AgentMemoryImportResult{}
	for _, item := range bundle.Memories {
		status := strings.TrimSpace(item.Status)
		if status == "" {
			status = model.AgentLessonStatusApproved
		}
		if status != model.AgentLessonStatusApproved && status != model.AgentLessonStatusPending && status != model.AgentLessonStatusRejected && status != model.AgentLessonStatusExpired {
			result.Skipped++
			continue
		}
		if status == model.AgentLessonStatusApproved {
			approved, err := s.repo.CountAgentLessonsByAuthor(userID, model.AgentLessonStatusApproved)
			if err != nil {
				return result, err
			}
			if approved >= cloudAgentRememberLessonApprovedMax {
				result.Skipped++
				continue
			}
		}
		entry, err := s.buildUserAgentMemory(userID, AgentMemoryRequest{
			Topic: item.Topic, Category: item.Category, Situation: item.Situation,
			Lesson: item.Lesson, Steps: item.Steps, Source: item.Source,
		}, status)
		if err != nil {
			result.Skipped++
			continue
		}
		now := time.Now()
		if duplicate, findErr := cloudAgentFindDuplicateLesson(s.repo, userID, entry); findErr != nil {
			return result, findErr
		} else if duplicate != nil {
			if status == model.AgentLessonStatusApproved && duplicate.Status != model.AgentLessonStatusApproved {
				if err := s.repo.SetAgentLessonStatus(userID, duplicate.ID, model.AgentLessonStatusApproved); err != nil {
					return result, err
				}
			}
			result.Merged++
			continue
		}
		entry.ID = newID()
		entry.CreatedAt = now
		if err := s.repo.Create(entry); err != nil {
			return result, err
		}
		result.Imported++
	}
	return result, nil
}

func (s *Service) AdminAgentLessons(status, userID, keyword string, limit int) ([]AgentLessonAdminView, error) {
	lessons, err := s.repo.AdminAgentLessons(status, userID, keyword, limit)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(lessons))
	for _, lesson := range lessons {
		if lesson.AuthorUserID != "" {
			ids = append(ids, lesson.AuthorUserID)
		}
	}
	users, err := s.repo.UsersByIDs(ids)
	if err != nil {
		return nil, err
	}
	views := make([]AgentLessonAdminView, 0, len(lessons))
	for _, lesson := range lessons {
		view := agentLessonAdminViewOf(lesson)
		if user, ok := users[lesson.AuthorUserID]; ok {
			view.AuthorUsername = user.Username
			view.AuthorDisplayName = user.DisplayName
		}
		views = append(views, view)
	}
	return views, nil
}

func (s *Service) AdminDeleteAgentLesson(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return BadAuthRequest("记忆 ID 无效")
	}
	if err := s.repo.DeleteAgentLesson("", id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return kernel.NotFound("记忆不存在")
		}
		return err
	}
	return nil
}
