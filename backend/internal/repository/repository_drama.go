package repository

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ErrDramaPlanPending 表示还有章节在等待分集规划，此时不能逐集追加。
var ErrDramaPlanPending = errors.New("drama plan pending")

func (r *Repository) DramaProduction(projectID string) (*model.DramaProduction, error) {
	var production model.DramaProduction
	if err := r.db.First(&production, "project_id = ?", projectID).Error; err != nil {
		return nil, err
	}
	return &production, nil
}

// RunningDramaProductions 返回需要调度循环推进的项目：运行中的项目，以及暂停或已完成但仍有已派发任务的项目。
// 后者只回收任务结果（已付费的视频、尾帧），不再派发新工作。
func (r *Repository) RunningDramaProductions(limit int) ([]model.DramaProduction, error) {
	var productions []model.DramaProduction
	pending := r.db.Model(&model.DramaJob{}).Select("project_id").Where("status = ?", model.DramaJobRunning)
	err := r.db.Where("status = ? OR project_id IN (?)", model.DramaStatusRunning, pending).Order("updated_at asc").Limit(limit).Find(&productions).Error
	return productions, err
}

// CreateDramaProject 在同一事务内写入项目、章节与制作控制面，避免出现无章节的半成品项目。
// episodes 非空表示每章直接成为一集（逐集制作），不经过分集规划。
func (r *Repository) CreateDramaProject(project *model.Project, chapters []model.ProjectUnit, production *model.DramaProduction, episodes ...model.DramaEpisode) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}, {Name: "name"}}, DoNothing: true}).Create(project)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrProjectNameConflict
		}
		if len(chapters) > 0 {
			if err := tx.CreateInBatches(&chapters, 200).Error; err != nil {
				return err
			}
		}
		if len(episodes) > 0 {
			if err := tx.CreateInBatches(&episodes, 200).Error; err != nil {
				return err
			}
		}
		return tx.Create(production).Error
	})
}

// AppendDramaEpisodeSource 在作品末尾追加一章原文和对应的一集，并把分集游标推过这一章，
// 调度循环不会再把它交给分集规划。只允许在分集规划完成后追加，否则游标会把新章节并入规划批次。
func (r *Repository) AppendDramaEpisodeSource(projectID string, chapter *model.ProjectUnit, episode *model.DramaEpisode) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var production model.DramaProduction
		if err := tx.First(&production, "project_id = ?", projectID).Error; err != nil {
			return err
		}
		if !production.PlanDone {
			return ErrDramaPlanPending
		}
		var count int64
		if err := tx.Model(&model.ProjectUnit{}).Where("project_id = ? AND kind = ?", projectID, model.ProjectUnitKindChapter).Count(&count).Error; err != nil {
			return err
		}
		var position int
		if err := tx.Model(&model.ProjectUnit{}).Where("project_id = ? AND kind = ?", projectID, model.ProjectUnitKindChapter).Select("COALESCE(MAX(position), -1)").Scan(&position).Error; err != nil {
			return err
		}
		var number int
		if err := tx.Model(&model.DramaEpisode{}).Where("project_id = ?", projectID).Select("COALESCE(MAX(number), 0)").Scan(&number).Error; err != nil {
			return err
		}
		chapter.Position = position + 1
		episode.Number = number + 1
		if err := tx.Create(chapter).Error; err != nil {
			return err
		}
		if err := tx.Create(episode).Error; err != nil {
			return err
		}
		return tx.Model(&model.DramaProduction{}).Where("project_id = ?", projectID).
			Updates(map[string]any{"plan_cursor": count + 1, "plan_done": true, "updated_at": time.Now()}).Error
	})
}

// UpdateDramaChapterSource 修改一章原文与字数。
func (r *Repository) UpdateDramaChapterSource(projectID, chapterID string, fields map[string]any) error {
	fields["updated_at"] = time.Now()
	return r.db.Model(&model.ProjectUnit{}).Where("id = ? AND project_id = ? AND kind = ?", chapterID, projectID, model.ProjectUnitKindChapter).Updates(fields).Error
}

// InsertDramaShot 在同一剧情段内插入镜头：后续镜头顺延，本段提示词与视频过期。
func (r *Repository) InsertDramaShot(shot model.DramaShot) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.DramaShot{}).Where("episode_id = ? AND position >= ?", shot.EpisodeID, shot.Position).
			Update("position", gorm.Expr("position + 1")).Error; err != nil {
			return err
		}
		if err := tx.Create(&shot).Error; err != nil {
			return err
		}
		return refreshDramaSegmentAfterShotChange(tx, shot)
	})
}

// DeleteDramaShot 删除镜头并前移后续镜头；调用方保证本段还剩其他镜头。
func (r *Repository) DeleteDramaShot(shot model.DramaShot) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("id = ? AND project_id = ?", shot.ID, shot.ProjectID).Delete(&model.DramaShot{}).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.DramaShot{}).Where("episode_id = ? AND position > ?", shot.EpisodeID, shot.Position).
			Update("position", gorm.Expr("position - 1")).Error; err != nil {
			return err
		}
		return refreshDramaSegmentAfterShotChange(tx, shot)
	})
}

func refreshDramaSegmentAfterShotChange(tx *gorm.DB, shot model.DramaShot) error {
	var segment model.DramaSegment
	if err := tx.Where("episode_id = ? AND segment_index = ?", shot.EpisodeID, shot.SegmentIndex).First(&segment).Error; err != nil {
		return err
	}
	if err := invalidateDramaSegment(tx, segment, map[string]any{"prompt_status": promptStatusAfterInputChange(segment.PromptStatus), "video_prompt_override": ""}, true); err != nil {
		return err
	}
	if err := tx.Model(&model.DramaEpisode{}).Where("id = ?", shot.EpisodeID).Update("duration_ms", tx.Model(&model.DramaShot{}).Select("COALESCE(SUM(duration_ms),0)").Where("episode_id = ?", shot.EpisodeID)).Error; err != nil {
		return err
	}
	return tx.Model(&model.DramaEpisode{}).Where("id = ?", shot.EpisodeID).Update("shot_count", tx.Model(&model.DramaShot{}).Select("COUNT(*)").Where("episode_id = ?", shot.EpisodeID)).Error
}

func (r *Repository) DramaChapters(projectID string) ([]model.ProjectUnit, error) {
	var units []model.ProjectUnit
	err := r.db.Where("project_id = ? AND kind = ?", projectID, model.ProjectUnitKindChapter).Order("position asc").Find(&units).Error
	return units, err
}

func (r *Repository) DramaChapterSummaries(projectID string) ([]model.ProjectUnit, error) {
	var units []model.ProjectUnit
	err := r.db.Select("id", "project_id", "kind", "title", "word_count", "position", "status", "created_at", "updated_at").
		Where("project_id = ? AND kind = ?", projectID, model.ProjectUnitKindChapter).Order("position asc").Find(&units).Error
	return units, err
}

func (r *Repository) DramaChaptersByIDs(projectID string, ids []string) ([]model.ProjectUnit, error) {
	var units []model.ProjectUnit
	if len(ids) == 0 {
		return units, nil
	}
	err := r.db.Where("project_id = ? AND id IN ?", projectID, ids).Order("position asc").Find(&units).Error
	return units, err
}

func (r *Repository) DramaCasts(projectID string) ([]model.DramaCast, error) {
	var casts []model.DramaCast
	err := r.db.Where("project_id = ?", projectID).Order("kind asc, position asc").Find(&casts).Error
	return casts, err
}

func (r *Repository) DramaCast(projectID string, id string) (*model.DramaCast, error) {
	var cast model.DramaCast
	if err := r.db.First(&cast, "id = ? AND project_id = ?", id, projectID).Error; err != nil {
		return nil, err
	}
	return &cast, nil
}

func (r *Repository) CreateDramaCasts(casts []model.DramaCast) error {
	if len(casts) == 0 {
		return nil
	}
	return r.db.Create(&casts).Error
}

func (r *Repository) DramaEpisodes(projectID string) ([]model.DramaEpisode, error) {
	var episodes []model.DramaEpisode
	err := r.db.Omit("subtitle_srt").Where("project_id = ?", projectID).Order("number asc").Find(&episodes).Error
	return episodes, err
}

func (r *Repository) DramaEpisode(projectID string, id string) (*model.DramaEpisode, error) {
	var episode model.DramaEpisode
	if err := r.db.First(&episode, "id = ? AND project_id = ?", id, projectID).Error; err != nil {
		return nil, err
	}
	return &episode, nil
}

func (r *Repository) MaxDramaEpisodeNumber(projectID string) (int, error) {
	var number int
	err := r.db.Model(&model.DramaEpisode{}).Where("project_id = ?", projectID).Select("COALESCE(MAX(number), 0)").Scan(&number).Error
	return number, err
}

func (r *Repository) LastDramaEpisode(projectID string) (*model.DramaEpisode, error) {
	var episode model.DramaEpisode
	err := r.db.Where("project_id = ?", projectID).Order("number desc").First(&episode).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &episode, nil
}

// AppendDramaEpisodes 写入规划出的分集并推进规划游标，保证重复回填不会生成重复集。
func (r *Repository) AppendDramaEpisodes(production *model.DramaProduction, episodes []model.DramaEpisode, expectedCursor int) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.DramaProduction{}).Where("project_id = ? AND plan_cursor = ?", production.ProjectID, expectedCursor).
			Updates(map[string]any{"plan_cursor": production.PlanCursor, "plan_done": production.PlanDone, "updated_at": time.Now()})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrInvalidData
		}
		if len(episodes) == 0 {
			return nil
		}
		return tx.Create(&episodes).Error
	})
}

func (r *Repository) DramaShots(episodeID string) ([]model.DramaShot, error) {
	var shots []model.DramaShot
	err := r.db.Where("episode_id = ?", episodeID).Order("position asc").Find(&shots).Error
	return shots, err
}

func (r *Repository) DramaShot(projectID string, id string) (*model.DramaShot, error) {
	var shot model.DramaShot
	if err := r.db.First(&shot, "id = ? AND project_id = ?", id, projectID).Error; err != nil {
		return nil, err
	}
	return &shot, nil
}

func (r *Repository) CreateDramaTake(take *model.DramaTake) error {
	if take.TaskID != "" {
		var count int64
		if err := r.db.Model(&model.DramaTake{}).Where("task_id = ? AND owner_id = ? AND kind = ?", take.TaskID, take.OwnerID, take.Kind).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return nil
		}
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		var current int
		if err := tx.Model(&model.DramaTake{}).Where("owner_id = ? AND kind = ?", take.OwnerID, take.Kind).Select("COALESCE(MAX(version), 0)").Scan(&current).Error; err != nil {
			return err
		}
		take.Version = current + 1
		return tx.Create(take).Error
	})
}

func (r *Repository) DramaJobsByStatus(projectID string, statuses ...string) ([]model.DramaJob, error) {
	var jobs []model.DramaJob
	err := r.db.Where("project_id = ? AND status IN ?", projectID, statuses).Order("priority desc, created_at asc").Find(&jobs).Error
	return jobs, err
}

func (r *Repository) DramaJob(projectID string, id string) (*model.DramaJob, error) {
	var job model.DramaJob
	if err := r.db.First(&job, "id = ? AND project_id = ?", id, projectID).Error; err != nil {
		return nil, err
	}
	return &job, nil
}

// LatestDramaJob 返回某集某类工作的最近一条记录，用于回看剧本改编的提示词与模型返回。
func (r *Repository) LatestDramaJob(projectID string, kind string, episodeID string) (*model.DramaJob, error) {
	var job model.DramaJob
	err := r.db.Where("project_id = ? AND kind = ? AND episode_id = ?", projectID, kind, episodeID).Order("created_at desc").First(&job).Error
	if err != nil {
		return nil, err
	}
	return &job, nil
}

func (r *Repository) RecentDramaJobs(projectID string, limit int) ([]model.DramaJob, error) {
	var jobs []model.DramaJob
	err := r.db.Where("project_id = ?", projectID).Order("updated_at desc").Limit(limit).Find(&jobs).Error
	return jobs, err
}

func (r *Repository) DramaJobCounts(projectID string) (map[string]int64, error) {
	var rows []struct {
		Status string
		Count  int64
	}
	if err := r.db.Model(&model.DramaJob{}).Select("status, COUNT(*) AS count").Where("project_id = ?", projectID).Group("status").Scan(&rows).Error; err != nil {
		return nil, err
	}
	counts := map[string]int64{}
	for _, row := range rows {
		counts[row.Status] = row.Count
	}
	return counts, nil
}

func (r *Repository) CreateDramaJobs(jobs []model.DramaJob) error {
	if len(jobs) == 0 {
		return nil
	}
	return r.db.Create(&jobs).Error
}

func (r *Repository) SaveDramaJob(job *model.DramaJob) error {
	job.UpdatedAt = time.Now()
	return r.db.Save(job).Error
}

// CancelDramaJobs 取消尚未派发的排队工作；已提交的任务由任务中心各自收尾。
func (r *Repository) CancelQueuedDramaJobs(projectID string, filter func(*gorm.DB) *gorm.DB) error {
	query := r.db.Model(&model.DramaJob{}).Where("project_id = ? AND status = ?", projectID, model.DramaJobQueued)
	if filter != nil {
		query = filter(query)
	}
	return query.Updates(map[string]any{"status": model.DramaJobCanceled, "updated_at": time.Now()}).Error
}

func (r *Repository) DeleteDramaProductionData(projectID string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		for _, entity := range []any{&model.DramaJob{}, &model.DramaTake{}, &model.DramaSegment{}, &model.DramaShot{}, &model.DramaEpisode{}, &model.DramaCast{}, &model.DramaProduction{}} {
			if err := tx.Where("project_id = ?", projectID).Delete(entity).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// FailedDramaCastErrors 返回各角色/场景最近一次参考图失败的原因，供收件箱展示真实错误。
func (r *Repository) FailedDramaCastErrors(projectID string) (map[string]string, error) {
	var jobs []model.DramaJob
	err := r.db.Select("cast_id", "error").
		Where("project_id = ? AND kind = ? AND status = ? AND cast_id <> ''", projectID, model.DramaJobCastImage, model.DramaJobFailed).
		Order("updated_at asc").Find(&jobs).Error
	errors := make(map[string]string, len(jobs))
	for _, job := range jobs {
		errors[job.CastID] = job.Error
	}
	return errors, err
}

// AttentionDramaShots 返回需要人工处理的失败镜头，供“待处理”收件箱使用。

func (r *Repository) DramaProjectsPage(userID string, search string, status string, page int, pageSize int) ([]model.Project, int64, error) {
	query := r.db.Model(&model.Project{}).
		Joins("JOIN drama_productions ON drama_productions.project_id = projects.id").
		Where("projects.user_id = ?", userID)
	if search = strings.TrimSpace(search); search != "" {
		query = query.Where("LOWER(projects.name) LIKE ? ESCAPE '\\'", "%"+strings.ToLower(escapeLike(search))+"%")
	}
	if status != "" {
		query = query.Where("drama_productions.status = ?", status)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var projects []model.Project
	err := query.Select("projects.*").Order("projects.updated_at desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&projects).Error
	return projects, total, err
}

// DramaStatusCounts 统计用户各状态的短剧数量，供列表筛选标签显示。
func (r *Repository) DramaStatusCounts(userID string) (map[string]int64, error) {
	var rows []struct {
		Status string
		Count  int64
	}
	err := r.db.Model(&model.DramaProduction{}).Select("status, COUNT(*) AS count").Where("user_id = ?", userID).Group("status").Scan(&rows).Error
	result := map[string]int64{}
	for _, row := range rows {
		result[row.Status] = row.Count
	}
	return result, err
}

func escapeLike(value string) string {
	return strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(value)
}

func (r *Repository) DramaProductionsForUser(userID string, projectIDs []string) (map[string]model.DramaProduction, error) {
	var productions []model.DramaProduction
	if len(projectIDs) == 0 {
		return map[string]model.DramaProduction{}, nil
	}
	if err := r.db.Where("user_id = ? AND project_id IN ?", userID, projectIDs).Find(&productions).Error; err != nil {
		return nil, err
	}
	result := make(map[string]model.DramaProduction, len(productions))
	for _, production := range productions {
		result[production.ProjectID] = production
	}
	return result, nil
}

// DramaEpisodeCounts 汇总项目列表卡片所需的集数与完成数。
func (r *Repository) DramaEpisodeCounts(projectIDs []string) (map[string][2]int64, error) {
	var rows []struct {
		ProjectID string
		Total     int64
		Done      int64
	}
	result := map[string][2]int64{}
	if len(projectIDs) == 0 {
		return result, nil
	}
	err := r.db.Model(&model.DramaEpisode{}).Select("project_id, COUNT(*) AS total, SUM(CASE WHEN stage = 'done' THEN 1 ELSE 0 END) AS done").
		Where("project_id IN ?", projectIDs).Group("project_id").Scan(&rows).Error
	for _, row := range rows {
		result[row.ProjectID] = [2]int64{row.Total, row.Done}
	}
	return result, err
}

// DramaCoverResources 取每个项目前几张已就绪的角色参考图，列表卡片拼成封面。
func (r *Repository) DramaCoverResources(projectIDs []string, limit int) (map[string][]string, error) {
	var casts []model.DramaCast
	result := map[string][]string{}
	if len(projectIDs) == 0 {
		return result, nil
	}
	err := r.db.Select("project_id", "image_resource_id", "position").Where("project_id IN ? AND kind = ? AND image_status = ?", projectIDs, "character", model.DramaMediaReady).
		Order("position asc").Find(&casts).Error
	for _, cast := range casts {
		if len(result[cast.ProjectID]) < limit {
			result[cast.ProjectID] = append(result[cast.ProjectID], cast.ImageResourceID)
		}
	}
	return result, err
}

// ===== 定向更新 =====
// 调度循环与用户操作并发写同一行时，整行 Save 会互相覆盖；以下方法只写各自负责的列，
// 并用状态或版本号做条件，过期的写入直接失效，由下一轮调度重新推导。

// UpdateDramaProduction 写入用户侧控制字段，并递增版本。
func (r *Repository) UpdateDramaProduction(projectID string, fields map[string]any) error {
	fields["updated_at"] = time.Now()
	fields["revision"] = gorm.Expr("revision + 1")
	return r.db.Model(&model.DramaProduction{}).Where("project_id = ?", projectID).Updates(fields).Error
}

// SaveDramaProductionProgress 写入调度循环负责的进度字段；状态只在仍处于 expectedStatus 时改变。
func (r *Repository) SaveDramaProductionProgress(production *model.DramaProduction, expectedStatus string, statusChanged bool) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		if err := tx.Model(&model.DramaProduction{}).Where("project_id = ?", production.ProjectID).Updates(map[string]any{
			"stage": production.Stage, "bible_json": production.BibleJSON, "spent_microcredits": production.SpentMicrocredits,
			"plan_done": production.PlanDone, "last_tick_at": production.LastTickAt, "updated_at": now,
		}).Error; err != nil {
			return err
		}
		if !statusChanged {
			return nil
		}
		return tx.Model(&model.DramaProduction{}).Where("project_id = ? AND status = ?", production.ProjectID, expectedStatus).
			Updates(map[string]any{"status": production.Status, "pause_reason": production.PauseReason}).Error
	})
}

// UpdateDramaEpisodeIfRevision 只在集未被用户改动（版本未变）时写入调度结果。
func (r *Repository) UpdateDramaEpisodeIfRevision(id string, revision int64, fields map[string]any) (bool, error) {
	fields["updated_at"] = time.Now()
	result := r.db.Model(&model.DramaEpisode{}).Where("id = ? AND revision = ?", id, revision).Updates(fields)
	return result.RowsAffected == 1, result.Error
}

// UpdateDramaEpisodeUser 写入用户修改并递增版本，使调度循环基于旧版本的写入失效。
func (r *Repository) UpdateDramaEpisodeUser(id string, fields map[string]any) error {
	fields["updated_at"] = time.Now()
	fields["revision"] = gorm.Expr("revision + 1")
	return r.db.Model(&model.DramaEpisode{}).Where("id = ?", id).Updates(fields).Error
}

// UpdateDramaShotIf 只在槽位状态仍为 allowed 之一时写入，防止旧任务结果覆盖用户刚发起的重做。

func (r *Repository) UpdateDramaCastIf(id string, allowed []string, fields map[string]any) (bool, error) {
	fields["updated_at"] = time.Now()
	result := r.db.Model(&model.DramaCast{}).Where("id = ? AND image_status IN ?", id, allowed).Updates(fields)
	return result.RowsAffected == 1, result.Error
}

// ApplyDramaScript 写入一集的新镜头；revision 不为 nil 时要求集版本未变。
func (r *Repository) ApplyDramaScript(episodeID string, revision *int64, fields map[string]any, shots []model.DramaShot) (bool, error) {
	applied := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		fields["updated_at"] = time.Now()
		query := tx.Model(&model.DramaEpisode{}).Where("id = ?", episodeID)
		if revision != nil {
			query = query.Where("revision = ?", *revision)
		} else {
			fields["revision"] = gorm.Expr("revision + 1")
		}
		result := query.Updates(fields)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return nil
		}
		if err := tx.Where("episode_id = ?", episodeID).Delete(&model.DramaShot{}).Error; err != nil {
			return err
		}
		// 剧情段随镜头重新切分，旧段的提示词不再对得上，重建为待撰写。
		if err := tx.Where("episode_id = ?", episodeID).Delete(&model.DramaSegment{}).Error; err != nil {
			return err
		}
		if len(shots) > 0 {
			if err := tx.CreateInBatches(&shots, 100).Error; err != nil {
				return err
			}
			segments := []model.DramaSegment{}
			seen := map[int]bool{}
			now := time.Now()
			for _, shot := range shots {
				if !seen[shot.SegmentIndex] {
					seen[shot.SegmentIndex] = true
					segments = append(segments, model.DramaSegment{ID: kernel.NewID(), ProjectID: shot.ProjectID, EpisodeID: episodeID, SegmentIndex: shot.SegmentIndex, CreatedAt: now, UpdatedAt: now})
				}
			}
			if err := tx.Create(&segments).Error; err != nil {
				return err
			}
		}
		applied = true
		return nil
	})
	return applied, err
}

func (r *Repository) UpdateDramaCastFields(id string, fields map[string]any) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		fields["updated_at"] = time.Now()
		fields["revision"] = gorm.Expr("revision + 1")
		if err := tx.Model(&model.DramaCast{}).Where("id = ?", id).Updates(fields).Error; err != nil {
			return err
		}
		// Textual cast changes invalidate prompt inputs. Lock-only edits do not change media.
		changed := false
		for _, key := range []string{"name", "appearance", "description", "voice_instructions", "aliases_json"} {
			if _, ok := fields[key]; ok {
				changed = true
			}
		}
		if !changed {
			return nil
		}
		var cast model.DramaCast
		if err := tx.First(&cast, "id = ?", id).Error; err != nil {
			return err
		}
		var shots []model.DramaShot
		if err := tx.Where("project_id = ? AND (scene_cast_id = ? OR cast_ids_json LIKE ?)", cast.ProjectID, id, fmt.Sprintf("%%%q%%", id)).Find(&shots).Error; err != nil {
			return err
		}
		seen := map[string]bool{}
		for _, shot := range shots {
			key := shot.EpisodeID + ":" + fmt.Sprint(shot.SegmentIndex)
			if seen[key] {
				continue
			}
			seen[key] = true
			var seg model.DramaSegment
			if err := tx.Where("episode_id = ? AND segment_index = ?", shot.EpisodeID, shot.SegmentIndex).First(&seg).Error; err != nil {
				return err
			}
			if err := invalidateDramaSegment(tx, seg, map[string]any{"prompt_status": promptStatusAfterInputChange(seg.PromptStatus), "video_prompt_override": ""}, true); err != nil {
				return err
			}
		}
		return nil
	})
}

// promptStatusAfterInputChange 决定撰写素材变化后的提示词状态：写好的才标记过期、等用户确认重写；
// 待撰写或撰写中的退回待撰写，由调度按新素材自动写；失败保持失败，等用户重试。
func promptStatusAfterInputChange(current string) string {
	switch current {
	case model.DramaMediaReady, model.DramaMediaStale:
		return model.DramaMediaStale
	case model.DramaMediaFailed:
		return model.DramaMediaFailed
	}
	return ""
}
func (r *Repository) UpdateDramaCastRevision(id string, revision int64, fields map[string]any) (bool, error) {
	fields["updated_at"] = time.Now()
	result := r.db.Model(&model.DramaCast{}).Where("id = ? AND revision = ?", id, revision).Updates(fields)
	return result.RowsAffected > 0, result.Error
}

// UpdateDramaEpisodeMeta 修改不影响已生成内容的集字段（标题、素材类型），不递增版本，避免打断调度写入。
func (r *Repository) UpdateDramaEpisodeMeta(episodeID string, fields map[string]any) error {
	fields["updated_at"] = time.Now()
	return r.db.Model(&model.DramaEpisode{}).Where("id = ?", episodeID).Updates(fields).Error
}

func (r *Repository) DramaSegments(episodeID string) ([]model.DramaSegment, error) {
	var segments []model.DramaSegment
	err := r.db.Where("episode_id = ?", episodeID).Order("segment_index asc").Find(&segments).Error
	return segments, err
}

// SaveDramaSegmentOverride 写入或清除段级提示词改写；行不存在时创建（旧剧本没有段记录）。
func (r *Repository) SaveDramaSegmentOverride(segment model.DramaSegment) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var current model.DramaSegment
		if err := tx.Where("episode_id = ? AND segment_index = ?", segment.EpisodeID, segment.SegmentIndex).First(&current).Error; err != nil {
			return err
		}
		return invalidateDramaSegment(tx, current, map[string]any{"video_prompt_override": segment.VideoPromptOverride}, true)
	})
}

// SaveDramaSegmentReferences 写入或清除段级参考图指定；参考图编号写在提示词里，所以已写好的提示词标记过期、视频过期。
func (r *Repository) SaveDramaSegmentReferences(episodeID string, index int, referenceIDsJSON string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var current model.DramaSegment
		if err := tx.Where("episode_id = ? AND segment_index = ?", episodeID, index).First(&current).Error; err != nil {
			return err
		}
		if current.ReferenceCastIDsJSON == referenceIDsJSON {
			return nil
		}
		return invalidateDramaSegment(tx, current, map[string]any{"reference_cast_ids_json": referenceIDsJSON, "prompt_status": promptStatusAfterInputChange(current.PromptStatus)}, true)
	})
}

// RequestDramaSegmentPrompts 把指定段标记为待撰写；正在撰写的段保持不动。返回实际排队的段数。
func (r *Repository) RequestDramaSegmentPrompts(projectID, episodeID string, indexes []int) (int, error) {
	queued := 0
	err := r.db.Transaction(func(tx *gorm.DB) error {
		for _, index := range indexes {
			var segment model.DramaSegment
			if err := tx.Where("project_id = ? AND episode_id = ? AND segment_index = ?", projectID, episodeID, index).First(&segment).Error; err != nil {
				return err
			}
			if segment.PromptStatus == model.DramaMediaRunning {
				continue
			}
			if err := invalidateDramaSegment(tx, segment, map[string]any{"prompt_status": "", "prompt_error": ""}, true); err != nil {
				return err
			}
			queued++
		}
		return nil
	})
	return queued, err
}

// PendingDramaSegments 返回待撰写提示词的段；按集与段序排列。
func (r *Repository) PendingDramaSegments(projectID string) ([]model.DramaSegment, error) {
	var segments []model.DramaSegment
	err := r.db.Where("project_id = ? AND prompt_status = ?", projectID, "").Order("episode_id asc, segment_index asc").Limit(500).Find(&segments).Error
	return segments, err
}

func (r *Repository) DramaSegment(projectID string, id string) (*model.DramaSegment, error) {
	var segment model.DramaSegment
	if err := r.db.First(&segment, "id = ? AND project_id = ?", id, projectID).Error; err != nil {
		return nil, err
	}
	return &segment, nil
}

// MarkDramaSegmentVideoStale 在参考图重做后让该段已生成或生成中的视频过期。提示词只引用参考图编号，
// 不含图片内容，因此保持不变；尚未生成的视频提交时会读取新参考图，无需处理。返回是否有视频被标记。
func (r *Repository) MarkDramaSegmentVideoStale(episodeID string, index int) (bool, error) {
	marked := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var segment model.DramaSegment
		if err := tx.Where("episode_id = ? AND segment_index = ?", episodeID, index).First(&segment).Error; err != nil {
			return err
		}
		if segment.VideoStatus != model.DramaMediaReady && segment.VideoStatus != model.DramaMediaRunning {
			return nil
		}
		fields := map[string]any{"video_status": model.DramaMediaStale, "revision": gorm.Expr("revision + 1"), "updated_at": time.Now()}
		// 版本递增会让撰写中的提示词结果作废，退回待撰写由调度重写。
		if segment.PromptStatus == model.DramaMediaRunning {
			fields["prompt_status"] = ""
		}
		if err := tx.Model(&model.DramaSegment{}).Where("id = ?", segment.ID).Updates(fields).Error; err != nil {
			return err
		}
		marked = true
		return markLaterSegmentsStale(tx, segment.EpisodeID, segment.SegmentIndex)
	})
	return marked, err
}

func (r *Repository) DramaShotsReferencingCast(projectID string, castID string) ([]model.DramaShot, error) {
	var shots []model.DramaShot
	pattern := "%\"" + castID + "\"%"
	err := r.db.Where("project_id = ? AND (scene_cast_id = ? OR cast_ids_json LIKE ? OR prop_ids_json LIKE ?)", projectID, castID, pattern, pattern).Find(&shots).Error
	return shots, err
}

// DramaSegmentStat 是集列表进度使用的剧情段聚合计数。
type DramaSegmentStat struct {
	EpisodeID   string
	Total       int64
	PromptReady int64
	VideoReady  int64
	Failed      int64
}

func (r *Repository) DramaSegmentStats(projectID string) (map[string]DramaSegmentStat, error) {
	var rows []DramaSegmentStat
	err := r.db.Model(&model.DramaSegment{}).Select(`episode_id,
		COUNT(*) AS total,
		SUM(CASE WHEN (prompt_status = 'ready' OR video_prompt_override <> '') THEN 1 ELSE 0 END) AS prompt_ready,
		SUM(CASE WHEN video_status = 'ready' THEN 1 ELSE 0 END) AS video_ready,
		SUM(CASE WHEN prompt_status = 'failed' OR video_status = 'failed' THEN 1 ELSE 0 END) AS failed`).
		Where("project_id = ?", projectID).Group("episode_id").Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	stats := make(map[string]DramaSegmentStat, len(rows))
	for _, row := range rows {
		stats[row.EpisodeID] = row
	}
	return stats, nil
}

// FailedDramaSegments 返回提示词或视频失败的剧情段，供待处理与一键重试使用。
func (r *Repository) FailedDramaSegments(projectID string, limit int) ([]model.DramaSegment, error) {
	var segments []model.DramaSegment
	err := r.db.Where("project_id = ? AND (prompt_status = ? OR video_status = ?)", projectID, model.DramaMediaFailed, model.DramaMediaFailed).
		Order("updated_at desc").Limit(limit).Find(&segments).Error
	return segments, err
}

func (r *Repository) UpdateDramaSegmentFields(id string, fields map[string]any) error {
	fields["updated_at"] = time.Now()
	return r.db.Model(&model.DramaSegment{}).Where("id = ?", id).Updates(fields).Error
}

func (r *Repository) UpdateDramaSegmentRevision(id string, revision int64, fields map[string]any) (bool, error) {
	fields["updated_at"] = time.Now()
	result := r.db.Model(&model.DramaSegment{}).Where("id = ? AND revision = ?", id, revision).Updates(fields)
	return result.RowsAffected > 0, result.Error
}

func markLaterSegmentsStale(tx *gorm.DB, episodeID string, index int) error {
	// Queued descendants remain requested, but receive a new revision and wait for the new tail.
	// The new revision also voids running prompt jobs, so those segments go back to pending instead of staying "running".
	return tx.Model(&model.DramaSegment{}).Where("episode_id = ? AND segment_index > ?", episodeID, index).
		Updates(map[string]any{
			"video_status":  gorm.Expr("CASE WHEN video_status IN ? THEN ? ELSE video_status END", []string{"ready", "running"}, "stale"),
			"prompt_status": gorm.Expr("CASE WHEN prompt_status = ? THEN '' ELSE prompt_status END", model.DramaMediaRunning),
			"revision":      gorm.Expr("revision + 1"),
			"updated_at":    time.Now(),
		}).Error
}

// invalidateDramaSegment makes user edits and downstream invalidation one transaction.
func invalidateDramaSegment(tx *gorm.DB, segment model.DramaSegment, fields map[string]any, prompts bool) error {
	if _, ok := fields["video_status"]; !ok {
		if segment.VideoStatus != "" {
			fields["video_status"] = model.DramaMediaStale
		}
	}
	fields["revision"] = gorm.Expr("revision + 1")
	fields["updated_at"] = time.Now()
	if err := tx.Model(&model.DramaSegment{}).Where("id = ?", segment.ID).Updates(fields).Error; err != nil {
		return err
	}
	if err := markLaterSegmentsStale(tx, segment.EpisodeID, segment.SegmentIndex); err != nil {
		return err
	}
	stage := "video"
	if prompts {
		stage = "prompts"
	}
	if err := tx.Model(&model.DramaEpisode{}).Where("id = ?", segment.EpisodeID).Updates(map[string]any{"stage": stage, "approved": false, "final_stale": true, "error": "", "revision": gorm.Expr("revision + 1"), "updated_at": time.Now()}).Error; err != nil {
		return err
	}
	return tx.Model(&model.DramaJob{}).Where("episode_id = ? AND status = ? AND kind IN ?", segment.EpisodeID, "queued", []string{"segment_prompt", "segment_video", "render"}).Updates(map[string]any{"status": "canceled", "updated_at": time.Now()}).Error
}

func (r *Repository) UpdateDramaShotScript(shot model.DramaShot, fields map[string]any) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		fields["updated_at"] = time.Now()
		if err := tx.Model(&model.DramaShot{}).Where("id = ? AND project_id = ?", shot.ID, shot.ProjectID).Updates(fields).Error; err != nil {
			return err
		}
		var segment model.DramaSegment
		if err := tx.Where("episode_id = ? AND segment_index = ?", shot.EpisodeID, shot.SegmentIndex).First(&segment).Error; err != nil {
			return err
		}
		if err := invalidateDramaSegment(tx, segment, map[string]any{"prompt_status": promptStatusAfterInputChange(segment.PromptStatus), "video_prompt_override": ""}, true); err != nil {
			return err
		}
		return tx.Model(&model.DramaEpisode{}).Where("id = ?", shot.EpisodeID).Update("duration_ms", tx.Model(&model.DramaShot{}).Select("COALESCE(SUM(duration_ms),0)").Where("episode_id = ?", shot.EpisodeID)).Error
	})
}

func (r *Repository) RequestDramaSegmentVideos(projectID, episodeID string, indexes []int, modelJSON *string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		for _, index := range indexes {
			var segment model.DramaSegment
			if err := tx.Where("project_id = ? AND episode_id = ? AND segment_index = ?", projectID, episodeID, index).First(&segment).Error; err != nil {
				return err
			}
			if segment.VideoStatus == "running" {
				return errors.New("剧情段视频正在生成")
			}
			fields := map[string]any{"video_status": "queued", "video_error": ""}
			if modelJSON != nil {
				fields["video_model_json"] = *modelJSON
			}
			if err := invalidateDramaSegment(tx, segment, fields, false); err != nil {
				return err
			}
		}
		return tx.Model(&model.DramaEpisode{}).Where("id = ?", episodeID).Updates(map[string]any{"approved": true, "media_released": true}).Error
	})
}

func (r *Repository) RetryDramaResultJobs(projectID string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		// A successful provider task is re-applied, never submitted a second time.
		if err := tx.Model(&model.DramaJob{}).Where("project_id = ? AND status = ? AND task_id IN (?)", projectID, "failed", tx.Model(&model.Task{}).Select("id").Where("status = ?", model.TaskStatusSucceeded)).Updates(map[string]any{"status": "running", "error": "", "finished_at": nil}).Error; err != nil {
			return err
		}
		return nil
	})
}

// ReopenDramaSegmentVideoJob 把生成任务已成功、回写失败的段视频作业重新置为运行中，
// 调度循环会重放同一任务结果；段状态同步改回生成中。返回作业是否仍满足重放条件。
func (r *Repository) ReopenDramaSegmentVideoJob(jobID, segmentID string) (bool, error) {
	reopened := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		result := tx.Model(&model.DramaJob{}).
			Where("id = ? AND shot_id = ? AND kind = ? AND status = ? AND task_id IN (?)", jobID, segmentID, model.DramaJobSegmentVideo, model.DramaJobFailed, tx.Model(&model.Task{}).Select("id").Where("status = ?", model.TaskStatusSucceeded)).
			Updates(map[string]any{"status": model.DramaJobRunning, "error": "", "finished_at": nil, "updated_at": now})
		if result.Error != nil || result.RowsAffected == 0 {
			return result.Error
		}
		segment := tx.Model(&model.DramaSegment{}).Where("id = ? AND video_status = ?", segmentID, model.DramaMediaFailed).Updates(map[string]any{"video_status": model.DramaMediaRunning, "video_error": "", "updated_at": now})
		if segment.Error != nil {
			return segment.Error
		}
		if segment.RowsAffected == 0 {
			// 段状态已被并发操作改变（例如用户刚点了重新生成），放弃重放。
			return errReopenRaced
		}
		reopened = true
		return nil
	})
	if errors.Is(err, errReopenRaced) {
		return false, nil
	}
	return reopened, err
}

var errReopenRaced = errors.New("drama segment changed during reopen")

func (r *Repository) RecentDramaSegmentJobs(projectID, episodeID string) ([]model.DramaJob, error) {
	var jobs []model.DramaJob
	err := r.db.Where("project_id = ? AND episode_id = ? AND kind IN ?", projectID, episodeID, []string{model.DramaJobSegmentPrompt, model.DramaJobSegmentVideo}).Order("created_at desc").Find(&jobs).Error
	return jobs, err
}
