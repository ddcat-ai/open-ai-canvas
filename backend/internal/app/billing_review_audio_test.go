package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
	"yingce/backend/internal/storage"
)

func TestResolveAudioOrderFromPersistedOutput(t *testing.T) {
	s, db := newMediaRecoveryTestService(t)
	order := model.BillingOrder{
		ID: "order", TaskID: "task", UserID: "user", IdempotencyKey: "key",
		Status: model.BillingStatusUncertain, Capability: "audio", BillingMode: "per_second",
		UnitPriceMicrocredits: 100, Quantity: 1, MultiplierBasisPoints: 10000,
		AmountMicrocredits: 100, ReservedAmountMicrocredits: 100,
	}
	for _, row := range []any{
		&order, &model.CreditAccount{UserID: "user", ReservedMicrocredits: 100, AvailableMicrocredits: 900},
		&model.Task{ID: "task", UserID: "user", BillingOrderID: "old", Type: "canvas_audio",
			Status: model.TaskStatusSucceeded, ResultJSON: `{"audio":{"storageKey":"resource:sound"}}`},
		&model.Resource{ID: "sound", UserID: "user", Kind: "audio", Status: model.ResourceStatusReady},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	req := ResolveBillingRequest{Action: "settle", Note: "核对原产物"}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	unchanged := func() {
		t.Helper()
		saved, err := s.repo.BillingOrder(order.ID)
		if err != nil || saved.Status != model.BillingStatusUncertain || saved.AmountMicrocredits != 100 || saved.ActualAmountMicrocredits != 0 {
			t.Fatal(saved, err)
		}
		var n int64
		if err := db.Model(&model.CreditLedgerEntry{}).Count(&n).Error; err != nil || n != 0 {
			t.Fatal(n, err)
		}
	}
	if _, err := s.ResolveBillingOrder(admin, order.ID, req); err == nil {
		t.Fatal("accepted replacement order")
	}
	unchanged()
	if err := db.Model(&model.Task{}).Where("id='task'").Update("billing_order_id", order.ID).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.ResolveBillingOrder(admin, order.ID, req); err == nil {
		t.Fatal("accepted missing duration")
	}
	unchanged()
	const displayDuration = 321
	unmeasured, err := s.persistGeneratedMediaResult("user", map[string]any{"audio": map[string]any{
		"dataUrl":    dataURL("audio/wav", []byte("not a decodable WAV")),
		"durationMs": displayDuration,
	}})
	if err != nil {
		t.Fatal(err)
	}
	unmeasuredAudio := unmeasured["audio"].(map[string]any)
	unmeasuredResource, err := s.repo.ResourceForUser("user", unmeasuredAudio["resourceId"].(string))
	if err != nil || intValue(unmeasuredAudio["durationMs"]) != displayDuration || unmeasuredResource.DurationMs != displayDuration {
		t.Fatalf("preserve display metadata when decoding fails: %+v %v", unmeasuredResource, err)
	}
	if err := db.Model(&model.Task{}).Where("id='task'").Update("result_json", mustJSON(unmeasured)).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.ResolveBillingOrder(admin, order.ID, req); err == nil {
		t.Fatal("accepted unverified display duration for billing")
	}
	unchanged()
	wav := filepath.Join(t.TempDir(), "fixture.wav")
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg unavailable")
	}
	if out, err := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono", "-t", "2.1", wav).CombinedOutput(); err != nil {
		t.Fatalf("fixture %s: %v", out, err)
	}
	audio, err := os.ReadFile(wav)
	if err != nil {
		t.Fatal(err)
	}
	result, err := s.persistGeneratedMediaResult("user", map[string]any{"audio": map[string]any{"dataUrl": dataURL("audio/wav", audio), "durationMs": 1}, "cover": map[string]any{"dataUrl": dataURL("image/png", mediaTestPNG(t))}})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	id := result["audio"].(map[string]any)["resourceId"].(string)
	resource, err := s.repo.ResourceForUser("user", id)
	if err != nil || resource.DurationMs != 2100 {
		t.Fatalf("persisted resource %+v: %v", resource, err)
	}
	if err := db.Model(&model.Task{}).Where("id='task'").Update("result_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	// Upgrade case: previously delivered object has no authoritative duration metadata.
	if err := db.Model(&model.Resource{}).Where("id=?", id).Update("duration_ms", 0).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.ResolveBillingOrder(&model.User{ID: "user"}, order.ID, req); err == nil {
		t.Fatal("accepted non-admin")
	}
	unchanged()
	saved, err := s.ResolveBillingOrder(admin, order.ID, req)
	if err != nil || saved.Status != model.BillingStatusSettled || saved.Quantity != 3 || saved.ActualAmountMicrocredits != 300 || saved.ResolvedBy != "admin" {
		t.Fatal(saved, err)
	}
}

func TestAudioSettlementFromStagedDelivery(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg unavailable")
	}
	s, db := newMediaRecoveryTestService(t)
	expires := time.Now().Add(time.Minute)
	task := model.Task{ID: "staged", UserID: "owner", BillingOrderID: "bill", Type: "canvas_audio",
		Status: model.TaskStatusRunning, LeaseOwner: "fixture", LeaseExpiresAt: &expires, RouteRun: 1, InputJSON: `{"mode":"audio"}`}
	path := filepath.Join(t.TempDir(), "original.wav")
	// One sample past one second. Resampling before measuring can erase this boundary.
	if out, err := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-af", "atrim=end_sample=44101", path).CombinedOutput(); err != nil {
		t.Fatalf("fixture: %s %v", out, err)
	}
	audio, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range []any{
		&task,
		&model.CreditAccount{UserID: task.UserID, ReservedMicrocredits: 300},
		&model.BillingOrder{ID: task.BillingOrderID, TaskID: task.ID, UserID: task.UserID, IdempotencyKey: "staged",
			Status: model.BillingStatusRunning, Capability: "audio", BillingMode: "per_second", UnitPriceMicrocredits: 100,
			MultiplierBasisPoints: 10000, Quantity: 3, AmountMicrocredits: 300, ReservedAmountMicrocredits: 300},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	ctx := context.WithValue(withProviderAnalytics(context.Background(), s, task), mediaExecutionTaskKey{}, task)
	result, handled, err := recoverProtocolMedia(ctx, providerConfig{}, "audio", []protocol.MediaReference{{DataURL: dataURL("audio/wav", audio), MIMEType: "audio/wav"}})
	if !handled || err != nil {
		t.Fatalf("media delivery: handled=%t err=%v", handled, err)
	}
	stored, err := s.repo.Task(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.finishTaskMediaRecovery(stored, result, nil); err != nil {
		t.Fatal(err)
	}
	resourceID := audioOutputResourceID(mustJSON(map[string]any{"audios": result["audios"]}))
	resource, err := s.repo.ResourceForUser(task.UserID, resourceID)
	if err != nil || resource.DurationMs != 1001 {
		t.Fatalf("staged duration: %+v %v", resource, err)
	}
	order, err := s.repo.BillingOrder(task.BillingOrderID)
	if err != nil || order.Status != model.BillingStatusSettled || order.Quantity != 2 || order.ActualAmountMicrocredits != 200 || order.RefundedAmountMicrocredits != 100 {
		t.Fatalf("settlement: %+v %v", order, err)
	}
}

func TestMeasureCompleteAudioOrigin(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg unavailable")
	}
	svc := newResourceTestService(t)
	setting := ossSettingValue{Enabled: true, Provider: aliyunOSSProvider, Endpoint: "https://example.invalid", Bucket: "fixture", AccessKeyID: "fixture", AccessKeySecret: "fixture"}
	encoded, _ := json.Marshal(setting)
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(encoded)}); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "long.wav")
	if out, err := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "90", path).CombinedOutput(); err != nil {
		t.Fatal(string(out), err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if int64(len(data)) <= mediaProbeRemoteHeadBytes {
		t.Fatal("fixture within hints limit")
	}
	res := model.Resource{ID: "music", UserID: "owner", Kind: "audio", Provider: setting.Provider, Endpoint: setting.Endpoint, Bucket: setting.Bucket, Size: int64(len(data)), ETag: "original", ObjectKey: "immutable-key", Status: model.ResourceStatusReady, DurationMs: 1}
	if err := svc.repo.CreateResource(&res); err != nil {
		t.Fatal(err)
	}
	orig := getOriginOSSObjectRange
	t.Cleanup(func() { getOriginOSSObjectRange = orig })
	tag := "original"
	body := data
	calls := 0
	getOriginOSSObjectRange = func(actual storage.Settings, key, rng string) (*storage.ObjectStream, error) {
		calls++
		if actual.Bucket != res.Bucket || key != res.ObjectKey || rng != "" {
			t.Fatal(key, rng)
		}
		return &storage.ObjectStream{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(body)), ETag: tag, ContentLength: -1}, nil
	}
	task := model.Task{UserID: "other", Type: "canvas_audio", ResultJSON: `{"audio":{"resourceId":"music"}}`}
	if _, _, err := svc.measuredAudioOutput(task); err == nil || calls != 0 {
		t.Fatalf("foreign object %d %v", calls, err)
	}
	task.UserID = "owner"
	if _, ms, err := svc.measuredAudioOutput(task); err != nil || ms != 90000 {
		t.Fatal(ms, err)
	}
	tag = "replacement"
	if _, _, err := svc.measuredAudioOutput(task); err == nil {
		t.Fatal("accepted changed origin ETag")
	}
	tag = "original"
	body = data[:mediaProbeRemoteHeadBytes]
	if _, _, err := svc.measuredAudioOutput(task); err == nil {
		t.Fatal("accepted partial body")
	}
	getOriginOSSObjectRange = func(storage.Settings, string, string) (*storage.ObjectStream, error) {
		return nil, errors.New("synthetic storage outage")
	}
	_, _, err = svc.measuredAudioOutput(task)
	var detail *AppError
	if !errors.As(err, &detail) || detail.Status != 503 {
		t.Fatalf("storage outage: %v", err)
	}
}
