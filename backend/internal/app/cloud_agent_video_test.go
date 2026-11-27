package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
	"yingce/backend/internal/repository"
)

func TestCloudAgentVideoToolUsesVisionAdmission(t *testing.T) {
	for _, vision := range []bool{false, true} {
		req := agentTestRequest()
		req.VisionEnabled = vision
		if got := cloudAgentToolAllowed(req, "canvas_inspect_video"); got != vision {
			t.Fatalf("视频观察工具准入 = %t，期望 %t", got, vision)
		}
	}
}

func cloudAgentVideoFixture(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("需要 FFmpeg 验证视频观察")
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("需要 FFprobe 验证视频观察")
	}
	s, db, _ := cloudAgentVisionFixture(t)
	s.coordinator = platform.NewCoordinatorWithRedis(nil, "video-observation-test")
	path := filepath.Join(s.dataDir, "resources", "observation.mp4")
	cmd := exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=4:duration=2", "-an", "-c:v", "mpeg4", path)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("生成真实视频失败: %v %s", err, output)
	}
	stat, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	resource := &model.Resource{ID: "video-source", UserID: "user", Kind: "video", Status: "ready", MimeType: "video/mp4", Provider: "local", ObjectKey: "observation.mp4", Size: stat.Size(), Width: 160, Height: 90, DurationMs: 2000}
	if err := db.Create(resource).Error; err != nil {
		t.Fatal(err)
	}
	canvas, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
	if err != nil {
		t.Fatal(err)
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	doc["nodes"] = append(creationMaps(doc["nodes"]), map[string]any{"id": "clip", "type": "video", "title": "原片", "metadata": map[string]any{"status": "success", "storageKey": "resource:video-source"}})
	raw, _ := json.Marshal(doc)
	if err := db.Model(&model.CanvasProject{}).Where("id = ?", "agent-canvas").Update("payload_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	return s, db
}

func cloudAgentVideoCall(t *testing.T, args map[string]any) cloudAgentCall {
	t.Helper()
	if args == nil {
		args = map[string]any{"nodeId": "clip", "purpose": "分析人物动作与运镜"}
	}
	return cloudAgentStoryboardCall(t, "canvas_inspect_video", "inspect-clip", args)
}

func TestCloudAgentVideoWorkerReceivesFramesThroughPi(t *testing.T) {
	for _, protocol := range []model.ChannelInterfaceType{model.ChannelInterfaceChatCompletion, model.ChannelInterfaceOpenAIResponse} {
		t.Run(string(protocol), func(t *testing.T) {
			t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
			s, _ := cloudAgentVideoFixture(t)
			root, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
			if err != nil {
				t.Fatal(err)
			}
			run, err := s.repo.CloudAgent("user", root.ID)
			if err != nil {
				t.Fatal(err)
			}
			state, err := cloudAgentDecode(run)
			if err != nil {
				t.Fatal(err)
			}
			state.ActiveTaskID = ""
			state.Request.VisionEnabled = true
			state.Calls = []cloudAgentCall{cloudAgentVideoCall(t, nil), cloudAgentStoryboardCall(t, "canvas_get_state", "read-state", map[string]any{})}
			for index := range state.Calls {
				state.Calls[index].ItemID = "fc-" + state.Calls[index].ID
			}
			state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{"role": "assistant", "content": "", "tool_calls": state.Calls})
			if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
				return cloudAgentSave(current, &state)
			}); err != nil {
				t.Fatal(err)
			}
			for _, call := range state.Calls {
				if _, err := s.executeCloudAgentRuntimeTool(context.Background(), "user", run.ID, call); err != nil {
					t.Fatal(err)
				}
			}
			stored, err := s.repo.CloudAgent("user", run.ID)
			if err != nil {
				t.Fatal(err)
			}
			saved, err := cloudAgentDecode(stored)
			if err != nil {
				t.Fatal(err)
			}
			assertPiBatchImages(t, &saved, 2)
			if saved.ImageInspectCalls != 2 {
				t.Fatalf("视频帧未计入统一预算: %d", saved.ImageInspectCalls)
			}
			toolParts := make([]any, 0, len(state.Calls))
			for _, call := range state.Calls {
				toolParts = append(toolParts, map[string]any{"type": "toolCall", "id": call.ID, "itemId": call.ItemID, "name": call.Function.Name, "arguments": map[string]any{}})
			}
			projected := []map[string]any{{"role": "assistant", "content": toolParts}}
			for _, call := range state.Calls {
				content, ok := cloudAgentToolMessage(&saved, call.ID)
				if !ok {
					t.Fatal("缺少工具回执")
				}
				projected = append(projected, map[string]any{"role": "toolResult", "toolCallId": call.ID, "content": content})
			}
			canonical, err := cloudAgentPiCanonicalForModelRequest(projected, saved.Canonical)
			if err != nil {
				t.Fatal(err)
			}
			refs, err := s.cloudAgentPiStepImageReferences("user", saved.Request, &canonical)
			if err != nil {
				t.Fatal(err)
			}
			if len(refs) != 2 {
				t.Fatalf("真实帧引用数量: %d", len(refs))
			}
			want := make([]string, 0, len(refs))
			for _, ref := range refs {
				_, reader, err := s.OpenResource("user", strings.TrimPrefix(ref.StorageKey, "resource:"))
				if err != nil {
					t.Fatal(err)
				}
				img, _, err := image.Decode(reader)
				reader.Close()
				if err != nil || img.Bounds().Dx() != 160 || img.Bounds().Dy() != 90 {
					t.Fatal("未得到真实视频帧")
				}
				_, reader, err = s.OpenResource("user", strings.TrimPrefix(ref.StorageKey, "resource:"))
				if err != nil {
					t.Fatal(err)
				}
				var data bytes.Buffer
				_, err = data.ReadFrom(reader)
				reader.Close()
				if err != nil {
					t.Fatal(err)
				}
				want = append(want, base64.StdEncoding.EncodeToString(data.Bytes()))
			}
			received := make(chan string, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					w.WriteHeader(400)
					return
				}
				raw, _ := json.Marshal(body)
				received <- string(raw)
				if protocol == model.ChannelInterfaceOpenAIResponse {
					w.Header().Set("Content-Type", "text/event-stream")
					_, _ = w.Write([]byte("event: response.output_text.delta\ndata: {\"delta\":\"frames received\"}\n\nevent: response.completed\ndata: {\"response\":{\"status\":\"completed\",\"output\":[]}}\n\n"))
				} else {
					w.Header().Set("Content-Type", "application/json")
					_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"frames received"}}]}`))
				}
			}))
			defer server.Close()
			limits, err := s.cloudAgentVisionReferences(saved.Request)
			if err != nil {
				t.Fatal(err)
			}
			stream := protocol == model.ChannelInterfaceOpenAIResponse
			input := canvasGenerationInput{Mode: "text", Prompt: "分析原片", ReferenceImages: refs, AgentRequests: &agentToolRequests{Canonical: &canonical}, TextOptions: canvasTextOptions{Stream: &stream}, Config: providerConfig{Model: "text-test", InterfaceType: string(protocol), APIKey: "test-only", BaseURL: server.URL, CapabilityConfig: &ModelCapabilityConfig{Text: &TextCapabilityConfig{References: limits}}}}
			raw, err := json.Marshal(input)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(raw), "base64,") {
				t.Fatal("持久输入包含图片字节")
			}
			if _, err := s.processCanvasGenerationTask(context.Background(), "user", "agent-canvas", "canvas_text", "", string(raw)); err != nil {
				t.Fatal(err)
			}
			select {
			case body := <-received:
				last := -1
				for _, pixels := range want {
					index := strings.Index(body, pixels)
					if index <= last {
						t.Fatal("上游未收到按时间排序的真实帧")
					}
					last = index
				}
				if !strings.Contains(body, `\"timestampMs\":1750`) || !strings.Contains(body, "not_analyzed") {
					t.Fatal("上游缺少时间戳或声音边界")
				}
			default:
				t.Fatal("没有发送模型请求")
			}
		})
	}
}

func TestCloudAgentVideoCacheAndAdmission(t *testing.T) {
	s, db := cloudAgentVideoFixture(t)
	state := cloudAgentRuntime{Request: agentTestRequest()}
	state.Request.VisionEnabled = true
	call := cloudAgentVideoCall(t, nil)
	first, err := s.prepareCloudAgentVideoInspection(context.Background(), "user", "agent-canvas", &state, call)
	if err != nil {
		t.Fatal(err)
	}
	batch := first.(cloudAgentImageInspectionBatch)
	if len(batch.Inspections) != 2 || batch.Receipt["audioStatus"] != "not_analyzed" {
		t.Fatalf("观察回执错误: %#v", batch.Receipt)
	}
	// 缓存命中必须无需再次启动解码器，同时保留原有真实帧身份。
	t.Setenv(renderFfmpegEnv, "/missing/ffmpeg")
	second, err := s.prepareCloudAgentVideoInspection(context.Background(), "user", "agent-canvas", &state, call)
	if err != nil {
		t.Fatal(err)
	}
	if second.(cloudAgentImageInspectionBatch).Inspections[0].ImageURL != batch.Inspections[0].ImageURL {
		t.Fatal("缓存未复用")
	}
	canonical := canonicalAgentRequest{Messages: []map[string]any{{"role": "user", "content": cloudAgentImageContentParts(batch.Inspections...)}}}
	if _, err := s.cloudAgentImageReferences("user", state.Request, &canonical); err != nil {
		t.Fatal(err)
	}
	if _, err := s.prepareCloudAgentVideoInspection(context.Background(), "other", "agent-canvas", &state, call); err == nil {
		t.Fatal("跨用户可读取视频缓存")
	}
	state.ImageInspectCalls = cloudAgentMaxImageInspectionCallsPerRun - 1
	if _, err := s.prepareCloudAgentVideoInspection(context.Background(), "user", "agent-canvas", &state, call); err == nil {
		t.Fatal("视频绕过本轮图片预算")
	}
	state.ImageInspectCalls = 0
	state.Canonical = canonical
	if _, err := s.prepareCloudAgentVideoInspection(context.Background(), "user", "agent-canvas", &state, call); err == nil {
		t.Fatal("历史帧未计入模型上限")
	}
	state.Canonical = canonicalAgentRequest{}
	// 不改资源身份与就绪状态，仅更新时间也必须使旧缓存和待发送帧失效。
	if err := db.Model(&model.Resource{}).Where("id = ?", "video-source").UpdateColumn("updated_at", time.Now().Add(time.Hour)).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.prepareCloudAgentVideoInspection(context.Background(), "user", "agent-canvas", &state, call); err == nil {
		t.Fatal("资源版本变化后仍复用旧缓存")
	}
	if _, err := s.cloudAgentImageReferences("user", state.Request, &canonical); err == nil {
		t.Fatal("发送前未拒绝旧版本视频帧")
	}
	if err := db.Model(&model.Resource{}).Where("id = ?", "video-source").Update("status", "failed").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.prepareCloudAgentVideoInspection(context.Background(), "user", "agent-canvas", &state, call); err == nil {
		t.Fatal("失效视频仍可命中缓存")
	}
	if _, err := s.cloudAgentImageReferences("user", state.Request, &canonical); err == nil {
		t.Fatal("发送前未校验原视频")
	}
}

func TestCloudAgentVideoCancellationAndInvalidRange(t *testing.T) {
	s, _ := cloudAgentVideoFixture(t)
	state := cloudAgentRuntime{Request: agentTestRequest()}
	for _, args := range []map[string]any{
		{"nodeId": "clip", "purpose": "观察", "startMs": -1},
		{"nodeId": "clip", "purpose": "观察", "endMs": 4000},
		{"nodeId": "cat", "purpose": "观察"},
		{"nodeId": "clip", "purpose": "观察", "url": "https://example.invalid"},
	} {
		if _, err := s.prepareCloudAgentVideoInspection(context.Background(), "user", "agent-canvas", &state, cloudAgentVideoCall(t, args)); err == nil {
			t.Fatalf("非法输入被放行: %#v", args)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := s.prepareCloudAgentVideoInspection(ctx, "user", "agent-canvas", &state, cloudAgentVideoCall(t, nil))
	var admission *cloudAgentMediaAdmissionError
	if !errors.As(err, &admission) || admission.Reason != "video_observation_cancelled" {
		t.Fatalf("取消错误: %v", err)
	}
}

func TestCloudAgentVideoStopsWhenRunCancelled(t *testing.T) {
	s, db := cloudAgentVideoFixture(t)
	root, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	state := cloudAgentRuntime{Request: agentTestRequest(), RuntimeRunID: root.ID}
	// 占满解码槽，验证取消能打断排队，不依赖解码器恰好处理完的时机。
	cloudAgentVideoSlots <- struct{}{}
	cloudAgentVideoSlots <- struct{}{}
	defer func() { <-cloudAgentVideoSlots; <-cloudAgentVideoSlots }()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	done := make(chan error, 1)
	call := cloudAgentVideoCall(t, nil)
	go func() {
		_, err := s.prepareCloudAgentVideoInspection(ctx, "user", "agent-canvas", &state, call)
		done <- err
	}()
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", root.ID).Update("status", "cancelled").Error; err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		var admission *cloudAgentMediaAdmissionError
		if !errors.As(err, &admission) || admission.Reason != "video_observation_cancelled" {
			t.Fatalf("会话取消未中断观察: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("会话取消后仍在等待解码")
	}
}

func TestCloudAgentVideoLeaderCancellationKeepsOtherRequestAlive(t *testing.T) {
	s, _ := cloudAgentVideoFixture(t)
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Fatal(err)
	}
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	wrapper := filepath.Join(dir, "ffmpeg")
	// 首次解码停在可观测屏障，后续解码使用真实 FFmpeg，确保另一个请求确实成功。
	script := "#!/bin/sh\nif mkdir \"${0}.first\" 2>/dev/null; then\n  : > \"${0}.started\"\n  exec sleep 30\nfi\nexec \"$PIXELSHORT_TEST_REAL_FFMPEG\" \"$@\"\n"
	if err := os.WriteFile(wrapper, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(ffprobe, filepath.Join(dir, "ffprobe")); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PIXELSHORT_TEST_REAL_FFMPEG", ffmpeg)
	t.Setenv(renderFfmpegEnv, wrapper)
	ctx1, cancel1 := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel1()
	ctx2, cancel2 := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel2()
	state1 := cloudAgentRuntime{Request: agentTestRequest()}
	state2 := cloudAgentRuntime{Request: agentTestRequest()}
	call := cloudAgentVideoCall(t, nil)
	done1, done2 := make(chan error, 1), make(chan error, 1)
	go func() {
		_, err := s.prepareCloudAgentVideoInspection(ctx1, "user", "agent-canvas", &state1, call)
		done1 <- err
	}()
	for {
		if _, err := os.Stat(wrapper + ".started"); err == nil {
			break
		}
		select {
		case <-ctx1.Done():
			t.Fatal("首个请求未进入解码阶段")
		case <-time.After(5 * time.Millisecond):
		}
	}
	go func() {
		result, err := s.prepareCloudAgentVideoInspection(ctx2, "user", "agent-canvas", &state2, call)
		if err == nil && len(result.(cloudAgentImageInspectionBatch).Inspections) != 2 {
			err = errors.New("第二个请求未取得真实视频帧")
		}
		done2 <- err
	}()
	// 留出第二个请求完成资源准入并进入缓存等待的时间；成功断言不依赖固定完成耗时。
	time.Sleep(100 * time.Millisecond)
	cancel1()
	select {
	case err := <-done1:
		var admission *cloudAgentMediaAdmissionError
		if !errors.As(err, &admission) || admission.Reason != "video_observation_cancelled" {
			t.Fatalf("首个请求取消结果: %v", err)
		}
	case <-ctx2.Done():
		t.Fatal("首个请求未响应取消")
	}
	select {
	case err := <-done2:
		if err != nil {
			t.Fatalf("首个请求取消不应影响第二个请求: %v", err)
		}
	case <-ctx2.Done():
		t.Fatal("第二个请求未完成独立观察")
	}
}
