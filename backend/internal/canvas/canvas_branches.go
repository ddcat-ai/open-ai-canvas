package canvas

import (
	"bytes"
	"encoding/json"
	"errors"
	"infinite-canvas/backend/internal/kernel"
	"net/http"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/gorm"
)

const CanvasBranchStatusActive = "active"

type CanvasBranchSummary struct {
	ID                  string    `json:"id"`
	SourceCanvasID      string    `json:"sourceCanvasId"`
	BranchCanvasID      string    `json:"branchCanvasId"`
	ParentBranchID      string    `json:"parentBranchId,omitempty"`
	SourceTitle         string    `json:"sourceTitle,omitempty"`
	OwnerID             string    `json:"ownerId"`
	Name                string    `json:"name"`
	Status              string    `json:"status"`
	BaseRevision        int64     `json:"baseRevision"`
	HeadRevision        int64     `json:"headRevision"`
	LastMergedSourceRev int64     `json:"lastMergedSourceRevision,omitempty"`
	LastMergedTargetRev int64     `json:"lastMergedTargetRevision,omitempty"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

type CanvasBranchCreateRequest struct {
	Name         string `json:"name"`
	BaseRevision *int64 `json:"baseRevision,omitempty"`
}

type CanvasBranchCreateResult struct {
	Branch  CanvasBranchSummary `json:"branch"`
	Project json.RawMessage     `json:"project"`
}

type CanvasBranchDetail struct {
	Branch  CanvasBranchSummary `json:"branch"`
	Project json.RawMessage     `json:"project"`
}

type CanvasBranchContext struct {
	Branch       CanvasBranchSummary `json:"branch"`
	SourceCanvas CanvasBranchSummary `json:"sourceCanvas"`
}

func (s *Service) CanvasBranchContextForUser(actor *model.User, canvasID string) (*CanvasBranchContext, error) {
	project, err := s.scopedCanvasProject(actor, canvasID)
	if err != nil {
		return nil, err
	}
	branch, err := s.repo.CanvasBranchByCanvasID(project.ID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	source, err := s.repo.CanvasProject(branch.SourceCanvasID)
	if err != nil {
		return nil, err
	}
	branchSummary := canvasBranchSummary(*branch, project)
	branchSummary.SourceTitle = source.Title
	return &CanvasBranchContext{Branch: branchSummary, SourceCanvas: CanvasBranchSummary{BranchCanvasID: source.ID, Name: source.Title, HeadRevision: source.Revision}}, nil
}

type CanvasBranchConflict struct {
	Path   string          `json:"path"`
	Label  string          `json:"label"`
	Base   json.RawMessage `json:"base,omitempty"`
	Source json.RawMessage `json:"source,omitempty"`
	Target json.RawMessage `json:"target,omitempty"`
}

type CanvasBranchMergePreviewRequest struct {
	TargetCanvasID         string `json:"targetCanvasId,omitempty"`
	ExpectedTargetRevision int64  `json:"expectedTargetRevision,omitempty"`
	SourceRevision         int64  `json:"sourceRevision,omitempty"`
}

type CanvasBranchMergePreview struct {
	Branch            CanvasBranchSummary    `json:"branch"`
	TargetCanvasID    string                 `json:"targetCanvasId"`
	BaseRevision      int64                  `json:"baseRevision"`
	SourceRevision    int64                  `json:"sourceRevision"`
	TargetRevision    int64                  `json:"targetRevision"`
	BaseProject       json.RawMessage        `json:"baseProject"`
	SourceProject     json.RawMessage        `json:"sourceProject"`
	TargetProject     json.RawMessage        `json:"targetProject"`
	AutoMergedProject json.RawMessage        `json:"autoMergedProject"`
	Conflicts         []CanvasBranchConflict `json:"conflicts"`
}

type CanvasBranchMergeRequest struct {
	TargetCanvasID         string          `json:"targetCanvasId,omitempty"`
	ExpectedTargetRevision int64           `json:"expectedTargetRevision"`
	SourceRevision         int64           `json:"sourceRevision"`
	MergedProject          json.RawMessage `json:"mergedProject,omitempty"`
}

type CanvasBranchMergeResult struct {
	Status         string                 `json:"status"`
	Branch         CanvasBranchSummary    `json:"branch"`
	TargetCanvasID string                 `json:"targetCanvasId"`
	TargetRevision int64                  `json:"targetRevision"`
	Conflicts      []CanvasBranchConflict `json:"conflicts,omitempty"`
	Project        json.RawMessage        `json:"project,omitempty"`
}

func canvasBranchSummary(branch model.CanvasBranch, project *model.CanvasProject) CanvasBranchSummary {
	head := int64(0)
	if project != nil {
		head = project.Revision
	}
	return CanvasBranchSummary{ID: branch.ID, SourceCanvasID: branch.SourceCanvasID, BranchCanvasID: branch.BranchCanvasID, OwnerID: branch.OwnerID, Name: branch.Name, Status: branch.Status, BaseRevision: branch.BaseRevision, HeadRevision: head, LastMergedSourceRev: branch.LastMergedSourceRev, LastMergedTargetRev: branch.LastMergedTargetRev, CreatedAt: branch.CreatedAt, UpdatedAt: branch.UpdatedAt}
}

func (s *Service) canvasWriteAccess(actor *model.User, project *model.CanvasProject) error {
	if actor == nil {
		return kernel.Unauthorized("请先登录")
	}
	if project.UserID == actor.ID {
		return nil
	}
	member, err := s.repo.CanvasCollaboratorForUser(project.ID, actor.ID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return kernel.NewAppError(http.StatusNotFound, "画布不存在或无权访问")
	}
	if err != nil {
		return err
	}
	if member.Role != CanvasCollaboratorRoleEditor {
		return kernel.Forbidden("当前成员只有查看权限")
	}
	return nil
}

func (s *Service) CanvasBranchesForUser(actor *model.User, sourceCanvasID string) ([]CanvasBranchSummary, error) {
	source, err := s.scopedCanvasProject(actor, sourceCanvasID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, kernel.NewAppError(http.StatusNotFound, "画布不存在或无权访问")
		}
		return nil, err
	}
	// Walk the branch lineage so a branch created from another independent
	//方案 is visible in the same tree. The relationship is already encoded by
	// source_canvas_id; no extra schema field is needed.
	result := make([]CanvasBranchSummary, 0)
	queue := []string{source.ID}
	visitedCanvas := map[string]bool{}
	branchIDsByCanvas := map[string]string{}
	for len(queue) > 0 {
		canvasID := queue[0]
		queue = queue[1:]
		if visitedCanvas[canvasID] {
			continue
		}
		visitedCanvas[canvasID] = true
		branches, listErr := s.repo.CanvasBranchesForSource(canvasID)
		if listErr != nil {
			return nil, listErr
		}
		for _, branch := range branches {
			if branchIDsByCanvas[branch.BranchCanvasID] != "" {
				continue
			}
			branchProject, projectErr := s.repo.CanvasProject(branch.BranchCanvasID)
			if errors.Is(projectErr, gorm.ErrRecordNotFound) {
				continue
			}
			if projectErr != nil {
				return nil, projectErr
			}
			// A deleted or inaccessible descendant must not make the whole
			// tree fail to load. The source owner and copied collaborators can
			// still see all normal descendants.
			if _, accessErr := s.scopedCanvasProject(actor, branchProject.ID); accessErr != nil {
				continue
			}
			summary := canvasBranchSummary(branch, branchProject)
			if parentID := branchIDsByCanvas[branch.SourceCanvasID]; parentID != "" {
				summary.ParentBranchID = parentID
			}
			if branch.SourceCanvasID == source.ID {
				summary.SourceTitle = source.Title
			} else if parent, parentErr := s.repo.CanvasProject(branch.SourceCanvasID); parentErr == nil {
				summary.SourceTitle = parent.Title
			}
			branchIDsByCanvas[branch.BranchCanvasID] = branch.ID
			result = append(result, summary)
			queue = append(queue, branch.BranchCanvasID)
		}
	}
	return result, nil
}

func (s *Service) CreateCanvasBranchForUser(actor *model.User, sourceCanvasID string, req CanvasBranchCreateRequest) (CanvasBranchCreateResult, error) {
	source, err := s.scopedCanvasProject(actor, sourceCanvasID)
	if err != nil {
		return CanvasBranchCreateResult{}, err
	}
	if err := s.canvasWriteAccess(actor, source); err != nil {
		return CanvasBranchCreateResult{}, err
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return CanvasBranchCreateResult{}, kernel.BadAuthRequest("请给独立方案起一个名称")
	}
	if len([]rune(name)) > 80 {
		return CanvasBranchCreateResult{}, kernel.BadAuthRequest("独立方案名称不能超过 80 个字")
	}
	baseRevision := source.Revision
	baseRaw, err := canvasProjectPayload(*source)
	if err != nil {
		return CanvasBranchCreateResult{}, err
	}
	if req.BaseRevision != nil {
		if *req.BaseRevision <= 0 || *req.BaseRevision > source.Revision {
			return CanvasBranchCreateResult{}, kernel.BadAuthRequest("分支基线版本无效")
		}
		baseRevision = *req.BaseRevision
		if baseRevision != source.Revision {
			snapshot, snapshotErr := s.repo.CanvasSnapshotAtRevision(source.UserID, source.ID, baseRevision)
			if errors.Is(snapshotErr, gorm.ErrRecordNotFound) {
				return CanvasBranchCreateResult{}, kernel.NewAppError(http.StatusNotFound, "这个历史版本已过期，无法创建独立方案")
			}
			if snapshotErr != nil {
				return CanvasBranchCreateResult{}, snapshotErr
			}
			baseRaw = json.RawMessage(snapshot.PayloadJSON)
		}
	}
	branchCanvasID := kernel.NewID()
	branchRaw, err := rebindBranchPayload(baseRaw, branchCanvasID, name)
	if err != nil {
		return CanvasBranchCreateResult{}, err
	}
	branchProject, err := canvasProjectFromJSON(actor.ID, branchRaw)
	if err != nil {
		return CanvasBranchCreateResult{}, err
	}
	branchProject.ID = branchCanvasID
	branchProject.Title = name
	branchProject.CollaborationEnabled = true
	branchProject.Revision = 1
	if source.UserID != actor.ID {
		// An editor may fork the creative content, but the source owner's
		// business-project association must not silently transfer with it.
		branchProject.ProjectID = ""
	}
	branchProject.CreatedAt = time.Now().UTC()
	branchProject.UpdatedAt = branchProject.CreatedAt
	if source.UserID != actor.ID {
		var branchRoot map[string]json.RawMessage
		if err := json.Unmarshal(branchRaw, &branchRoot); err != nil {
			return CanvasBranchCreateResult{}, err
		}
		setJSONField(branchRoot, "projectId", "")
		branchRaw, err = json.Marshal(branchRoot)
		if err != nil {
			return CanvasBranchCreateResult{}, err
		}
	}
	branchRaw, err = rebindBranchPayload(branchRaw, branchCanvasID, name)
	if err != nil {
		return CanvasBranchCreateResult{}, err
	}
	branchProject.PayloadJSON = string(branchRaw)
	branch := model.CanvasBranch{ID: "branch_" + kernel.NewID(), SourceCanvasID: source.ID, BranchCanvasID: branchCanvasID, OwnerID: actor.ID, Name: name, Status: CanvasBranchStatusActive, BaseRevision: baseRevision, BasePayloadJSON: string(baseRaw), CreatedBy: actor.ID, CreatedAt: branchProject.CreatedAt, UpdatedAt: branchProject.UpdatedAt}
	// Keep the source collaboration roster on the independent canvas. The
	// creator remains the owner even when the source owner created the branch.
	sourceMembers, err := s.repo.CanvasCollaborators(source.ID)
	if err != nil {
		return CanvasBranchCreateResult{}, err
	}
	members := make([]model.CanvasCollaborator, 0, len(sourceMembers)+1)
	seen := map[string]bool{actor.ID: true}
	for _, member := range sourceMembers {
		if seen[member.UserID] {
			continue
		}
		seen[member.UserID] = true
		members = append(members, model.CanvasCollaborator{ID: kernel.NewID(), CanvasID: branchCanvasID, UserID: member.UserID, Role: member.Role, CreatedBy: actor.ID, CreatedAt: branchProject.CreatedAt, UpdatedAt: branchProject.UpdatedAt})
	}
	if source.UserID != actor.ID && !seen[source.UserID] {
		members = append(members, model.CanvasCollaborator{ID: kernel.NewID(), CanvasID: branchCanvasID, UserID: source.UserID, Role: CanvasCollaboratorRoleEditor, CreatedBy: actor.ID, CreatedAt: branchProject.CreatedAt, UpdatedAt: branchProject.UpdatedAt})
	}
	if err := s.repo.WithCanvasCollaborationTransaction(source.ID, func(tx *gorm.DB, locked *model.CanvasProject) error {
		if err := canvasEditAccessTx(tx, locked, actor.ID); err != nil {
			return err
		}
		if locked.Revision != source.Revision {
			return canvasRevisionConflict()
		}
		txRepo := repository.New(tx)
		if err := grantCanvasDocumentMedia(txRepo, actor.ID, branchProject.ID, branchProject.PayloadJSON, source.ID); err != nil {
			return err
		}
		return txRepo.CreateCanvasBranch(&branchProject, &branch, members)
	}); err != nil {
		return CanvasBranchCreateResult{}, err
	}
	return CanvasBranchCreateResult{Branch: canvasBranchSummary(branch, &branchProject), Project: branchRaw}, nil
}

func (s *Service) branchForUser(actor *model.User, branchID string) (*model.CanvasBranch, *model.CanvasProject, error) {
	branch, err := s.repo.CanvasBranch(branchID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil, kernel.NewAppError(http.StatusNotFound, "独立方案不存在")
	}
	if err != nil {
		return nil, nil, err
	}
	if _, err := s.scopedCanvasProject(actor, branch.SourceCanvasID); err != nil {
		// A user who no longer has source access may still use a branch they own.
		if actor == nil || actor.ID != branch.OwnerID {
			return nil, nil, err
		}
	}
	project, err := s.scopedCanvasProject(actor, branch.BranchCanvasID)
	if err != nil {
		return nil, nil, err
	}
	return branch, project, nil
}

func (s *Service) CanvasBranchForUser(actor *model.User, branchID string) (CanvasBranchDetail, error) {
	branch, project, err := s.branchForUser(actor, branchID)
	if err != nil {
		return CanvasBranchDetail{}, err
	}
	raw, err := canvasProjectPayload(*project)
	if err != nil {
		return CanvasBranchDetail{}, err
	}
	return CanvasBranchDetail{Branch: canvasBranchSummary(*branch, project), Project: raw}, nil
}

func (s *Service) ArchiveCanvasBranchForUser(actor *model.User, branchID string) error {
	branch, _, err := s.branchForUser(actor, branchID)
	if err != nil {
		return err
	}
	if actor == nil || actor.ID != branch.OwnerID {
		return kernel.Forbidden("只有独立方案创建者可以归档方案")
	}
	updated, err := s.repo.ArchiveCanvasBranch(branch.ID, time.Now().UTC())
	if err != nil {
		return err
	}
	if !updated {
		return kernel.NewAppError(http.StatusConflict, "这个独立方案已经归档或正在被其他操作处理")
	}
	return nil
}

func (s *Service) CanvasBranchMergePreviewForUser(actor *model.User, branchID string, req CanvasBranchMergePreviewRequest) (CanvasBranchMergePreview, error) {
	branch, branchProject, err := s.branchForUser(actor, branchID)
	if err != nil {
		return CanvasBranchMergePreview{}, err
	}
	targetID := strings.TrimSpace(req.TargetCanvasID)
	if targetID == "" {
		targetID = branch.SourceCanvasID
	}
	if targetID == branch.BranchCanvasID {
		return CanvasBranchMergePreview{}, kernel.BadAuthRequest("不能把独立方案合并到自己")
	}
	target, err := s.scopedCanvasProject(actor, targetID)
	if err != nil {
		return CanvasBranchMergePreview{}, err
	}
	if err := s.canvasWriteAccess(actor, target); err != nil {
		return CanvasBranchMergePreview{}, err
	}
	if req.SourceRevision != 0 && req.SourceRevision != branchProject.Revision {
		return CanvasBranchMergePreview{}, kernel.NewAppError(http.StatusConflict, "独立方案刚刚有新修改，请重新打开合并预览")
	}
	if req.ExpectedTargetRevision != 0 && req.ExpectedTargetRevision != target.Revision {
		return CanvasBranchMergePreview{}, kernel.NewAppError(http.StatusConflict, "目标画布刚刚有新修改，请重新打开合并预览")
	}
	base := json.RawMessage(branch.BasePayloadJSON)
	source, err := canvasProjectPayload(*branchProject)
	if err != nil {
		return CanvasBranchMergePreview{}, err
	}
	targetRaw, err := canvasProjectPayload(*target)
	if err != nil {
		return CanvasBranchMergePreview{}, err
	}
	merged, conflicts, err := mergeCanvasDocuments(base, source, targetRaw)
	if err != nil {
		return CanvasBranchMergePreview{}, err
	}
	if conflicts == nil {
		conflicts = make([]CanvasBranchConflict, 0)
	}
	return CanvasBranchMergePreview{Branch: canvasBranchSummary(*branch, branchProject), TargetCanvasID: targetID, BaseRevision: branch.BaseRevision, SourceRevision: branchProject.Revision, TargetRevision: target.Revision, BaseProject: base, SourceProject: source, TargetProject: targetRaw, AutoMergedProject: merged, Conflicts: conflicts}, nil
}

func (s *Service) MergeCanvasBranchForUser(actor *model.User, branchID string, req CanvasBranchMergeRequest) (CanvasBranchMergeResult, error) {
	branch, _, err := s.branchForUser(actor, branchID)
	if err != nil {
		return CanvasBranchMergeResult{}, err
	}
	targetID := strings.TrimSpace(req.TargetCanvasID)
	if targetID == "" {
		targetID = branch.SourceCanvasID
	}
	if targetID == branch.BranchCanvasID {
		return CanvasBranchMergeResult{}, kernel.BadAuthRequest("不能把独立方案合并到自己")
	}
	if req.ExpectedTargetRevision <= 0 || req.SourceRevision <= 0 {
		return CanvasBranchMergeResult{}, kernel.NewAppError(http.StatusPreconditionRequired, "请先打开最新的合并预览")
	}
	targetProject, targetErr := s.scopedCanvasProject(actor, targetID)
	if targetErr != nil {
		return CanvasBranchMergeResult{}, targetErr
	}
	if err := s.canvasWriteAccess(actor, targetProject); err != nil {
		return CanvasBranchMergeResult{}, err
	}
	var result CanvasBranchMergeResult
	err = s.repo.WithCanvasBranchMerge(branchID, targetID, func(tx *gorm.DB, lockedBranch *model.CanvasBranch, branchProject *model.CanvasProject, target *model.CanvasProject) error {
		if _, err := canvasCollaborationRole(tx, branchProject, actor.ID); err != nil {
			return err
		}
		if err := canvasEditAccessTx(tx, target, actor.ID); err != nil {
			return err
		}
		mergeOpID := canvasBranchMergeOperationID(lockedBranch.ID, req.SourceRevision, req.ExpectedTargetRevision)
		// A client may lose the response after the transaction commits and retry
		// the same merge. Return the committed result instead of treating the
		// retry as a fresh stale-revision conflict.
		var previousMerge model.CanvasCollaborationOperation
		previousErr := tx.Where("canvas_id = ? AND op_id = ? AND kind = ? AND result_status = ?", target.ID, mergeOpID, "merge_branch", canvasCollabApplied).First(&previousMerge).Error
		if previousErr == nil {
			project, projectErr := canvasProjectPayload(*target)
			if projectErr != nil {
				return projectErr
			}
			result = CanvasBranchMergeResult{Status: "already_merged", Branch: canvasBranchSummary(*lockedBranch, branchProject), TargetCanvasID: target.ID, TargetRevision: target.Revision, Project: project}
			return nil
		}
		if !errors.Is(previousErr, gorm.ErrRecordNotFound) {
			return previousErr
		}
		if lockedBranch.Status != CanvasBranchStatusActive {
			return kernel.NewAppError(http.StatusConflict, "这个独立方案已归档，不能继续合并")
		}
		if branchProject.Revision != req.SourceRevision {
			return kernel.NewAppError(http.StatusConflict, "独立方案刚刚有新修改，请重新打开合并预览")
		}
		if target.Revision != req.ExpectedTargetRevision {
			return kernel.NewAppError(http.StatusConflict, "目标画布刚刚有新修改，请重新打开合并预览")
		}
		if err := canvasEditAccessTx(tx, target, actor.ID); err != nil {
			return err
		}
		base := json.RawMessage(lockedBranch.BasePayloadJSON)
		source, err := canvasProjectPayload(*branchProject)
		if err != nil {
			return err
		}
		targetRaw, err := canvasProjectPayload(*target)
		if err != nil {
			return err
		}
		autoMerged, conflicts, err := mergeCanvasDocuments(base, source, targetRaw)
		if err != nil {
			return err
		}
		merged := autoMerged
		if len(req.MergedProject) > 0 {
			if err := validateCanvasBranchManualMerge(autoMerged, req.MergedProject, conflicts); err != nil {
				return err
			}
			merged = req.MergedProject
		} else if len(conflicts) > 0 {
			return kernel.NewAppError(http.StatusConflict, "有几处内容需要先确认，请在合并窗口中选择保留哪一份")
		}
		now := time.Now().UTC()
		requestJSON, _ := json.Marshal(map[string]any{
			"branchId": lockedBranch.ID, "sourceRevision": branchProject.Revision,
			"targetRevision": target.Revision, "hasManualResolution": len(req.MergedProject) > 0,
		})
		rebound, err := rebindTargetPayload(merged, target, now)
		if err != nil {
			return err
		}
		after, err := canvasProjectFromJSON(target.UserID, rebound)
		if err != nil {
			return err
		}
		after.ID = target.ID
		after.Revision = target.Revision
		after.CreatedAt = target.CreatedAt
		after.UpdatedAt = now
		after.ProjectID = target.ProjectID
		after.CollaborationEnabled = target.CollaborationEnabled
		after.PayloadJSON = string(rebound)
		if err := grantCanvasDocumentMedia(repository.New(tx), actor.ID, target.ID, after.PayloadJSON, branchProject.ID); err != nil {
			return err
		}
		snapshot, resourceIDs, err := buildCanvasSnapshot(target, after, "branch_merge")
		if err != nil {
			return err
		}
		if err := s.repo.UpdateCanvasProjectWithSnapshotTx(tx, &after, snapshot, resourceIDs); err != nil {
			if errors.Is(err, repository.ErrCanvasBranchRevisionConflict) || errors.Is(err, repository.ErrCanvasRevisionConflict) {
				return kernel.NewAppError(http.StatusConflict, "目标画布刚刚有新修改，请重新打开合并预览")
			}
			return err
		}
		mergeOp := model.CanvasCollaborationOperation{
			ID: kernel.NewID(), CanvasID: target.ID, ActorID: actor.ID,
			OpID: mergeOpID,
			Kind: "merge_branch", BaseRevision: target.Revision, Revision: after.Revision,
			ResultStatus: canvasCollabApplied, RequestJSON: string(requestJSON),
			ResultJSON: `{"kind":"merge_branch"}`, CreatedAt: now, UpdatedAt: now,
		}
		if err := tx.Create(&mergeOp).Error; err != nil {
			return err
		}
		if err := s.repo.TouchCanvasBranchMerge(tx, lockedBranch.ID, branchProject.Revision, after.Revision, actor.ID, now); err != nil {
			return err
		}
		// The successful merge becomes the next common ancestor. This keeps a
		// long-lived branch useful for a second and third merge instead of
		// reporting the original creation diff forever.
		if err := tx.Model(&model.CanvasBranch{}).Where("id = ?", lockedBranch.ID).Updates(map[string]any{
			"base_revision":     branchProject.Revision,
			"base_payload_json": string(source),
		}).Error; err != nil {
			return err
		}
		updatedBranch := *lockedBranch
		updatedBranch.BaseRevision = branchProject.Revision
		updatedBranch.LastMergedSourceRev = branchProject.Revision
		updatedBranch.LastMergedTargetRev = after.Revision
		updatedBranch.MergedAt = &now
		updatedBranch.MergedBy = actor.ID
		updatedBranch.UpdatedAt = now
		committed, err := canvasProjectPayload(after)
		if err != nil {
			return err
		}
		result = CanvasBranchMergeResult{Status: "merged", Branch: canvasBranchSummary(updatedBranch, branchProject), TargetCanvasID: target.ID, TargetRevision: after.Revision, Conflicts: conflicts, Project: committed}
		return nil
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return CanvasBranchMergeResult{}, kernel.NewAppError(http.StatusNotFound, "分支或目标画布不存在")
		}
		return CanvasBranchMergeResult{}, err
	}
	if result.Status == "merged" {
		s.publishCanvasCollaborationRealtime(CanvasCollaborationRealtimeMessage{Type: "resync", CanvasID: result.TargetCanvasID, ActorID: actor.ID, Kind: "merge_branch", Revision: result.TargetRevision})
	}
	return result, nil
}

func canvasBranchMergeOperationID(branchID string, sourceRevision, targetRevision int64) string {
	return "branch-merge:" + branchID + ":" + formatInt64(sourceRevision) + ":" + formatInt64(targetRevision)
}

func canvasEditAccessTx(tx *gorm.DB, project *model.CanvasProject, actorID string) error {
	if project.UserID == actorID {
		return nil
	}
	var member model.CanvasCollaborator
	if err := tx.Where("canvas_id = ? AND user_id = ?", project.ID, actorID).First(&member).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return kernel.NewAppError(http.StatusNotFound, "目标画布不存在或无权访问")
		}
		return err
	}
	if member.Role != CanvasCollaboratorRoleEditor {
		return kernel.Forbidden("当前成员只有查看权限")
	}
	return nil
}

func rebindBranchPayload(raw json.RawMessage, id, title string) (json.RawMessage, error) {
	var root map[string]json.RawMessage
	if err := json.Unmarshal(raw, &root); err != nil || root == nil {
		return nil, kernel.BadAuthRequest("画布内容格式错误")
	}
	setJSONField(root, "id", id)
	setJSONField(root, "title", title)
	setJSONField(root, "revision", int64(1))
	setJSONField(root, "collaborationEnabled", true)
	setJSONField(root, "createdAt", time.Now().UTC())
	setJSONField(root, "updatedAt", time.Now().UTC())
	return json.Marshal(root)
}

func rebindTargetPayload(raw json.RawMessage, target *model.CanvasProject, now time.Time) (json.RawMessage, error) {
	var root map[string]json.RawMessage
	if err := json.Unmarshal(raw, &root); err != nil || root == nil {
		return nil, kernel.BadAuthRequest("合并后的画布内容格式错误")
	}
	if err := validateBranchStructure(root); err != nil {
		return nil, err
	}
	setJSONField(root, "id", target.ID)
	setJSONField(root, "revision", target.Revision)
	setJSONField(root, "title", target.Title)
	setJSONField(root, "projectId", target.ProjectID)
	setJSONField(root, "collaborationEnabled", target.CollaborationEnabled)
	setJSONField(root, "createdAt", target.CreatedAt)
	setJSONField(root, "updatedAt", now)
	var targetRoot map[string]json.RawMessage
	if json.Unmarshal([]byte(target.PayloadJSON), &targetRoot) == nil {
		if viewport, ok := targetRoot["viewport"]; ok {
			root["viewport"] = viewport
		}
	}
	delete(root, "remoteContentHash")
	return json.Marshal(root)
}

func validateBranchStructure(root map[string]json.RawMessage) error {
	nodes := rawObjectArray(root["nodes"])
	nodeIDs := make(map[string]bool, len(nodes))
	for _, node := range nodes {
		id := rawID(node, "id")
		if id == "" {
			return kernel.BadAuthRequest("合并结果包含没有 ID 的节点")
		}
		if nodeIDs[id] {
			return kernel.BadAuthRequest("合并结果包含重复的节点 ID")
		}
		nodeIDs[id] = true
	}
	connectionIDs := make(map[string]bool)
	for _, connection := range rawObjectArray(root["connections"]) {
		id := rawID(connection, "id")
		if id == "" || connectionIDs[id] {
			return kernel.BadAuthRequest("合并结果包含无效或重复的连线 ID")
		}
		connectionIDs[id] = true
		var item map[string]json.RawMessage
		_ = json.Unmarshal(connection, &item)
		from, to := branchRawString(item["fromNodeId"]), branchRawString(item["toNodeId"])
		if from == "" {
			from = branchRawString(item["sourceNodeId"])
		}
		if to == "" {
			to = branchRawString(item["targetNodeId"])
		}
		if (from != "" && !nodeIDs[from]) || (to != "" && !nodeIDs[to]) {
			return kernel.BadAuthRequest("合并结果包含指向不存在节点的连线")
		}
	}
	return nil
}

func setJSONField(root map[string]json.RawMessage, key string, value any) {
	encoded, _ := json.Marshal(value)
	root[key] = encoded
}

func mergeCanvasDocuments(baseRaw, sourceRaw, targetRaw json.RawMessage) (json.RawMessage, []CanvasBranchConflict, error) {
	var base, source, target map[string]json.RawMessage
	for _, item := range []struct {
		raw json.RawMessage
		dst *map[string]json.RawMessage
	}{{baseRaw, &base}, {sourceRaw, &source}, {targetRaw, &target}} {
		if err := json.Unmarshal(item.raw, item.dst); err != nil || *item.dst == nil {
			return nil, nil, kernel.BadAuthRequest("合并内容格式错误")
		}
	}
	merged := cloneRawMap(target)
	var conflicts []CanvasBranchConflict
	rootKeys := make(map[string]bool, len(base)+len(source)+len(target))
	for key := range base {
		rootKeys[key] = true
	}
	for key := range source {
		rootKeys[key] = true
	}
	for key := range target {
		rootKeys[key] = true
	}
	for key := range rootKeys {
		if key == "id" || key == "title" || key == "projectId" || key == "revision" || key == "createdAt" || key == "updatedAt" || key == "viewport" || key == "remoteContentHash" || key == "collaborationEnabled" || key == "nodes" || key == "connections" {
			continue
		}
		baseValue, baseOK := base[key]
		sourceValue, sourceOK := source[key]
		targetValue, targetOK := target[key]
		localChanged := baseOK != sourceOK || (baseOK && !rawJSONEqual(baseValue, sourceValue))
		remoteChanged := baseOK != targetOK || (baseOK && !rawJSONEqual(baseValue, targetValue))
		sameResult := sourceOK == targetOK && (!sourceOK || rawJSONEqual(sourceValue, targetValue))
		switch {
		case !localChanged:
			// Keep the target value.
		case !remoteChanged:
			if sourceOK {
				merged[key] = cloneRaw(sourceValue)
			} else {
				delete(merged, key)
			}
		case sameResult:
			if sourceOK {
				merged[key] = cloneRaw(sourceValue)
			} else {
				delete(merged, key)
			}
		default:
			conflicts = append(conflicts, CanvasBranchConflict{Path: key, Label: key, Base: cloneRaw(baseValue), Source: cloneRaw(sourceValue), Target: cloneRaw(targetValue)})
		}
	}
	mergeArray := func(key, idKey string) {
		baseItems := rawObjectArray(base[key])
		sourceItems := rawObjectArray(source[key])
		targetItems := rawObjectArray(target[key])
		baseMap, sourceMap, targetMap := rawMapByID(baseItems, idKey), rawMapByID(sourceItems, idKey), rawMapByID(targetItems, idKey)
		ids := map[string]bool{}
		for id := range baseMap {
			ids[id] = true
		}
		for id := range sourceMap {
			ids[id] = true
		}
		for id := range targetMap {
			ids[id] = true
		}
		result := cloneRawMap(targetMap)
		for id := range ids {
			b, bok := baseMap[id]
			s, sok := sourceMap[id]
			t, tok := targetMap[id]
			switch {
			case !bok:
				if !tok {
					if sok {
						result[id] = cloneRaw(s)
					}
				} else if sok && !rawJSONEqual(s, t) {
					conflicts = append(conflicts, CanvasBranchConflict{Path: key + "." + id, Label: "新增内容", Source: cloneRaw(s), Target: cloneRaw(t)})
				}
			case !sok:
				if tok && rawJSONEqual(b, t) {
					delete(result, id)
				} else if tok && !rawJSONEqual(b, t) {
					conflicts = append(conflicts, CanvasBranchConflict{Path: key + "." + id, Label: "删除与修改", Base: cloneRaw(b), Target: cloneRaw(t)})
				}
			case !tok:
				if rawJSONEqual(b, s) {
					delete(result, id)
				} else {
					conflicts = append(conflicts, CanvasBranchConflict{Path: key + "." + id, Label: "修改与删除", Base: cloneRaw(b), Source: cloneRaw(s)})
				}
			default:
				var bm, sm, tm map[string]json.RawMessage
				_ = json.Unmarshal(b, &bm)
				_ = json.Unmarshal(s, &sm)
				_ = json.Unmarshal(t, &tm)
				mergedItem := cloneRawMap(tm)
				for field, sv := range sm {
					if field == idKey {
						continue
					}
					bv, bok := bm[field]
					tv, tok := tm[field]
					if (!bok && !tok) || rawJSONEqual(bv, tv) {
						if !bok || !rawJSONEqual(bv, sv) {
							mergedItem[field] = cloneRaw(sv)
						}
					} else if !rawJSONEqual(bv, sv) && !rawJSONEqual(sv, tv) {
						conflicts = append(conflicts, CanvasBranchConflict{Path: key + "." + id + "." + field, Label: field, Base: cloneRaw(bv), Source: cloneRaw(sv), Target: cloneRaw(tv)})
					}
				}
				result[id], _ = json.Marshal(mergedItem)
			}
		}
		ordered := make([]json.RawMessage, 0, len(result))
		for _, item := range targetItems {
			id := rawID(item, idKey)
			if value, ok := result[id]; ok {
				ordered = append(ordered, value)
				delete(result, id)
			}
		}
		keys := make([]string, 0, len(result))
		for id := range result {
			keys = append(keys, id)
		}
		sort.Strings(keys)
		for _, id := range keys {
			ordered = append(ordered, result[id])
		}
		encoded, _ := json.Marshal(ordered)
		merged[key] = encoded
	}
	mergeArray("nodes", "id")
	mergeArray("connections", "id")
	// Never leave edges pointing at a node deleted by either side.
	mergedNodes := rawMapByID(rawObjectArray(merged["nodes"]), "id")
	validConnections := make([]json.RawMessage, 0)
	for _, connection := range rawObjectArray(merged["connections"]) {
		var item map[string]json.RawMessage
		_ = json.Unmarshal(connection, &item)
		from, to := branchRawString(item["fromNodeId"]), branchRawString(item["toNodeId"])
		if from == "" {
			from = branchRawString(item["sourceNodeId"])
		}
		if to == "" {
			to = branchRawString(item["targetNodeId"])
		}
		if (from == "" || mergedNodes[from] != nil) && (to == "" || mergedNodes[to] != nil) {
			validConnections = append(validConnections, connection)
		}
	}
	merged["connections"], _ = json.Marshal(validConnections)
	encoded, err := json.Marshal(merged)
	return encoded, conflicts, err
}

// validateCanvasBranchManualMerge prevents a client from replacing the whole
// target document while presenting the request as a conflict resolution. A
// valid manual result may differ from the automatic three-way result only at
// paths reported as conflicts, and each such value must equal the source or
// target value shown in the preview.
func validateCanvasBranchManualMerge(autoMergedRaw, submittedRaw json.RawMessage, conflicts []CanvasBranchConflict) error {
	var autoMerged, submitted map[string]json.RawMessage
	if json.Unmarshal(autoMergedRaw, &autoMerged) != nil || autoMerged == nil || json.Unmarshal(submittedRaw, &submitted) != nil || submitted == nil {
		return kernel.BadAuthRequest("合并结果格式错误")
	}
	for _, conflict := range conflicts {
		value, present := branchMergeValueAt(submitted, conflict.Path)
		if !branchMergeValueMatches(value, present, conflict.Source) && !branchMergeValueMatches(value, present, conflict.Target) {
			return kernel.BadAuthRequest("合并结果没有使用预览中的冲突内容，请重新打开合并预览")
		}
		autoValue, autoPresent := branchMergeValueAt(autoMerged, conflict.Path)
		if err := setBranchMergeValue(submitted, conflict.Path, autoValue, autoPresent); err != nil {
			return err
		}
	}
	// A manual choice may delete an item that appears in the middle of an
	// array. Re-inserting the automatic value for comparison must use the
	// automatic merge order; otherwise a valid delete/keep choice is rejected
	// merely because the temporary item was appended at the end.
	alignBranchMergeCollectionOrder(submitted, autoMerged)
	normalized, err := json.Marshal(submitted)
	if err != nil || !rawJSONEqual(normalized, autoMergedRaw) {
		return kernel.BadAuthRequest("合并结果包含未确认的额外修改，请重新打开合并预览")
	}
	return nil
}

func branchMergeValueMatches(value json.RawMessage, present bool, expected json.RawMessage) bool {
	if len(expected) == 0 {
		return !present
	}
	return present && rawJSONEqual(value, expected)
}

func branchMergeValueAt(root map[string]json.RawMessage, path string) (json.RawMessage, bool) {
	parts := strings.Split(path, ".")
	if len(parts) == 0 || parts[0] == "" {
		return nil, false
	}
	if len(parts) == 1 {
		value, ok := root[parts[0]]
		return value, ok
	}
	if parts[0] != "nodes" && parts[0] != "connections" {
		return nil, false
	}
	items := rawObjectArray(root[parts[0]])
	for _, item := range items {
		if rawID(item, "id") != parts[1] {
			continue
		}
		if len(parts) == 2 {
			return item, true
		}
		var object map[string]json.RawMessage
		if json.Unmarshal(item, &object) != nil {
			return nil, false
		}
		return rawObjectPath(object, parts[2:])
	}
	return nil, false
}

func rawObjectPath(object map[string]json.RawMessage, path []string) (json.RawMessage, bool) {
	if len(path) == 0 {
		encoded, _ := json.Marshal(object)
		return encoded, true
	}
	value, ok := object[path[0]]
	if !ok {
		return nil, false
	}
	if len(path) == 1 {
		return value, true
	}
	var child map[string]json.RawMessage
	if json.Unmarshal(value, &child) != nil || child == nil {
		return nil, false
	}
	return rawObjectPath(child, path[1:])
}

func setBranchMergeValue(root map[string]json.RawMessage, path string, value json.RawMessage, present bool) error {
	parts := strings.Split(path, ".")
	if len(parts) == 0 || parts[0] == "" {
		return kernel.BadAuthRequest("合并冲突路径无效")
	}
	if len(parts) == 1 {
		if present {
			root[parts[0]] = cloneRaw(value)
		} else {
			delete(root, parts[0])
		}
		return nil
	}
	if parts[0] != "nodes" && parts[0] != "connections" {
		return kernel.BadAuthRequest("合并冲突路径无效")
	}
	items := rawObjectArray(root[parts[0]])
	for index, item := range items {
		if rawID(item, "id") != parts[1] {
			continue
		}
		if len(parts) == 2 {
			if present {
				items[index] = cloneRaw(value)
			} else {
				items = append(items[:index], items[index+1:]...)
			}
			root[parts[0]], _ = json.Marshal(items)
			return nil
		}
		var object map[string]json.RawMessage
		if json.Unmarshal(item, &object) != nil || object == nil {
			return kernel.BadAuthRequest("合并结果包含无效对象")
		}
		if err := setRawObjectPath(object, parts[2:], value, present); err != nil {
			return err
		}
		items[index], _ = json.Marshal(object)
		root[parts[0]], _ = json.Marshal(items)
		return nil
	}
	if !present {
		return nil
	}
	if len(parts) > 2 {
		return kernel.BadAuthRequest("合并结果缺少冲突对象")
	}
	// The submitted result may intentionally choose deletion while the
	// automatic result still contains the target/source item. Add the
	// reference item so the caller can normalize the collection order before
	// comparing all non-conflicting content.
	items = append(items, cloneRaw(value))
	root[parts[0]], _ = json.Marshal(items)
	return nil
}

func alignBranchMergeCollectionOrder(root, reference map[string]json.RawMessage) {
	for _, key := range []string{"nodes", "connections"} {
		referenceItems := rawObjectArray(reference[key])
		items := rawObjectArray(root[key])
		if len(referenceItems) == 0 || len(items) == 0 {
			continue
		}
		byID := make(map[string]json.RawMessage, len(items))
		for _, item := range items {
			byID[rawID(item, "id")] = item
		}
		ordered := make([]json.RawMessage, 0, len(items))
		for _, item := range referenceItems {
			id := rawID(item, "id")
			if value, ok := byID[id]; ok {
				ordered = append(ordered, value)
				delete(byID, id)
			}
		}
		for _, item := range items {
			id := rawID(item, "id")
			if value, ok := byID[id]; ok {
				ordered = append(ordered, value)
				delete(byID, id)
			}
		}
		root[key], _ = json.Marshal(ordered)
	}
}

func setRawObjectPath(object map[string]json.RawMessage, path []string, value json.RawMessage, present bool) error {
	if len(path) == 0 {
		return nil
	}
	if len(path) == 1 {
		if present {
			object[path[0]] = cloneRaw(value)
		} else {
			delete(object, path[0])
		}
		return nil
	}
	child := map[string]json.RawMessage{}
	if existing, ok := object[path[0]]; ok {
		if json.Unmarshal(existing, &child) != nil || child == nil {
			return kernel.BadAuthRequest("合并结果包含无效嵌套字段")
		}
	}
	if err := setRawObjectPath(child, path[1:], value, present); err != nil {
		return err
	}
	encoded, _ := json.Marshal(child)
	object[path[0]] = encoded
	return nil
}

func formatInt64(value int64) string                 { return strconv.FormatInt(value, 10) }
func cloneRaw(value json.RawMessage) json.RawMessage { return append(json.RawMessage(nil), value...) }
func cloneRawMap(input map[string]json.RawMessage) map[string]json.RawMessage {
	out := make(map[string]json.RawMessage, len(input))
	for k, v := range input {
		out[k] = cloneRaw(v)
	}
	return out
}
func rawJSONEqual(a, b json.RawMessage) bool {
	var av, bv any
	if len(a) == 0 && len(b) == 0 {
		return true
	}
	if json.Unmarshal(a, &av) != nil || json.Unmarshal(b, &bv) != nil {
		return bytes.Equal(a, b)
	}
	return reflect.DeepEqual(av, bv)
}
func rawObjectArray(value json.RawMessage) []json.RawMessage {
	var items []json.RawMessage
	if len(value) > 0 {
		_ = json.Unmarshal(value, &items)
	}
	return items
}
func rawID(value json.RawMessage, key string) string {
	var item map[string]json.RawMessage
	_ = json.Unmarshal(value, &item)
	return branchRawString(item[key])
}
func branchRawString(value json.RawMessage) string {
	var result string
	_ = json.Unmarshal(value, &result)
	return result
}
func rawMapByID(items []json.RawMessage, key string) map[string]json.RawMessage {
	result := make(map[string]json.RawMessage, len(items))
	for _, item := range items {
		if id := rawID(item, key); id != "" {
			result[id] = item
		}
	}
	return result
}
