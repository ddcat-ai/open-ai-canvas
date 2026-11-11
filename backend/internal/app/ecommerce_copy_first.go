package app

import (
	"fmt"
	"math"
	"regexp"
	"strings"
	"unicode/utf8"
	"yingce/backend/internal/model"
)

type EcommerceCopyBrief struct {
	Text string `json:"text"`
	Mode string `json:"mode"`
}

var ecommerceCopyPageSeparator = regexp.MustCompile(`(?m)^\s*---\s*$`)
var ecommerceTextColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func validateEcommerceCopyBrief(brief *EcommerceCopyBrief) error {
	if brief == nil {
		return nil
	}
	if brief.Mode != "verbatim" && brief.Mode != "polish" {
		return BadAuthRequest("文案处理方式无效")
	}
	if utf8.RuneCountInString(brief.Text) > 8000 {
		return BadAuthRequest("文案最多 8000 字")
	}
	return nil // Empty drafts may be saved; planning requires actual copy.
}

func validateEcommerceSuppliedCopy(draft EcommerceDraft, plan *model.EcommercePlan) error {
	if draft.CopyBrief == nil {
		return nil
	}
	if err := validateEcommerceCopyBrief(draft.CopyBrief); err != nil {
		return err
	}
	if strings.TrimSpace(draft.CopyBrief.Text) == "" {
		return BadAuthRequest("请填写要上图的文案")
	}
	if draft.CopyBrief.Mode != "verbatim" {
		return nil
	}
	compact := func(s string) string {
		return strings.NewReplacer("\r", "", "\n", "").Replace(strings.TrimSpace(s))
	}
	pages := []string{}
	for _, page := range ecommerceCopyPageSeparator.Split(strings.ReplaceAll(draft.CopyBrief.Text, "\r\n", "\n"), -1) {
		if strings.TrimSpace(page) != "" {
			pages = append(pages, compact(page))
		}
	}
	copies := []string{}
	for _, image := range plan.Images {
		copies = append(copies, compact(image.Copy))
	}
	if strings.Join(pages, "") != strings.Join(copies, "") {
		return BadAuthRequest("策划改动或遗漏了给定文案，请重新策划或允许润色")
	}
	if len(pages) > 1 {
		if len(pages) != len(copies) {
			return BadAuthRequest("策划页数与给定文案不一致")
		}
		for i := range pages {
			if pages[i] != copies[i] {
				return BadAuthRequest(fmt.Sprintf("第%d页未保留原文及顺序", i+1))
			}
		}
	}
	return nil
}

func (s *Service) validateEcommerceTextImage(userID string, image model.EcommercePlanTask) error {
	if image.SourcePhotoResourceID != "" {
		resource, err := s.repo.ResourceForUser(userID, image.SourcePhotoResourceID)
		if err != nil || resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
			return BadAuthRequest("实拍图片不存在或不属于当前用户")
		}
	}
	if layout := image.TextLayout; layout != nil {
		if layout.FontFamily != "" && layout.FontFamily != "sans" && layout.FontFamily != "serif" && layout.FontFamily != "rounded" {
			return BadAuthRequest("字体选项无效")
		}
		for _, n := range []float64{layout.X, layout.Y, layout.Width, layout.FontSize} {
			if math.IsNaN(n) || math.IsInf(n, 0) {
				return BadAuthRequest("文字排版参数无效")
			}
		}
		if layout.X < 0 || layout.Y < 0 || layout.Y > 90 || layout.Width < 10 || layout.X+layout.Width > 100 || layout.FontSize < 1 || layout.FontSize > 12 {
			return BadAuthRequest("文字位置或字号超出范围")
		}
		if !ecommerceTextColor.MatchString(layout.Color) || (layout.Background != "transparent" && !ecommerceTextColor.MatchString(layout.Background)) || (layout.Align != "left" && layout.Align != "center" && layout.Align != "right") {
			return BadAuthRequest("文字颜色或对齐方式无效")
		}
		if utf8.RuneCountInString(image.Copy) > 8000 {
			return BadAuthRequest("文案最多 8000 字")
		}
	}
	return nil
}
