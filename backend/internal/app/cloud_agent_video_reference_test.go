package app

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"yingce/backend/internal/model"
)

func TestCloudAgentVideoSourceValidationOnlyChecksRetainedFrames(t *testing.T) {
	s, db := cloudAgentVideoFixture(t)
	req := agentTestRequest()
	state := cloudAgentRuntime{Request: req}
	result, err := s.prepareCloudAgentVideoInspection(context.Background(), "user", "agent-canvas", &state, cloudAgentVideoCall(t, nil))
	if err != nil {
		t.Fatal(err)
	}
	oldFrames := result.(cloudAgentImageInspectionBatch).Inspections
	canvas, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
	if err != nil {
		t.Fatal(err)
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	// 用户删去旧视频节点后转看普通图片，旧帧仍可能暂留在最近几轮历史中。
	nodes := make([]map[string]any, 0)
	for _, node := range creationMaps(doc["nodes"]) {
		if stringValue(node["id"]) != "clip" {
			nodes = append(nodes, node)
		}
	}
	doc["nodes"] = nodes
	raw, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CanvasProject{}).Where("id = ?", "agent-canvas").Update("payload_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	current := []cloudAgentImageInspection{cloudAgentPairingInspection("cat", "resource:ref-one"), cloudAgentPairingInspection("hero", "resource:ref-two")}
	for count := 0; count <= 2; count++ {
		t.Run(fmt.Sprintf("new_pictures_%d", count), func(t *testing.T) {
			messages := []map[string]any{
				{"role": "user", "content": cloudAgentImageContentParts(oldFrames...)},
				{"role": "user", "content": cloudAgentImageContentParts(current[:count]...)},
			}
			canonical := canonicalAgentRequest{Messages: messages}
			refs, err := s.cloudAgentPiStepImageReferences("user", req, &canonical)
			if count < 2 {
				if err == nil {
					t.Fatal("仍会发送的旧视频帧必须拒绝失效来源")
				}
			} else {
				if err != nil {
					t.Fatalf("已裁掉的旧视频帧不应阻断新图片: %v", err)
				}
				if len(refs) != 2 || refs[0].StorageKey != "resource:ref-one" || refs[1].StorageKey != "resource:ref-two" {
					t.Fatalf("请求未仅引用新图片: %#v", refs)
				}
			}
			if cloudAgentCanonicalImageCount(messages) != 2+count {
				t.Fatal("请求裁剪修改了调用方的完整历史")
			}
		})
	}
}
