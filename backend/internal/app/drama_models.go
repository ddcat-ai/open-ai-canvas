package app

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"

	"yingce/backend/internal/production"
)

var dramaCapabilities = []string{"text", "image", "video"}

// dramaModelIntent 是短剧流水线对各能力的最低要求：参考图走文生图；视频只要求能生成视频，
// 生成方式（尾帧续接需要图生视频，并行出片只需参考图生视频或文生视频）由 dramaVideoProfile 按能力合同判断。
func dramaModelIntent(capability string) *ModelRequestIntent {
	switch capability {
	case "image":
		return &ModelRequestIntent{Capability: "image", Operation: "text_to_image"}
	case "video":
		return &ModelRequestIntent{Capability: "video"}
	}
	return &ModelRequestIntent{Capability: "text"}
}

// dramaSegmentOperation 是剧情段视频在该衔接方式下的主要生成方式，用于报价与能力校验。
func dramaSegmentOperation(settings DramaSettings, profile dramaVideoProfile) (string, map[string]int) {
	if !settings.parallelVideo() {
		return "image_to_video", map[string]int{"image": 1}
	}
	if profile.supports("reference_to_video") {
		return "reference_to_video", map[string]int{"image": 1}
	}
	return "text_to_video", nil
}

// validateDramaVideoSettings 在保存设置时确认视频模型支持所选的段落衔接方式。
func (s *Service) validateDramaVideoSettings(settings DramaSettings) error {
	if settings.Models.Video.Empty() {
		return nil
	}
	profile, err := s.dramaVideoProfile(settings.Models.Video)
	if err != nil {
		return BadAuthRequest("视频模型不可用于短剧：" + err.Error())
	}
	if issue := profile.continuityIssue(settings); issue != "" {
		return BadAuthRequest(issue)
	}
	return nil
}

// dramaModelOptions 列出某能力下的平台模型：可由服务端无人值守执行的进入 options，
// 其余带原因进入 unavailable。候选与创作端目录同源（不带意图过滤），避免“别处能选、这里看不到”。
func (s *Service) dramaModelOptions(userID string, capability string) ([]DramaModelOption, []DramaModelUnavailable, error) {
	access, err := s.userGroupAccess(userID)
	if err != nil {
		return nil, nil, err
	}
	options := []DramaModelOption{}
	unavailable := []DramaModelUnavailable{}
	seen := map[string]bool{}
	add := func(choice DramaModelChoice, key, label, priceLabel string, available bool) {
		if seen[key] {
			return
		}
		seen[key] = true
		reason := ""
		if !available {
			reason = "模型暂不可用或未配置有效价格"
		} else {
			reason = s.dramaChoiceIssue(access, choice, capability)
		}
		if reason != "" {
			unavailable = append(unavailable, DramaModelUnavailable{Choice: choice, Reason: reason})
			return
		}
		options = append(options, s.dramaModelOption(choice, capability, label, priceLabel))
	}
	frontendEnabled, err := s.FeatureEnabled(FeatureFrontendModels)
	if err != nil {
		return nil, nil, err
	}
	if frontendEnabled {
		models, err := s.PublicLogicalModels(access, nil)
		if err != nil {
			return nil, nil, err
		}
		for _, item := range models {
			if normalizeCapability(item.Capability) != capability {
				continue
			}
			add(DramaModelChoice{LogicalModelID: item.ID, Label: item.Name, PriceLabel: item.PriceLabel}, "l:"+item.ID, item.Name, item.PriceLabel, item.Available)
		}
	}
	catalog, err := s.ModelCatalog(access, nil)
	if err != nil {
		return nil, nil, err
	}
	for _, channel := range catalog.Channels {
		for _, item := range channel.Models {
			if normalizeCapability(item.Capability) != capability {
				continue
			}
			label := firstNonEmpty(item.DisplayName, item.ModelKey)
			add(DramaModelChoice{ChannelID: channel.ID, ModelKey: item.ModelKey, Label: label, PriceLabel: item.PriceLabel}, "c:"+channel.ID+":"+item.ModelKey, label, item.PriceLabel, item.Available)
		}
	}
	return options, unavailable, nil
}

// dramaChoiceIssue 返回模型不能用于短剧的原因；空串表示可用。
func (s *Service) dramaChoiceIssue(access *userGroupAccess, choice DramaModelChoice, capability string) string {
	intent := dramaModelIntent(capability)
	if choice.LogicalModelID != "" {
		if _, err := s.ResolveLogicalModel(access, choice.LogicalModelID, *intent); err != nil {
			return dramaIntentIssue(capability, err.Error())
		}
	} else {
		row, err := s.repo.ChannelModelByKey(choice.ChannelID, choice.ModelKey)
		if err != nil {
			return "模型不存在或已下架"
		}
		if normalizeCapability(row.Capability) != "audio" {
			config, err := normalizedChannelModelCapability(row, s.protocolRegistry())
			if err != nil {
				return "模型能力配置无效：" + err.Error()
			}
			spec, err := CapabilitySpecFromModelCapabilityConfig(config, row.Capability)
			if err != nil {
				return "模型能力配置无效：" + err.Error()
			}
			if match := MatchCapability(spec, *intent); !match.Matched {
				return dramaIntentIssue(capability, strings.Join(match.Reasons, "；"))
			}
		}
	}
	if capability == "video" {
		if _, err := s.dramaVideoProfile(choice); err != nil {
			return err.Error()
		}
	}
	if capability == "image" {
		// 场景与道具参考图固定横版 16:9：给不出接近尺寸的模型会把它们画成方图。
		if request := s.dramaImageRequestFor(choice, production.AssetImageRatio, ""); request.Issue != "" {
			return request.Issue
		}
	}
	return ""
}

// validateDramaImageSettings 在保存设置时确认所选图片模型能按参考图画幅与分辨率出图，
// 避免开工后每张参考图都失败。模型能力读不到时交给提交时校验。
func (s *Service) validateDramaImageSettings(models DramaModels, assets production.AssetSettings) error {
	if models.Image.Empty() {
		return nil
	}
	ratios := []string{production.AssetImageRatio}
	if assets.CharacterRatio != production.AssetImageRatio {
		ratios = append(ratios, assets.CharacterRatio)
	}
	for _, ratio := range ratios {
		if request := s.dramaImageRequestFor(models.Image, ratio, assets.Resolution); request.Issue != "" {
			return BadAuthRequest("参考图设置与图片模型不匹配：" + request.Issue)
		}
	}
	return nil
}

func dramaIntentIssue(capability, reason string) string {
	switch capability {
	case "image":
		return "短剧参考图需要文生图：" + reason
	case "video":
		return "短剧需要可生成视频的模型：" + reason
	}
	return reason
}

func (s *Service) DramaModelCatalog(userID string) (DramaModelCatalog, error) {
	result := DramaModelCatalog{Options: map[string][]DramaModelOption{}}
	result.Unavailable = map[string][]DramaModelUnavailable{}
	for _, capability := range dramaCapabilities {
		options, unavailable, err := s.dramaModelOptions(userID, capability)
		if err != nil {
			return result, err
		}
		result.Options[capability] = options
		result.Unavailable[capability] = unavailable
		// 新作品默认尾帧续接，默认视频模型优先选支持图生视频的。
		if option, ok := preferredDramaOption(options, DramaSettings{VideoContinuity: DramaContinuityTailFrame}); ok {
			setDramaModelChoice(&result.Defaults, capability, option.Choice)
		}
	}
	return result, nil
}

// preferredDramaOption 返回第一个满足作品衔接方式的候选；都不满足时退回第一个，由保存时校验说明原因。
func preferredDramaOption(options []DramaModelOption, settings DramaSettings) (DramaModelOption, bool) {
	if len(options) == 0 {
		return DramaModelOption{}, false
	}
	for _, option := range options {
		if option.Capability != "video" || settings.parallelVideo() || option.TailFrameChain {
			return option, true
		}
	}
	return options[0], true
}

func setDramaModelChoice(models *DramaModels, capability string, choice DramaModelChoice) {
	switch capability {
	case "text":
		models.Text = choice
	case "image":
		models.Image = choice
	case "video":
		models.Video = choice
	}
}

// resolveDramaModels 为未选择的能力补齐默认模型；新用户无需进入任何模型配置即可启动。
// 视频模型按作品的段落衔接方式挑选（尾帧续接需要图生视频）。
func (s *Service) resolveDramaModels(userID string, settings DramaSettings) (DramaModels, error) {
	models := settings.Models
	for _, capability := range dramaCapabilities {
		if !models.choice(capability).Empty() {
			continue
		}
		options, _, err := s.dramaModelOptions(userID, capability)
		if err != nil {
			return models, err
		}
		if option, ok := preferredDramaOption(options, settings); ok {
			setDramaModelChoice(&models, capability, option.Choice)
		}
	}
	return models, nil
}

func missingDramaCapabilities(models DramaModels) []string {
	labels := map[string]string{"text": "文本", "image": "图片", "video": "视频"}
	missing := []string{}
	for _, capability := range dramaCapabilities {
		if models.choice(capability).Empty() {
			missing = append(missing, labels[capability])
		}
	}
	return missing
}

// dramaVideoProfile 是视频模型能力合同中短剧需要的部分：时长档位、支持的生成方式、参考图上限与是否可开启原声。
type dramaVideoProfile struct {
	Durations     production.DurationOptions
	Operations    []string
	MaxImages     int
	GenerateAudio bool
}

// supports 与 MatchCapability 一致：未声明生成方式的模型视为不限制。
func (p dramaVideoProfile) supports(operation string) bool {
	if len(p.Operations) == 0 {
		return true
	}
	for _, item := range p.Operations {
		if item == operation {
			return true
		}
	}
	return false
}

func (p dramaVideoProfile) maxSeconds() int {
	return dramaMaxVideoSeconds(p.Durations)
}

// continuityIssue 返回模型不支持作品段落衔接方式的原因；空串表示可用。
func (p dramaVideoProfile) continuityIssue(settings DramaSettings) string {
	if !settings.parallelVideo() && !p.supports("image_to_video") {
		return "所选视频模型不支持图生视频，无法用上一段尾帧续接；请在制作设置里改用“并行出片”或换用支持图生视频的模型"
	}
	return ""
}

func (s *Service) dramaVideoProfile(choice DramaModelChoice) (dramaVideoProfile, error) {
	var capability *ModelCapabilityConfig
	if choice.LogicalModelID != "" {
		// 只读取能力画像；用户授权在任务准入时按分组校验。
		routed, err := s.ResolveLogicalModel(nil, choice.LogicalModelID, *dramaModelIntent("video"))
		if err != nil {
			return dramaVideoProfile{}, err
		}
		if routed == nil {
			return dramaVideoProfile{}, errors.New("视频模型路由不存在")
		}
		var parseErr error
		capability, parseErr = normalizedChannelModelCapability(&routed.ChannelModel, s.protocolRegistry())
		if parseErr != nil {
			return dramaVideoProfile{}, parseErr
		}
	} else if choice.ChannelID != "" && choice.ModelKey != "" {
		row, err := s.repo.ChannelModelByKey(choice.ChannelID, choice.ModelKey)
		if err != nil {
			return dramaVideoProfile{}, err
		}
		capability, err = normalizedChannelModelCapability(row, s.protocolRegistry())
		if err != nil {
			return dramaVideoProfile{}, err
		}
	} else {
		return dramaVideoProfile{}, errors.New("请选择视频模型")
	}
	if capability == nil || capability.Video == nil {
		return dramaVideoProfile{}, errors.New("模型未声明视频能力")
	}
	video := capability.Video
	options := production.DurationOptions{Values: video.Duration.Values, Min: video.Duration.Min, Max: video.Duration.Max, Step: video.Duration.Step}
	profile := dramaVideoProfile{Durations: options, Operations: video.Operations, MaxImages: video.References.MaxImages, GenerateAudio: video.GenerateAudio.Supported}
	if profile.maxSeconds() <= 0 {
		return profile, errors.New("未声明可生成时长，无法按剧情段切分")
	}
	if !profile.GenerateAudio {
		return profile, errors.New("未声明原声对白（generateAudio）：短剧台词由视频模型直接出声")
	}
	if !profile.supports("reference_to_video") && !profile.supports("text_to_video") {
		return profile, errors.New("短剧需要支持参考图生视频或文生视频（开场段与并行出片）")
	}
	return profile, nil
}

func (s *Service) quoteDramaChoice(userID string, choice DramaModelChoice, intent ModelRequestIntent) (int64, bool) {
	if choice.Empty() {
		return 0, false
	}
	var quote *LogicalModelQuote
	var err error
	if choice.LogicalModelID != "" {
		quote, err = s.QuoteLogicalModel(userID, choice.LogicalModelID, intent)
	} else {
		quote, err = s.QuoteChannelModel(userID, ChannelModelQuoteRequest{ChannelID: choice.ChannelID, ModelKey: choice.ModelKey, Intent: intent})
	}
	if err != nil || quote == nil {
		return 0, false
	}
	return quote.AmountMicrocredits, true
}

// EstimateDrama 依据真实报价估算整部剧的费用区间；数量按经验比例推算，结果只用于预算决策。
func (s *Service) EstimateDrama(userID string, req DramaEstimateRequest) (DramaEstimate, error) {
	settings := req.Settings.normalized()
	models, err := s.resolveDramaModels(userID, settings)
	if err != nil {
		return DramaEstimate{}, err
	}
	chapters := max(req.ChapterCount, 1)
	words := max(req.WordCount, chapters*1000)
	// 竖屏短剧每集约 90 秒，对应原文 2000-3000 字；章节过短时按字数折算。
	episodes := int(math.Round(float64(words) / 2500 * 90 / float64(settings.EpisodeSeconds)))
	if mode := firstNonEmpty(settings.EpisodeMode, req.EpisodeMode); mode == DramaEpisodeModeChapter {
		perEpisode := max(1, settings.ChaptersPerEpisode)
		episodes = (chapters + perEpisode - 1) / perEpisode
	}
	episodes = max(episodes, 1)
	shotsPerEpisode := settings.Storyboard.ShotTarget(settings.EpisodeSeconds)
	profile, err := s.dramaVideoProfile(models.Video)
	if err != nil {
		return DramaEstimate{}, err
	}
	// 一个剧情段一次视频调用；智能模式按模型上限估算，是调用次数的下限。
	segmentSeconds := max(settings.Storyboard.SegmentLimits(profile.maxSeconds()).TargetSeconds(), 1)
	segmentsPerEpisode := max(1, int(math.Ceil(float64(settings.EpisodeSeconds)/float64(segmentSeconds))))
	casts := min(60, 12+episodes/3)
	estimate := DramaEstimate{
		Episodes:        episodes,
		Shots:           episodes * shotsPerEpisode,
		Images:          casts,
		Videos:          episodes * segmentsPerEpisode,
		TextCalls:       1 + (chapters+9)/10 + episodes*(1+segmentsPerEpisode),
		DurationMinutes: episodes * settings.EpisodeSeconds / 60,
	}
	textCost, okText := s.quoteDramaChoice(userID, models.Text, ModelRequestIntent{Capability: "text"})
	// 参考图按实际提交的尺寸与分辨率报价，避免按模型默认档位低估。
	imageIntent := *dramaModelIntent("image")
	if request := s.dramaImageRequestFor(models.Image, production.AssetImageRatio, settings.Assets.Resolution); request.Issue == "" {
		imageIntent.Options = map[string]any{}
		if request.Size != "" {
			imageIntent.Options["size"] = request.Size
		}
		if request.Resolution != "" {
			imageIntent.Options["imageResolution"] = request.Resolution
		}
	}
	imageCost, okImage := s.quoteDramaChoice(userID, models.Image, imageIntent)
	operation, inputs := dramaSegmentOperation(settings, profile)
	videoCost, okVideo := s.quoteDramaChoice(userID, models.Video, ModelRequestIntent{Capability: "video", Operation: operation, Inputs: inputs, Options: map[string]any{"videoSeconds": itoa(production.SnapVideoSeconds(int64(segmentSeconds)*1000, profile.Durations))}})
	total := int64(estimate.TextCalls)*textCost + int64(estimate.Images)*imageCost + int64(estimate.Videos)*videoCost
	sample := textCost*int64(2+segmentsPerEpisode) + int64(casts)*imageCost + int64(segmentsPerEpisode)*videoCost
	estimate.Priced = okText || okImage || okVideo
	estimate.MinMicrocredits = total * 9 / 10
	// 上限包含失败重试与返工的余量。
	estimate.MaxMicrocredits = total * 14 / 10
	estimate.SampleMicrocredit = sample
	notes := []string{}
	if !(okText && okImage && okVideo) {
		notes = append(notes, "部分模型暂无报价，费用按已知部分估算")
	}
	if missing := missingDramaCapabilities(models); len(missing) > 0 {
		notes = append(notes, "尚无可用的"+strings.Join(missing, "、")+"模型")
	}
	estimate.Note = strings.Join(notes, "；")
	return estimate, nil
}

// dramaImageSpec 读取图片模型的能力合同；与云端 Agent 生图选项同一加载方式。
func (s *Service) dramaImageSpec(choice DramaModelChoice) (CapabilitySpec, map[string]any, bool) {
	defaults := map[string]any{}
	if choice.LogicalModelID != "" {
		snapshot, err := s.routeCatalogSnapshot()
		if err != nil {
			return CapabilitySpec{}, nil, false
		}
		cached, exists := snapshot.Models[choice.LogicalModelID]
		if !exists {
			return CapabilitySpec{}, nil, false
		}
		return cached.ProductSpec, cached.Defaults, true
	}
	if choice.ChannelID == "" {
		return CapabilitySpec{}, nil, false
	}
	item, err := s.repo.ChannelModelByKey(choice.ChannelID, choice.ModelKey)
	if err != nil {
		return CapabilitySpec{}, nil, false
	}
	profile, err := normalizedChannelModelCapability(item, s.protocolRegistry())
	if err != nil {
		return CapabilitySpec{}, nil, false
	}
	spec, err := CapabilitySpecFromModelCapabilityConfig(profile, item.Capability)
	if err != nil {
		return CapabilitySpec{}, nil, false
	}
	applyChannelCapabilityDefaults(defaults, "image", profile)
	return spec, defaults, true
}

// dramaAssetRatios 与 production.AssetSettings.Normalized 接受的角色参考图画幅一致。
var dramaAssetRatios = []string{"16:9", "4:3", "1:1", "3:4", "9:16"}

// 参考图画幅允许的偏差：宽高比的对数差不超过 0.18（约 ±20%）。16:9 可以落到 3:2，
// 不会落到 4:3 或 1:1；超出时直接报错，不能让模型悄悄出方图。
const dramaRatioTolerance = 0.18

// DramaImageTiers 是参考图可指定的分辨率档位，与模型能力合同的 tier 命名一致。
var DramaImageTiers = []string{"1k", "1.5k", "2k", "4k"}

// 允许自定义像素尺寸的模型按档位的像素总量换算宽高。
var dramaTierPixels = map[string]float64{"1k": 1024 * 1024, "1.5k": 1536 * 1536, "2k": 2048 * 2048, "4k": 4096 * 4096}

// dramaImageRequest 是一次参考图生成的尺寸参数：size 是模型真正接受的取值（像素或比例），
// resolution 是明确指定的分辨率档位；Issue 非空表示所选模型给不出这个画幅或档位。
type dramaImageRequest struct {
	Size       string
	Resolution string
	Issue      string
}

func (r dramaImageRequest) apply(config map[string]any) {
	if r.Size != "" {
		config["size"] = r.Size
	}
	if r.Resolution != "" {
		config["imageResolution"] = r.Resolution
	}
}

// dramaImageRequestFor 把期望画幅与档位换算成所选模型的尺寸参数。流水线无人值守、按张计费，
// 参考图画幅直接决定视频里人物与场景的构图，因此只在比例足够接近时替换，绝不退到模型默认的方图。
func (s *Service) dramaImageRequestFor(choice DramaModelChoice, ratio, tier string) dramaImageRequest {
	spec, defaults, ok := s.dramaImageSpec(choice)
	if !ok {
		// 能力合同读不到（例如测试替身或刚下架）时按原比例提交，由任务准入严格校验。
		return dramaImageRequest{Size: ratio}
	}
	return dramaImageRequestForSpec(spec, defaults, ratio, tier)
}

func dramaImageRequestForSpec(spec CapabilitySpec, defaults map[string]any, ratio, tier string) dramaImageRequest {
	target, ok := dramaRatioValue(ratio)
	if !ok {
		return dramaImageRequest{Issue: "参考图画幅无效：" + ratio}
	}
	constraint, declared := spec.Options["size"]
	if !declared || (spec.ImageSize != nil && spec.ImageSize.Parameter == "none") {
		return dramaImageRequest{Issue: "所选图片模型不能指定画幅，参考图会按模型默认尺寸（通常是 1:1）出图；请换用能指定尺寸的图片模型"}
	}
	tier = strings.ToLower(strings.TrimSpace(tier))
	if tier != "" && !dramaImageTierAvailable(spec, tier) {
		return dramaImageRequest{Issue: "所选图片模型不支持 " + strings.ToUpper(tier) + " 分辨率"}
	}
	if tier == "" {
		tier = dramaDefaultImageTier(spec, defaults)
	}
	request := dramaImageRequest{}
	if constraint, independent := spec.Options["imageResolution"]; independent && tier != "" && matchOptionConstraint("imageResolution", constraint, tier) {
		request.Resolution = tier
	}
	candidates := dramaSizeCandidates(spec, constraint, tier)
	best, bestRatio, bestScore := "", "", math.Inf(1)
	for _, candidate := range candidates {
		value, ok := dramaRatioValue(firstNonEmpty(candidate.ratio, candidate.value))
		if !ok {
			continue
		}
		score := math.Abs(math.Log(value) - math.Log(target))
		if score < bestScore-1e-9 {
			best, bestRatio, bestScore = candidate.value, firstNonEmpty(candidate.ratio, candidate.value), score
		}
	}
	if best != "" && bestScore <= dramaRatioTolerance {
		request.Size = best
		return request
	}
	if dramaSizeAllowsCustom(constraint) {
		if spec.ImageSize != nil && spec.ImageSize.Parameter == "size" {
			request.Size = dramaCustomPixelSize(target, tier)
		} else {
			request.Size = ratio
		}
		return request
	}
	if best == "" {
		return dramaImageRequest{Issue: "所选图片模型没有声明可用的画面尺寸，无法按 " + ratio + " 出图"}
	}
	return dramaImageRequest{Issue: fmt.Sprintf("所选图片模型没有接近 %s 的尺寸（最接近的是 %s），参考图会变形或变成方图；请换用支持 %s 的图片模型，或改参考图画幅", ratio, dramaRatioLabel(bestRatio), ratio)}
}

type dramaSizeCandidate struct {
	value string
	ratio string
}

// dramaSizeCandidates 列出模型在该档位下接受的尺寸；档位没有专属预设时使用全部声明值。
func dramaSizeCandidates(spec CapabilitySpec, constraint OptionConstraint, tier string) []dramaSizeCandidate {
	candidates := []dramaSizeCandidate{}
	if spec.ImageSize != nil && len(spec.ImageSize.Presets) > 0 {
		inTier := false
		for _, preset := range spec.ImageSize.Presets {
			if tier != "" && preset.Tier == tier {
				inTier = true
				break
			}
		}
		for _, preset := range spec.ImageSize.Presets {
			if inTier && preset.Tier != tier {
				continue
			}
			value := strings.TrimSpace(preset.Ratio)
			if spec.ImageSize.Parameter == "size" {
				value = strings.TrimSpace(preset.Size)
			}
			if value != "" && matchOptionConstraint("size", constraint, value) {
				candidates = append(candidates, dramaSizeCandidate{value: value, ratio: strings.TrimSpace(preset.Ratio)})
			}
		}
		if inTier {
			return candidates
		}
	}
	for _, value := range constraint.Values {
		if text := strings.TrimSpace(stringValue(value)); text != "" && text != "*" {
			candidates = append(candidates, dramaSizeCandidate{value: text})
		}
	}
	return candidates
}

func dramaSizeAllowsCustom(constraint OptionConstraint) bool {
	for _, value := range constraint.Values {
		if normalizedScalar(value) == "*" {
			return true
		}
	}
	return false
}

// dramaImageTierAvailable 判断模型是否提供该档位：独立分辨率参数按其取值，否则按尺寸预设的档位。
func dramaImageTierAvailable(spec CapabilitySpec, tier string) bool {
	if constraint, independent := spec.Options["imageResolution"]; independent {
		return matchOptionConstraint("imageResolution", constraint, tier)
	}
	if spec.ImageSize != nil {
		for _, preset := range spec.ImageSize.Presets {
			if preset.Tier == tier {
				return true
			}
		}
	}
	return false
}

// dramaImageTiersFor 返回模型可选的分辨率档位（按 DramaImageTiers 排序）。
func dramaImageTiersFor(spec CapabilitySpec) []string {
	tiers := []string{}
	for _, tier := range DramaImageTiers {
		if dramaImageTierAvailable(spec, tier) {
			tiers = append(tiers, tier)
		}
	}
	return tiers
}

// dramaDefaultImageTier 是作品未指定分辨率时的档位：模型默认分辨率，其次是默认尺寸所在的预设档位。
func dramaDefaultImageTier(spec CapabilitySpec, defaults map[string]any) string {
	if tier := strings.ToLower(stringValue(defaults["imageResolution"])); tier != "" && tier != "auto" && dramaImageTierAvailable(spec, tier) {
		return tier
	}
	if spec.ImageSize == nil || len(spec.ImageSize.Presets) == 0 {
		return ""
	}
	defaultSize := stringValue(defaults["size"])
	for _, preset := range spec.ImageSize.Presets {
		if defaultSize != "" && (strings.EqualFold(preset.Size, defaultSize) || preset.Ratio == defaultSize) {
			return preset.Tier
		}
	}
	return spec.ImageSize.Presets[0].Tier
}

// dramaCustomPixelSize 按档位像素总量换算宽高，取 16 的倍数。
func dramaCustomPixelSize(ratio float64, tier string) string {
	pixels := dramaTierPixels[tier]
	if pixels == 0 {
		pixels = dramaTierPixels["1k"]
	}
	height := math.Sqrt(pixels / ratio)
	width := height * ratio
	round := func(value float64) int { return max(16, int(math.Round(value/16))*16) }
	return fmt.Sprintf("%dx%d", round(width), round(height))
}

// dramaRatioLabel 把 "1024x1024" 这类像素值显示成约分后的比例。
func dramaRatioLabel(value string) string {
	ratio, ok := dramaRatioValue(value)
	if !ok {
		return value
	}
	for _, label := range []string{"21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"} {
		if known, _ := dramaRatioValue(label); math.Abs(math.Log(known)-math.Log(ratio)) < 0.02 {
			return label
		}
	}
	return value
}

// dramaImageRatioMismatch 检查生成结果的实际画幅；宽高未知（如部分 WebP）时不判断。
func dramaImageRatioMismatch(width, height int, ratio string) bool {
	target, ok := dramaRatioValue(ratio)
	if !ok || width <= 0 || height <= 0 {
		return false
	}
	return math.Abs(math.Log(float64(width)/float64(height))-math.Log(target)) > dramaRatioTolerance
}

// dramaRatioValue 解析 "9:16" 或 "1024x1824" 为宽高比；auto 等非尺寸值返回 false。
func dramaRatioValue(value string) (float64, bool) {
	value = strings.TrimSpace(strings.ToLower(value))
	separator := ":"
	if !strings.Contains(value, ":") {
		separator = "x"
	}
	left, right, found := strings.Cut(value, separator)
	if !found {
		return 0, false
	}
	width, widthErr := strconv.ParseFloat(strings.TrimSpace(left), 64)
	height, heightErr := strconv.ParseFloat(strings.TrimSpace(right), 64)
	if widthErr != nil || heightErr != nil || width <= 0 || height <= 0 {
		return 0, false
	}
	return width / height, true
}

// dramaSizeRejected 判断准入错误是否只因尺寸参数；只看结构化字段，不解析文案。

func (s *Service) dramaModelOption(choice DramaModelChoice, capability, label, priceLabel string) DramaModelOption {
	option := DramaModelOption{Choice: choice, Capability: capability, Label: label, PriceLabel: priceLabel}
	if capability == "video" {
		if profile, err := s.dramaVideoProfile(choice); err == nil {
			option.MaxVideoSeconds = profile.maxSeconds()
			option.TailFrameChain = profile.supports("image_to_video")
		}
	}
	if capability == "image" {
		if spec, defaults, ok := s.dramaImageSpec(choice); ok {
			option.ImageResolutions = dramaImageTiersFor(spec)
			option.DefaultImageResolution = dramaDefaultImageTier(spec, defaults)
			for _, ratio := range dramaAssetRatios {
				if dramaImageRequestForSpec(spec, defaults, ratio, "").Issue == "" {
					option.ImageRatios = append(option.ImageRatios, ratio)
				}
			}
		}
	}
	return option
}

// dramaMaxVideoSeconds 是视频模型单次可生成的最长秒数，也是一个剧情段的时长上限。
func dramaMaxVideoSeconds(options production.DurationOptions) int {
	longest := options.Max
	for _, value := range options.Values {
		longest = max(longest, value)
	}
	return longest
}

// dramaWritingSkill 读取作品选定的视频提示词写作技能；技能不可读时报错，不悄悄退回内置格式。
func (s *Service) dramaWritingSkill(userID string, ref *DramaSkillRef) (*production.WritingSkill, error) {
	if ref == nil {
		return nil, nil
	}
	file, err := s.SkillPackageFile(userID, ref.SkillID, ref.Path)
	if err != nil {
		return nil, BadAuthRequest("视频提示词技能「" + firstNonEmpty(ref.SkillName, ref.SkillID) + "」不可用：" + err.Error())
	}
	if file.Binary || strings.TrimSpace(file.Content) == "" {
		return nil, BadAuthRequest("视频提示词技能文件 " + ref.Path + " 不是文本或为空")
	}
	return &production.WritingSkill{Name: firstNonEmpty(ref.SkillName, ref.SkillID), Path: ref.Path, Content: file.Content}, nil
}
