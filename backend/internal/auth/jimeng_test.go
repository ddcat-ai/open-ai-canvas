package auth

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	"yingce/backend/internal/assets"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

const (
	jimengTestProjectID    = "0f0e0d0c-0b0a-4908-8706-050403020100"
	jimengTestImageID      = "11111111-1111-4111-8111-111111111111"
	jimengTestVideoID      = "33333333-3333-4333-8333-333333333333"
	jimengTestUntrustedID  = "44444444-4444-4444-8444-444444444444"
	jimengTestExpiresAt    = 1900000000
	jimengTestVideoExpires = 1795847348
)

// jimengTestDraftJSON 取自真实分享画布的字段形态：分组子节点坐标相对分组原点，
// 提示词由文本段和内联引用标记交替组成，生成节点保留多批历史结果。
const jimengTestDraftJSON = `{
  "draftVersion": 1,
  "nodes": [
    {"id":"node_img","type":"image","parentId":"node_group",
     "layout":{"x":10,"y":20,"width":320,"height":180,"zIndex":3},
     "data":{"title":"城门航拍\n第二行不会进入节点名","source":"model_generated","resourceId":"11111111-1111-4111-8111-111111111111",
       "resourceBatches":[{"id":"b1","resourceIds":["11111111-1111-4111-8111-111111111111"]},{"id":"b2","resourceIds":["22222222-2222-4222-8222-222222222222"]}],
       "generationDraft":{"kind":"image","outputCount":1,
         "parts":[{"type":"text","text":"修改 "},{"type":"extension","extension_type":"node","object_id":"slot-1"},{"type":"text","text":" 这张攻城全景"}],
         "references":[{"extensionType":"node","nodeId":"node_ref","role":"reference","slotId":"slot-1","sourceInstanceId":"node_ref","type":"extension"}],
         "contentSettings":{"aspectRatio":"16:9","modelName":"jm_image_model_lib_s","quality":"high","resolution":"2K"}}}},
    {"id":"node_video","type":"video","parentId":"node_group",
     "layout":{"x":400,"y":20,"width":320,"height":568.889,"zIndex":4},
     "data":{"title":"镜头70（共2.8秒）\n景别： 超大全景","source":"model_generated","resourceId":"33333333-3333-4333-8333-333333333333",
       "resourceBatches":[{"id":"b3","resourceIds":["33333333-3333-4333-8333-333333333333"]}],
       "generationDraft":{"kind":"video","outputCount":1,"parts":[{"type":"text","text":"秦凤路真人水墨大景"}],
         "contentSettings":{"aspectRatio":"9:16","durationSeconds":30,"isLongVideo":false,"mode":"multiModal","modelName":"seedance_2.5","resolution":"720p"}}}},
    {"id":"node_evil","type":"image","layout":{"x":-900,"y":300,"width":320,"height":180},
     "data":{"title":"来路不明的图片","source":"uploaded","resourceId":"44444444-4444-4444-8444-444444444444"}},
    {"id":"node_missing","type":"image","layout":{"x":-500,"y":300,"width":320,"height":0},
     "data":{"title":"素材已删除","source":"uploaded","resourceId":"55555555-5555-4555-8555-555555555555"}},
    {"id":"node_timeline","type":"timeline","layout":{"x":-200,"y":900,"width":1714,"height":235},"data":{"title":"时间线 1","tracks":[]}},
    {"id":"node_hidden","type":"image","layout":{"x":-200,"y":1200,"width":320,"height":180},
     "data":{"title":"分享方已隐藏","resourceId":"66666666-6666-4666-8666-666666666666"}},
    {"id":"node_group","type":"group","layout":{"x":100,"y":200,"width":3000,"height":2000,"zIndex":1},"data":{"name":"片段集合一"}}
  ],
  "edges": [
    {"id":"edge_1","source":"node_img","target":"node_video","type":"reference","data":{}},
    {"id":"edge_2","source":"node_video","target":"node_timeline","type":"reference","data":{}},
    {"id":"edge_2","source":"node_video","target":"node_img","type":"reference","data":{}},
    {"id":"","source":"node_img","target":"node_video","type":"reference","data":{}},
    {"id":"edge_3","source":"node_evil","target":"node_video","type":"reference","data":{}}
  ]
}`

func jimengTestResources() *jimengResourceSet {
	return &jimengResourceSet{
		Resources: map[string]jimengResource{
			jimengTestImageID:     {ResourceID: jimengTestImageID, Type: jimengImageResource, Status: jimengResourceReady, Image: &jimengImageMeta{URI: "tos-cn-i-test/image-1", Width: 2048, Height: 1152, Format: "png"}},
			jimengTestVideoID:     {ResourceID: jimengTestVideoID, Type: jimengVideoResource, Status: jimengResourceReady, Video: &jimengVideoMeta{VID: "v0287test", Width: 720, Height: 1280, Duration: 30.05}},
			jimengTestUntrustedID: {ResourceID: jimengTestUntrustedID, Type: jimengImageResource, Status: jimengResourceReady, Image: &jimengImageMeta{URI: "tos-cn-i-test/evil", Width: 640, Height: 480}},
		},
		Images: map[string]jimengImageURLs{
			"tos-cn-i-test/image-1": {
				URL: "https://p26-dreamina-sign.byteimg.com/tos-cn-i-test/image-1~tplv-x-aigc_resize:0:0.image?x-expires=1900000000&x-signature=a",
				ResolutionSource: map[string]jimengSizedURL{
					"1280:1280": {URL: "https://p26-dreamina-sign.byteimg.com/tos-cn-i-test/1280.webp?x-expires=1900000000", Width: 1280, Height: 720, Format: "webp"},
					"360:360":   {URL: "https://p26-dreamina-sign.byteimg.com/tos-cn-i-test/360.webp?x-expires=1900000000", Width: 360, Height: 203, Format: "webp"},
					"720:720":   {URL: "https://p9-dreamina-sign.byteimg.com/tos-cn-i-test/720.webp?x-expires=1900000000", Width: 720, Height: 405, Format: "webp"},
				},
			},
			"tos-cn-i-test/evil": {URL: "https://evil.example/image.png"},
		},
		Media: map[string]jimengMediaURLs{
			"v0287test": {
				URL:      "https://v26-dreamina-de.jianying.com/61c63ba27f86c81f/6b0a74b4/video/tos/cn/tos-cn-ve-1/key/?a=513695",
				CoverURL: "https://p9-sign.douyinpic.com/cover.jpeg?x-expires=1900000000",
			},
		},
	}
}

func jimengTestDraft(t *testing.T) (*jimengDraftDetail, *jimengDraft) {
	t.Helper()
	detail := &jimengDraftDetail{
		Project:     jimengProject{ProjectID: jimengTestProjectID, Name: "持械入宋"},
		DraftJSON:   jimengTestDraftJSON,
		ShareReview: jimengShareReview{BlockedNodeIDs: []string{"node_hidden"}},
	}
	draft, err := detail.draft()
	if err != nil {
		t.Fatalf("draft() error = %v", err)
	}
	return detail, draft
}

func TestAdaptJimengDraftMapsFramesMediaAndEdges(t *testing.T) {
	detail, draft := jimengTestDraft(t)
	result, err := adaptJimengDraft(*detail, draft, jimengTestResources(), jimengTestProjectID)
	if err != nil {
		t.Fatalf("adaptJimengDraft() error = %v", err)
	}
	if result.ProjectName != "持械入宋" || result.ProjectID != jimengTestProjectID {
		t.Fatalf("project mapping = %q %q", result.ProjectName, result.ProjectID)
	}
	if result.ImportedNodeCount != 5 || result.FrameNodeCount != 1 || result.PlaceholderNodeCount != 2 || result.MultiResultNodeCount != 1 {
		t.Fatalf("counts = nodes %d, frames %d, placeholders %d, multi %d", result.ImportedNodeCount, result.FrameNodeCount, result.PlaceholderNodeCount, result.MultiResultNodeCount)
	}
	if len(result.SkippedNodes) != 2 || result.SkippedNodes[0].Reason != "暂不支持的节点类型" || result.SkippedNodes[0].Name != "时间线 1" || result.SkippedNodes[1].ID != "node_hidden" {
		t.Fatalf("skipped nodes = %#v", result.SkippedNodes)
	}
	if len(result.Warnings) != 3 {
		t.Fatalf("warnings = %#v", result.Warnings)
	}

	// 背板排在最前；子节点坐标已换算为画布绝对坐标并挂到背板下。
	frame, image, video := result.Nodes[0], result.Nodes[1], result.Nodes[2]
	if frame.Type != "frame" || frame.Title != "片段集合一" || frame.X != 100 || frame.Y != 200 || frame.Width != 3000 || frame.ParentID != "" {
		t.Fatalf("frame mapping = %#v", frame)
	}
	if image.ParentID != frame.ID || image.X != 110 || image.Y != 220 || image.Width != 320 || video.ParentID != frame.ID || video.X != 500 || video.Y != 220 {
		t.Fatalf("child layout = %#v %#v", image, video)
	}
	if !strings.HasPrefix(image.ID, "jimeng-"+result.BatchID+"-node_img") || image.Metadata.Provider != "jimeng" || image.Metadata.NodeID != "node_img" || image.Metadata.ResourceID != jimengTestImageID || image.Metadata.BatchID != result.BatchID {
		t.Fatalf("image identity = %#v", image.Metadata)
	}
	if image.Title != "城门航拍" || image.Prompt != "修改\n这张攻城全景" || image.Model != "jm_image_model_lib_s" || image.Size != "16:9" || image.Quality != "2k" {
		t.Fatalf("image generation contract = %#v", image)
	}
	if image.Content != "https://p26-dreamina-sign.byteimg.com/tos-cn-i-test/image-1~tplv-x-aigc_resize:0:0.image?x-expires=1900000000&x-signature=a" {
		t.Fatalf("image content = %q", image.Content)
	}
	if image.PreviewContent != "https://p9-dreamina-sign.byteimg.com/tos-cn-i-test/720.webp?x-expires=1900000000" {
		t.Fatalf("image preview should pick the largest variant not above 960px, got %q", image.PreviewContent)
	}
	if image.Status != "success" || image.NaturalWidth != 2048 || image.NaturalHeight != 1152 || image.MimeType != "image/png" || image.Metadata.SourceType != "model_generated" {
		t.Fatalf("image media = %#v", image)
	}
	if !image.Metadata.ExpiresAt.Equal(time.Unix(jimengTestExpiresAt, 0)) {
		t.Fatalf("image expiresAt = %v", image.Metadata.ExpiresAt)
	}
	if video.Title != "镜头70（共2.8秒）" || video.Prompt != "秦凤路真人水墨大景" || video.Seconds != "30" || video.VQuality != "720p" || video.Quality != "" {
		t.Fatalf("video generation contract = %#v", video)
	}
	if video.Content != "https://v26-dreamina-de.jianying.com/61c63ba27f86c81f/6b0a74b4/video/tos/cn/tos-cn-ve-1/key/?a=513695" || video.PreviewContent != "https://p9-sign.douyinpic.com/cover.jpeg?x-expires=1900000000" {
		t.Fatalf("video media = %#v", video)
	}
	if video.DurationMs != 30050 || video.MimeType != "video/mp4" || video.NaturalWidth != 720 || video.NaturalHeight != 1280 {
		t.Fatalf("video specs = %#v", video)
	}
	// 视频路径里的十六进制时间戳早于图片的 x-expires，整批以此为准。
	if !video.Metadata.ExpiresAt.Equal(time.Unix(jimengTestVideoExpires, 0)) || !result.MediaExpiresAt.Equal(time.Unix(jimengTestVideoExpires, 0)) {
		t.Fatalf("video expiry = %v, batch expiry = %v", video.Metadata.ExpiresAt, result.MediaExpiresAt)
	}
	for _, placeholder := range result.Nodes[3:] {
		if placeholder.Content != "" || placeholder.Status != "idle" || placeholder.Width != 320 {
			t.Fatalf("placeholder = %#v", placeholder)
		}
	}
	if result.Nodes[4].Height != 300 {
		t.Fatalf("invalid height should fall back to the default, got %v", result.Nodes[4].Height)
	}

	if result.ImportedConnectionCount != 2 || len(result.SkippedConnections) != 3 {
		t.Fatalf("connections = %d, skipped = %#v", result.ImportedConnectionCount, result.SkippedConnections)
	}
	if result.Connections[0].FromNodeID != image.ID || result.Connections[0].ToNodeID != video.ID || !strings.HasSuffix(result.Connections[0].ID, "-edge_1") {
		t.Fatalf("connection mapping = %#v", result.Connections[0])
	}
	if result.Connections[1].FromNodeID != result.Nodes[3].ID || result.Connections[1].ToNodeID != video.ID {
		t.Fatalf("placeholder nodes keep their connections = %#v", result.Connections[1])
	}
}

func TestAdaptJimengDraftRejectsUnusableCanvas(t *testing.T) {
	_, full := jimengTestDraft(t)
	tooMany := &jimengDraft{Nodes: make([]jimengRawNode, jimengMaxNodes+1)}
	if _, err := adaptJimengDraft(jimengDraftDetail{}, tooMany, &jimengResourceSet{}, jimengTestProjectID); err == nil || !strings.Contains(err.Error(), "节点过多") {
		t.Fatalf("oversized canvas error = %v", err)
	}
	empty := &jimengDraft{Nodes: []jimengRawNode{{ID: "node_timeline", Type: "timeline"}}}
	if _, err := adaptJimengDraft(jimengDraftDetail{}, empty, &jimengResourceSet{}, jimengTestProjectID); err == nil || !strings.Contains(err.Error(), "没有可导入的有效节点") {
		t.Fatalf("empty canvas error = %v", err)
	}
	// 父子互相引用时不能死循环，两个分组都按坐标无效跳过。
	cyclic := &jimengDraft{Nodes: []jimengRawNode{
		{ID: "group_a", Type: "group", ParentID: "group_b"},
		{ID: "group_b", Type: "group", ParentID: "group_a"},
		full.Nodes[2],
	}}
	result, err := adaptJimengDraft(jimengDraftDetail{}, cyclic, &jimengResourceSet{}, jimengTestProjectID)
	if err != nil {
		t.Fatalf("adaptJimengDraft() error = %v", err)
	}
	if result.FrameNodeCount != 0 || result.ImportedNodeCount != 1 || len(result.SkippedNodes) != 2 {
		t.Fatalf("cyclic parents = frames %d, nodes %d, skipped %#v", result.FrameNodeCount, result.ImportedNodeCount, result.SkippedNodes)
	}
	for _, skipped := range result.SkippedNodes {
		if skipped.Reason != "节点坐标无效" {
			t.Fatalf("cyclic group %q skipped for %q", skipped.ID, skipped.Reason)
		}
	}
}

func TestJimengURLExpiry(t *testing.T) {
	if got := jimengURLExpiry("https://p26-dreamina-sign.byteimg.com/a.image?x-expires=1900000000&x-signature=a"); !got.Equal(time.Unix(jimengTestExpiresAt, 0)) {
		t.Fatalf("image expiry = %v", got)
	}
	if got := jimengURLExpiry("https://v26-dreamina-de.jianying.com/61c63ba2/6b0a74b4/video/tos/cn/key/"); !got.Equal(time.Unix(jimengTestVideoExpires, 0)) {
		t.Fatalf("video expiry = %v", got)
	}
	for _, raw := range []string{"https://v26-dreamina-de.jianying.com/a/not-hex/x/", "https://p26-dreamina-sign.byteimg.com/a.image", "not a url"} {
		if got := jimengURLExpiry(raw); !got.IsZero() {
			t.Fatalf("expiry of %q = %v, want zero", raw, got)
		}
	}
}

func TestJimengResourceSetResolveReportsReasons(t *testing.T) {
	set := jimengTestResources()
	if media, reason := set.resolve(jimengTestUntrustedID); media != nil || reason != jimengUntrustedMedia {
		t.Fatalf("untrusted media = %#v, %q", media, reason)
	}
	if media, reason := set.resolve("00000000-0000-4000-8000-000000000000"); media != nil || reason != "即梦素材不存在或已被删除" {
		t.Fatalf("missing media = %#v, %q", media, reason)
	}
	set.Resources["99999999-9999-4999-8999-999999999999"] = jimengResource{Type: jimengImageResource, Status: 1}
	if _, reason := set.resolve("99999999-9999-4999-8999-999999999999"); reason != "即梦素材尚未生成完成" {
		t.Fatalf("pending media reason = %q", reason)
	}
	set.Resources["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"] = jimengResource{Type: 7, Status: jimengResourceReady}
	if _, reason := set.resolve("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"); reason != "暂不支持的即梦素材类型" {
		t.Fatalf("unsupported media reason = %q", reason)
	}
	// 带端口或非 https 的地址一律拒绝，不因为域名匹配就放行。
	set.Images["tos-cn-i-test/port"] = jimengImageURLs{URL: "https://p26-dreamina-sign.byteimg.com:8443/a.image"}
	set.Resources["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"] = jimengResource{Type: jimengImageResource, Status: jimengResourceReady, Image: &jimengImageMeta{URI: "tos-cn-i-test/port"}}
	if _, reason := set.resolve("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"); reason != jimengUntrustedMedia {
		t.Fatalf("media with port reason = %q", reason)
	}
}

func newJimengTestService(t *testing.T) *Service {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CanvasProject{}); err != nil {
		t.Fatal(err)
	}
	for _, project := range []model.CanvasProject{
		{ID: "canvas-1", UserID: "user-1", Title: "故事画布", PayloadJSON: "{}", Revision: 1},
		{ID: "canvas-2", UserID: "user-2", Title: "他人画布", PayloadJSON: "{}", Revision: 1},
	} {
		if err := db.Create(&project).Error; err != nil {
			t.Fatal(err)
		}
	}
	return New(repository.New(db), nil, nil)
}

type jimengFakeRequest struct {
	Path   string
	AppID  string
	Body   map[string]any
	Status int
}

// newJimengFakeAPI 模拟即梦的两个公开接口，并记录每次请求；respond 可改写响应。
func newJimengFakeAPI(t *testing.T, draftJSON string, respond func(path string, body map[string]any) (int, string)) (*httptest.Server, *[]jimengFakeRequest) {
	t.Helper()
	// 出站客户端默认拦截回环地址，这里按测试惯例精确放行本地假服务。
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	requests := &[]jimengFakeRequest{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		payload, _ := io.ReadAll(r.Body)
		body := map[string]any{}
		_ = json.Unmarshal(payload, &body)
		*requests = append(*requests, jimengFakeRequest{Path: r.URL.Path, AppID: r.Header.Get("appid"), Body: body})
		if respond != nil {
			if status, text := respond(r.URL.Path, body); text != "" {
				w.WriteHeader(status)
				_, _ = w.Write([]byte(text))
				return
			}
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/octo_api/v1/project/draft/get":
			_ = json.NewEncoder(w).Encode(map[string]any{"ret": "0", "errmsg": "OK", "data": map[string]any{
				"project":       map[string]any{"project_id": jimengTestProjectID, "name": "持械入宋"},
				"draft_json":    draftJSON,
				"draft_version": 1,
			}})
		case "/octo_api/v1/resource/batch_get":
			resources := make([]map[string]any, 0)
			imageURLs := map[string]any{}
			for _, id := range body["resource_ids"].([]any) {
				resourceID := id.(string)
				resources = append(resources, map[string]any{"resource_id": resourceID, "type": 1, "status": 1000, "image": map[string]any{"uri": "tos/" + resourceID, "width": 10, "height": 10}})
				imageURLs["tos/"+resourceID] = map[string]any{"url": "https://p26-dreamina-sign.byteimg.com/tos/" + resourceID + "?x-expires=1900000000"}
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"ret": "0", "errmsg": "OK", "data": map[string]any{"resources": resources, "image_urls": imageURLs}})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	previous := jimengAPIBase
	jimengAPIBase = server.URL + "/octo_api/v1/"
	t.Cleanup(func() { jimengAPIBase = previous })
	return server, requests
}

func TestImportJimengFetchesDraftThenChunkedResources(t *testing.T) {
	nodes := make([]map[string]any, 0, 170)
	for index := 0; index < 170; index++ {
		nodes = append(nodes, map[string]any{
			"id":     fmt.Sprintf("node-%d", index),
			"type":   "image",
			"layout": map[string]any{"x": float64(index), "y": 0, "width": 320, "height": 180},
			"data":   map[string]any{"title": "图片", "resourceId": fmt.Sprintf("%08d-0000-4000-8000-000000000000", index)},
		})
	}
	draftJSON, err := json.Marshal(map[string]any{"nodes": nodes, "edges": []any{}})
	if err != nil {
		t.Fatal(err)
	}
	_, requests := newJimengFakeAPI(t, string(draftJSON), nil)
	svc := newJimengTestService(t)

	result, err := svc.ImportJimeng("user-1", "canvas-1", " "+strings.ToUpper(jimengTestProjectID)+" ")
	if err != nil {
		t.Fatalf("ImportJimeng() error = %v", err)
	}
	if result.ImportedNodeCount != 170 || result.ProjectID != jimengTestProjectID {
		t.Fatalf("result = %d nodes, project %q", result.ImportedNodeCount, result.ProjectID)
	}
	if got := result.Nodes[169].Content; got != "https://p26-dreamina-sign.byteimg.com/tos/00000169-0000-4000-8000-000000000000?x-expires=1900000000" {
		t.Fatalf("last node content = %q", got)
	}
	batches := make([]int, 0)
	for _, request := range *requests {
		if request.AppID != jimengAppID || request.Body["project_id"] != jimengTestProjectID {
			t.Fatalf("request = %#v", request)
		}
		if request.Path == "/octo_api/v1/resource/batch_get" {
			batches = append(batches, len(request.Body["resource_ids"].([]any)))
		}
	}
	if fmt.Sprint(batches) != "[80 80 10]" {
		t.Fatalf("resource batch sizes = %v, want [80 80 10]", batches)
	}
	if _, err := svc.ImportJimeng("user-2", "canvas-1", jimengTestProjectID); err == nil {
		t.Fatal("importing into another user's canvas must fail")
	}
	if _, err := svc.ImportJimeng("user-1", "canvas-1", "not-a-project-id"); err == nil || !strings.Contains(err.Error(), "格式无效") {
		t.Fatalf("invalid project id error = %v", err)
	}
	// 新建后尚未同步到云端的画布在服务端没有记录，要给出可操作的提示。
	_, err = svc.ImportJimeng("user-1", "canvas-unsynced", jimengTestProjectID)
	var appErr *kernel.AppError
	if !errors.As(err, &appErr) || !strings.Contains(appErr.Message, "尚未同步到云端") {
		t.Fatalf("unsynced canvas error = %v, want a not-found hint", err)
	}
}

func TestImportJimengSurfacesShareAndUpstreamFailures(t *testing.T) {
	responses := map[string]struct {
		status int
		body   string
	}{
		"share": {status: http.StatusOK, body: `{"ret":"3","errmsg":"login is required"}`},
		"http":  {status: http.StatusInternalServerError, body: `oops`},
	}
	for name, response := range responses {
		t.Run(name, func(t *testing.T) {
			newJimengFakeAPI(t, jimengTestDraftJSON, func(string, map[string]any) (int, string) {
				return response.status, response.body
			})
			_, err := newJimengTestService(t).ImportJimeng("user-1", "canvas-1", jimengTestProjectID)
			var appErr *kernel.AppError
			if !errors.As(err, &appErr) {
				t.Fatalf("error = %v, want *kernel.AppError", err)
			}
			want := "未公开分享"
			if name == "http" {
				want = "HTTP 500"
			}
			if !strings.Contains(appErr.Message, want) {
				t.Fatalf("error message = %q, want it to contain %q", appErr.Message, want)
			}
		})
	}
}

func TestResolveJimengMediaDeduplicatesAndReportsMissing(t *testing.T) {
	_, requests := newJimengFakeAPI(t, jimengTestDraftJSON, nil)
	svc := newJimengTestService(t)
	first := "aaaaaaaa-0000-4000-8000-000000000000"
	second := "bbbbbbbb-0000-4000-8000-000000000000"

	resolved, err := svc.ResolveJimengMedia("user-1", "canvas-1", jimengTestProjectID, []string{strings.ToUpper(first), second, " " + first + " "})
	if err != nil {
		t.Fatalf("ResolveJimengMedia() error = %v", err)
	}
	if len(resolved) != 2 || len((*requests)) != 1 {
		t.Fatalf("resolved = %#v, requests = %d", resolved, len(*requests))
	}
	if resolved[0].Media == nil || resolved[0].Media.Kind != "image" || resolved[0].Media.URL == "" {
		t.Fatalf("first media = %#v", resolved[0])
	}
	if _, err := svc.ResolveJimengMedia("user-1", "canvas-1", jimengTestProjectID, []string{"not-a-resource-id"}); err == nil {
		t.Fatal("invalid resource id must fail")
	}
	if _, err := svc.ResolveJimengMedia("user-2", "canvas-1", jimengTestProjectID, []string{first, second}); err == nil {
		t.Fatal("resolving for another user's canvas must fail")
	}
}

// 画布保存会扫描文档里名为 resourceId 等的字段并当作影策资源校验。即梦素材 ID 写进节点
// 元数据时不能占用这些名字，否则整张画布都会被判定为引用了不存在的资源而无法保存。
func TestJimengImportMetadataIsNotMistakenForCanvasResource(t *testing.T) {
	const jimengResourceID = "e8f95c27-3fc3-5b0a-97f6-df111e82dcbb"
	const canvasResourceID = "5c4f2f6c2a6b4f6e9d0d6a5b3f1c2d3e"
	metadata := JimengImportMetadata{
		Provider:   "jimeng",
		ProjectID:  jimengTestProjectID,
		NodeID:     "node-1",
		ResourceID: jimengResourceID,
		BatchID:    "jimeng-batch",
		SourceType: "uploaded",
		ExpiresAt:  time.Unix(jimengTestExpiresAt, 0),
	}
	encoded, err := json.Marshal(metadata)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(encoded, &fields); err != nil {
		t.Fatal(err)
	}
	if _, reserved := fields["resourceId"]; reserved {
		t.Fatalf("import source must not use the reserved key resourceId: %s", encoded)
	}
	if fields["mediaResourceId"] != jimengResourceID {
		t.Fatalf("import source = %s", encoded)
	}

	document, err := json.Marshal(map[string]any{"nodes": []any{map[string]any{
		"id": "jimeng-jimeng-batch-node-1",
		"metadata": map[string]any{
			"content":      "/api/resources/" + canvasResourceID + "/file",
			"storageKey":   "resource:" + canvasResourceID,
			"importSource": metadata,
		},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	references, err := assets.CollectDocumentResourceReferences(string(document))
	if err != nil {
		t.Fatal(err)
	}
	// content 与 storageKey 指向同一个影策资源；即梦素材 ID 不应出现在引用里。
	if len(references) == 0 {
		t.Fatal("canvas resource references = none, want the hosting resource")
	}
	for _, reference := range references {
		if reference.ResourceID != canvasResourceID {
			t.Fatalf("canvas resource reference = %#v, want only the hosting resource %s", reference, canvasResourceID)
		}
	}
}
