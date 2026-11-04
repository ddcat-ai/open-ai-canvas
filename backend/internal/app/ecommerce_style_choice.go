package app

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
	"yingce/backend/internal/ecommerceagent"
	"yingce/backend/internal/model"
)

// EcommerceStyleChoice is the style the user confirms: a recommended
// direction (optionally rewritten), a library preset ("preset:<key>",
// optionally rewritten) or the user's own style ("custom").
type EcommerceStyleChoice struct {
	DirectionID string `json:"directionId"`
	Name        string `json:"name,omitempty"`
	Description string `json:"description,omitempty"`
}

// A typed style is expanded by the fast analysis model; past this bound the
// user's words are kept on the closest ready-made visual system instead.
const ecommerceCustomStyleTimeout = 25 * time.Second

// SelectEcommerceCreativeStyle confirms the user's final style. A preset or a
// typed style is added to the recommendation as a new direction with its own
// strategy, so planning reads it exactly like a recommended direction.
func (s *Service) SelectEcommerceCreativeStyle(ctx context.Context, userID, recommendationID string, choice EcommerceStyleChoice) (*EcommerceCreativeDirectionSelection, error) {
	if err := s.RequireFeature(FeatureEcommerce); err != nil {
		return nil, err
	}
	choice.DirectionID, choice.Name, choice.Description = strings.TrimSpace(choice.DirectionID), strings.TrimSpace(choice.Name), strings.TrimSpace(choice.Description)
	if utf8.RuneCountInString(choice.Name) > 40 || utf8.RuneCountInString(choice.Description) > 500 {
		return nil, BadAuthRequest("风格名称最多 40 字，风格描述最多 500 字")
	}
	presetKey, isPreset := strings.CutPrefix(choice.DirectionID, "preset:")
	isCustom := choice.DirectionID == "custom"
	if !isPreset && !isCustom && choice.Name == "" && choice.Description == "" {
		return s.SelectEcommerceCreativeDirection(userID, recommendationID, choice.DirectionID)
	}
	item, err := s.repo.EcommerceRecommendation(userID, recommendationID)
	if err != nil {
		return nil, NotFound("推荐任务不存在")
	}
	var directions []ecommerceStoredDirection
	if err := json.Unmarshal([]byte(item.DirectionsJSON), &directions); err != nil || len(directions) == 0 {
		return nil, BadAuthRequest("推荐任务数据损坏")
	}
	id := choice.DirectionID
	var preset ecommerceagent.StylePreset
	switch {
	case isCustom:
		if choice.Name == "" && choice.Description == "" {
			return nil, BadAuthRequest("请填写风格名称或风格描述")
		}
		id = item.ID + "-custom"
	case isPreset:
		var ok bool
		if preset, ok = ecommerceagent.StylePresetByKey(presetKey); !ok {
			return nil, BadAuthRequest("风格库中没有这个风格，请刷新后重试")
		}
		id = item.ID + "-style-" + preset.Key
	}
	index := -1
	for i := range directions {
		if directions[i].ID == id {
			index = i
			break
		}
	}
	// A confirmed selection is final: a retry returns it as stored and never
	// runs the model again or swaps the style.
	if item.SelectedDirectionID != "" {
		if item.SelectedDirectionID != id || index < 0 {
			return nil, BadAuthRequest("该推荐任务已经选择了其他方向，请重新获取推荐")
		}
		return ecommerceDirectionSelection(item.ID, directions[index]), nil
	}
	if !isPreset && !isCustom && index < 0 {
		return nil, BadAuthRequest("创意方向不存在")
	}

	// The first direction carries the shared brief, facts, page count and ratio.
	base := directions[0]
	shared := ecommerceStoredRecommendation(base)
	var rec ecommerceagent.Recommendation
	var hint *ecommerceagent.Recommendation
	mode, source := "creative", "custom"
	switch {
	case isPreset:
		preset = ecommerceagent.AdaptStylePreset(preset, item.ProductCategory)
		rec, mode, source = preset.Recommendation(), preset.Mode, "preset"
		hint = &rec
	case isCustom:
		matched, ok := ecommerceagent.MatchStylePreset(choice.Name + " " + choice.Description)
		if ok {
			mode = matched.Mode
		} else {
			matched, _ = ecommerceagent.StylePresetByKey(ecommerceagent.DefaultStylePresetKey)
		}
		rec = matched.Recommendation()
		if ok {
			hint = &rec
		}
	default:
		base = directions[index]
		rec = ecommerceStoredRecommendation(base)
		mode, source = ecommerceWorkbenchDirectionModes[index%len(ecommerceWorkbenchDirectionModes)], "edited"
		hint = &rec
	}
	rewritten := isCustom || (choice.Name != "" && choice.Name != rec.Label) || (choice.Description != "" && choice.Description != rec.Style)
	if !isPreset && !rewritten {
		return s.SelectEcommerceCreativeDirection(userID, recommendationID, id)
	}
	if rewritten {
		var reference *ecommerceagent.Recommendation
		if hint != nil {
			copied := *hint
			reference = &copied
		}
		rec = s.ecommerceCustomStyle(ctx, userID, base.Strategy["brief"], choice.Name, choice.Description, reference, rec)
	}
	rec.ID, rec.Pages, rec.AspectRatio, rec.NeedText = id, shared.Pages, shared.AspectRatio, shared.NeedText
	ecommerceagent.RepairStyleRecommendation(&rec)
	if !ecommerceagent.CompleteStyleRecommendation(rec) {
		return nil, BadAuthRequest("风格信息不完整，请补充风格描述后重试")
	}
	strategy, err := s.ecommerceStyleStrategy(userID, item, base, rec, mode)
	if err != nil {
		return nil, err
	}
	strategy["styleSource"] = source
	if rewritten {
		strategy["userStyle"] = map[string]any{"name": choice.Name, "description": choice.Description}
	}
	stored := ecommerceStoredDirection{ID: id, Name: rec.Label, Summary: rec.Style + "；" + rec.Why, Tags: append(append([]string{}, rec.VisualSystem.Palette...), rec.AspectRatio), CategoryFit: base.CategoryFit, Visual: ecommerceDirectionVisualFrom(rec), Strategy: strategy}
	if index >= 0 {
		directions[index] = stored
	} else {
		directions = append(directions, stored)
	}
	raw, err := json.Marshal(directions)
	if err != nil {
		return nil, err
	}
	if err := s.repo.SelectEcommerceRecommendationStyle(userID, item.ID, id, string(raw)); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, BadAuthRequest("该推荐任务已经选择了其他方向，请重新获取推荐")
		}
		return nil, err
	}
	slog.Info("ecommerce style selected", "recommendation", item.ID, "direction", id, "source", source, "rewritten", rewritten)
	return ecommerceDirectionSelection(item.ID, stored), nil
}

// ecommerceStoredRecommendation reads the direction a stored strategy was built
// from; older stored directions fall back to their public fields.
func ecommerceStoredRecommendation(direction ecommerceStoredDirection) ecommerceagent.Recommendation {
	var rec ecommerceagent.Recommendation
	if raw, err := json.Marshal(direction.Strategy["direction"]); err == nil {
		_ = json.Unmarshal(raw, &rec)
	}
	if strings.TrimSpace(rec.Label) == "" {
		rec.Label = direction.Name
	}
	if strings.TrimSpace(rec.Style) == "" {
		rec.Style = direction.Summary
		if direction.Visual != nil && direction.Visual.Style != "" {
			rec.Style = direction.Visual.Style
		}
	}
	if rec.VisualSystem == nil && direction.Visual != nil {
		v := direction.Visual
		rec.Why = firstNonEmptyText(rec.Why, v.Why)
		rec.VisualSystem = &ecommerceagent.VisualSystem{Palette: append([]string{}, v.Palette...), Typography: v.Typography, Layout: v.Layout, Scene: v.Scene, Lighting: v.Lighting, Camera: v.Camera, Props: v.Props, ColorGrade: v.ColorGrade}
	}
	return rec
}

// ecommerceStyleStrategy copies the shared strategy of the recommendation and
// re-runs the direction skills, so the visual lock and copy tone follow the
// confirmed style instead of the direction it was copied from.
func (s *Service) ecommerceStyleStrategy(userID string, item *model.EcommerceCreativeRecommendation, base ecommerceStoredDirection, rec ecommerceagent.Recommendation, mode string) (map[string]any, error) {
	strategy := map[string]any{}
	raw, _ := json.Marshal(base.Strategy)
	if err := json.Unmarshal(raw, &strategy); err != nil {
		return nil, BadAuthRequest("推荐任务数据损坏")
	}
	strategy["direction"] = rec
	project, err := s.EcommerceProject(userID, item.ProjectID)
	if err != nil {
		return nil, err
	}
	// The draft only refines the knowledge query; the category alone still works.
	var draft EcommerceDraft
	_ = json.Unmarshal([]byte(project.DraftJSON), &draft)
	req := ecommerceWorkbenchDirectionsRequest(item.ProjectID, draft)
	knowledgeRequest := req
	knowledgeRequest.Category = item.ProductCategory
	_, knowledge, err := s.ecommerceCreativeContext(knowledgeRequest)
	if err != nil {
		return nil, err
	}
	analysis := runEcommerceProductAnalysis(ecommerceProductCategory(knowledgeRequest), req, knowledge)
	input := ecommerceDirectionInput{Seed: ecommerceDirectionSeed{Name: rec.Label, Summary: rec.Style, Mode: mode}}
	if rec.VisualSystem != nil {
		input.Palette, input.Lighting, input.Layout = rec.VisualSystem.Palette, rec.VisualSystem.Lighting, rec.VisualSystem.Layout
	}
	planEcommerceDirectionInputs([]ecommerceDirectionInput{input}, knowledge, analysis, "creative-directions")[0].attach(strategy)
	return strategy, nil
}

// ecommerceCustomStyle expands a typed or rewritten style with the analysis
// model. Without a usable answer it keeps the user's words on the fallback
// visual system, so a confirmed choice never fails because of the model.
func (s *Service) ecommerceCustomStyle(ctx context.Context, userID string, brief any, name, description string, hint *ecommerceagent.Recommendation, fallback ecommerceagent.Recommendation) ecommerceagent.Recommendation {
	cfg, err := s.ecommerceVisionText(userID, ecommerceConfig())
	if err == nil {
		err = cfg.validate()
	}
	if err == nil && cfg.Mode == "live" {
		callCtx, cancel := context.WithTimeout(ctx, ecommerceCustomStyleTimeout)
		defer cancel()
		started := time.Now()
		var rec ecommerceagent.Recommendation
		err = s.ecommerceChatJSON(callCtx, cfg, "custom-style", ecommerceagent.CustomStyleSystem, ecommerceagent.CustomStyleRequest(brief, name, description, hint), nil, &rec)
		if err == nil {
			ecommerceagent.RepairStyleRecommendation(&rec)
			if ecommerceagent.CompleteStyleRecommendation(rec) {
				if name != "" {
					rec.Label = name
				}
				slog.Info("ecommerce custom style expanded", "model", cfg.TextModel, "latencyMs", time.Since(started).Milliseconds())
				return rec
			}
			err = errors.New("模型返回的风格缺少配色或描述")
		}
		slog.Warn("ecommerce custom style fallback", "model", cfg.TextModel, "latencyMs", time.Since(started).Milliseconds(), "error", err)
	}
	if name != "" {
		fallback.Label = name
	}
	if description != "" {
		fallback.Style = description
	}
	return fallback
}

func firstNonEmptyText(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
