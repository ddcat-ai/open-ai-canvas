package app

import (
	"encoding/json"
	"errors"
	"net/url"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
	"yingce/backend/internal/assets"
	"yingce/backend/internal/canvas"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type CommunityWorkInput struct {
	Title           string   `json:"title"`
	Description     string   `json:"description"`
	Category        string   `json:"category"`
	Tags            []string `json:"tags"`
	MediaResourceID string   `json:"mediaResourceId"`
	CoverResourceID string   `json:"coverResourceId"`
	ProjectID       string   `json:"projectId"`
	RightsConfirmed bool     `json:"rightsConfirmed"`
}

type CommunityWorkView struct {
	ID              string    `json:"id"`
	Title           string    `json:"title"`
	Description     string    `json:"description"`
	Category        string    `json:"category"`
	Tags            []string  `json:"tags"`
	Author          string    `json:"author"`
	Kind            string    `json:"kind"`
	MediaResourceID string    `json:"mediaResourceId"`
	CoverResourceID string    `json:"coverResourceId"`
	MediaURL        string    `json:"mediaUrl"`
	CoverURL        string    `json:"coverUrl"`
	ProjectID       string    `json:"projectId,omitempty"`
	HasProject      bool      `json:"hasProject"`
	Status          string    `json:"status"`
	Featured        bool      `json:"featured"`
	ReviewReason    string    `json:"reviewReason,omitempty"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type CommunityWorkReviewInput struct {
	Action string `json:"action"`
	Reason string `json:"reason"`
}
type CommunityWorkProject struct {
	Project map[string]any `json:"project"`
}

type CommunityWorkPage struct {
	Items    []CommunityWorkView `json:"items"`
	Page     int                 `json:"page"`
	PageSize int                 `json:"pageSize"`
	Total    int64               `json:"total"`
}

func communityActor(actor *model.User) error {
	if actor == nil || actor.ID == "" || actor.Status != model.UserStatusActive {
		return kernel.Unauthorized("请先登录")
	}
	return nil
}

func validCommunityStatus(status string) bool {
	switch status {
	case "", model.CommunityWorkPending, model.CommunityWorkPublished, model.CommunityWorkRejected, model.CommunityWorkWithdrawn, model.CommunityWorkUnlisted:
		return true
	}
	return false
}

type CommunityWorkReaction struct {
	Count int64 `json:"count"`
	Liked bool  `json:"liked"`
}

func (s *Service) CommunityWorkReaction(actor *model.User, id string) (*CommunityWorkReaction, error) {
	userID := ""
	if actor != nil {
		if err := communityActor(actor); err != nil {
			return nil, err
		}
		userID = actor.ID
	}
	if _, err := s.accessibleCommunityWork(nil, id, true); err != nil {
		return nil, err
	}
	count, liked, err := s.repo.CommunityWorkReaction(id, userID)
	if err != nil {
		return nil, err
	}
	return &CommunityWorkReaction{Count: count, Liked: liked}, nil
}

func (s *Service) SetCommunityWorkLiked(actor *model.User, id string, liked bool) (*CommunityWorkReaction, error) {
	if err := communityActor(actor); err != nil {
		return nil, err
	}
	var reaction CommunityWorkReaction
	err := s.repo.Transaction(func(repo *repository.Repository) error {
		work, err := repo.CommunityWork(id, true)
		if err != nil {
			return communityWorkError(err)
		}
		if work.Status != model.CommunityWorkPublished {
			return kernel.NotFound("作品未发布")
		}
		if err = validateCommunityPublication(repo, work); err != nil {
			return err
		}
		if err = repo.SetCommunityWorkLiked(id, actor.ID, liked); err != nil {
			return err
		}
		reaction.Count, reaction.Liked, err = repo.CommunityWorkReaction(id, actor.ID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return &reaction, nil
}

func (s *Service) CommunityWorks(actor *model.User, admin bool, status string, page, pageSize int) (*CommunityWorkPage, error) {
	if err := communityActor(actor); err != nil {
		return nil, err
	}
	if !validCommunityStatus(status) {
		return nil, kernel.BadAuthRequest("作品状态无效")
	}
	if page == 0 {
		page = 1
	}
	if pageSize == 0 {
		pageSize = 24
	}
	if page < 1 || pageSize < 1 || pageSize > 100 || page > int(^uint(0)>>1)/pageSize {
		return nil, kernel.BadAuthRequest("分页参数无效")
	}
	owner := actor.ID
	if admin {
		if err := s.RequireAdmin(actor); err != nil {
			return nil, err
		}
		owner = ""
	}
	works, total, err := s.repo.CommunityWorksPage(owner, status, page, pageSize)
	if err != nil {
		return nil, err
	}
	return &CommunityWorkPage{Items: communityWorkViews(works, false), Page: page, PageSize: pageSize, Total: total}, nil
}

func (s *Service) PublicCommunityWorks(featured bool) ([]CommunityWorkView, error) {
	works, err := s.repo.CommunityWorks("", "", true, featured)
	if err != nil {
		return nil, err
	}
	return communityWorkViews(works, true), nil
}

func communityWorkViews(works []model.CommunityWork, public bool) []CommunityWorkView {
	views := make([]CommunityWorkView, 0, len(works))
	for i := range works {
		views = append(views, communityWorkView(&works[i], public))
	}
	return views
}

func communityWorkResourceURL(workID, resourceID string, public bool) string {
	prefix := "/api/works/"
	if public {
		prefix = "/api/public/works/"
	}
	return prefix + url.PathEscape(workID) + "/resources/" + url.PathEscape(resourceID) + "/file"
}

func communityWorkView(work *model.CommunityWork, public bool) CommunityWorkView {
	tags := []string{}
	_ = json.Unmarshal([]byte(work.TagsJSON), &tags)
	view := CommunityWorkView{ID: work.ID, Title: work.Title, Description: work.Description, Category: work.Category, Tags: tags, Author: work.Author, Kind: work.Kind, MediaResourceID: work.MediaResourceID, CoverResourceID: work.CoverResourceID, HasProject: work.ProjectID != "", Status: work.Status, Featured: work.Featured, CreatedAt: work.CreatedAt, UpdatedAt: work.UpdatedAt}
	view.MediaURL = communityWorkResourceURL(work.ID, work.MediaResourceID, public)
	if work.Kind == "video" {
		view.MediaURL += "?variant=playback"
	}
	view.CoverURL = communityWorkResourceURL(work.ID, work.CoverResourceID, public)
	if !public {
		view.ProjectID = work.ProjectID
		view.ReviewReason = work.ReviewReason
	}
	return view
}

func (s *Service) accessibleCommunityWork(actor *model.User, id string, public bool) (*model.CommunityWork, error) {
	work, err := s.repo.CommunityWork(id, false)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.NotFound("作品不存在或未发布")
	}
	if err != nil {
		return nil, err
	}
	if public {
		if work.Status != model.CommunityWorkPublished {
			return nil, kernel.NotFound("作品不存在或未发布")
		}
		owner, e := s.repo.User(work.UserID)
		if errors.Is(e, gorm.ErrRecordNotFound) {
			return nil, kernel.NotFound("作品不存在或未发布")
		}
		if e != nil {
			return nil, e
		}
		if owner.Status != model.UserStatusActive {
			return nil, kernel.NotFound("作品不存在或未发布")
		}
	} else {
		if err := communityActor(actor); err != nil {
			return nil, err
		}
		if actor.ID != work.UserID && actor.Role != model.UserRoleAdmin {
			return nil, kernel.NotFound("作品不存在或无权访问")
		}
	}
	return work, nil
}

func (s *Service) CommunityWork(actor *model.User, id string, public bool) (*CommunityWorkView, error) {
	work, err := s.accessibleCommunityWork(actor, id, public)
	if err != nil {
		return nil, err
	}
	view := communityWorkView(work, public)
	return &view, nil
}

func validateCommunityInput(input *CommunityWorkInput) error {
	input.Title = strings.TrimSpace(input.Title)
	input.Description = strings.TrimSpace(input.Description)
	if input.Title == "" || utf8.RuneCountInString(input.Title) > 120 || utf8.RuneCountInString(input.Description) > 2000 {
		return kernel.BadAuthRequest("作品名称须为1–120字，简介最多2000字")
	}
	if !input.RightsConfirmed {
		return kernel.BadAuthRequest("请确认作品及所公开制作素材的发布权利")
	}
	switch input.Category {
	case "drama", "animation", "commercial", "music", "documentary", "education", "creative", "other":
	default:
		return kernel.BadAuthRequest("请选择有效作品分类")
	}
	if len(input.Tags) > 10 {
		return kernel.BadAuthRequest("作品标签最多10个")
	}
	tags := make([]string, 0, len(input.Tags))
	seen := map[string]bool{}
	for _, tag := range input.Tags {
		tag = strings.TrimSpace(tag)
		if tag == "" || utf8.RuneCountInString(tag) > 32 {
			return kernel.BadAuthRequest("每个标签须为1–32字")
		}
		if !seen[tag] {
			tags = append(tags, tag)
			seen[tag] = true
		}
	}
	input.Tags = tags
	if input.MediaResourceID == "" || len(input.MediaResourceID) > 80 || input.CoverResourceID == "" || len(input.CoverResourceID) > 80 || len(input.ProjectID) > 80 {
		return kernel.BadAuthRequest("请选择已保存的成品与封面")
	}
	return nil
}

func (s *Service) SubmitCommunityWork(actor *model.User, id string, input CommunityWorkInput) (*CommunityWorkView, error) {
	if err := communityActor(actor); err != nil {
		return nil, err
	}
	if err := validateCommunityInput(&input); err != nil {
		return nil, err
	}
	if err := s.RequireStorageWritable(actor.ID); err != nil {
		return nil, err
	}
	var saved *model.CommunityWork
	err := s.repo.Transaction(func(repo *repository.Repository) error {
		now := time.Now().UTC()
		creating := id == ""
		work := &model.CommunityWork{ID: "work-" + kernel.NewID(), UserID: actor.ID, Revision: 1, CreatedAt: now}
		if !creating {
			var e error
			work, e = repo.CommunityWork(id, true)
			if errors.Is(e, gorm.ErrRecordNotFound) {
				return kernel.NotFound("投稿不存在")
			}
			if e != nil {
				return e
			}
			if work.UserID != actor.ID {
				return kernel.NotFound("投稿不存在")
			}
		}
		media, e := repo.CommunityResourceForSubmission(actor.ID, input.MediaResourceID)
		if errors.Is(e, gorm.ErrRecordNotFound) {
			return kernel.BadAuthRequest("成品不存在或不属于当前账号")
		}
		if e != nil {
			return e
		}
		if media.Status != model.ResourceStatusReady || media.Size <= 0 || (media.Kind != "image" && media.Kind != "video") || !strings.HasPrefix(media.MimeType, media.Kind+"/") || media.MimeType == "image/svg+xml" {
			return kernel.BadAuthRequest("请选择上传完成的图片或视频成品")
		}
		cover, e := repo.CommunityResourceForSubmission(actor.ID, input.CoverResourceID)
		if errors.Is(e, gorm.ErrRecordNotFound) {
			return kernel.BadAuthRequest("封面不存在或不属于当前账号")
		}
		if e != nil {
			return e
		}
		if cover.Status != model.ResourceStatusReady || cover.Size <= 0 || cover.Kind != "image" || !strings.HasPrefix(cover.MimeType, "image/") || cover.MimeType == "image/svg+xml" {
			return kernel.BadAuthRequest("封面必须是上传完成的静态图片")
		}
		allowed := map[string]bool{media.ID: true, cover.ID: true}
		snapshotJSON := "{}"
		if input.ProjectID != "" {
			project, e := repo.CanvasProjectForUser(actor.ID, input.ProjectID)
			if errors.Is(e, gorm.ErrRecordNotFound) {
				return kernel.BadAuthRequest("制作画布不存在或不属于当前账号")
			}
			if e != nil {
				return e
			}
			if len(project.PayloadJSON) > 2<<20 {
				return kernel.BadAuthRequest("制作画布过大，请精简后投稿")
			}
			snapshot, refs, e := canvas.PublicationSnapshot(project)
			if e != nil {
				return kernel.BadAuthRequest("制作画布数据无效")
			}
			for resourceID := range refs {
				resource, e := repo.CommunityResourceForSubmission(actor.ID, resourceID)
				if errors.Is(e, gorm.ErrRecordNotFound) {
					return kernel.BadAuthRequest("制作画布引用了不存在或非本账号的媒体")
				}
				if e != nil {
					return e
				}
				if resource.Status != model.ResourceStatusReady || resource.Size <= 0 {
					return kernel.BadAuthRequest("制作画布包含尚未保存完成的媒体")
				}
				allowed[resourceID] = true
			}
			data, e := json.Marshal(snapshot)
			if e != nil {
				return e
			}
			snapshotJSON = string(data)
		}
		tags, _ := json.Marshal(input.Tags)
		active := actor.ID + ":" + media.ID
		work.Author = strings.TrimSpace(actor.DisplayName)
		if work.Author == "" {
			work.Author = "创作者"
		}
		work.Title = input.Title
		work.Description = input.Description
		work.Category = input.Category
		work.TagsJSON = string(tags)
		work.Kind = media.Kind
		work.MediaResourceID = media.ID
		work.CoverResourceID = cover.ID
		work.ProjectID = input.ProjectID
		work.SnapshotJSON = snapshotJSON
		work.Status = model.CommunityWorkPending
		work.Featured = false
		work.ReviewReason = ""
		work.RightsConfirmedAt = now
		work.ActiveKey = &active
		work.UpdatedAt = now
		ids := make([]string, 0, len(allowed))
		for resourceID := range allowed {
			ids = append(ids, resourceID)
		}
		sort.Strings(ids)
		if e := repo.SaveCommunityWork(work, creating, ids, &model.CommunityWorkReview{ID: kernel.NewID(), WorkID: work.ID, ActorID: actor.ID, Action: "submit", CreatedAt: now}); e != nil {
			return e
		}
		saved = work
		return nil
	})
	if err != nil {
		return nil, communityWorkError(err)
	}
	view := communityWorkView(saved, false)
	return &view, nil
}

func (s *Service) WithdrawCommunityWork(actor *model.User, id string) (*CommunityWorkView, error) {
	if err := communityActor(actor); err != nil {
		return nil, err
	}
	var result *model.CommunityWork
	err := s.repo.Transaction(func(repo *repository.Repository) error {
		work, e := repo.CommunityWork(id, true)
		if errors.Is(e, gorm.ErrRecordNotFound) {
			return kernel.NotFound("投稿不存在")
		}
		if e != nil {
			return e
		}
		if work.UserID != actor.ID {
			return kernel.NotFound("投稿不存在")
		}
		if work.Status == model.CommunityWorkWithdrawn {
			result = work
			return nil
		}
		work.Status = model.CommunityWorkWithdrawn
		work.Featured = false
		work.ActiveKey = nil
		work.UpdatedAt = time.Now().UTC()
		work.ReviewReason = ""
		if e := repo.SaveCommunityWork(work, false, nil, &model.CommunityWorkReview{ID: kernel.NewID(), WorkID: work.ID, ActorID: actor.ID, Action: "withdraw", CreatedAt: work.UpdatedAt}); e != nil {
			return e
		}
		result = work
		return nil
	})
	if err != nil {
		return nil, communityWorkError(err)
	}
	view := communityWorkView(result, false)
	return &view, nil
}

func (s *Service) ReviewCommunityWork(actor *model.User, id string, input CommunityWorkReviewInput) (*CommunityWorkView, error) {
	if err := communityActor(actor); err != nil {
		return nil, err
	}
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	input.Reason = strings.TrimSpace(input.Reason)
	if utf8.RuneCountInString(input.Reason) > 500 {
		return nil, kernel.BadAuthRequest("审核说明最多500字")
	}
	var result *model.CommunityWork
	err := s.repo.Transaction(func(repo *repository.Repository) error {
		work, e := repo.CommunityWork(id, true)
		if errors.Is(e, gorm.ErrRecordNotFound) {
			return kernel.NotFound("投稿不存在")
		}
		if e != nil {
			return e
		}
		switch input.Action {
		case "approve":
			if work.Status != model.CommunityWorkPending {
				return kernel.NewAppError(409, "仅可批准待审核作品")
			}
			if e := validateCommunityPublication(repo, work); e != nil {
				return e
			}
			work.Status = model.CommunityWorkPublished
		case "reject":
			if work.Status != model.CommunityWorkPending {
				return kernel.NewAppError(409, "仅可驳回待审核作品")
			}
			if input.Reason == "" {
				return kernel.BadAuthRequest("请填写驳回原因")
			}
			work.Status = model.CommunityWorkRejected
			work.Featured = false
			work.ActiveKey = nil
		case "feature", "unfeature":
			if work.Status != model.CommunityWorkPublished {
				return kernel.NewAppError(409, "只有已发布作品可以设置精选")
			}
			work.Featured = input.Action == "feature"
		case "unlist":
			if work.Status != model.CommunityWorkPublished {
				return kernel.NewAppError(409, "仅可下架已发布作品")
			}
			work.Status = model.CommunityWorkUnlisted
			work.Featured = false
			work.ActiveKey = nil
		default:
			return kernel.BadAuthRequest("审核操作无效")
		}
		if input.Action != "feature" && input.Action != "unfeature" {
			work.ReviewReason = input.Reason
		}
		work.UpdatedAt = time.Now().UTC()
		if e := repo.SaveCommunityWork(work, false, nil, &model.CommunityWorkReview{ID: kernel.NewID(), WorkID: work.ID, ActorID: actor.ID, Action: input.Action, Reason: input.Reason, CreatedAt: work.UpdatedAt}); e != nil {
			return e
		}
		result = work
		return nil
	})
	if err != nil {
		return nil, communityWorkError(err)
	}
	view := communityWorkView(result, false)
	return &view, nil
}

func communityWorkError(err error) error {
	if errors.Is(err, repository.ErrCommunityWorkConflict) {
		return kernel.NewAppError(409, repository.ErrCommunityWorkConflict.Error())
	}
	return err
}

func validateCommunityPublication(repo *repository.Repository, work *model.CommunityWork) error {
	owner, err := repo.User(work.UserID)
	if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && owner.Status != model.UserStatusActive) {
		return kernel.NewAppError(409, "作者账号当前不可发布作品")
	}
	if err != nil {
		return err
	}
	ids, err := repo.CommunityWorkResourceIDs(work.ID)
	if err != nil {
		return err
	}
	if len(ids) == 0 {
		return kernel.NewAppError(409, "作品媒体已失效，请让作者重新提交")
	}
	for _, id := range ids {
		resource, err := repo.CommunityResourceForSubmission(work.UserID, id)
		if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && (resource.Status != model.ResourceStatusReady || resource.Size <= 0)) {
			return kernel.NewAppError(409, "作品媒体已失效，请让作者重新提交")
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) CommunityWorkProject(actor *model.User, id string, public bool) (*CommunityWorkProject, error) {
	work, err := s.accessibleCommunityWork(actor, id, public)
	if err != nil {
		return nil, err
	}
	if work.ProjectID == "" {
		return nil, kernel.NotFound("该作品未公开制作画布")
	}
	var project map[string]any
	if err = json.Unmarshal([]byte(work.SnapshotJSON), &project); err != nil {
		return nil, kernel.NewAppError(500, "作品制作快照无法读取")
	}
	project = rewriteCommunitySnapshot(project, func(resourceID string) string { return communityWorkResourceURL(work.ID, resourceID, public) }).(map[string]any)
	return &CommunityWorkProject{Project: project}, nil
}

func rewriteCommunitySnapshot(value any, resourceURL func(string) string) any {
	return canvas.RewritePublicationResources(value, resourceURL)
}

func (s *Service) PrepareCommunityWorkResource(actor *model.User, id, resourceID string, public bool, options assets.AccessOptions, rangeHeader string) (*assets.ResourceDelivery, error) {
	work, err := s.accessibleCommunityWork(actor, id, public)
	if err != nil {
		return nil, err
	}
	resource, err := s.repo.CommunityWorkResource(id, resourceID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.NotFound("作品资源不存在")
	}
	if err != nil {
		return nil, err
	}
	if resource.UserID != work.UserID || resource.Status != model.ResourceStatusReady {
		return nil, kernel.NotFound("作品资源不存在")
	}
	options.ExpiresAt = time.Now().Add(time.Minute)
	return s.prepareResourceDelivery(work.UserID, resource, options, rangeHeader)
}
