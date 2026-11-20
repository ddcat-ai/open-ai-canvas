package app

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

// requireFFmpegTools 跳过依赖本机 ffmpeg/ffprobe 的用例；纯逻辑用例不经过这里。
func requireFFmpegTools(t *testing.T) {
	t.Helper()
	for _, name := range []string{"ffmpeg", "ffprobe"} {
		if _, err := exec.LookPath(name); err != nil {
			t.Skipf("%s 未安装，跳过真实媒体探测用例", name)
		}
	}
}

// writeTestVideo 生成一段 1 秒、带音轨的 H.264 测试视频；tags 写入容器元数据。
func writeTestVideo(t *testing.T, path string, width int, height int, tags map[string]string) {
	t.Helper()
	args := []string{"-v", "error", "-y",
		"-f", "lavfi", "-i", "color=c=red:s=" + strconv.Itoa(width) + "x" + strconv.Itoa(height) + ":r=30",
		"-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
		"-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"}
	for key, value := range tags {
		args = append(args, "-metadata", key+"="+value)
	}
	args = append(args, "-movflags", "+faststart+use_metadata_tags", path)
	if output, err := exec.Command("ffmpeg", args...).CombinedOutput(); err != nil {
		t.Fatalf("generate test video: %v %s", err, output)
	}
}

func TestParseMediaProbeOutput(t *testing.T) {
	cases := []struct {
		name          string
		raw           string
		width, height int
		durationMs    int64
		aigc          string
	}{
		{"video with tags", `{"streams":[{"width":768,"height":1344}],"format":{"duration":"5.041000","tags":{"AIGC":"{\"Label\":\"1\"}"}}}`, 768, 1344, 5041, `{"Label":"1"}`},
		{"rotated display swaps dimensions", `{"streams":[{"width":1920,"height":1080,"side_data_list":[{"rotation":-90}]}],"format":{"duration":"1.0"}}`, 1080, 1920, 1000, ""},
		{"audio only keeps unknown dimensions", `{"streams":[],"format":{"duration":"1.500000","tags":{"aigc":"x"}}}`, 0, 0, 1500, "x"},
		{"unknown duration and absurd size", `{"streams":[{"width":99999,"height":2}],"format":{"duration":"N/A"}}`, 0, 0, 0, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			info, err := parseMediaProbeOutput([]byte(tc.raw))
			if err != nil {
				t.Fatal(err)
			}
			if info.Width != tc.width || info.Height != tc.height || info.DurationMs != tc.durationMs {
				t.Fatalf("info = %dx%d %dms, want %dx%d %dms", info.Width, info.Height, info.DurationMs, tc.width, tc.height, tc.durationMs)
			}
			if got := mediaProbeTag(info.Tags, "AIGC"); got != tc.aigc {
				t.Fatalf("AIGC tag = %q, want %q", got, tc.aigc)
			}
		})
	}
	if _, err := parseMediaProbeOutput([]byte("not json")); err == nil {
		t.Fatal("invalid probe output: want error")
	}
}

func TestStoreTaskMediaFileRecordsVideoDimensions(t *testing.T) {
	requireFFmpegTools(t)
	s, db := newMediaRecoveryTestService(t)
	task := seedMediaTask(t, db, providerConfig{})
	path := filepath.Join(t.TempDir(), "generated.mp4")
	writeTestVideo(t, path, 768, 1344, nil)
	resource, fallback, err := s.storeTaskMediaFile(task, 0, path, "video/mp4", "video", nil)
	if err != nil || fallback != nil {
		t.Fatalf("store: %v fallback=%v", err, fallback)
	}
	if resource.Width != 768 || resource.Height != 1344 || resource.DurationMs < 900 {
		t.Fatalf("resource = %dx%d %dms, want 768x1344 ~1000ms", resource.Width, resource.Height, resource.DurationMs)
	}
	stored, err := s.repo.ResourceForUser(task.UserID, resource.ID)
	if err != nil || stored.Width != 768 || stored.Height != 1344 {
		t.Fatalf("persisted resource = %+v %v", stored, err)
	}
}

// seedLocalVideoResource 在服务数据目录写入一段真实视频，并登记为尺寸未知（旧版本入库）的本地资源。
func seedLocalVideoResource(t *testing.T, s *Service, userID string, width int, height int, tags map[string]string) *model.Resource {
	t.Helper()
	resource := &model.Resource{ID: newID(), UserID: userID, Kind: "video", Status: model.ResourceStatusReady, Provider: "local", MimeType: "video/mp4", CreatedAt: time.Now()}
	resource.ObjectKey = userID + "/" + resource.ID + ".mp4"
	path := filepath.Join(s.dataDir, "resources", filepath.FromSlash(resource.ObjectKey))
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	writeTestVideo(t, path, width, height, tags)
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	resource.Size = info.Size()
	if err := s.repo.CreateResource(resource); err != nil {
		t.Fatal(err)
	}
	return resource
}

func legacyVideoAssetPayload(t *testing.T, assetID string, resourceID string, metadata map[string]any) string {
	t.Helper()
	payload := map[string]any{
		"id": assetID, "kind": "video", "title": "旧视频", "coverUrl": "", "tags": []string{},
		"createdAt": "2026-09-01T00:00:00Z", "updatedAt": "2026-09-01T00:00:00Z",
		"data": map[string]any{"url": "/api/resources/" + resourceID + "/file", "storageKey": "resource:" + resourceID, "mimeType": "video/mp4", "bytes": 10, "width": 1, "height": 1},
	}
	if metadata != nil {
		payload["metadata"] = metadata
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}

func assetPayloadData(t *testing.T, s *Service, userID string, assetID string) (map[string]any, map[string]any) {
	t.Helper()
	asset, err := s.repo.AssetForUser(userID, assetID)
	if err != nil {
		t.Fatalf("load asset %s: %v", assetID, err)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(asset.PayloadJSON), &payload); err != nil {
		t.Fatal(err)
	}
	data, _ := payload["data"].(map[string]any)
	metadata, _ := payload["metadata"].(map[string]any)
	return data, metadata
}

func TestBackfillVideoResourceDimensionsRepairsResourceAndAssets(t *testing.T) {
	requireFFmpegTools(t)
	s, db := newMediaRecoveryTestService(t)
	resource := seedLocalVideoResource(t, s, "media-user", 768, 1344, nil)
	asset := model.Asset{ID: "generation_legacy", UserID: "media-user", Kind: "video", Category: model.AssetCategoryMaterial, Status: model.AssetVersionStatusConfirmed, Title: "旧视频", PayloadJSON: legacyVideoAssetPayload(t, "generation_legacy", resource.ID, nil), CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}
	if repaired := s.BackfillVideoResourceDimensions(context.Background()); repaired != 1 {
		t.Fatalf("repaired = %d, want 1", repaired)
	}
	stored, err := s.repo.ResourceForUser("media-user", resource.ID)
	if err != nil || stored.Width != 768 || stored.Height != 1344 {
		t.Fatalf("resource = %+v %v", stored, err)
	}
	data, _ := assetPayloadData(t, s, "media-user", asset.ID)
	if data["width"] != float64(768) || data["height"] != float64(1344) {
		t.Fatalf("asset dimensions = %v x %v", data["width"], data["height"])
	}
	// 幂等：已补齐的资源不再被选中，素材文档不再改写。
	before, _ := s.repo.AssetForUser("media-user", asset.ID)
	if repaired := s.BackfillVideoResourceDimensions(context.Background()); repaired != 0 {
		t.Fatalf("second run repaired = %d, want 0", repaired)
	}
	after, _ := s.repo.AssetForUser("media-user", asset.ID)
	if before.PayloadJSON != after.PayloadJSON {
		t.Fatal("second run rewrote the asset document")
	}
}

func TestDramaCanvasAssetsLinksProjectAndRepairsLegacyAssets(t *testing.T) {
	svc, fake := newDramaTestService(t)
	svc.dataDir = t.TempDir()
	drama := createTestDrama(t, svc, DramaReviewAuto)
	userID, projectID := "usr-drama", drama.Project.ID
	imageID := fake.resourceSized(userID, "image", "image/png", 1080, 1920)
	videoID := fake.resource(userID, "video", "video/mp4")
	// 旧版本登记的素材：只有短剧来源、没有项目归属与项目链接。
	legacy := model.Asset{ID: dramaCanvasAssetID(videoID), UserID: userID, Kind: "video", Category: model.AssetCategoryMaterial, Status: model.AssetVersionStatusConfirmed, Title: "旧视频",
		PayloadJSON: legacyVideoAssetPayload(t, dramaCanvasAssetID(videoID), videoID, map[string]any{"source": "short-drama", "dramaProjectId": projectID, "resourceKey": "resource:" + videoID}), CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := fake.db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	request := DramaCanvasAssetsRequest{Resources: []DramaCanvasAssetInput{{ResourceID: imageID, Title: "设定图"}, {ResourceID: videoID}}}
	result, err := svc.DramaCanvasAssets(userID, projectID, request)
	if err != nil {
		t.Fatal(err)
	}
	if items := result["assets"].([]map[string]string); len(items) != 2 {
		t.Fatalf("assets = %+v", items)
	}
	for _, assetID := range []string{dramaCanvasAssetID(imageID), dramaCanvasAssetID(videoID)} {
		linked, err := svc.repo.ProjectAssetLinked(projectID, assetID)
		if err != nil || !linked {
			t.Fatalf("asset %s not linked to project: %v", assetID, err)
		}
		_, metadata := assetPayloadData(t, svc, userID, assetID)
		ids, _ := metadata["projectIds"].([]any)
		if len(ids) != 1 || ids[0] != projectID || metadata["projectName"] != drama.Project.Name || metadata["source"] != "short-drama" {
			t.Fatalf("asset %s metadata = %#v", assetID, metadata)
		}
	}
	imageData, _ := assetPayloadData(t, svc, userID, dramaCanvasAssetID(imageID))
	if imageData["width"] != float64(1080) || imageData["height"] != float64(1920) {
		t.Fatalf("new asset dimensions = %#v", imageData)
	}
	// 资源记录已有真实尺寸时，旧素材的 1×1 占位按资源改写。
	videoData, _ := assetPayloadData(t, svc, userID, dramaCanvasAssetID(videoID))
	if videoData["width"] != float64(1080) || videoData["height"] != float64(1920) {
		t.Fatalf("legacy asset dimensions = %#v", videoData)
	}

	// 重复登记幂等：不新增链接，不改写文档。
	links, _ := svc.repo.ProjectAssetLinks(projectID)
	before, _ := svc.repo.AssetForUser(userID, dramaCanvasAssetID(videoID))
	if _, err := svc.DramaCanvasAssets(userID, projectID, request); err != nil {
		t.Fatal(err)
	}
	again, _ := svc.repo.ProjectAssetLinks(projectID)
	after, _ := svc.repo.AssetForUser(userID, dramaCanvasAssetID(videoID))
	if len(again) != len(links) || before.PayloadJSON != after.PayloadJSON {
		t.Fatalf("re-registration not idempotent: links %d -> %d", len(links), len(again))
	}
}

func TestDramaCanvasAssetsProbesUnknownVideoDimensions(t *testing.T) {
	requireFFmpegTools(t)
	svc, _ := newDramaTestService(t)
	svc.dataDir = t.TempDir()
	drama := createTestDrama(t, svc, DramaReviewAuto)
	resource := seedLocalVideoResource(t, svc, "usr-drama", 768, 1344, nil)
	if _, err := svc.DramaCanvasAssets("usr-drama", drama.Project.ID, DramaCanvasAssetsRequest{Resources: []DramaCanvasAssetInput{{ResourceID: resource.ID}}}); err != nil {
		t.Fatal(err)
	}
	stored, err := svc.repo.ResourceForUser("usr-drama", resource.ID)
	if err != nil || stored.Width != 768 || stored.Height != 1344 {
		t.Fatalf("resource not repaired: %+v %v", stored, err)
	}
	data, _ := assetPayloadData(t, svc, "usr-drama", dramaCanvasAssetID(resource.ID))
	if data["width"] != float64(768) || data["height"] != float64(1344) {
		t.Fatalf("asset dimensions = %#v", data)
	}
}

func TestDramaCanvasAssetKeepsUnknownDimensionsAsZero(t *testing.T) {
	project := &model.Project{ID: "prj-1", Name: "短剧"}
	asset, err := dramaCanvasAsset("usr", project, model.Resource{ID: "res-1", MimeType: "video/mp4", Size: 10}, "video", DramaCanvasAssetInput{})
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(asset.PayloadJSON), &payload); err != nil {
		t.Fatal(err)
	}
	data := payload["data"].(map[string]any)
	if data["width"] != float64(0) || data["height"] != float64(0) {
		t.Fatalf("unknown dimensions were invented: %#v", data)
	}
	metadata := payload["metadata"].(map[string]any)
	if ids := metadata["projectIds"].([]any); len(ids) != 1 || ids[0] != "prj-1" || metadata["projectName"] != "短剧" {
		t.Fatalf("metadata = %#v", metadata)
	}
}
