package app

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type EcommerceRoundView struct {
	ID         string               `json:"id"`
	ProjectID  string               `json:"projectId"`
	Ordinal    int                  `json:"ordinal"`
	ImageCount int                  `json:"imageCount"`
	Version    int64                `json:"version"`
	CreatedAt  time.Time            `json:"createdAt"`
	UpdatedAt  time.Time            `json:"updatedAt"`
	Plan       *model.EcommercePlan `json:"plan"`
}

type EcommerceRoundPageResult struct {
	Rounds  []EcommerceRoundView `json:"rounds"`
	Total   int64                `json:"total"`
	HasMore bool                 `json:"hasMore"`
}

type EcommerceRoundConversion struct {
	CreatedRounds int   `json:"createdRounds"`
	TotalRounds   int64 `json:"totalRounds"`
	TotalImages   int64 `json:"totalImages"`
}

type EcommerceRoundImageUpdateRequest struct {
	Version int64                    `json:"version"`
	Image   *model.EcommercePlanTask `json:"image,omitempty"`
	Remove  bool                     `json:"remove"`
}

const ecommerceRoundPageMax = 20
const ecommerceRoundPageDefault = 10

func ecommerceRoundView(round *model.EcommerceRound) EcommerceRoundView {
	view := EcommerceRoundView{
		ID:         round.ID,
		ProjectID:  round.ProjectID,
		Ordinal:    round.Ordinal,
		ImageCount: round.ImageCount,
		Version:    round.Version,
		CreatedAt:  round.CreatedAt,
		UpdatedAt:  round.UpdatedAt,
	}
	var plan model.EcommercePlan
	if json.Unmarshal([]byte(round.PlanJSON), &plan) == nil {
		plan.PreviousImages = nil
		for i := range plan.Images {
			plan.Images[i].RoundID = round.ID
		}
		view.Plan = &plan
	}
	return view
}

func (s *Service) EcommerceRoundPage(userID, projectID string, limit, before int) (*EcommerceRoundPageResult, error) {
	if err := s.RequireFeature(FeatureEcommerce); err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = ecommerceRoundPageDefault
	}
	if limit > ecommerceRoundPageMax {
		limit = ecommerceRoundPageMax
	}
	if before < 0 {
		return nil, BadAuthRequest("历史分页游标无效")
	}
	if _, err := s.repo.EcommerceProject(userID, projectID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NotFound("电商项目不存在")
		}
		return nil, err
	}
	rounds, total, err := s.repo.EcommerceRoundPage(userID, projectID, limit, before)
	if err != nil {
		return nil, err
	}
	result := &EcommerceRoundPageResult{Rounds: make([]EcommerceRoundView, 0, len(rounds)), Total: total}
	for i := range rounds {
		result.Rounds = append(result.Rounds, ecommerceRoundView(&rounds[i]))
	}
	if len(rounds) > 0 {
		result.HasMore = int64(rounds[len(rounds)-1].Ordinal) > 1
	}
	return result, nil
}

func (s *Service) ConvertEcommerceRounds(userID, projectID string, expectedRevision int64) (*model.EcommerceProject, EcommerceRoundConversion, error) {
	var conversion EcommerceRoundConversion
	if err := s.RequireFeature(FeatureEcommerce); err != nil {
		return nil, conversion, err
	}
	project, created, err := s.repo.ConvertEcommerceProjectRounds(userID, projectID, expectedRevision)
	if errors.Is(err, repository.ErrEcommerceRoundConflict) {
		return nil, conversion, creationConflict("项目已在其他窗口更新，请刷新后重试")
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, conversion, NotFound("电商项目不存在")
	}
	if err != nil {
		return nil, conversion, err
	}
	conversion.CreatedRounds = created
	if total, images, err := s.repo.EcommerceRoundStats(userID, projectID); err == nil {
		conversion.TotalRounds = total
		conversion.TotalImages = images
	}
	project.RoundCount = conversion.TotalRounds
	s.fillEcommerceCoverTasks(userID, project)
	return project, conversion, nil
}

func (s *Service) UpdateEcommerceRoundImage(userID, projectID, roundID, imageID string, req EcommerceRoundImageUpdateRequest) (*EcommerceRoundView, error) {
	if err := s.RequireFeature(FeatureEcommerce); err != nil {
		return nil, err
	}
	if (req.Image == nil) == !req.Remove {
		return nil, BadAuthRequest("请指定要更新的图片或移除操作")
	}
	if strings.TrimSpace(imageID) == "" {
		return nil, BadAuthRequest("图片ID不能为空")
	}
	round, err := s.repo.EcommerceRound(userID, projectID, roundID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("历史轮次不存在")
	}
	if err != nil {
		return nil, err
	}
	if req.Image != nil {
		image := *req.Image
		if image.ID != imageID {
			return nil, BadAuthRequest("图片ID与路径不一致")
		}
		if len(image.Prompt) > 32000 {
			return nil, BadAuthRequest("图片提示词过长")
		}
		if len(image.SourceDraft) > 128<<10 {
			return nil, BadAuthRequest("历史图片参数快照过长")
		}
		if image.TaskID != "" {
			task, err := s.repo.TaskForUser(userID, image.TaskID)
			if err != nil || task.Type != "canvas_image" {
				return nil, BadAuthRequest("生成任务不存在或不属于当前用户")
			}
			var plan model.EcommercePlan
			if json.Unmarshal([]byte(round.PlanJSON), &plan) == nil {
				for _, existing := range plan.Images {
					if existing.ID != imageID && existing.TaskID == image.TaskID {
						return nil, BadAuthRequest("同一生成任务不能绑定多张策划图")
					}
				}
			}
		}
		req.Image = &image
	}
	updated, _, err := s.repo.UpdateEcommerceRoundImage(userID, projectID, roundID, imageID, repository.EcommerceRoundImageUpdate{ExpectedVersion: req.Version, Image: req.Image, Remove: req.Remove})
	if errors.Is(err, repository.ErrEcommerceRoundConflict) {
		return nil, creationConflict("这轮历史已在其他窗口更新，请刷新后重试")
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, BadAuthRequest("图片不在该历史轮次中")
	}
	if err != nil {
		return nil, err
	}
	view := ecommerceRoundView(updated)
	return &view, nil
}
