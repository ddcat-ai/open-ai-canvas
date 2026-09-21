package handler

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"strings"
	"time"

	"infinite-canvas/backend/internal/assets"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

const t2aChannelInterface = model.ChannelInterfaceType("minimax-t2a")

func RegisterMinimaxT2ARoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/minimax-t2a/synthesize", func(c *gin.Context) { handleT2ASynthesize(c, svc) })
	r.POST("/minimax-t2a/voice-design", func(c *gin.Context) { handleT2AVoiceDesign(c, svc) })
	r.POST("/minimax-t2a/voice-clone", func(c *gin.Context) { handleT2AVoiceClone(c, svc) })
	r.GET("/minimax-t2a/voices", func(c *gin.Context) { handleT2AListVoices(c, svc) })
	r.DELETE("/minimax-t2a/voices/:voiceId", func(c *gin.Context) { handleT2ADeleteVoice(c, svc) })
	r.POST("/minimax-t2a/diagnose", func(c *gin.Context) { handleT2ADiagnose(c) })
}

// handleT2ADiagnose 前端插件诊断上报（背景移除等纯前端功能失败时打服务器日志，便于远程排查）。
func handleT2ADiagnose(c *gin.Context) {
	body, _ := io.ReadAll(io.LimitReader(c.Request.Body, 4096))
	log.Printf("[diagnose] %s", string(body))
	c.JSON(200, gin.H{"ok": true})
}

type t2aVoiceSetting struct {
	VoiceID string  `json:"voiceId"`
	Speed   float64 `json:"speed"`
	Vol     float64 `json:"vol"`
	Pitch   float64 `json:"pitch"`
	Emotion string  `json:"emotion"`
}
type t2aAudioSetting struct {
	SampleRate int    `json:"sampleRate"`
	Bitrate    int    `json:"bitrate"`
	Format     string `json:"format"`
	Channel    int    `json:"channel"`
}

type t2aBaseResp struct {
	StatusCode int    `json:"status_code"`
	StatusMsg  string `json:"status_msg"`
}

func (r t2aBaseResp) err() error {
	if r.StatusCode != 0 {
		return errors.New(r.StatusMsg)
	}
	return nil
}

func t2aChannel(ctx context.Context, svc *service.Service) (*model.ModelChannel, error) {
	return svc.SystemChannelForInterfaceType(t2aChannelInterface)
}

func t2aPost(ctx context.Context, channel *model.ModelChannel, path string, body any, target any) error {
	data, _ := json.Marshal(body)
	base := strings.TrimRight(channel.BaseURL, "/")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+path, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+channel.APIKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := service.OutboundHTTPClient(35 * time.Minute).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
		return fmt.Errorf("MiniMax 返回 %d：%s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	if target != nil {
		if err := json.NewDecoder(resp.Body).Decode(target); err != nil {
			return err
		}
	}
	return nil
}

func decodeT2AAudio(raw string) ([]byte, error) {
	s := strings.TrimSpace(raw)
	if i := strings.Index(s, ","); i >= 0 && strings.HasPrefix(s, "data:") {
		s = s[i+1:]
	}
	if s == "" {
		return nil, errors.New("音频数据为空")
	}
	if len(s) > 1 && len(s)%2 == 0 && isHexString(s) {
		return hex.DecodeString(s)
	}
	return base64.StdEncoding.DecodeString(s)
}

func isHexString(s string) bool {
	for _, r := range s {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
			return false
		}
	}
	return true
}

// storeT2AAudio 把 MiniMax 返回的 base64/hex 音频存为系统资源（走后端资源存储），返回 storageKey + url。
func storeT2AAudio(svc *service.Service, userID string, raw string, fileName string, mimeType string, durationMs int) (string, string, error) {
	audio, err := decodeT2AAudio(raw)
	if err != nil {
		return "", "", err
	}
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("file", fileName)
	if err != nil {
		return "", "", err
	}
	if _, err := part.Write(audio); err != nil {
		return "", "", err
	}
	if err := writer.Close(); err != nil {
		return "", "", err
	}
	reader := multipart.NewReader(&buf, writer.Boundary())
	form, err := reader.ReadForm(64 << 20)
	if err != nil {
		return "", "", err
	}
	defer form.RemoveAll()
	if len(form.File["file"]) == 0 {
		return "", "", errors.New("音频资源构造失败")
	}
	resource, err := svc.UploadResource(userID, form.File["file"][0], "audio", 0, 0, int64(durationMs))
	if err != nil {
		return "", "", err
	}
	// ⚠️ 返回**站内资源地址**，不要用 `resource.PublicURL` —— 本站从不写 public_url
	// （`Resources()` / `Resource()` 读的时候还主动置空），全站媒体一律走
	// `/api/resources/<id>/file`。2026-09-19 实测：用它当 audio_path 时角色配音
	// 明明 HTTP 200、音频也已落盘，前端却拿不到地址，报「服务端没返回音频路径」。
	return "resource:" + resource.ID, assets.FileURL(resource.ID), nil
}

func handleT2ASynthesize(c *gin.Context, svc *service.Service) {
	user, err := currentUser(c, svc)
	if err != nil {
		failService(c, err)
		return
	}
	var req struct {
		Text  string          `json:"text"`
		Model string          `json:"model"`
		Voice t2aVoiceSetting `json:"voice"`
		Audio t2aAudioSetting `json:"audio"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, 400, err)
		return
	}
	if strings.TrimSpace(req.Text) == "" {
		fail(c, 400, errors.New("text 不能为空"))
		return
	}
	if req.Model == "" {
		req.Model = "speech-02-hd"
	}
	channel, err := t2aChannel(c.Request.Context(), svc)
	if err != nil {
		failService(c, err)
		return
	}
	voiceSetting := map[string]any{
		"voice_id": req.Voice.VoiceID,
		"speed":    req.Voice.Speed,
		"vol":      req.Voice.Vol,
	}
	if req.Voice.Pitch != 0 {
		voiceSetting["pitch"] = req.Voice.Pitch
	}
	if req.Voice.Emotion != "" {
		voiceSetting["emotion"] = req.Voice.Emotion
	}
	body := map[string]any{
		"model":         req.Model,
		"text":          req.Text,
		"stream":        false,
		"voice_setting": voiceSetting,
		"audio_setting": map[string]any{
			"sample_rate": req.Audio.SampleRate,
			"bitrate":     req.Audio.Bitrate,
			"format":      req.Audio.Format,
			"channel":     req.Audio.Channel,
		},
	}
	var resp struct {
		Data struct {
			Audio    string `json:"audio"`
			Duration int    `json:"duration"`
		} `json:"data"`
		BaseResp t2aBaseResp `json:"base_resp"`
	}
	if err := t2aPost(c.Request.Context(), channel, "/v1/t2a_v2", body, &resp); err != nil {
		log.Printf("[t2a] synthesize POST error: %v", err)
		fail(c, 502, err)
		return
	}
	if err := resp.BaseResp.err(); err != nil {
		log.Printf("[t2a] synthesize base_resp error: code=%d msg=%s voice=%s model=%s", resp.BaseResp.StatusCode, resp.BaseResp.StatusMsg, req.Voice.VoiceID, req.Model)
		fail(c, 502, resp.BaseResp.err())
		return
	}
	storageKey, url, err := storeT2AAudio(svc, user.ID, resp.Data.Audio, fmt.Sprintf("t2a-%d.mp3", time.Now().UnixMilli()), "audio/mpeg", resp.Data.Duration)
	if err != nil {
		log.Printf("[t2a] synthesize store error: %v", err)
		fail(c, 502, err)
		return
	}
	ok(c, gin.H{
		"storageKey": storageKey,
		"url":        url,
		"mimeType":   "audio/mpeg",
		"durationMs": resp.Data.Duration,
	})
}

func handleT2AVoiceDesign(c *gin.Context, svc *service.Service) {
	user, err := currentUser(c, svc)
	if err != nil {
		failService(c, err)
		return
	}
	var req struct {
		Prompt      string `json:"prompt"`
		PreviewText string `json:"previewText"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, 400, err)
		return
	}
	channel, err := t2aChannel(c.Request.Context(), svc)
	if err != nil {
		failService(c, err)
		return
	}
	body := map[string]any{
		"prompt":         req.Prompt,
		"preview_text":   req.PreviewText,
		"aigc_watermark": false,
	}
	var resp struct {
		VoiceID    string      `json:"voice_id"`
		TrialAudio string      `json:"trial_audio"`
		BaseResp   t2aBaseResp `json:"base_resp"`
	}
	if err := t2aPost(c.Request.Context(), channel, "/v1/voice_design", body, &resp); err != nil {
		fail(c, 502, err)
		return
	}
	if err := resp.BaseResp.err(); err != nil {
		fail(c, 502, err)
		return
	}
	storageKey, url, err := storeT2AAudio(svc, user.ID, resp.TrialAudio, fmt.Sprintf("voice-design-%d.mp3", time.Now().UnixMilli()), "audio/mpeg", 0)
	if err != nil {
		log.Printf("[t2a] voice-design store error: %v", err)
		fail(c, 502, err)
		return
	}
	ok(c, gin.H{
		"voiceId":    resp.VoiceID,
		"trialAudio": gin.H{"storageKey": storageKey, "url": url, "mimeType": "audio/mpeg"},
	})
}

func handleT2AVoiceClone(c *gin.Context, svc *service.Service) {
	if _, err := currentUser(c, svc); err != nil {
		failService(c, err)
		return
	}
	var req struct {
		SampleBase64 string `json:"sampleBase64"`
		SampleName   string `json:"sampleName"`
		Text         string `json:"text"`
		VoiceID      string `json:"voiceId"`
		Model        string `json:"model"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, 400, err)
		return
	}
	sample, err := base64.StdEncoding.DecodeString(req.SampleBase64)
	if err != nil || len(sample) == 0 {
		fail(c, 400, errors.New("样本音频数据无效"))
		return
	}
	channel, err := t2aChannel(c.Request.Context(), svc)
	if err != nil {
		failService(c, err)
		return
	}
	// 1) 上传样本 → file_id
	fileID, err := t2aUploadSample(c.Request.Context(), channel, req.SampleName, sample)
	if err != nil {
		fail(c, 502, err)
		return
	}
	// 2) 执行克隆
	if req.Model == "" {
		req.Model = "speech-02-hd"
	}
	body := map[string]any{
		"voice_id":                  req.VoiceID,
		"file_id":                   fileID,
		"text":                      req.Text,
		"model":                     req.Model,
		"output_format":             "mp3",
		"need_noise_reduction":      true,
		"need_volume_normalization": true,
		"text_validation":           "strict",
		"accuracy":                  0.9,
	}
	var resp struct {
		BaseResp t2aBaseResp `json:"base_resp"`
	}
	if err := t2aPost(c.Request.Context(), channel, "/v1/voice_clone", body, &resp); err != nil {
		fail(c, 502, err)
		return
	}
	if err := resp.BaseResp.err(); err != nil {
		fail(c, 502, err)
		return
	}
	ok(c, gin.H{"voiceId": req.VoiceID})
}

func t2aUploadSample(ctx context.Context, channel *model.ModelChannel, name string, data []byte) (string, error) {
	if name == "" {
		name = "voice_sample.mp3"
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", name)
	if err != nil {
		return "", err
	}
	if _, err := part.Write(data); err != nil {
		return "", err
	}
	if err := writer.WriteField("purpose", "voice_clone"); err != nil {
		return "", err
	}
	if err := writer.Close(); err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(channel.BaseURL, "/")+"/v1/files/upload", &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+channel.APIKey)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp, err := service.OutboundHTTPClient(35 * time.Minute).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
		return "", fmt.Errorf("样本上传失败 %d：%s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	var out struct {
		File struct {
			FileID string `json:"file_id"`
		} `json:"file"`
		BaseResp t2aBaseResp `json:"base_resp"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	if err := out.BaseResp.err(); err != nil {
		return "", err
	}
	if out.File.FileID == "" {
		return "", errors.New("样本上传未返回 file_id")
	}
	return out.File.FileID, nil
}

func handleT2AListVoices(c *gin.Context, svc *service.Service) {
	if _, err := currentUser(c, svc); err != nil {
		failService(c, err)
		return
	}
	channel, err := t2aChannel(c.Request.Context(), svc)
	if err != nil {
		failService(c, err)
		return
	}
	body := map[string]any{"voice_type": "voice_cloning"}
	var resp struct {
		Data     json.RawMessage `json:"data"`
		BaseResp t2aBaseResp     `json:"base_resp"`
	}
	if err := t2aPost(c.Request.Context(), channel, "/v1/get_voice", body, &resp); err != nil {
		fail(c, 502, err)
		return
	}
	if err := resp.BaseResp.err(); err != nil {
		fail(c, 502, err)
		return
	}
	// data 可能是数组，也可能是 {voice_list:[...]}
	voices := make([]gin.H, 0)
	if len(resp.Data) > 0 {
		var arr []struct {
			VoiceID string `json:"voice_id"`
			Name    string `json:"name"`
		}
		if err := json.Unmarshal(resp.Data, &arr); err == nil {
			for _, v := range arr {
				voices = append(voices, gin.H{"voiceId": v.VoiceID, "name": v.Name})
			}
		} else {
			var obj struct {
				List []struct {
					VoiceID string `json:"voice_id"`
					Name    string `json:"name"`
				} `json:"voice_list"`
			}
			if err := json.Unmarshal(resp.Data, &obj); err == nil {
				for _, v := range obj.List {
					voices = append(voices, gin.H{"voiceId": v.VoiceID, "name": v.Name})
				}
			}
		}
	}
	ok(c, gin.H{"voices": voices})
}

func handleT2ADeleteVoice(c *gin.Context, svc *service.Service) {
	if _, err := currentUser(c, svc); err != nil {
		failService(c, err)
		return
	}
	voiceID := c.Param("voiceId")
	if voiceID == "" {
		fail(c, 400, errors.New("voiceId 不能为空"))
		return
	}
	channel, err := t2aChannel(c.Request.Context(), svc)
	if err != nil {
		failService(c, err)
		return
	}
	body := map[string]any{"voice_id": voiceID}
	var resp struct {
		BaseResp t2aBaseResp `json:"base_resp"`
	}
	if err := t2aPost(c.Request.Context(), channel, "/v1/delete_voice", body, &resp); err != nil {
		fail(c, 502, err)
		return
	}
	if err := resp.BaseResp.err(); err != nil {
		fail(c, 502, err)
		return
	}
	ok(c, gin.H{"voiceId": voiceID})
}
