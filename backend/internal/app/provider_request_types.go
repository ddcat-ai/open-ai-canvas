package app

import "encoding/json"

func requestAsMap(value interface{}) (map[string]interface{}, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	result := make(map[string]interface{})
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	return result, nil
}

type seedanceVideosRequest struct {
	Model              string   `json:"model"`
	Prompt             string   `json:"prompt"`
	AspectRatio        string   `json:"aspect_ratio"`
	Duration           int      `json:"duration"`
	GenerateAudio      *bool    `json:"generate_audio,omitempty"`
	ImageURL           string   `json:"image_url,omitempty"`
	ReferenceImageURLs []string `json:"reference_image_urls,omitempty"`
	ImageURLs          []string `json:"image_urls,omitempty"`
	ReferenceVideos    []string `json:"reference_videos,omitempty"`
	ReferenceAudios    []string `json:"reference_audios,omitempty"`
}

type grokImageRequest struct {
	Model          string          `json:"model"`
	Prompt         string          `json:"prompt"`
	Image          *grokImageInput `json:"image,omitempty"`
	N              int             `json:"n"`
	ResponseFormat string          `json:"response_format"`
	AspectRatio    string          `json:"aspect_ratio,omitempty"`
	// Resolution 对应 xAI / grok2api 的 resolution（常见 1k / 2k）。
	Resolution string `json:"resolution,omitempty"`
}

type grokImageInput struct {
	URL string `json:"url"`
}

type geminiImageRequest struct {
	Contents          []geminiImageContent        `json:"contents"`
	SystemInstruction *geminiImageContent         `json:"systemInstruction,omitempty"`
	GenerationConfig  geminiImageGenerationConfig `json:"generationConfig"`
}

type geminiImageContent struct {
	Role  string                   `json:"role,omitempty"`
	Parts []geminiImageContentPart `json:"parts"`
}

type geminiImageContentPart struct {
	Text       string                 `json:"text,omitempty"`
	InlineData *geminiImageInlineData `json:"inlineData,omitempty"`
}

type geminiImageInlineData struct {
	MIMEType string `json:"mimeType"`
	Data     string `json:"data"`
}

type geminiImageGenerationConfig struct {
	ResponseModalities []string           `json:"responseModalities"`
	ImageConfig        *geminiImageConfig `json:"imageConfig,omitempty"`
}

type geminiImageConfig struct {
	AspectRatio string `json:"aspectRatio,omitempty"`
	ImageSize   string `json:"imageSize,omitempty"`
}

type seedanceAgentPlanRequest struct {
	Model         string                   `json:"model"`
	Content       []map[string]interface{} `json:"content"`
	Ratio         string                   `json:"ratio"`
	Resolution    string                   `json:"resolution"`
	Duration      int                      `json:"duration"`
	GenerateAudio *bool                    `json:"generate_audio,omitempty"`
	Watermark     *bool                    `json:"watermark,omitempty"`
}
