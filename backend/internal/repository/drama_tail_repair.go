package repository

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

const (
	// 筛选原作业 JSON 中由服务端编码的标记，供 SQLite 和 PostgreSQL 共用。执行时还会解析完整快照。
	DramaTailRepairPending  = "pending"
	DramaTailRepairFinished = "finished"
)

func (r *Repository) IsDramaSegmentVideoTask(taskID string) (bool, error) {
	var job model.DramaJob
	err := r.db.Select("id").Take(&job, "task_id = ? AND kind = ?", taskID, model.DramaJobSegmentVideo).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	return err == nil, err
}

func (r *Repository) DramaTailRepairJobs(ctx context.Context) ([]model.DramaJob, error) {
	var jobs []model.DramaJob
	const pending = `%"tailRepair":"pending"%`
	err := r.db.WithContext(ctx).Model(&model.DramaJob{}).
		Select("drama_jobs.*").
		Joins("JOIN drama_segments s ON s.id = drama_jobs.shot_id AND s.project_id = drama_jobs.project_id").
		Joins("JOIN drama_productions p ON p.project_id = s.project_id").
		Joins("JOIN projects ON projects.id = p.project_id AND projects.user_id = p.user_id").
		Joins("LEFT JOIN resources v ON v.id = s.video_resource_id AND v.user_id = p.user_id").
		Joins("JOIN tasks t ON t.id = drama_jobs.task_id AND t.user_id = p.user_id").
		Where("drama_jobs.kind = ? AND drama_jobs.status = ? AND t.status = ?", model.DramaJobSegmentVideo, model.DramaJobFailed, model.TaskStatusSucceeded).
		Where("s.video_status = ? AND COALESCE(s.tail_frame_resource_id, '') = ''", model.DramaMediaFailed).
		Where(`(drama_jobs.payload_json LIKE ? OR (v.provider = 'volcengine' AND v.status = ? AND v.mime_type LIKE ? AND projects.status <> ?
			AND COALESCE(drama_jobs.payload_json, '') NOT LIKE ?
			AND (s.video_error LIKE ? OR s.video_error LIKE ? OR s.video_error LIKE ?)))`,
			pending, model.ResourceStatusReady, "video/%", model.ProjectStatusArchived, `%"tailRepair":%`, "%while reading body%", "%读取段视频超时%", "%读取已保存视频超时%").
		Where(`NOT EXISTS (SELECT 1 FROM drama_jobs newer
			WHERE newer.project_id = s.project_id AND newer.shot_id = s.id AND newer.kind = drama_jobs.kind
			AND (newer.created_at > drama_jobs.created_at OR (newer.created_at = drama_jobs.created_at AND newer.id > drama_jobs.id)))`).
		Order("drama_jobs.updated_at ASC, drama_jobs.id ASC").Limit(20).Find(&jobs).Error
	return jobs, err
}

func (r *Repository) QueueDramaTailRepair(job model.DramaJob, segment model.DramaSegment, payload string) (bool, error) {
	result := r.db.Model(&model.DramaJob{}).
		Where("id = ? AND task_id = ? AND status = ? AND payload_json IN ?", job.ID, job.TaskID, model.DramaJobFailed, []string{job.PayloadJSON, payload}).
		Where("EXISTS (?)", dramaTailRepairTarget(r.db, segment).Select("1")).
		Update("payload_json", payload)
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) FinishDramaTailRepair(job model.DramaJob, segment model.DramaSegment, payload, tailID, reason string) (bool, error) {
	err := r.db.Transaction(func(tx *gorm.DB) error {
		fields := map[string]any{"payload_json": payload, "error": reason}
		videoStatus := model.DramaMediaFailed
		if tailID != "" {
			fields["status"] = model.DramaJobSucceeded
			videoStatus = model.DramaMediaReady
		}
		result := tx.Model(&model.DramaJob{}).
			Where("id = ? AND task_id = ? AND status = ? AND payload_json = ?", job.ID, job.TaskID, model.DramaJobFailed, job.PayloadJSON).
			Updates(fields)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrDramaJobChanged
		}
		result = dramaTailRepairTarget(tx, segment).
			Updates(map[string]any{"video_status": videoStatus, "video_error": reason, "tail_frame_resource_id": tailID})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrDramaJobChanged
		}
		return nil
	})
	if errors.Is(err, ErrDramaJobChanged) {
		return false, nil
	}
	return err == nil, err
}

func (r *Repository) DiscardDramaTailRepair(job model.DramaJob, payload string) error {
	return r.db.Model(&model.DramaJob{}).
		Where("id = ? AND task_id = ? AND status = ? AND payload_json = ?", job.ID, job.TaskID, model.DramaJobFailed, job.PayloadJSON).
		Update("payload_json", payload).Error
}

func dramaTailRepairTarget(db *gorm.DB, segment model.DramaSegment) *gorm.DB {
	return db.Model(&model.DramaSegment{}).Where(
		"id = ? AND project_id = ? AND revision = ? AND video_resource_id = ? AND video_status = ? AND COALESCE(tail_frame_resource_id, '') = ''",
		segment.ID, segment.ProjectID, segment.Revision, segment.VideoResourceID, model.DramaMediaFailed,
	)
}
