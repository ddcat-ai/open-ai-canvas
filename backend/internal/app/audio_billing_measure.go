package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// The singular audio field and the first audios entry are the delivered
// output. Other references in the result may point to covers or inputs.
func audioOutputResourceID(raw string) string {
	type output struct {
		ResourceID string `json:"resourceId"`
		StorageKey string `json:"storageKey"`
		URL        string `json:"url"`
		DataURL    string `json:"dataUrl"`
	}
	var result struct {
		Audio  *output  `json:"audio"`
		Audios []output `json:"audios"`
	}
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return ""
	}
	audio := result.Audio
	if audio == nil && len(result.Audios) > 0 {
		audio = &result.Audios[0]
	}
	if audio == nil {
		return ""
	}
	id := validCanvasResourceID(audio.ResourceID)
	for _, ref := range []string{audio.StorageKey, audio.URL, audio.DataURL} {
		candidate := canvasResourceID(ref)
		if candidate == "" {
			continue
		}
		if id != "" && candidate != id {
			return ""
		}
		id = candidate
	}
	return id
}

func audioReviewError(reason ErrorReason, message string) *AppError {
	e := NewAppError(422, message)
	e.Reason = reason
	return e
}

func (s *Service) settleReviewedAudio(actor *model.User, order *model.BillingOrder, note string) error {
	task, err := s.repo.Task(order.TaskID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return audioReviewError("audio_output_required", "找不到原音频任务")
	}
	if err != nil {
		return err
	}
	if task.BillingOrderID != order.ID || order.UserID == "" || task.UserID != order.UserID || order.TeamID != "" || order.MembershipID != "" || order.BillingAccountID != model.PersonalCreditAccountID(task.UserID) {
		return audioReviewError("audio_order_mismatch", "音频任务与原订单或付款账户不匹配")
	}
	if task.Status != model.TaskStatusSucceeded || capabilityFromTaskType(task.Type) != "audio" {
		return audioReviewError("audio_output_required", "缺少已交付的音频任务")
	}
	resource, ms, err := s.measuredAudioOutput(*task)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return audioReviewError("audio_output_required", "原音频产物不存在或归属不符")
	}
	if err != nil {
		return err
	}
	audit, err := newAdminAuditEvent(actor, "billing.resolve", "user", order.UserID, "人工核对用户计费订单", map[string]any{"billingOrderId": order.ID, "action": "settle", "note": note})
	if err != nil {
		return err
	}
	err = s.repo.SettleReviewedAudio(order, task, resource, ms, audit, note)
	switch {
	case errors.Is(err, repository.ErrBillingChargeLimit):
		return audioReviewError("billing_charge_limit", "音频实际费用超过本次授权上限")
	case errors.Is(err, repository.ErrInsufficientCredits):
		return audioReviewError("insufficient_credits", "预留或可用积分不足以完成音频实际结算")
	case errors.Is(err, gorm.ErrRecordNotFound), errors.Is(err, repository.ErrBillingStateConflict):
		return audioReviewError("audio_evidence_changed", "任务、订单或原资源已变化，请重新核对")
	default:
		return err
	}
}

// Build the output clock from decoded samples at their native rate. A container
// duration, timestamp gap, or partial metadata probe cannot authorize a debit.
func measureAudioFile(path string) (int64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), mediaProbeTimeout)
	defer cancel()
	cmd := hideCommandWindow(exec.CommandContext(ctx, "ffmpeg", "-nostdin", "-v", "error", "-xerror",
		"-protocol_whitelist", "file", "-format_whitelist", "wav,mp3,flac,ogg,mov,matroska,webm,aac,aiff,amr,ac3,caf",
		"-i", path, "-map", "0:a:0", "-af", "asetpts=N/SR/TB", "-c:a", "pcm_s16le", "-f", "null", "-", "-nostats", "-progress", "pipe:1"))
	report, err := cmd.Output()
	if err != nil {
		if ctx.Err() != nil {
			return 0, WrapAppError(503, "解码音频超时，暂时无法核实时长", ctx.Err())
		}
		if errors.Is(err, exec.ErrNotFound) {
			return 0, WrapAppError(503, "服务端缺少 FFmpeg，暂时无法核实音频时长", err)
		}
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			return 0, audioReviewError("audio_duration_unverified", "音频内容不可解码，无法核实完整时长")
		}
		return 0, err
	}
	var durationUs int64
	for _, line := range strings.Fields(string(report)) {
		if value, ok := strings.CutPrefix(line, "out_time_us="); ok {
			durationUs, _ = strconv.ParseInt(value, 10, 64)
		}
		if line == "progress=end" && durationUs > 0 {
			return (durationUs-1)/1000 + 1, nil
		}
	}
	return 0, audioReviewError("audio_duration_unverified", "音频结果缺少有效时长")
}

func measureAudioReader(body io.Reader, size int64) (int64, error) {
	f, err := os.CreateTemp("", "yingce-audio-*")
	if err != nil {
		return 0, err
	}
	defer os.Remove(f.Name())
	n, err := io.Copy(f, io.LimitReader(body, size+1))
	closeErr := f.Close()
	if err != nil {
		return 0, err
	}
	if closeErr != nil {
		return 0, closeErr
	}
	if n != size {
		return 0, audioReviewError("audio_duration_unverified", "音频对象长度与原资源不符")
	}
	return measureAudioFile(f.Name())
}

func (s *Service) measuredAudioOutput(task model.Task) (*model.Resource, int64, error) {
	id := audioOutputResourceID(task.ResultJSON)
	if id == "" {
		return nil, 0, audioReviewError("audio_duration_unverified", "音频结果缺少已保存的资源")
	}
	res, err := s.repo.ResourceForUser(task.UserID, id)
	if err != nil {
		return nil, 0, err
	}
	if res.Kind != "audio" {
		return nil, 0, audioReviewError("audio_output_required", "原产物不是音频资源")
	}
	if res.Status != model.ResourceStatusReady || res.ObjectKey == "" || res.Size <= 0 {
		return nil, 0, audioReviewError("audio_duration_unverified", "音频结果缺少可核实的音频资源")
	}
	if res.Provider == "local" {
		path := filepath.Join(s.dataDir, "resources", filepath.FromSlash(res.ObjectKey))
		before, err := os.Lstat(path)
		if errors.Is(err, os.ErrNotExist) {
			return nil, 0, audioReviewError("audio_duration_unverified", "原音频文件不存在")
		}
		if err != nil {
			return nil, 0, err
		}
		if !before.Mode().IsRegular() || before.Size() != res.Size {
			return nil, 0, audioReviewError("audio_duration_unverified", "原音频文件不完整")
		}
		ms, err := measureAudioFile(path)
		if err != nil {
			return nil, 0, err
		}
		after, err := os.Lstat(path)
		if err != nil {
			return nil, 0, err
		}
		if !os.SameFile(before, after) || after.Size() != before.Size() || !after.ModTime().Equal(before.ModTime()) {
			return nil, 0, audioReviewError("audio_duration_unverified", "测量期间音频文件已变化")
		}
		return res, ms, nil
	}
	if strings.Trim(res.ETag, "\"") == "" || strings.HasPrefix(res.ETag, "W/") {
		return nil, 0, audioReviewError("audio_duration_unverified", "原音频对象缺少可核对的版本")
	}
	stream, err := s.openResourceRange(task.UserID, res, "")
	if err != nil {
		return nil, 0, WrapAppError(503, "暂时无法读取原音频对象，请确认存储可用后重试", err)
	}
	defer stream.Body.Close()
	if stream.StatusCode != http.StatusOK || stream.ContentRange != "" || stream.ContentLength >= 0 && stream.ContentLength != res.Size || strings.Trim(stream.ETag, "\"") != strings.Trim(res.ETag, "\"") {
		return nil, 0, audioReviewError("audio_duration_unverified", "音频对象与原资源版本不符")
	}
	timer := time.AfterFunc(mediaProbeRemoteReadTimeout, func() { _ = stream.Body.Close() })
	defer timer.Stop()
	ms, err := measureAudioReader(stream.Body, res.Size)
	var detail *AppError
	if err != nil && !errors.As(err, &detail) {
		return nil, 0, WrapAppError(503, "原音频对象读取或暂存失败，请稍后重试", err)
	}
	return res, ms, err
}
