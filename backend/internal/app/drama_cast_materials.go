package app

import (
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"yingce/backend/internal/model"
	"yingce/backend/internal/production"
)

func validDramaCastKind(kind string) bool {
	return kind == "character" || kind == "scene" || kind == "prop"
}

func validateDramaCastText(value, label string, limit int, required bool) error {
	if required && strings.TrimSpace(value) == "" {
		return BadAuthRequest("请填写" + label)
	}
	if utf8.RuneCountInString(value) > limit {
		return BadAuthRequest(fmt.Sprintf("%s最多 %d 字", label, limit))
	}
	return nil
}

// 同一组可清空字段供基础设定、造型和无副作用的预览使用。
func applyDramaCastImageFields(cast *model.DramaCast, prompt, styleID, styleName, stylePrompt *string) (map[string]any, error) {
	fields := map[string]any{}
	for _, field := range []struct {
		column, label string
		value         *string
		target        *string
		limit         int
	}{
		{"image_prompt", "图片提示词", prompt, &cast.ImagePrompt, 12000},
		{"image_style_id", "画风 ID", styleID, &cast.ImageStyleID, 64},
		{"image_style_name", "画风名称", styleName, &cast.ImageStyleName, 120},
		{"image_style_prompt", "画风提示词", stylePrompt, &cast.ImageStylePrompt, 4000},
	} {
		if field.value == nil {
			continue
		}
		value := strings.TrimSpace(*field.value)
		if err := validateDramaCastText(value, field.label, field.limit, false); err != nil {
			return nil, err
		}
		*field.target = value
		fields[field.column] = value
	}
	return fields, nil
}

func (s *Service) CreateDramaCast(userID, projectID string, req CreateDramaCastRequest) (model.DramaCast, error) {
	project, _, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return model.DramaCast{}, err
	}
	kind, name, appearance := strings.TrimSpace(req.Kind), strings.TrimSpace(req.Name), strings.TrimSpace(req.Appearance)
	if !validDramaCastKind(kind) {
		return model.DramaCast{}, BadAuthRequest("设定类型必须为 character、scene 或 prop")
	}
	for _, field := range []struct {
		value, label string
		limit        int
		required     bool
	}{
		{name, "名称", 60, true}, {appearance, "外观描述", 1000, true}, {strings.TrimSpace(req.Description), "说明", 1000, false},
	} {
		if err := validateDramaCastText(field.value, field.label, field.limit, field.required); err != nil {
			return model.DramaCast{}, err
		}
	}
	cast := model.DramaCast{ID: newID(), ProjectID: project.ID, Kind: kind, Name: name, Appearance: appearance, Description: strings.TrimSpace(req.Description), AliasesJSON: "[]", ImageStatus: model.DramaMediaDraft, Revision: 1, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if _, err := applyDramaCastImageFields(&cast, &req.ImagePrompt, &req.ImageStyleID, &req.ImageStyleName, &req.ImageStylePrompt); err != nil {
		return model.DramaCast{}, err
	}
	casts, err := s.repo.DramaCasts(project.ID)
	if err != nil {
		return model.DramaCast{}, err
	}
	for _, row := range casts {
		if row.ParentID == "" {
			cast.Position = max(cast.Position, row.Position+1)
		}
	}
	if err := s.repo.CreateDramaCasts([]model.DramaCast{cast}); err != nil {
		return model.DramaCast{}, err
	}
	return cast, nil
}

func dramaCastHasImageStyle(cast model.DramaCast) bool {
	return strings.TrimSpace(cast.ImageStyleID) != "" || strings.TrimSpace(cast.ImageStyleName) != "" || strings.TrimSpace(cast.ImageStylePrompt) != ""
}

// 编排函数是预览和实际提交的唯一入口。自定义提示词是完整正文，不再追加作品旧画风。
func buildDramaCastImagePrompt(settings DramaSettings, meta dramaBibleMeta, cast model.DramaCast) string {
	assets := settings.Assets.Normalized()
	style, rules := settings.StylePrompt, meta.VisualRules
	independentStyle := dramaCastHasImageStyle(cast)
	if independentStyle {
		style, rules = firstNonEmpty(cast.ImageStylePrompt, cast.ImageStyleName, "写实电影感"), ""
	}
	style, rules = production.StripFrameDirectives(style), production.StripFrameDirectives(rules)
	prompt := strings.TrimSpace(cast.ImagePrompt)
	if prompt == "" {
		prompt = production.CastImagePrompt(assets, cast.Kind, cast.Name, firstNonEmpty(cast.Appearance, cast.Description, cast.Role), style, rules)
	} else if independentStyle && style != "" && !strings.Contains(prompt, style) {
		prompt = "本素材画风以以下设定为准，覆盖正文中的旧画风要求：" + style + "。\n" + prompt
	}
	if cast.ParentID != "" {
		identity := "参考图1仅用于识别同一角色的身份与五官特征，不照搬其年龄、体态、服装或背景。按本次造型描述表现年龄与身体比例，允许幼年、成年等年龄变化；服装、发型、妆容和背景以本次造型为准。输出仍须遵循下述作品角色参考图方案的视图与排版。"
		if !strings.Contains(prompt, identity) {
			prompt = identity + "\n" + prompt
		}
	}
	ratio := production.AssetImageRatio
	if cast.Kind == "character" {
		ratio = assets.CharacterRatio
	}
	ratioHint := production.WithAssetRatio("", ratio)
	if !strings.HasSuffix(prompt, ratioHint) {
		prompt = production.WithAssetRatio(prompt, ratio)
	}
	return prompt
}

func (s *Service) PreviewDramaCastImagePrompt(userID, projectID, castID string, req DramaCastImagePromptRequest) (string, error) {
	project, row, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return "", err
	}
	cast, err := s.repo.DramaCast(project.ID, castID)
	if err != nil {
		return "", dramaLookupError(err)
	}
	if req.Appearance != nil {
		appearance := strings.TrimSpace(*req.Appearance)
		if err := validateDramaCastText(appearance, "外观描述", 1000, true); err != nil {
			return "", err
		}
		cast.Appearance = appearance
	}
	if _, err := applyDramaCastImageFields(cast, nil, req.ImageStyleID, req.ImageStyleName, req.ImageStylePrompt); err != nil {
		return "", err
	}
	cast.ImagePrompt = ""
	return buildDramaCastImagePrompt(parseDramaSettings(row.SettingsJSON), parseDramaBibleMeta(row.BibleJSON), *cast), nil
}
