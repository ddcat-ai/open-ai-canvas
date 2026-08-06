package service

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

type newAPIVideoRequest struct {
	Model         string   `json:"model"`
	Prompt        string   `json:"prompt"`
	Seconds       string   `json:"seconds"`
	AspectRatio   string   `json:"aspect_ratio"`
	Resolution    string   `json:"resolution"`
	GenerateAudio *bool    `json:"generate_audio,omitempty"`
	ImageURLs     []string `json:"image_urls,omitempty"`
	VideoURLs     []string `json:"video_urls,omitempty"`
	AudioURLs     []string `json:"audio_urls,omitempty"`
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

type xaiVideoRequest struct {
	Model       string         `json:"model"`
	Prompt      string         `json:"prompt"`
	Duration    int            `json:"duration"`
	AspectRatio string         `json:"aspect_ratio"`
	Resolution  string         `json:"resolution"`
	Image       *xaiVideoImage `json:"image,omitempty"`
}

type xaiVideoImage struct {
	URL string `json:"url"`
}

type geminiVeoRequest struct {
	Instances  []geminiVeoInstance `json:"instances"`
	Parameters geminiVeoParameters `json:"parameters"`
}

type geminiVeoInstance struct {
	Prompt string          `json:"prompt"`
	Image  *geminiVeoImage `json:"image,omitempty"`
}

type geminiVeoImage struct {
	BytesBase64Encoded string `json:"bytesBase64Encoded"`
	MIMEType           string `json:"mimeType"`
}

type geminiVeoParameters struct {
	AspectRatio     string `json:"aspectRatio"`
	DurationSeconds int    `json:"durationSeconds"`
	Resolution      string `json:"resolution"`
	SampleCount     int    `json:"sampleCount"`
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
