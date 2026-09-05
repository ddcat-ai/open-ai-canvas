package service

import (
	"encoding/json"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

// ShotTimelineEntry 是 Timeline 投影用的 DTO（D-026：不落数据库）。
//
// 它替代了原计划中的 ShotRegistry 表——信息分散在 Shot / ShotRevision / ShotArtifact / Task，
// 由本 DTO 在读出时组装，而不是复制一份进新表。
//
// D-033 时长语义：
//   - PlannedDurationMs = Shot.DurationMs，是导演的**计划时长**
//   - ActualDurationMs  = 当前活动版本 / 选中产物实测媒体时长；尚未生成时为 0
//
// Timeline 的视觉长度规则：ActualDurationMs > 0 用实际值，否则回退到 PlannedDurationMs。
// 这样「重生成后时长变了」会自动 reflow（OiiOii 的非破坏性编辑模型）。
type ShotTimelineEntry struct {
	ShotID         string `json:"shotId"`
	ProjectID      string `json:"projectId"`
	UnitID         string `json:"unitId"`
	Title          string `json:"title"`
	Position       int    `json:"position"`
	CanvasNodeID   string `json:"canvasNodeId,omitempty"`
	SemanticType   string `json:"semanticType,omitempty"`
	Status         string `json:"status"`
	PlannedDurationMs int64   `json:"plannedDurationMs"`
	ActualDurationMs  float64 `json:"actualDurationMs"`
	// EffectiveDurationMs 是 Timeline 实际应该使用的时长（实际值优先，否则计划值）。
	EffectiveDurationMs float64 `json:"effectiveDurationMs"`
	RevisionID          string  `json:"revisionId,omitempty"`
	RevisionVersion     int     `json:"revisionVersion"`
	LatestTaskID        string  `json:"latestTaskId,omitempty"`
	LatestJobID         string  `json:"latestJobId,omitempty"`
	LatestArtifactID    string  `json:"latestArtifactId,omitempty"`
	HasArtifact         bool    `json:"hasArtifact"`
}

// TaskChainDetail 是 /tasks/:id/chain 的返回结构（D-009 可追踪链）。
// 一个 GenerationTask 因重试可有多个 ComfyJob（D-020），故 Jobs 是数组；
// 产物统一落在 shot_artifacts（D-035），故 Artifacts 也是数组。
type TaskChainDetail struct {
	Task      *model.Task                 `json:"task"`
	Jobs      []model.ComfyBridgeRequest  `json:"jobs"`
	Artifacts []model.ShotArtifact        `json:"artifacts"`
}

// TaskChain 读取任务链（Task → ComfyJob → Artifact）。
// D-024：逐层归属校验，禁止仅凭 ID 返回。
func (s *Service) TaskChain(userID string, taskID string) (*TaskChainDetail, error) {
	task, err := s.repo.TaskForUser(userID, taskID)
	if err != nil {
		return nil, err
	}
	jobs, err := s.repo.ComfyBridgeRequestsByTask(task.ID)
	if err != nil {
		return nil, err
	}
	artifacts, err := s.repo.ShotArtifactsByTask(task.ID)
	if err != nil {
		return nil, err
	}
	s.hydrateTaskProviderRequestID(task)
	return &TaskChainDetail{Task: taskForOutput(*task), Jobs: jobs, Artifacts: artifacts}, nil
}

// ShotTimelineEntries 返回项目下所有分镜的 Timeline 投影 DTO（D-026 / D-033）。
// D-024：先校验项目归属，再按 project_id 取分镜，禁止仅凭 shotID 查询。
func (s *Service) ShotTimelineEntries(userID string, projectID string) ([]ShotTimelineEntry, error) {
	if _, err := s.activeProjectForUser(userID, projectID); err != nil {
		return nil, err
	}
	shots, err := s.repo.ProjectShots(projectID)
	if err != nil {
		return nil, err
	}
	shotIDs := make([]string, 0, len(shots))
	for _, shot := range shots {
		shotIDs = append(shotIDs, shot.ID)
	}
	revisions, err := s.repo.ShotRevisionsByShotIDs(shotIDs)
	if err != nil {
		return nil, err
	}
	artifacts, err := s.repo.SelectedArtifactsByShotIDs(shotIDs)
	if err != nil {
		return nil, err
	}
	// 每个分镜取版本号最大的 revision；一个分镜可能有多类型产物，取最近更新的那个
	revisionByShot := make(map[string]model.ShotRevision, len(revisions))
	for _, revision := range revisions {
		revisionByShot[revision.ShotID] = revision
	}
	artifactByShot := make(map[string]model.ShotArtifact, len(artifacts))
	for _, artifact := range artifacts {
		artifactByShot[artifact.ShotID] = artifact
	}
	entries := make([]ShotTimelineEntry, 0, len(shots))
	for _, shot := range shots {
		entry := ShotTimelineEntry{
			ShotID:            shot.ID,
			ProjectID:         shot.ProjectID,
			UnitID:            shot.UnitID,
			Title:             shot.Title,
			Position:          shot.Position,
			CanvasNodeID:      shot.CanvasNodeID,
			SemanticType:      shot.SemanticType,
			Status:            shot.Status,
			PlannedDurationMs: shot.DurationMs,
			LatestTaskID:      shot.LatestTaskID,
			LatestJobID:       shot.LatestJobID,
			LatestArtifactID:  shot.LatestArtifactID,
		}
		if revision, ok := revisionByShot[shot.ID]; ok {
			entry.RevisionID = revision.ID
			entry.RevisionVersion = revision.Version
		}
		if artifact, ok := artifactByShot[shot.ID]; ok {
			entry.HasArtifact = true
			entry.ActualDurationMs = artifact.DurationMs
		}
		// D-033：实际时长优先，未生成时回退到计划时长
		entry.EffectiveDurationMs = entry.ActualDurationMs
		if entry.EffectiveDurationMs <= 0 {
			entry.EffectiveDurationMs = float64(entry.PlannedDurationMs)
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

// RetryShotTask 在分镜上下文中重试任务（D-030：Retry = 同一 Task 新增一个 ComfyJob）。
//
// 归属校验 user → project → shot → task 逐层进行（D-024）；
// 真正的重试逻辑复用既有 taskLifecycle.retryTask —— 它已正确处理计费、
// 并发上限、内容审核拦截等，不要在这里另写一套。
func (s *Service) RetryShotTask(userID string, projectID string, shotID string, taskID string) (*model.Task, error) {
	if _, err := s.requireShotInProject(userID, projectID, shotID); err != nil {
		return nil, err
	}
	task, err := s.repo.TaskForShot(userID, shotID, taskID)
	if err != nil {
		return nil, err
	}
	return s.RetryTask(userID, task.ID)
}

// RegenerateShot 为分镜新建一个生成任务（D-030：Regenerate = 新建 GenerationTask，与 Retry 不同）。
//
// 新任务克隆该分镜最近一次任务的输入参数（provider/model/operation/input…），
// 但身份是全新的：新 Task ID、清空结果、状态 queued。
// 生成成功后会产生新的 ShotArtifact 版本，从而触发 Timeline reflow（D-033）。
func (s *Service) RegenerateShot(userID string, projectID string, shotID string) (*model.Task, error) {
	shot, err := s.requireShotInProject(userID, projectID, shotID)
	if err != nil {
		return nil, err
	}
	latestID := strings.TrimSpace(shot.LatestTaskID)
	if latestID == "" {
		return nil, BadAuthRequest("该镜头还没有生成记录，无法重新生成")
	}
	latest, err := s.repo.TaskForUser(userID, latestID)
	if err != nil {
		return nil, err
	}
	decrypted, err := s.decryptTaskInputJSON(latest.InputJSON)
	if err != nil {
		return nil, err
	}
	var input map[string]any
	if strings.TrimSpace(decrypted) != "" {
		if err := json.Unmarshal([]byte(decrypted), &input); err != nil {
			return nil, BadAuthRequest("原任务参数无法解析，不能重新生成")
		}
	}
	created, err := s.CreateTask(userID, CreateTaskRequest{
		SessionID:      latest.SessionID,
		ProjectID:      latest.ProjectID,
		Type:           latest.Type,
		Operation:      latest.Operation,
		Prompt:         latest.Prompt,
		Provider:       latest.Provider,
		Model:          latest.Model,
		LogicalModelID: latest.LogicalModelID,
		Input:          input,
	})
	if err != nil {
		return nil, err
	}
	// 新任务的 canonical 链字段从原任务继承（SaveTaskChainContext 只补空值，不会覆盖）
	if err := s.repo.SaveTaskChainContext(created.ID, shot.ID, shot.CanvasNodeID, latest.WorkflowStepID); err != nil {
		return nil, err
	}
	created.ShotID = shot.ID
	created.CanvasNodeID = shot.CanvasNodeID
	created.WorkflowStepID = latest.WorkflowStepID
	created.AgentSessionID = latest.AgentSessionID
	created.AgentTurnID = latest.AgentTurnID
	return created, nil
}

// SelectShotArtifact 切换分镜「当前采用的版本」（W1-B-02：Domain Tool 的后端能力）。
//
// 语义边界（与 W1-01 定死的模型注释一致）：selected 是**版本指针**，不是状态——
// 切换版本不动 status、不动 revision、不产生新版本、不触发 Timeline reflow 的时长变化
// 之外的副作用；它只决定「下载/成片/时间线 effective 时长取哪一版」。
// 归属校验逐层走「用户 → 项目 → 分镜」，产物属于该分镜由仓储层兜底。
func (s *Service) SelectShotArtifact(userID string, projectID string, shotID string, artifactID string) (*model.ShotArtifact, error) {
	if _, err := s.requireShotInProject(userID, projectID, shotID); err != nil {
		return nil, err
	}
	artifactID = strings.TrimSpace(artifactID)
	if artifactID == "" {
		return nil, BadAuthRequest("请选择要采用的产物版本")
	}
	return s.repo.SelectShotArtifact(shotID, artifactID, time.Now())
}

// requireShotInProject 逐层校验「用户 → 项目 → 分镜」归属（D-024）。
func (s *Service) requireShotInProject(userID string, projectID string, shotID string) (*model.Shot, error) {
	if _, err := s.activeProjectForUser(userID, projectID); err != nil {
		return nil, err
	}
	shot, err := s.repo.ShotForProject(projectID, shotID)
	if err != nil {
		return nil, err
	}
	return shot, nil
}
