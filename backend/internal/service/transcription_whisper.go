package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// 本地 whisper.cpp HTTP 服务客户端。配置项 CANVAS_WHISPER_BASE_URL
// 指向自建 whisper.cpp server（/inference，多部件 file 上传）。
// 语音数据不出本机，未配置该地址时任务在进入转写前明确失败。

type timelineTranscriptionSegment struct {
	StartMs int64  `json:"startMs"`
	EndMs   int64  `json:"endMs"`
	Text    string `json:"text"`
}

type timelineTranscriptionResult struct {
	Segments []timelineTranscriptionSegment `json:"segments"`
	SRT      string                         `json:"srt"`
	Language string                         `json:"language"`
}

type whisperSegment struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	Text  string  `json:"text"`
}

type whisperVerboseJSON struct {
	Segments []whisperSegment `json:"segments"`
	Language string           `json:"language"`
}

type whisperClient struct {
	baseURL string
	http    *http.Client
}

func newWhisperClient(baseURL string) *whisperClient {
	return &whisperClient{
		baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		http:    &http.Client{Timeout: 20 * time.Minute},
	}
}

// transcribe 将本地 wav 送至 whisper.cpp /inference，返回段落与语言。
func (c *whisperClient) transcribe(ctx context.Context, wavPath string, language string) ([]timelineTranscriptionSegment, string, error) {
	if c.baseURL == "" {
		return nil, "", fmt.Errorf("本地转写服务未配置：请设置 CANVAS_WHISPER_BASE_URL")
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	audio, err := os.Open(wavPath)
	if err != nil {
		return nil, "", fmt.Errorf("读取待转写音频失败: %w", err)
	}
	defer audio.Close()
	part, err := writer.CreateFormFile("file", filepath.Base(wavPath))
	if err != nil {
		return nil, "", err
	}
	if _, err := io.Copy(part, audio); err != nil {
		return nil, "", fmt.Errorf("上传音频失败: %w", err)
	}
	if err := writer.WriteField("response_format", "verbose_json"); err != nil {
		return nil, "", err
	}
	if strings.TrimSpace(language) != "" {
		if err := writer.WriteField("language", strings.TrimSpace(language)); err != nil {
			return nil, "", err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/inference", &body)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("无法连接本地转写服务(whisper.cpp): %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return nil, "", fmt.Errorf("本地转写服务返回 %d: %s", resp.StatusCode, strings.TrimSpace(string(msg)))
	}
	payload, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, "", fmt.Errorf("读取转写结果失败: %w", err)
	}
	segments, languageOut, err := decodeWhisperVerboseJSON(payload)
	if err != nil {
		return nil, "", err
	}
	if len(segments) == 0 {
		return nil, "", fmt.Errorf("本地转写服务未识别出语音内容")
	}
	return segments, languageOut, nil
}

// decodeWhisperVerboseJSON 解析 whisper.cpp verbose_json 响应为内部段落，
// 过滤空文本，秒精度取整为毫秒。
func decodeWhisperVerboseJSON(payload []byte) ([]timelineTranscriptionSegment, string, error) {
	var parsed whisperVerboseJSON
	if err := json.Unmarshal(payload, &parsed); err != nil {
		return nil, "", fmt.Errorf("转写结果解析失败: %w", err)
	}
	segments := make([]timelineTranscriptionSegment, 0, len(parsed.Segments))
	for _, seg := range parsed.Segments {
		if strings.TrimSpace(seg.Text) == "" {
			continue
		}
		segments = append(segments, timelineTranscriptionSegment{
			StartMs: int64(math.Round(seg.Start * 1000)),
			EndMs:   int64(math.Round(seg.End * 1000)),
			Text:    strings.TrimSpace(seg.Text),
		})
	}
	return segments, parsed.Language, nil
}

// formatSRTTimestamp 将毫秒时间格式化为 SRT 时间戳 hh:mm:ss,mmm。
func formatSRTTimestamp(ms int64) string {
	if ms < 0 {
		ms = 0
	}
	hours := ms / 3600000
	minutes := (ms % 3600000) / 60000
	seconds := (ms % 60000) / 1000
	millis := ms % 1000
	return fmt.Sprintf("%02d:%02d:%02d,%03d", hours, minutes, seconds, millis)
}

// buildTimelineSRT 由段落生成 SRT 字幕文本，供前端直接消费或导出。
func buildTimelineSRT(segments []timelineTranscriptionSegment) string {
	var out strings.Builder
	for i, seg := range segments {
		fmt.Fprintf(&out, "%d\n%s --> %s\n%s\n\n", i+1, formatSRTTimestamp(seg.StartMs), formatSRTTimestamp(seg.EndMs), seg.Text)
	}
	return out.String()
}
