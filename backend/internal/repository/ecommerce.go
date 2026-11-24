package repository

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

// Recover the durable receipt even if the browser left before saving the task ID.
// Direction tasks are always created after their project, so the created_at lower
// bound lets the database skip the owner's older tasks before matching input_json.
func (r *Repository) EcommerceDirectionsTask(userID, projectID string, since time.Time) (*model.Task, error) {
	var tasks []model.Task
	query := r.db.Where("user_id = ? AND type = ?", userID, "canvas_text")
	if !since.IsZero() {
		query = query.Where("created_at >= ?", since.Add(-time.Minute))
	}
	if err := query.Where("input_json LIKE ? AND input_json LIKE ?", `%"stage":"creative-directions"%`, `%"ecommerceProjectId":"`+projectID+`"%`).Order("created_at desc, id desc").Limit(10).Find(&tasks).Error; err != nil {
		return nil, err
	}
	for _, task := range tasks {
		var input struct {
			Metadata struct {
				ProjectID string `json:"ecommerceProjectId"`
				Stage     string `json:"stage"`
				Source    string `json:"source"`
			} `json:"metadata"`
		}
		if json.Unmarshal([]byte(task.InputJSON), &input) == nil && input.Metadata.ProjectID == projectID && input.Metadata.Stage == "creative-directions" && input.Metadata.Source == "ecommerce-agent" {
			return &task, nil
		}
	}
	return nil, gorm.ErrRecordNotFound
}

var ErrEcommerceProjectSelectionChanged = errors.New("ecommerce project selection changed")

func (r *Repository) CreateEcommerceProject(project *model.EcommerceProject) error {
	return r.db.Create(project).Error
}

func (r *Repository) EcommerceProject(userID, id string) (*model.EcommerceProject, error) {
	var project model.EcommerceProject
	if err := r.db.Where("user_id = ? AND id = ?", userID, id).First(&project).Error; err != nil {
		return nil, err
	}
	return &project, nil
}

func (r *Repository) EcommerceProjects(userID string) ([]model.EcommerceProject, error) {
	projects, _, err := r.EcommerceProjectPage(userID, 1, 100)
	return projects, err
}

func (r *Repository) EcommerceProjectPage(userID string, page, pageSize int) ([]model.EcommerceProject, int64, error) {
	projects := make([]model.EcommerceProject, 0)
	var total int64
	if err := r.db.Model(&model.EcommerceProject{}).Where("user_id = ?", userID).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := r.db.Where("user_id = ?", userID).Order("updated_at desc, id desc").Limit(pageSize).Offset((page - 1) * pageSize).Find(&projects).Error
	return projects, total, err
}

// DeleteEcommerceProjects removes only the owner's project records. Referenced
// resources and generation tasks have their own lifecycles and remain intact.
func (r *Repository) DeleteEcommerceProjects(userID string, ids []string, all bool, expectedTotal int64) (int64, error) {
	var deleted int64
	err := r.db.Transaction(func(tx *gorm.DB) error {
		query := tx.Model(&model.EcommerceProject{}).Where("user_id = ?", userID)
		if !all {
			query = query.Where("id IN ?", ids)
		}
		var matchedIDs []string
		if err := query.Pluck("id", &matchedIDs).Error; err != nil {
			return err
		}
		if int64(len(matchedIDs)) != expectedTotal {
			return ErrEcommerceProjectSelectionChanged
		}
		result := tx.Where("user_id = ? AND id IN ?", userID, matchedIDs).Delete(&model.EcommerceProject{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != expectedTotal {
			return ErrEcommerceProjectSelectionChanged
		}
		// Rounds belong to the deleted projects only; tasks and resources keep
		// their own lifecycle and are never touched here.
		if err := tx.Where("user_id = ? AND project_id IN ?", userID, matchedIDs).Delete(&model.EcommerceRound{}).Error; err != nil {
			return err
		}
		deleted = result.RowsAffected
		return nil
	})
	return deleted, err
}
func (r *Repository) SaveEcommerceProject(project *model.EcommerceProject, expectedRevision int64) error {
	err := r.db.Transaction(func(tx *gorm.DB) error {
		stored, err := lockEcommerceProject(tx, project.UserID, project.ID)
		if err != nil {
			return err
		}
		if stored.Revision != expectedRevision {
			return gorm.ErrRecordNotFound
		}
		if stored.ActiveRoundID != "" {
			// An older client can still send inline history. Split it into round
			// rows (deduplicated) instead of writing it back onto the project row.
			var plan model.EcommercePlan
			if json.Unmarshal([]byte(project.PlanJSON), &plan) == nil && len(plan.PreviousImages) > 0 {
				legacy := *project
				if _, err := convertEcommerceLegacyRounds(tx, &legacy); err != nil {
					return err
				}
				project.PlanJSON = legacy.PlanJSON
			}
			project.ActiveRoundID = stored.ActiveRoundID
		}
		result := tx.Model(&model.EcommerceProject{}).
			Where("id = ? AND user_id = ? AND revision = ?", project.ID, project.UserID, expectedRevision).
			Updates(map[string]any{"name": project.Name, "status": project.Status, "draft_json": project.DraftJSON, "plan_json": project.PlanJSON, "revision": expectedRevision + 1})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
	if err != nil {
		return err
	}
	project.Revision = expectedRevision + 1
	return nil
}

// ErrEcommerceRoundConflict reports a stale revision, a stale active round, or
// an edited history image whose version changed. Callers must reload and retry
// explicitly; nothing is overwritten silently.
var ErrEcommerceRoundConflict = errors.New("ecommerce round conflict")

type EcommerceRoundsSaveOptions struct {
	RoundMode     bool
	AdvanceRound  bool
	ActiveRoundID string
}

// SaveEcommerceProjectRounds stores the bounded active draft/plan. In round
// mode it first converts legacy inline history, then optionally archives the
// current active round and allocates the next active round. All of this happens
// in one transaction guarded by the project revision.
func (r *Repository) SaveEcommerceProjectRounds(project *model.EcommerceProject, expectedRevision int64, opts EcommerceRoundsSaveOptions) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		stored, err := lockEcommerceProject(tx, project.UserID, project.ID)
		if err != nil {
			return err
		}
		if stored.Revision != expectedRevision {
			return ErrEcommerceRoundConflict
		}
		activeID := stored.ActiveRoundID
		if opts.RoundMode {
			if _, err := convertEcommerceLegacyRounds(tx, stored); err != nil {
				return err
			}
			activeID = stored.ActiveRoundID
			if opts.ActiveRoundID != "" && activeID != "" && opts.ActiveRoundID != activeID {
				return ErrEcommerceRoundConflict
			}
			if opts.AdvanceRound {
				if hasEcommercePlanImages(stored.PlanJSON) {
					archived, err := archiveEcommerceRound(tx, stored.UserID, stored.ID, stored.DraftJSON, stored.PlanJSON)
					if err != nil {
						return err
					}
					if archived {
						activeID = kernel.NewID()
					}
				}
			}
			if activeID == "" {
				activeID = kernel.NewID()
			}
			project.ActiveRoundID = activeID
		}
		updates := map[string]any{"name": project.Name, "status": project.Status, "draft_json": project.DraftJSON, "plan_json": project.PlanJSON, "revision": expectedRevision + 1}
		if opts.RoundMode {
			updates["active_round_id"] = project.ActiveRoundID
		}
		result := tx.Model(&model.EcommerceProject{}).
			Where("id = ? AND user_id = ? AND revision = ?", project.ID, project.UserID, expectedRevision).
			Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrEcommerceRoundConflict
		}
		project.Revision = expectedRevision + 1
		return nil
	})
}

// ConvertEcommerceProjectRounds is the explicit, idempotent legacy conversion.
// It bumps the revision so an old client holding the pre-conversion plan cannot
// write the whole history back afterwards.
func (r *Repository) ConvertEcommerceProjectRounds(userID, projectID string, expectedRevision int64) (*model.EcommerceProject, int, error) {
	created := 0
	err := r.db.Transaction(func(tx *gorm.DB) error {
		stored, err := lockEcommerceProject(tx, userID, projectID)
		if err != nil {
			return err
		}
		if stored.Revision != expectedRevision {
			return ErrEcommerceRoundConflict
		}
		var before model.EcommercePlan
		hadPrevious := json.Unmarshal([]byte(stored.PlanJSON), &before) == nil && len(before.PreviousImages) > 0
		alreadyConverted := stored.ActiveRoundID != ""
		created, err = convertEcommerceLegacyRounds(tx, stored)
		if err != nil {
			return err
		}
		if !hadPrevious && alreadyConverted {
			return nil
		}
		if stored.ActiveRoundID == "" {
			stored.ActiveRoundID = kernel.NewID()
		}
		if err := tx.Model(&model.EcommerceProject{}).
			Where("id = ? AND user_id = ? AND revision = ?", stored.ID, stored.UserID, stored.Revision).
			Updates(map[string]any{"plan_json": stored.PlanJSON, "active_round_id": stored.ActiveRoundID, "revision": stored.Revision + 1}).Error; err != nil {
			return err
		}
		stored.Revision++
		return nil
	})
	if err != nil {
		return nil, 0, err
	}
	project, err := r.EcommerceProject(userID, projectID)
	if err != nil {
		return nil, 0, err
	}
	return project, created, nil
}

func lockEcommerceProject(tx *gorm.DB, userID, projectID string) (*model.EcommerceProject, error) {
	var stored model.EcommerceProject
	query := tx
	if tx.Dialector.Name() == "postgres" {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if err := query.Where("user_id = ? AND id = ?", userID, projectID).First(&stored).Error; err != nil {
		return nil, err
	}
	return &stored, nil
}

func hasEcommercePlanImages(planJSON string) bool {
	var plan model.EcommercePlan
	if json.Unmarshal([]byte(planJSON), &plan) != nil {
		return false
	}
	return len(plan.Images) > 0
}

// convertEcommerceLegacyRounds moves inline previousImages into round rows,
// grouped by their original draft snapshot. Repeated calls are no-ops because
// the stored plan no longer carries previousImages afterwards.
func convertEcommerceLegacyRounds(tx *gorm.DB, project *model.EcommerceProject) (int, error) {
	var plan model.EcommercePlan
	if json.Unmarshal([]byte(project.PlanJSON), &plan) != nil {
		plan = model.EcommercePlan{}
	}
	if len(plan.PreviousImages) == 0 {
		if project.ActiveRoundID == "" {
			project.ActiveRoundID = kernel.NewID()
		}
		return 0, nil
	}
	type group struct {
		draft  string
		images []model.EcommercePlanTask
	}
	// Only adjacent images sharing a draft form one round. Grouping by draft
	// globally would merge a later round back into an earlier one whenever the
	// same product draft reappears, losing the chronological round boundaries.
	groups := make([]group, 0, 4)
	for _, image := range plan.PreviousImages {
		draftJSON := "{}"
		if len(image.SourceDraft) > 0 && json.Valid(image.SourceDraft) {
			draftJSON = string(image.SourceDraft)
		}
		image.RoundID = ""
		if len(groups) == 0 || groups[len(groups)-1].draft != draftJSON {
			groups = append(groups, group{draft: draftJSON})
		}
		groups[len(groups)-1].images = append(groups[len(groups)-1].images, image)
	}
	var existingRounds []model.EcommerceRound
	if err := tx.Model(&model.EcommerceRound{}).Where("project_id = ?", project.ID).Select("plan_json").Find(&existingRounds).Error; err != nil {
		return 0, err
	}
	archivedTasks := make(map[string]struct{})
	for _, round := range existingRounds {
		var archived model.EcommercePlan
		if json.Unmarshal([]byte(round.PlanJSON), &archived) != nil {
			continue
		}
		for _, image := range archived.Images {
			if image.TaskID != "" {
				archivedTasks[image.TaskID] = struct{}{}
			}
		}
	}
	var maxOrdinal int
	if err := tx.Model(&model.EcommerceRound{}).Where("project_id = ?", project.ID).Select("COALESCE(MAX(ordinal), 0)").Scan(&maxOrdinal).Error; err != nil {
		return 0, err
	}
	created := 0
	ordinal := maxOrdinal
	for _, item := range groups {
		// A legacy client can replay the same artwork with a new draft snapshot
		// stamped on it (and with locally edited/removed images). Tasks are unique
		// per generated artwork, so any overlap means this group was already
		// archived; re-inserting it would duplicate or resurrect edited history.
		replayed := false
		for _, image := range item.images {
			if _, ok := archivedTasks[image.TaskID]; ok && image.TaskID != "" {
				replayed = true
				break
			}
		}
		if replayed {
			continue
		}
		dedup := ecommerceRoundKey(item.draft, item.images)
		var existing int64
		if err := tx.Model(&model.EcommerceRound{}).Where("project_id = ? AND dedup_key = ?", project.ID, dedup).Count(&existing).Error; err != nil {
			return 0, err
		}
		if existing > 0 {
			continue
		}
		ordinal++
		roundPlan, err := json.Marshal(model.EcommercePlan{Images: item.images})
		if err != nil {
			return 0, err
		}
		round := model.EcommerceRound{
			ID:         kernel.NewID(),
			UserID:     project.UserID,
			ProjectID:  project.ID,
			Ordinal:    ordinal,
			DedupKey:   dedup,
			DraftJSON:  item.draft,
			PlanJSON:   string(roundPlan),
			ImageCount: len(item.images),
			Version:    1,
		}
		if err := tx.Create(&round).Error; err != nil {
			return 0, err
		}
		for _, image := range item.images {
			if image.TaskID != "" {
				archivedTasks[image.TaskID] = struct{}{}
			}
		}
		created++
	}
	plan.PreviousImages = nil
	raw, err := json.Marshal(plan)
	if err != nil {
		return 0, err
	}
	project.PlanJSON = string(raw)
	if project.ActiveRoundID == "" {
		project.ActiveRoundID = kernel.NewID()
	}
	return created, nil
}

// archiveEcommerceRound snapshots the stored active plan as one round. The
// dedup key makes retries idempotent even if the caller's revision handling
// failed and the same round is archived twice.
func archiveEcommerceRound(tx *gorm.DB, userID, projectID, draftJSON, planJSON string) (bool, error) {
	var plan model.EcommercePlan
	if json.Unmarshal([]byte(planJSON), &plan) != nil {
		return false, nil
	}
	// Only admitted tasks become history, matching the client archive rule;
	// pending sketches are discarded when the round advances.
	admitted := make([]model.EcommercePlanTask, 0, len(plan.Images))
	for _, image := range plan.Images {
		if image.TaskID == "" {
			continue
		}
		image.RoundID = ""
		admitted = append(admitted, image)
	}
	if len(admitted) == 0 {
		return false, nil
	}
	plan.Images = admitted
	draft := "{}"
	if json.Valid([]byte(draftJSON)) {
		draft = draftJSON
	}
	dedup := ecommerceRoundKey(draft, plan.Images)
	var existing int64
	if err := tx.Model(&model.EcommerceRound{}).Where("project_id = ? AND dedup_key = ?", projectID, dedup).Count(&existing).Error; err != nil {
		return false, err
	}
	if existing > 0 {
		return true, nil
	}
	var maxOrdinal int
	if err := tx.Model(&model.EcommerceRound{}).Where("project_id = ?", projectID).Select("COALESCE(MAX(ordinal), 0)").Scan(&maxOrdinal).Error; err != nil {
		return false, err
	}
	plan.PreviousImages = nil
	roundPlan, err := json.Marshal(plan)
	if err != nil {
		return false, err
	}
	round := model.EcommerceRound{
		ID:         kernel.NewID(),
		UserID:     userID,
		ProjectID:  projectID,
		Ordinal:    maxOrdinal + 1,
		DedupKey:   dedup,
		DraftJSON:  draft,
		PlanJSON:   string(roundPlan),
		ImageCount: len(plan.Images),
		Version:    1,
	}
	return true, tx.Create(&round).Error
}

func ecommerceRoundKey(draftJSON string, images []model.EcommercePlanTask) string {
	if !json.Valid([]byte(draftJSON)) {
		draftJSON = "{}"
	}
	payload, err := json.Marshal(struct {
		Draft  json.RawMessage           `json:"draft"`
		Images []model.EcommercePlanTask `json:"images"`
	}{Draft: json.RawMessage(draftJSON), Images: images})
	if err != nil {
		payload = []byte(draftJSON)
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

func (r *Repository) EcommerceRoundPage(userID, projectID string, limit, before int) ([]model.EcommerceRound, int64, error) {
	rounds := make([]model.EcommerceRound, 0)
	var total int64
	if err := r.db.Model(&model.EcommerceRound{}).Where("user_id = ? AND project_id = ?", userID, projectID).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	query := r.db.Where("user_id = ? AND project_id = ?", userID, projectID)
	if before > 0 {
		query = query.Where("ordinal < ?", before)
	}
	err := query.Order("ordinal desc").Limit(limit).Find(&rounds).Error
	return rounds, total, err
}

func (r *Repository) EcommerceRound(userID, projectID, roundID string) (*model.EcommerceRound, error) {
	var round model.EcommerceRound
	if err := r.db.Where("user_id = ? AND project_id = ? AND id = ?", userID, projectID, roundID).First(&round).Error; err != nil {
		return nil, err
	}
	return &round, nil
}

func (r *Repository) EcommerceRoundCount(userID, projectID string) (int64, error) {
	total, _, err := r.EcommerceRoundStats(userID, projectID)
	return total, err
}

func (r *Repository) EcommerceRoundStats(userID, projectID string) (int64, int64, error) {
	var count, images int64
	err := r.db.Model(&model.EcommerceRound{}).
		Where("user_id = ? AND project_id = ?", userID, projectID).
		Select("COUNT(*), COALESCE(SUM(image_count), 0)").
		Row().Scan(&count, &images)
	return count, images, err
}

// EcommerceRoundCoverTaskIDs returns task IDs from the newest rounds only, so
// project cards can show historical covers without reading the whole history.
func (r *Repository) EcommerceRoundCoverTaskIDs(userID, projectID string, limit int) ([]string, error) {
	rounds := make([]model.EcommerceRound, 0, 4)
	if err := r.db.Where("user_id = ? AND project_id = ?", userID, projectID).Order("ordinal desc").Limit(4).Find(&rounds).Error; err != nil {
		return nil, err
	}
	ids := make([]string, 0, limit)
	for _, round := range rounds {
		var plan model.EcommercePlan
		if json.Unmarshal([]byte(round.PlanJSON), &plan) != nil {
			continue
		}
		for i := len(plan.Images) - 1; i >= 0 && len(ids) < limit; i-- {
			if plan.Images[i].TaskID != "" {
				ids = append(ids, plan.Images[i].TaskID)
			}
		}
		if len(ids) >= limit {
			break
		}
	}
	return ids, nil
}

type EcommerceRoundImageUpdate struct {
	ExpectedVersion int64
	Image           *model.EcommercePlanTask
	Remove          bool
}

// UpdateEcommerceRoundImage edits exactly one image of one archived round.
// Identical content is an idempotent success; otherwise the round version must
// match. Removing a missing image is also an idempotent success.
func (r *Repository) UpdateEcommerceRoundImage(userID, projectID, roundID, imageID string, update EcommerceRoundImageUpdate) (*model.EcommerceRound, bool, error) {
	var result model.EcommerceRound
	changed := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		query := tx
		if tx.Dialector.Name() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := query.Where("user_id = ? AND project_id = ? AND id = ?", userID, projectID, roundID).First(&result).Error; err != nil {
			return err
		}
		var plan model.EcommercePlan
		if err := json.Unmarshal([]byte(result.PlanJSON), &plan); err != nil {
			return err
		}
		next := plan
		next.Images = append([]model.EcommercePlanTask{}, plan.Images...)
		found := false
		for i := range next.Images {
			if next.Images[i].ID != imageID {
				continue
			}
			found = true
			if update.Remove {
				next.Images = append(next.Images[:i], next.Images[i+1:]...)
			} else {
				image := *update.Image
				image.ID = imageID
				image.RoundID = ""
				next.Images[i] = image
			}
			break
		}
		if update.Remove && !found {
			return nil
		}
		if !update.Remove && !found {
			return gorm.ErrRecordNotFound
		}
		currentJSON, _ := json.Marshal(plan.Images)
		nextJSON, _ := json.Marshal(next.Images)
		if string(currentJSON) == string(nextJSON) {
			// The retried edit already landed (or the image was already gone);
			// report success without another write or version bump.
			return nil
		}
		if result.Version != update.ExpectedVersion {
			return ErrEcommerceRoundConflict
		}
		nextJSONFull, err := json.Marshal(next)
		if err != nil {
			return err
		}
		updated := tx.Model(&model.EcommerceRound{}).
			Where("user_id = ? AND project_id = ? AND id = ? AND version = ?", userID, projectID, roundID, update.ExpectedVersion).
			Updates(map[string]any{"plan_json": string(nextJSONFull), "image_count": len(next.Images), "version": update.ExpectedVersion + 1})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrEcommerceRoundConflict
		}
		result.PlanJSON = string(nextJSONFull)
		result.ImageCount = len(next.Images)
		result.Version = update.ExpectedVersion + 1
		changed = true
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	return &result, changed, nil
}
