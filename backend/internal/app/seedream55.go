package app

import (
	"fmt"
	"strconv"
	"strings"

	"yingce/backend/internal/model"
)

const seedream55Model = "doubao-seedream-5-5-261028"

// Sizes follow the official Seedream 5.5 API's 1K / 1.5K / 2K table.
func seedream55ImagePresets() []ImageSizePreset {
	rows := []struct {
		ratio string
		sizes [3]string
	}{
		{"1:1", [3]string{"1024x1024", "1536x1536", "2048x2048"}},
		{"4:3", [3]string{"1152x864", "1792x1344", "2368x1776"}},
		{"3:4", [3]string{"864x1152", "1344x1792", "1776x2368"}},
		{"16:9", [3]string{"1424x800", "2048x1152", "2816x1584"}},
		{"9:16", [3]string{"800x1424", "1152x2048", "1584x2816"}},
		{"3:2", [3]string{"1248x832", "1872x1248", "2496x1664"}},
		{"2:3", [3]string{"832x1248", "1248x1872", "1664x2496"}},
		{"21:9", [3]string{"1568x672", "2352x1008", "3136x1344"}},
	}
	var result []ImageSizePreset
	for _, row := range rows {
		for i, tier := range []string{"1k", "1.5k", "2k"} {
			var width, height int
			fmt.Sscanf(row.sizes[i], "%dx%d", &width, &height)
			result = append(result, ImageSizePreset{Tier: tier, Ratio: row.ratio, Size: row.sizes[i], Width: width, Height: height})
		}
	}
	return result
}

func validateSeedream55Input(input canvasGenerationInput) error {
	if input.Config.InterfaceType != string(model.ChannelInterfaceVolcengineArkImage) || input.Config.Model != seedream55Model {
		return nil
	}
	if len(input.ReferenceImages) > 10 || input.Mask != nil {
		return BadAuthRequest("Seedream 5.5 最多支持 10 张参考图，不支持蒙版参数")
	}
	if input.Config.Count != "" && input.Config.Count != "1" {
		return BadAuthRequest("Seedream 5.5 普通生图每次只支持一张，请分别提交生成任务")
	}
	options := input.Config.ImageParameters
	if options["layerDecomposition"] == true {
		if len(input.ReferenceImages) != 1 {
			return BadAuthRequest("Seedream 5.5 图层拆分必须输入一张图片")
		}
		return nil
	}
	if options["background"] == "transparent" && options["outputFormat"] == "jpeg" {
		return BadAuthRequest("Seedream 5.5 透明背景须使用 PNG 输出格式")
	}
	size := strings.TrimSpace(input.Config.Size)
	if strings.EqualFold(size, "1K") || strings.EqualFold(size, "1.5K") || strings.EqualFold(size, "2K") {
		return nil
	}
	widthText, heightText, ok := strings.Cut(strings.ToLower(size), "x")
	width, widthErr := strconv.ParseInt(widthText, 10, 64)
	height, heightErr := strconv.ParseInt(heightText, 10, 64)
	if !ok || widthErr != nil || heightErr != nil || width <= 0 || height <= 0 || width > 100000 || height > 100000 || width*height < 921600 || width*height > 4624220 || width > 16*height || height > 16*width {
		return BadAuthRequest("Seedream 5.5 输出尺寸须为 1K/1.5K/2K，或 921600–4624220 像素且宽高比在 1:16–16:1 之间")
	}
	return nil
}
