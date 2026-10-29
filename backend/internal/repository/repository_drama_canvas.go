package repository

import (
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

// 短剧与精修画布之间的数据：画布花费汇总、产物版本读取、外部视频采用，以及短剧持有的资源引用。

// DramaCanvasSpends 汇总关联到短剧作品（canvas_projects.project_id）的画布上生成任务的计费。
// 口径与流水线 taskCost 一致：未退款订单按下单金额计，运行中的订单也计入，避免预算被在途任务超出。
func (r *Repository) DramaCanvasSpends(userID string, projectIDs []string) (map[string]int64, error) {
	spends := make(map[string]int64, len(projectIDs))
	if len(projectIDs) == 0 {
		return spends, nil
	}
	var rows []struct {
		ProjectID string
		Total     int64
	}
	err := r.db.Table("canvas_projects").
		Select("canvas_projects.project_id AS project_id, COALESCE(SUM(billing_orders.amount_microcredits), 0) AS total").
		Joins("JOIN tasks ON tasks.project_id = canvas_projects.id AND tasks.user_id = canvas_projects.user_id").
		Joins("JOIN billing_orders ON billing_orders.id = tasks.billing_order_id").
		Where("canvas_projects.user_id = ? AND canvas_projects.project_id IN ? AND billing_orders.status <> ?", userID, projectIDs, model.BillingStatusRefunded).
		Group("canvas_projects.project_id").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		spends[row.ProjectID] = row.Total
	}
	return spends, nil
}

// DramaTakes 返回某个产物最近的版本，新版本在前。
func (r *Repository) DramaTakes(projectID string, ownerID string, kind string, limit int) ([]model.DramaTake, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	var takes []model.DramaTake
	err := r.db.Where("project_id = ? AND owner_id = ? AND kind = ?", projectID, ownerID, kind).Order("version desc").Limit(limit).Find(&takes).Error
	return takes, err
}

// TaskProjectIDs 返回用户任务所属的 project_id（画布任务是画布 ID，流水线任务是短剧作品 ID），用于判断版本来源。
func (r *Repository) TaskProjectIDs(userID string, ids []string) (map[string]string, error) {
	result := make(map[string]string, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	var rows []struct {
		ID        string
		ProjectID string
	}
	if err := r.db.Model(&model.Task{}).Select("id", "project_id").Where("user_id = ? AND id IN ?", userID, ids).Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.ID] = row.ProjectID
	}
	return result, nil
}

// RunningTaskStages 返回用户在途任务里、已被上游接收的任务的进度文案（如“候车 · 前面 3 条”），
// 只用于调度视图展示；没有上游任务 ID 的任务不返回。
func (r *Repository) RunningTaskStages(userID string, ids []string) (map[string]string, error) {
	result := make(map[string]string, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	var rows []struct {
		ID    string
		Stage string
	}
	if err := r.db.Model(&model.Task{}).Select("id", "stage").
		Where("user_id = ? AND id IN ? AND status = ? AND provider_request_id <> ''", userID, ids, model.TaskStatusRunning).
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.ID] = row.Stage
	}
	return result, nil
}

// AdoptDramaSegmentVideo 在一个事务里把外部视频写成剧情段当前视频。
//   - 段版本按 segment.Revision 做 CAS 并递增：调度中在途的生成结果因版本不符只进版本库，不会覆盖采用的视频。
//   - cascade 时后续已有视频的段重新排队（版本递增），首帧换成新视频的尾帧；否则后续段保持不变。
//   - 已有成片标记过期；已完成或正在合成的集退回视频阶段，由调度重新合成。
//
// 返回是否写入，以及重新排队的后续段数量。
func (r *Repository) AdoptDramaSegmentVideo(segment model.DramaSegment, fields map[string]any, cascade bool) (bool, int64, error) {
	adopted := false
	var requeued int64
	err := r.db.Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		fields["revision"] = gorm.Expr("revision + 1")
		fields["updated_at"] = now
		result := tx.Model(&model.DramaSegment{}).Where("id = ? AND revision = ?", segment.ID, segment.Revision).Updates(fields)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return nil
		}
		if cascade {
			later := tx.Model(&model.DramaSegment{}).
				Where("episode_id = ? AND segment_index > ? AND video_resource_id <> ''", segment.EpisodeID, segment.SegmentIndex).
				Updates(map[string]any{"video_status": model.DramaMediaQueued, "video_error": "", "revision": gorm.Expr("revision + 1"), "updated_at": now})
			if later.Error != nil {
				return later.Error
			}
			requeued = later.RowsAffected
		}
		var episode model.DramaEpisode
		if err := tx.First(&episode, "id = ?", segment.EpisodeID).Error; err != nil {
			return err
		}
		episodeFields := map[string]any{"error": "", "revision": gorm.Expr("revision + 1"), "updated_at": now}
		if episode.FinalResourceID != "" {
			episodeFields["final_stale"] = true
		}
		if episode.Stage == model.DramaEpisodeDone || episode.Stage == model.DramaEpisodeRender {
			episodeFields["stage"] = model.DramaEpisodeVideo
		}
		if err := tx.Model(&model.DramaEpisode{}).Where("id = ?", episode.ID).Updates(episodeFields).Error; err != nil {
			return err
		}
		// 本段排队中的重新生成请求已被采用取代。
		if err := tx.Model(&model.DramaJob{}).Where("shot_id = ? AND kind = ? AND status = ?", segment.ID, model.DramaJobSegmentVideo, model.DramaJobQueued).
			Updates(map[string]any{"status": model.DramaJobCanceled, "updated_at": now}).Error; err != nil {
			return err
		}
		adopted = true
		return nil
	})
	return adopted, requeued, err
}

// DramaSegmentsAwaitingTail 返回已采用外部视频、尚未抽取尾帧的剧情段（视频已就绪但缺尾帧）。
func (r *Repository) DramaSegmentsAwaitingTail(episodeID string) ([]model.DramaSegment, error) {
	var segments []model.DramaSegment
	err := r.db.Where("episode_id = ? AND video_status = ? AND video_resource_id <> '' AND tail_frame_resource_id = ''", episodeID, model.DramaMediaReady).
		Order("segment_index asc").Find(&segments).Error
	return segments, err
}

// DramaResourceReferenceKind 标记由短剧表直接持有的资源；素材删除和孤儿清理都保留这些资源。
const DramaResourceReferenceKind = "短剧"

// DramaResourceReferences 返回短剧制作仍在使用的资源：设定参考图、剧情段视频与尾帧、成片以及全部产物版本。
// 这些引用不在任何 JSON 文档里，必须单独查询，否则素材库“彻底删除”或孤儿清理会删掉短剧正在用的媒体。
func (r *Repository) DramaResourceReferences(userID string, resourceIDs []string) ([]ResourceDirectReference, error) {
	references := []ResourceDirectReference{}
	if len(resourceIDs) == 0 {
		return references, nil
	}
	for start := 0; start < len(resourceIDs); start += 400 {
		end := min(start+400, len(resourceIDs))
		chunk, err := r.dramaResourceReferences(userID, resourceIDs[start:end])
		if err != nil {
			return nil, err
		}
		references = append(references, chunk...)
	}
	return references, nil
}

func (r *Repository) dramaResourceReferences(userID string, resourceIDs []string) ([]ResourceDirectReference, error) {
	references := []ResourceDirectReference{}
	projects := r.db.Model(&model.DramaProduction{}).Select("project_id").Where("user_id = ?", userID)
	var casts []model.DramaCast
	if err := r.db.Select("id", "name", "image_resource_id").Where("project_id IN (?) AND image_resource_id IN ?", projects, resourceIDs).Find(&casts).Error; err != nil {
		return nil, err
	}
	for _, cast := range casts {
		references = append(references, ResourceDirectReference{Kind: DramaResourceReferenceKind, ID: cast.ID, Title: cast.Name, ResourceID: cast.ImageResourceID})
	}
	var segments []model.DramaSegment
	if err := r.db.Select("id", "segment_index", "video_resource_id", "tail_frame_resource_id").
		Where("project_id IN (?) AND (video_resource_id IN ? OR tail_frame_resource_id IN ?)", projects, resourceIDs, resourceIDs).Find(&segments).Error; err != nil {
		return nil, err
	}
	wanted := make(map[string]struct{}, len(resourceIDs))
	for _, id := range resourceIDs {
		wanted[id] = struct{}{}
	}
	for _, segment := range segments {
		for _, id := range []string{segment.VideoResourceID, segment.TailFrameResourceID} {
			if _, ok := wanted[id]; ok && id != "" {
				references = append(references, ResourceDirectReference{Kind: DramaResourceReferenceKind, ID: segment.ID, Title: "剧情段", ResourceID: id})
			}
		}
	}
	var episodes []model.DramaEpisode
	if err := r.db.Select("id", "title", "final_resource_id").Where("project_id IN (?) AND final_resource_id IN ?", projects, resourceIDs).Find(&episodes).Error; err != nil {
		return nil, err
	}
	for _, episode := range episodes {
		references = append(references, ResourceDirectReference{Kind: DramaResourceReferenceKind, ID: episode.ID, Title: episode.Title, ResourceID: episode.FinalResourceID})
	}
	var takes []model.DramaTake
	if err := r.db.Select("id", "kind", "resource_id").Where("project_id IN (?) AND resource_id IN ?", projects, resourceIDs).Find(&takes).Error; err != nil {
		return nil, err
	}
	for _, take := range takes {
		references = append(references, ResourceDirectReference{Kind: DramaResourceReferenceKind, ID: take.ID, Title: "短剧版本", ResourceID: take.ResourceID})
	}
	return references, nil
}
