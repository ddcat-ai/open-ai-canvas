package repository

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"infinite-canvas/backend/internal/model"
)

var ErrCreationConflict = errors.New("creation state changed; reload before continuing")

func (r *Repository) CreationStorageUsage(userID string) (int64, int64, error) {
	var usage struct {
		Count int64
		Bytes int64
	}
	query := `SELECT (SELECT COUNT(*) FROM creation_runs WHERE user_id = ?) AS count,
	(SELECT COALESCE(SUM(length(CAST(COALESCE(state_json,'') AS BLOB))+length(CAST(COALESCE(approved_operations_json,'') AS BLOB))+length(CAST(COALESCE(approved_canvas_json,'') AS BLOB))),0) FROM creation_runs WHERE user_id = ?)
	+ (SELECT COALESCE(SUM(length(CAST(COALESCE(request_json,'') AS BLOB))+length(CAST(COALESCE(quote_json,'') AS BLOB))+length(CAST(COALESCE(price_signature,'') AS BLOB))),0) FROM creation_submissions WHERE user_id = ?) AS bytes`
	if r.Dialect() == "postgres" {
		query = strings.ReplaceAll(query, "length(CAST(COALESCE(", "octet_length(COALESCE(")
		query = strings.ReplaceAll(query, ",'') AS BLOB))", ",''))")
	}
	err := r.db.Raw(query, userID, userID, userID).Scan(&usage).Error
	return usage.Count, usage.Bytes, err
}

func (r *Repository) CreationRun(userID, id string) (*model.CreationRun, error) {
	var run model.CreationRun
	err := r.db.First(&run, "id = ? AND user_id = ?", id, userID).Error
	return &run, err
}

func (r *Repository) CreationRunByClientKey(userID, key string) (*model.CreationRun, error) {
	var run model.CreationRun
	err := r.db.First(&run, "user_id = ? AND client_key = ?", userID, key).Error
	return &run, err
}
func (r *Repository) CreationRuns(userID string) ([]model.CreationRun, error) {
	items := []model.CreationRun{}
	err := r.db.Where("user_id = ?", userID).Order("updated_at DESC").Limit(100).Find(&items).Error
	return items, err
}
func (r *Repository) CreateCreationRun(run *model.CreationRun) error {
	var old model.CreationRun
	if err := r.db.First(&old, "user_id = ? AND client_key = ?", run.UserID, run.ClientKey).Error; err == nil {
		if old.CreateHash != run.CreateHash {
			return ErrCreationConflict
		}
		*run = old
		return nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if err := r.db.Create(run).Error; err != nil {
		if e := r.db.First(&old, "user_id = ? AND client_key = ?", run.UserID, run.ClientKey).Error; e == nil && old.CreateHash == run.CreateHash {
			*run = old
			return nil
		}
		return err
	}
	return nil
}

// A conditional write obtains the run row's write lock in both SQLite and PostgreSQL.
// All submission consumption and task reservation use the returned transaction repository.
func (r *Repository) MutateCreationRun(userID, id string, fn func(*model.CreationRun, *Repository) error) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.CreationRun{}).Where("id = ? AND user_id = ?", id, userID).UpdateColumn("revision", gorm.Expr("revision"))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		scoped := New(tx)
		run, err := scoped.CreationRun(userID, id)
		if err != nil {
			return err
		}
		if err := fn(run, scoped); err != nil {
			return err
		}
		return tx.Save(run).Error
	})
}
func (r *Repository) CreationSubmissions(userID, runID string) ([]model.CreationSubmission, error) {
	items := []model.CreationSubmission{}
	err := r.db.Where("user_id = ? AND run_id = ?", userID, runID).Order("created_at").Find(&items).Error
	return items, err
}
func (r *Repository) CreationSubmission(userID, runID, id string) (*model.CreationSubmission, error) {
	var item model.CreationSubmission
	err := r.db.First(&item, "id = ? AND user_id = ? AND run_id = ?", id, userID, runID).Error
	return &item, err
}
func (r *Repository) SaveCreationSubmission(item *model.CreationSubmission) error {
	return r.db.Save(item).Error
}
func (r *Repository) RevokeCreationSubmissions(runID string) error {
	return r.db.Model(&model.CreationSubmission{}).Where("run_id = ? AND task_id IS NULL AND revoked_at IS NULL", runID).Update("revoked_at", time.Now()).Error
}
func (r *Repository) CreateCreationCanvas(canvas *model.CanvasProject) error {
	return r.UpsertCanvasProject(canvas)
}

// Capture server-side configuration versions, never channel credentials.
func (r *Repository) CreationPriceSignature(task *model.Task, channelID, modelKey string) (string, error) {
	db := r.db.Clauses(clause.Locking{Strength: "SHARE"}).Session(&gorm.Session{})
	values := map[string]any{}
	var cm model.ChannelModel
	query := db.Where("channel_id = ? AND model_key = ?", channelID, modelKey)
	if task.ChannelModelID != "" {
		query = db.Where("id = ?", task.ChannelModelID)
	}
	if err := query.First(&cm).Error; err != nil {
		return "", err
	}
	values["channelModel"] = cm
	values["capabilityConfig"] = cm.CapabilityConfigJSON
	var channel struct {
		ID        string
		Enabled   bool
		UpdatedAt time.Time
	}
	if err := db.Model(&model.ModelChannel{}).Select("id, enabled, updated_at").First(&channel, "id = ?", cm.ChannelID).Error; err != nil {
		return "", err
	}
	values["channel"] = channel
	var tiers []model.ChannelModelPriceTier
	if err := db.Where("channel_model_id = ?", cm.ID).Order("id").Find(&tiers).Error; err != nil {
		return "", err
	}
	values["tiers"] = tiers
	if task.LogicalModelID != "" {
		var logical model.LogicalModel
		if err := db.First(&logical, "id = ?", task.LogicalModelID).Error; err != nil {
			return "", err
		}
		values["logical"] = logical
		var route model.LogicalModelRoute
		if err := db.First(&route, "id = ?", task.RouteID).Error; err != nil {
			return "", err
		}
		values["route"] = route
	}
	var settings []model.SystemSetting
	if err := db.Where("key IN ?", []string{"credit_policy", "feature_availability"}).Order("key").Find(&settings).Error; err != nil {
		return "", err
	}
	values["pricingSettings"] = settings
	b, err := json.Marshal(values)
	return string(b), err
}
