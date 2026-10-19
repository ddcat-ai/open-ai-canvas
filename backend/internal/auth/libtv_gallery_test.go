package auth

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

const (
	testLibTVTemplateUUID = "11111111111111111111111111111111"
	testLibTVProjectUUID  = "22222222222222222222222222222222"
)

func TestLibTVGalleryQueryValidation(t *testing.T) {
	req, err := normalizeLibTVGalleryRequest(LibTVGalleryRequest{})
	if err != nil || req.Page != 1 || req.PageSize != 20 || req.RequestID == "" {
		t.Fatalf("defaults = %#v, %v", req, err)
	}
	next, err := normalizeLibTVGalleryRequest(LibTVGalleryRequest{Page: 2, RequestID: req.RequestID, Keyword: " 查询 "})
	if err != nil || next.RequestID != req.RequestID || next.Keyword != "查询" {
		t.Fatalf("continuation = %#v, %v", next, err)
	}
	for _, bad := range []LibTVGalleryRequest{
		{Page: -1}, {Page: 1001}, {PageSize: 41}, {PageSize: -1}, {TagID: -1},
		{Keyword: strings.Repeat("字", 101)}, {RequestID: "arbitrary-cookie-value"},
	} {
		if _, err := normalizeLibTVGalleryRequest(bad); err == nil {
			t.Fatalf("accepted invalid request %#v", bad)
		}
	}
	if _, err := New(nil, nil, nil).LibTVGallery(context.Background(), nil, LibTVGalleryRequest{}); err == nil {
		t.Fatal("gallery accepted unauthenticated actor")
	}
}

func TestLibTVPublicResponseRequiresSuccessEnvelopeAndBounds(t *testing.T) {
	for _, tc := range []struct {
		name string
		body string
		code int
		want int
	}{
		{"success", `{"code":0,"data":{"list":[]}}`, 200, 0},
		{"no code", `{"data":{}}`, 200, 502},
		{"business error", `{"code":10050,"data":{}}`, 200, 502},
		{"null data", `{"code":0,"data":null}`, 200, 502},
		{"HTML", `<html>login</html>`, 200, 502},
		{"not found", `{}`, 404, 404},
		{"rate limited", `{}`, 429, 429},
		{"oversized", strings.Repeat(" ", libTVMaxResponseBytes+1), 200, 502},
	} {
		t.Run(tc.name, func(t *testing.T) {
			data, err := readLibTVPublicResponse(&http.Response{StatusCode: tc.code, Body: io.NopCloser(strings.NewReader(tc.body))})
			if tc.want == 0 {
				if err != nil || len(data) == 0 {
					t.Fatalf("valid response = %s, %v", data, err)
				}
				return
			}
			var appErr *kernel.AppError
			if !errors.As(err, &appErr) || appErr.Status != tc.want {
				t.Fatalf("error = %v, want status %d", err, tc.want)
			}
		})
	}
}

func TestLibTVGalleryProjectsApprovedMetadataOnly(t *testing.T) {
	data := json.RawMessage(`{"list":[
		{"templateUuid":"11111111111111111111111111111111","projectUuid":"22222222222222222222222222222222","auditStatus":1,"name":"作品","finalOutput":"https://libtv-res.liblib.art/a.MP4","coverUrl":"https://libtv-res.liblib.art/a.png","nickname":"作者","likeCount":-1,"tags":[{"id":1201,"tagLabel":"短片"}],"ownerId":123,"snapshotData":"private field"},
		{"templateUuid":"33333333333333333333333333333333","auditStatus":0},
		{"templateUuid":"not-a-uuid","auditStatus":1}],"hasMore":true,"total":1}`)
	req, _ := normalizeLibTVGalleryRequest(LibTVGalleryRequest{})
	result, err := decodeLibTVGallery(data, req)
	if err != nil || len(result.Items) != 1 || !result.HasMore {
		t.Fatalf("result = %#v, %v", result, err)
	}
	item := result.Items[0]
	if item.MediaType != "video" || item.LikeCount != 0 || len(item.Tags) != 1 || item.AuthorName != "作者" {
		t.Fatalf("projection = %#v", item)
	}
	encoded, _ := json.Marshal(result)
	if strings.Contains(string(encoded), "ownerId") || strings.Contains(string(encoded), "snapshotData") || strings.Contains(string(encoded), "total") {
		t.Fatalf("private/internal fields leaked: %s", encoded)
	}
	if _, err := decodeLibTVGallery(json.RawMessage(`{"list":[]}`), req); err == nil {
		t.Fatal("accepted changed pagination contract")
	}
	for _, raw := range []string{"http://libtv-res.liblib.art/a.png", "https://127.0.0.1/a.png", "https://libtv-res.liblib.art.evil.invalid/a.png", "https://user:pass@libtv-res.liblib.art/a.png", "https://libtv-res.liblib.art:443/a.png", "data:image/png;base64,AAAA"} {
		if safeLibTVResourceURL(raw) != "" {
			t.Fatalf("accepted non-canonical media host %q", raw)
		}
	}
}

func testLibTVPublishedSnapshot(t *testing.T) (*libTVPublishedTemplate, *libTVTemplateSnapshot) {
	t.Helper()
	work := &libTVPublishedTemplate{TemplateUUID: testLibTVTemplateUUID, ProjectUUID: testLibTVProjectUUID, Name: "测试作品", AuditStatus: 1, SnapshotID: 12}
	var snapshot libTVTemplateSnapshot
	if err := json.Unmarshal([]byte(`{"nodes":[
		{"id":"group","type":"group","position":{"x":100,"y":200},"width":800,"height":700,"data":{"type":"group","name":"场景"}},
		{"id":"nested","type":"group","parentId":"group","position":{"x":20,"y":30},"width":600,"height":500,"data":{"type":"group"}},
		{"id":"image","type":"image","parentId":"nested","position":{"x":4,"y":5},"measured":{"width":200,"height":300},"data":{"type":"image","url":["https://libtv-res.liblib.art/image.png"]},"resourceMeta":{"items":[{"width":1024,"height":1536,"mimeType":"image/png"}]}},
		{"id":"audio","type":"audio","position":{"x":900,"y":50},"data":{"type":"audio","url":["https://libtv-res.liblib.art/audio.mp3"]}},
		{"id":"text","type":"text","position":{"x":1000,"y":80},"data":{"type":"text","text":"故事内容"}},
		{"id":"video","type":"video","position":{"x":1200,"y":80},"data":{"type":"video","url":["https://libtv-res.liblib.art/video.mp4","https://libtv-res.liblib.art/other.mp4"],"params":{"prompt":"{{Mixed 1}}与{{Audio 1}}，缺失{{Image 9}}","model":"source-model","mixedListOrder":["image"],"audioList":[{"nodeId":"audio"}],"settings":{"ratio":"9:16","duration":5,"resolution":"720p"}}},"resourceMeta":{"items":[{"durationSec":5.5,"mimeType":"video/mp4"}]}},
		{"id":"untrusted","type":"image","position":{"x":1300,"y":90},"data":{"type":"image","url":["https://other.invalid/image.png"]}},
		{"id":"unsupported","type":"unknown","position":{"x":10,"y":10},"data":{"type":"unknown"}}
	],"edges":[{"id":"edge","source":"image","target":"video"},{"id":"broken","source":"unsupported","target":"video"}]}`), &snapshot); err != nil {
		t.Fatal(err)
	}
	return work, &snapshot
}

func TestLibTVTemplateMapsHierarchyReferencesAndExternalResources(t *testing.T) {
	work, snapshot := testLibTVPublishedSnapshot(t)
	result := adaptLibTVTemplate(work, snapshot)
	if result.ImportedNodeCount != 7 || result.ImportedConnectionCount != 1 || len(result.SkippedNodes) != 1 || len(result.SkippedConnections) != 1 {
		t.Fatalf("unexpected counts: %#v", result)
	}
	byID := map[string]LibTVCanvasNode{}
	for _, item := range result.Nodes {
		byID[item.Metadata.NodeKey] = item
		if item.Metadata.TemplateUUID != work.TemplateUUID || item.Metadata.SnapshotID != 12 {
			t.Fatalf("lost published provenance: %#v", item.Metadata)
		}
	}
	image, video := byID["image"], byID["video"]
	if image.X != 124 || image.Y != 235 || image.ParentID != byID["nested"].ID || image.Content != "https://libtv-res.liblib.art/image.png" || image.NaturalWidth != 1024 {
		t.Fatalf("child mapping = %#v", image)
	}
	if byID["group"].Type != "frame" || byID["nested"].ParentID != byID["group"].ID || byID["text"].Content != "故事内容" || byID["audio"].MimeType != "audio/mpeg" {
		t.Fatalf("group/text/audio mapping = %#v", byID)
	}
	if !strings.Contains(video.Prompt, "@[node:"+image.ID+"]") || !strings.Contains(video.Prompt, "@[node:"+byID["audio"].ID+"]") || !strings.Contains(video.Prompt, "{{Image 9}}") {
		t.Fatalf("reference rewrite = %q", video.Prompt)
	}
	if video.AspectRatio != "9:16" || video.DurationMs != 5500 || result.MultiResultNodeCount != 1 || result.ConvertedSpecialCount != 2 || result.PlaceholderNodeCount != 1 {
		t.Fatalf("metadata/counts = %#v", result)
	}
	if byID["untrusted"].Content != "" || byID["untrusted"].Status != "idle" {
		t.Fatal("untrusted remote content passed through")
	}
	steps := libTVWorkSteps(snapshot)
	if len(steps) != 5 || steps[3].Prompt != "{{Mixed 1}}与{{Audio 1}}，缺失{{Image 9}}" || steps[3].DurationSeconds != 5 || len(steps[3].ReferenceNodeIDs) != 2 {
		t.Fatalf("process steps = %#v", steps)
	}
	if again := adaptLibTVTemplate(work, snapshot); again.BatchID == result.BatchID {
		t.Fatal("duplicate imports share node IDs")
	}
}

func TestLibTVTemplateRejectsMissingParentsAndCycles(t *testing.T) {
	work, snapshot := testLibTVPublishedSnapshot(t)
	snapshot.Nodes[0].ParentID = "nested"
	result := adaptLibTVTemplate(work, snapshot)
	for _, node := range result.Nodes {
		if node.Metadata.NodeKey == "group" || node.Metadata.NodeKey == "nested" || node.Metadata.NodeKey == "image" {
			t.Fatalf("cyclic hierarchy imported: %#v", node)
		}
	}
	snapshot.Nodes[0].ParentID = "missing"
	if _, ok := libTVTemplateWorldPosition(snapshot.Nodes[0], map[string]libTVTemplateNode{}, map[string]bool{}); ok {
		t.Fatal("missing parent accepted")
	}
}

func TestLibTVPublishedTemplateFailsClosedForUnapprovedOrWrongWork(t *testing.T) {
	work, snapshot := testLibTVPublishedSnapshot(t)
	encodedSnapshot, _ := json.Marshal(snapshot)
	work.SnapshotData = string(encodedSnapshot)
	wrap := func() json.RawMessage {
		body, _ := json.Marshal(map[string]any{"detail": work})
		return body
	}
	if _, got, err := decodeLibTVPublishedTemplate(wrap(), work.TemplateUUID); err != nil || len(got.Nodes) != 8 {
		t.Fatalf("valid public work = %#v, %v", got, err)
	}
	work.AuditStatus = 0
	if _, _, err := decodeLibTVPublishedTemplate(wrap(), work.TemplateUUID); err == nil {
		t.Fatal("unapproved snapshot accepted")
	}
	work.AuditStatus = 1
	if _, _, err := decodeLibTVPublishedTemplate(wrap(), "33333333333333333333333333333333"); err == nil {
		t.Fatal("mismatched template accepted")
	}
	work.SnapshotData = `{"nodes":[],"edges":null}`
	if _, _, err := decodeLibTVPublishedTemplate(wrap(), work.TemplateUUID); err == nil {
		t.Fatal("changed snapshot schema accepted")
	}
}

func TestLibTVTemplateFromPublicSnapshotFile(t *testing.T) {
	file := os.Getenv("LIBTV_PUBLIC_SNAPSHOT_TEST_FILE")
	if file == "" {
		t.Skip("optional read-only upstream snapshot fixture")
	}
	body, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	data, err := readLibTVPublicResponse(&http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(body)))})
	if err != nil {
		t.Fatal(err)
	}
	var value struct {
		Detail libTVPublishedTemplate `json:"detail"`
	}
	if err := json.Unmarshal(data, &value); err != nil {
		t.Fatal(err)
	}
	work, snapshot, err := decodeLibTVPublishedTemplate(data, value.Detail.TemplateUUID)
	if err != nil {
		t.Fatal(err)
	}
	result := adaptLibTVTemplate(work, snapshot)
	if result.ImportedNodeCount != len(snapshot.Nodes) || result.ImportedNodeCount == 0 || len(result.SkippedNodes) != 0 {
		t.Fatalf("actual snapshot adaptation failed: nodes=%d skipped=%#v edges=%#v", result.ImportedNodeCount, result.SkippedNodes, result.SkippedConnections)
	}
	nodeIDs := map[string]bool{}
	for _, raw := range snapshot.Nodes {
		nodeIDs[raw.ID] = true
	}
	validEdges := map[string]bool{}
	for _, raw := range snapshot.Edges {
		if libTVSnapshotNodeID.MatchString(raw.ID) && nodeIDs[raw.Source] && nodeIDs[raw.Target] {
			validEdges[raw.ID] = true
		}
	}
	if result.ImportedConnectionCount != len(validEdges) || len(result.SkippedConnections) != len(snapshot.Edges)-len(validEdges) {
		t.Fatalf("lost valid edges: imported=%d valid=%d skipped=%d", result.ImportedConnectionCount, len(validEdges), len(result.SkippedConnections))
	}
	for _, issue := range result.SkippedConnections {
		if validEdges[issue.ID] {
			t.Fatalf("skipped a valid source edge: %#v", issue)
		}
	}
	t.Logf("public snapshot: %d nodes / %d valid connections / %d invalid connections reported / %d process steps; no binary media requested", result.ImportedNodeCount, result.ImportedConnectionCount, len(result.SkippedConnections), len(libTVWorkSteps(snapshot)))
}

type libTVReadTestHost struct {
	nopHost
	keys []string
}

func (h *libTVReadTestHost) AllowRequest(_ context.Context, key string, limit int, window time.Duration) (bool, error) {
	h.keys = append(h.keys, key)
	return false, nil
}

func TestLibTVPublicReadsRequireActorAndRateLimit(t *testing.T) {
	host := &libTVReadTestHost{}
	svc := New(nil, host, nil)
	for _, actor := range []*model.User{nil, {}, {ID: " "}} {
		if _, err := svc.LibTVGallery(context.Background(), actor, LibTVGalleryRequest{}); err == nil {
			t.Fatal("gallery accepted missing actor")
		}
		if _, err := svc.LibTVWork(context.Background(), actor, testLibTVTemplateUUID); err == nil {
			t.Fatal("detail accepted missing actor")
		}
	}
	if len(host.keys) != 0 {
		t.Fatal("unauthenticated requests reached the public read gate")
	}
	actor := &model.User{ID: "reader"}
	for _, run := range []func() error{
		func() error {
			_, err := svc.LibTVGallery(context.Background(), actor, LibTVGalleryRequest{})
			return err
		},
		func() error { _, err := svc.LibTVWork(context.Background(), actor, testLibTVTemplateUUID); return err },
	} {
		var appErr *kernel.AppError
		if err := run(); !errors.As(err, &appErr) || appErr.Status != http.StatusTooManyRequests {
			t.Fatalf("rate gate returned %v", err)
		}
	}
	if len(host.keys) != 2 || host.keys[0] != "libtv-gallery:reader" || host.keys[1] != host.keys[0] {
		t.Fatalf("read gate keys = %#v", host.keys)
	}
}

func TestLibTVTemplateImportChecksOwnershipBeforePublicRead(t *testing.T) {
	svc, db := newPasswordResetTestService(t)
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.CanvasProject{}); err != nil {
		t.Fatal(err)
	}
	project := &model.CanvasProject{ID: "canvas", UserID: "owner", Title: "Original", PayloadJSON: `{"nodes":[],"connections":[]}`}
	if err := db.Create(project).Error; err != nil {
		t.Fatal(err)
	}
	host := &libTVReadTestHost{}
	svc.host = host
	for _, tc := range []struct{ user, canvas string }{
		{"", project.ID}, {project.UserID, ""}, {"other", project.ID}, {project.UserID, "missing"},
	} {
		if _, err := svc.ImportLibTVTemplate(context.Background(), tc.user, tc.canvas, testLibTVTemplateUUID); err == nil {
			t.Fatalf("accepted inaccessible target: %#v", tc)
		} else if tc.user != "" && tc.canvas != "" && !errors.Is(err, gorm.ErrRecordNotFound) {
			t.Fatalf("unexpected target error: %v", err)
		}
	}
	if _, err := svc.ImportLibTVTemplate(context.Background(), project.UserID, project.ID, "invalid"); err == nil {
		t.Fatal("accepted invalid template UUID")
	}
	if len(host.keys) != 0 {
		t.Fatal("invalid targets reached the public read gate")
	}
	_, err = svc.ImportLibTVTemplate(context.Background(), project.UserID, project.ID, testLibTVTemplateUUID)
	var appErr *kernel.AppError
	if !errors.As(err, &appErr) || appErr.Status != http.StatusTooManyRequests || len(host.keys) != 1 {
		t.Fatalf("owned target must reach read gate: %v, %#v", err, host.keys)
	}
	saved, err := svc.repo.CanvasProjectForUser(project.UserID, project.ID)
	if err != nil || saved.PayloadJSON != project.PayloadJSON || saved.Revision != project.Revision {
		t.Fatalf("template read mutated the target: %#v, %v", saved, err)
	}
}

func TestLibTVPublicRequestPreservesCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := requestLibTVPublic(ctx, http.MethodGet, libTVPublicTemplateURL, nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation became upstream failure: %v", err)
	}
}

func TestLibTVTemplateKeepsValidEdgesAndReportsDanglingOrDuplicateEdges(t *testing.T) {
	work, snapshot := testLibTVPublishedSnapshot(t)
	snapshot.Edges = []libTVTemplateEdge{
		{ID: "valid", Source: "image", Target: "video"},
		{ID: "valid", Source: "audio", Target: "video"},
		{ID: "missing", Source: "image", Target: "deleted-node"},
		{ID: "invalid:id", Source: "image", Target: "video"},
	}
	result := adaptLibTVTemplate(work, snapshot)
	if result.ImportedConnectionCount != 1 || len(result.SkippedConnections) != 3 {
		t.Fatalf("partial connection report = %#v", result)
	}
	nodes := map[string]bool{}
	for _, node := range result.Nodes {
		nodes[node.ID] = true
	}
	for _, edge := range result.Connections {
		if !nodes[edge.FromNodeID] || !nodes[edge.ToNodeID] {
			t.Fatalf("import contains dangling edge: %#v", edge)
		}
	}
}

func TestLibTVTemplatePreservesSelectedResourceIndexAndRejectsInvalidNodes(t *testing.T) {
	work, snapshot := testLibTVPublishedSnapshot(t)
	snapshot.Nodes[2].Data = json.RawMessage(`{"type":"image","url":["https://other.invalid/wrong.png","https://libtv-res.liblib.art/right.png"],"resourceMeta":{"items":[{"width":100,"height":100},{"width":640,"height":360,"mimeType":"image/png"}]}}`)
	snapshot.Nodes[2].ResourceMeta = libTVTemplateResourceMeta{}
	snapshot.Nodes = append(snapshot.Nodes, snapshot.Nodes[2], libTVTemplateNode{ID: "invalid data", Data: json.RawMessage(`{}`)})
	result := adaptLibTVTemplate(work, snapshot)
	if len(result.SkippedNodes) != 3 {
		t.Fatalf("invalid/duplicate node report = %#v", result.SkippedNodes)
	}
	for _, node := range result.Nodes {
		if node.Metadata.NodeKey == "image" && (node.Content != "https://libtv-res.liblib.art/right.png" || node.NaturalWidth != 640 || node.NaturalHeight != 360) {
			t.Fatalf("selected resource metadata = %#v", node)
		}
	}
}
