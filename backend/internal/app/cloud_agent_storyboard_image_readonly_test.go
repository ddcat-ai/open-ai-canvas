package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"yingce/backend/internal/model"

	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCloudAgentApprovalReadonlyLivePreparation(t *testing.T) {
	path, runID := os.Getenv("CANVAS_TEST_APPROVAL_DB"), os.Getenv("CANVAS_TEST_APPROVAL_RUN")
	if path == "" || runID == "" {
		t.Skip("仅显式指定数据库和运行记录时执行只读审批检查")
	}
	if !filepath.IsAbs(path) {
		t.Fatal("必须指定数据库绝对路径")
	}
	db, err := gorm.Open(sqlite.Open("file:"+filepath.ToSlash(path)+"?mode=ro&_query_only=1&_busy_timeout=5000"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	var run model.CloudAgentExecution
	if err := db.Where("id = ?", runID).First(&run).Error; err != nil {
		t.Fatal(err)
	}
	repo := repository.New(db)
	loaded, err := repo.CloudAgent(run.UserID, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	run = *loaded
	state, err := cloudAgentDecode(&run)
	if err != nil || state.Approval == nil {
		t.Fatalf("缺少审批: %v", err)
	}
	service := &Service{repo: repo, dataDir: filepath.Dir(path)}
	call := state.Approval.Call
	var original cloudAgentMediaArgs
	if err := json.Unmarshal([]byte(call.Function.Arguments), &original); err != nil {
		t.Fatal(err)
	}
	canvas, err := repo.CanvasProjectForUser(run.UserID, state.Request.CanvasID)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := cloudAgentMediaDependencyHash(doc, original)
	if err != nil {
		t.Fatal(err)
	}
	if hash != state.Approval.Prepared.DependencyHash {
		t.Fatal("当前审批依赖仍不匹配")
	}
	_, _, err = service.prepareCloudAgentMedia(&run, &state, call)
	if err != nil {
		t.Fatalf("原审批准备失败: %v", err)
	}
	var args cloudAgentMediaArgs
	if err := json.Unmarshal([]byte(call.Function.Arguments), &args); err != nil {
		t.Fatal(err)
	}
	args.Size, args.Quality = "3840x2160", "high"
	raw, _ := json.Marshal(args)
	call.Function.Arguments = string(raw)
	editedApproval := *state.Approval
	editedApproval.CallHash = cloudAgentApprovalCallHash(call)
	state.Approval = &editedApproval
	request, _, err := service.prepareCloudAgentMedia(&run, &state, call)
	if err != nil {
		t.Fatalf("修改画幅后的准备失败: %v", err)
	}
	request.creationPrepare = &creationTaskPreparation{}
	task, err := service.CreateTask(run.UserID, request)
	if err != nil {
		t.Fatalf("修改规格的只读准入失败: %v", err)
	}
	var resolved struct {
		Config map[string]any `json:"config"`
	}
	if err := json.Unmarshal([]byte(task.InputJSON), &resolved); err != nil {
		t.Fatal(err)
	}
	requested, _ := request.Input["config"].(map[string]any)
	if err := validateCloudAgentResolvedMediaOptions(requested, resolved.Config); err != nil {
		t.Fatal(err)
	}
	t.Log("当前审批修改规格只读准备通过，未记录决定、未提交生成")
}

func TestCloudAgentStoryboardImageReadonlyLivePreparation(t *testing.T) {
	path := os.Getenv("CANVAS_TEST_STORYBOARD_DB")
	if path == "" {
		t.Skip("仅显式指定数据库时执行当前画布只读准备验证")
	}
	userID, canvasID, rowID := os.Getenv("CANVAS_TEST_STORYBOARD_USER"), os.Getenv("CANVAS_TEST_STORYBOARD_CANVAS"), os.Getenv("CANVAS_TEST_STORYBOARD_ROW")
	scriptID := os.Getenv("CANVAS_TEST_STORYBOARD_SCRIPT")
	if !filepath.IsAbs(path) || userID == "" || canvasID == "" || rowID == "" || scriptID == "" {
		t.Fatal("只读验证必须明确数据库绝对路径、用户、画布、分镜节点和镜头行")
	}
	var references []cloudAgentStoryboardImageBinding
	if err := json.Unmarshal([]byte(os.Getenv("CANVAS_TEST_STORYBOARD_REFERENCES")), &references); err != nil || len(references) == 0 {
		t.Fatal("只读验证必须指定已核实的真实参考节点及职责")
	}
	db, err := gorm.Open(sqlite.Open("file:"+filepath.ToSlash(path)+"?mode=ro&_query_only=1&_busy_timeout=5000"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	repo := repository.New(db)
	permissions, err := (&Service{repo: repo}).buildPermissionsConfig(userID, canvasID, "auto")
	if err != nil || permissions["canWriteCanvas"] != true || permissions["canManageRelations"] != true {
		t.Fatalf("当前画布实际权限未正确下发: %v", err)
	}
	canvas, err := repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		t.Fatal(err)
	}
	before := canvas.PayloadJSON
	doc, err := creationDocument(before)
	if err != nil {
		t.Fatal(err)
	}
	args := cloudAgentStoryboardImageArgs{NodeID: scriptID, RowID: rowID, SnapshotHash: cloudAgentNodeHash(doc, scriptID), ReferenceBindings: references}
	plan, result, err := prepareCloudAgentStoryboardImage(repo, userID, canvasID, cloudAgentStoryboardCall(t, "canvas_prepare_storyboard_image", "readonly-live-prepare", args))
	if err != nil {
		t.Fatal(err)
	}
	if result["submitted"] != false || len(result["referenceNodeIds"].([]string)) < len(references) {
		t.Fatal("只读准备遗漏了明确参考或误称已提交生成")
	}
	imageID := result["imageNodeId"].(string)
	media := cloudAgentMediaArgs{Mode: "image", NodeID: imageID, ReferenceNodeIDs: result["referenceNodeIds"].([]string)}
	if err := validateCloudAgentStoryboardImageInputs(plan.Document, media); err != nil {
		t.Fatal(err)
	}
	_, row, err := cloudAgentStoryboardImageSource(plan.Document, imageID)
	if err != nil || row == nil || stringValue(row["id"]) != rowID {
		t.Fatalf("真实镜头的准备计划没有正确输出关联: %v", err)
	}
	if protectedID := os.Getenv("CANVAS_TEST_STORYBOARD_PROTECTED_IMAGE"); protectedID != "" {
		protected := args
		protected.ImageNodeID, protected.ImageSnapshotHash = protectedID, cloudAgentNodeHash(doc, protectedID)
		_, _, err := prepareCloudAgentStoryboardImage(repo, userID, canvasID, cloudAgentStoryboardCall(t, "canvas_prepare_storyboard_image", "readonly-protected-image", protected))
		admission, ok := err.(*cloudAgentMediaAdmissionError)
		if !ok || admission.Reason != "task_bound" {
			t.Fatalf("真实旧任务保护被绕过或缺少明确原因: %v", err)
		}
	}
	after, err := repo.CanvasProjectForUser(userID, canvasID)
	if err != nil || after.PayloadJSON != before {
		t.Fatal("只读准备意外改变了真实画布")
	}
	t.Logf("真实行级准备通过，%d个图片参考，未保存画布、未提交任务", len(media.ReferenceNodeIDs))
}
