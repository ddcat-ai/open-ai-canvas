package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"strconv"
	"strings"

	_ "golang.org/x/image/webp"

	"yingce/backend/internal/imagebilling"
	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func imageBillingReservation(intent ModelRequestIntent) (int64, int64, error) {
	if intent.Capability != "image" || intent.Inputs["mask"] > 0 {
		return 0, 0, BadAuthRequest("图片用量计费需要图片请求，暂不支持蒙版输入计费")
	}
	inputs := int64(intent.Inputs["image"])
	outputs := int64(1)
	if value, exists := intent.Options["count"]; exists {
		count, err := strconv.ParseInt(fmt.Sprint(value), 10, 64)
		if err != nil || count < 1 {
			return 0, 0, BadAuthRequest("图片输出张数无效")
		}
		outputs = count
	}
	layers := parseBool(fmt.Sprint(intent.Options["layerDecomposition"]), false)
	if layers {
		if inputs != 1 {
			return 0, 0, BadAuthRequest("图层拆分必须输入一张图片")
		}
		outputs = 30
		if value, exists := intent.Options["maxImages"]; exists {
			count, err := strconv.ParseInt(fmt.Sprint(value), 10, 64)
			if err != nil || count < 2 || count > 100 {
				return 0, 0, BadAuthRequest("图层拆分最多输出张数须为 2 到 100")
			}
			outputs = count
		}
	}
	if inputs < 0 || inputs > 128 || outputs < 1 || outputs > 128 {
		return 0, 0, BadAuthRequest("图片用量超出计费范围")
	}
	return inputs, outputs, nil
}

func imagePricingSnapshot(p *model.ImagePricing, pricing groupPricing) (*model.ImagePricing, error) {
	return imagebilling.MapPrices(p, pricing.convertPrice)
}

func recordProtocolImageUsage(ctx context.Context, input canvasGenerationInput, request protocol.GenerationRequest, result *protocol.Result) error {
	if input.Mode != "image" || result == nil {
		return nil
	}
	metadata, _ := ctx.Value(providerAnalyticsKey{}).(providerAnalyticsContext)
	if metadata.Service == nil || metadata.BillingOrderID == "" {
		return nil
	}
	order, err := metadata.Service.repo.BillingOrder(metadata.BillingOrderID)
	if err != nil {
		return err
	}
	if order.BillingMode != imagebilling.Mode && order.CostBillingMode != imagebilling.Mode {
		return nil
	}
	usage := &model.ImageBillingUsage{InputImages: int64(len(request.Images)), Source: "provider_and_request"}
	needsPixels := func(pricing *model.ImagePricing) bool {
		return pricing != nil && !(len(pricing.OutputTiers) == 1 && pricing.OutputTiers[0].MaxPixels == 0)
	}
	measurePixels := needsPixels(order.ImagePricing) || order.CostPricing.Configured && needsPixels(order.CostPricing.ImagePricing)
	if value, exists := result.Usage["input_images"]; exists {
		count, parseErr := strconv.ParseInt(fmt.Sprint(value), 10, 64)
		if parseErr != nil || count != usage.InputImages {
			return errors.New("上游输入图片用量与实际请求不一致，需核对费用")
		}
		usage.InputImages, usage.Source = count, "provider"
	}
	if value, exists := result.Usage["generated_images"]; exists {
		count, parseErr := strconv.ParseInt(fmt.Sprint(value), 10, 64)
		if parseErr != nil || count != int64(len(result.Images)) {
			return errors.New("上游输出图片用量与成功图片清单不一致，需核对费用")
		}
	}
	for index := range result.Images {
		reference := &result.Images[index]
		output := model.ImageOutputUsage{Index: index}
		if size, ok := reference.Metadata["size"].(string); ok {
			width, height, found := strings.Cut(strings.ToLower(strings.TrimSpace(size)), "x")
			var widthErr, heightErr error
			output.Width, widthErr = strconv.ParseInt(width, 10, 64)
			output.Height, heightErr = strconv.ParseInt(height, 10, 64)
			if !found || widthErr != nil || heightErr != nil {
				return errors.New("上游图片尺寸格式无效，需核对费用")
			}
		}
		if measurePixels && (output.Width == 0 || output.Height == 0) {
			data, mime, downloadErr := protocolMediaBytes(ctx, input.Config, *reference)
			if downloadErr != nil {
				return downloadErr
			}
			config, _, decodeErr := image.DecodeConfig(bytes.NewReader(data))
			if decodeErr != nil {
				return fmt.Errorf("读取图片计费尺寸失败：%w", decodeErr)
			}
			output.Width, output.Height = int64(config.Width), int64(config.Height)
			reference.DataURL, reference.URL = dataURL(mime, data), ""
			usage.Source = "provider_and_media"
		}
		usage.Outputs = append(usage.Outputs, output)
	}
	return metadata.Service.repo.RecordImageBillingUsage(order.ID, usage)
}

func imageProxyIntent(body []byte) (ModelRequestIntent, error) {
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return ModelRequestIntent{}, err
	}
	inputs := 0
	switch value := payload["image"].(type) {
	case string:
		if value != "" {
			inputs = 1
		}
	case []any:
		inputs = len(value)
	}
	options := map[string]any{}
	if value, ok := payload["n"]; ok {
		options["count"] = value
	}
	options["layerDecomposition"] = payload["layer_decomposition"]
	if layerOptions, ok := payload["layer_decomposition_options"].(map[string]any); ok {
		if value, exists := layerOptions["max_images"]; exists {
			options["maxImages"] = value
		}
	}
	return ModelRequestIntent{Capability: "image", Inputs: map[string]int{"image": inputs}, Options: options}, nil
}

func (s *Service) RecordProxyImageBillingUsage(log model.ApiCallLog, responseBody []byte) error {
	if log.BillingOrderID == "" || log.Capability != "image" || log.Status != model.ApiCallStatusSucceeded {
		return nil
	}
	order, err := s.repo.BillingOrder(log.BillingOrderID)
	if err != nil {
		return err
	}
	if order.BillingMode != imagebilling.Mode && order.CostBillingMode != imagebilling.Mode {
		return nil
	}
	var payload struct {
		Data []struct {
			URL    string `json:"url"`
			Base64 string `json:"b64_json"`
			Size   string `json:"size"`
			Format string `json:"output_format"`
		} `json:"data"`
		Usage map[string]any `json:"usage"`
	}
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return err
	}
	result := &protocol.Result{Usage: payload.Usage}
	for _, item := range payload.Data {
		if item.URL == "" && item.Base64 == "" {
			continue
		}
		metadata := map[string]any{}
		if item.Size != "" {
			metadata["size"] = item.Size
		}
		inline := item.Base64
		if inline != "" && !strings.HasPrefix(inline, "data:") {
			format := "png"
			if item.Format == "jpeg" {
				format = "jpeg"
			}
			inline = "data:image/" + format + ";base64," + inline
		}
		result.Images = append(result.Images, protocol.MediaReference{URL: item.URL, DataURL: inline, Metadata: metadata})
	}
	ctx := context.WithValue(context.Background(), providerAnalyticsKey{}, providerAnalyticsContext{Service: s, BillingOrderID: order.ID})
	return recordProtocolImageUsage(ctx, canvasGenerationInput{Mode: "image"}, protocol.GenerationRequest{Images: make([]protocol.MediaReference, order.ImageInputImages)}, result)
}
