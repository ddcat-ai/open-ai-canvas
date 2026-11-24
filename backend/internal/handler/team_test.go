package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestTeamWorkspaceRoutesWithIndependentSessions(t *testing.T) {
	dir := t.TempDir()
	db, err := database.Open(database.Config{Driver: "sqlite", DSN: filepath.Join(dir, "team.db") + "?_busy_timeout=5000&_journal_mode=WAL"})
	if err != nil {
		t.Fatal(err)
	}
	verifyTeamSessionRoutes(t, db, dir)
}

func TestTeamWorkspaceRoutesPostgres(t *testing.T) {
	dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("CANVAS_TEST_POSTGRES_DSN is not configured")
	}
	admin, err := database.Open(database.Config{Driver: "postgres", DSN: dsn})
	if err != nil {
		t.Fatal(err)
	}
	connection, err := admin.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close() })
	schema := fmt.Sprintf("team_workspace_http_%d", time.Now().UnixNano())
	if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error; err != nil {
			t.Error(err)
		}
	})
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := u.Query()
	query.Set("search_path", schema)
	u.RawQuery = query.Encode()
	db, err := database.Open(database.Config{Driver: "postgres", DSN: u.String()})
	if err != nil {
		t.Fatal(err)
	}
	verifyTeamSessionRoutes(t, db, t.TempDir())
}

func verifyTeamSessionRoutes(t *testing.T, db *gorm.DB, dir string) {
	t.Helper()
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err = database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), dir)
	ConfigureRuntime(svc)
	t.Cleanup(func() { ConfigureRuntime(nil); svc.Close() })
	router := gin.New()
	api := router.Group("/api")
	RegisterTeamWorkspaceRoutes(api, svc)
	RegisterUserDataRoutes(api, svc)
	RegisterFeatureAvailabilityRoutes(api, svc)
	cookies := map[string]string{}
	for _, id := range []string{"team-test-owner", "team-test-member", "team-test-stranger"} {
		user := model.User{ID: id, Username: id, DisplayName: "相同昵称", Role: model.UserRoleUser, Status: model.UserStatusActive}
		if id == "team-test-owner" {
			user.Role = model.UserRoleAdmin
		}
		if err = db.Create(&user).Error; err != nil {
			t.Fatal(err)
		}
		session := model.AuthSession{ID: id, UserID: id, TokenHash: auth.HashToken("team-test-session"), ExpiresAt: time.Now().Add(time.Hour)}
		if err = db.Create(&session).Error; err != nil {
			t.Fatal(err)
		}
		cookies[id] = id + ".team-test-session"
	}
	owner, member, other := "team-test-owner", "team-test-member", "team-test-stranger"
	call := func(user, method, path string, body any, status int, data any) {
		t.Helper()
		var raw string
		if body != nil {
			b, e := json.Marshal(body)
			if e != nil {
				t.Fatal(e)
			}
			raw = string(b)
		}
		rec := profileRequest(router, method, "/api"+path, raw, cookies[user])
		if rec.Code != status {
			t.Fatalf("%s %s as %s: got %d want %d: %s", method, path, user, rec.Code, status, rec.Body.String())
		}
		var envelope struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		if e := json.Unmarshal(rec.Body.Bytes(), &envelope); e != nil {
			t.Fatal(e)
		}
		if (envelope.Code == 0) != (status == 200) {
			t.Fatalf("unexpected envelope: %s", rec.Body.String())
		}
		if data != nil {
			if e := json.Unmarshal(envelope.Data, data); e != nil {
				t.Fatal(e)
			}
		}
	}
	call("", http.MethodGet, "/teams", nil, 401, nil)
	call(owner, "GET", "/teams/credit-overview", nil, 403, nil)
	call(owner, "POST", "/teams", gin.H{"name": "不可创建"}, 403, nil)
	call(member, "PATCH", "/admin/settings/features", gin.H{"teamsEnabled": true}, 403, nil)
	call(owner, "PATCH", "/admin/settings/features", gin.H{"teamsEnabled": true}, 200, nil)
	var team repository.TeamSummary
	call(owner, "POST", "/teams", gin.H{"name": "  协作组  "}, 200, &team)
	if team.Name != "协作组" || team.Role != model.TeamOwner || team.MembershipID == "" {
		t.Fatal(team)
	}
	base := "/teams/" + team.ID
	var candidates []repository.TeamInviteCandidate
	call(owner, "GET", base+"/invite-candidates?q=%E7%9B%B8%E5%90%8C", nil, 200, &candidates)
	if len(candidates) != 2 {
		t.Fatalf("same-name candidates: %+v", candidates)
	}
	call(other, "GET", base+"/members", nil, 403, nil)
	invite := func(target string) repository.TeamInvitationView {
		t.Helper()
		var inv repository.TeamInvitationView
		call(owner, "POST", base+"/invitations", gin.H{"inviteeUserId": target}, 200, &inv)
		return inv
	}
	first := invite(member)
	if duplicate := invite(member); first.ID != duplicate.ID || first.TeamName != team.Name {
		t.Fatalf("duplicate invite %v vs %v", first, duplicate)
	}
	var inbox []repository.TeamInvitationView
	call(member, "GET", "/team-invitations", nil, 200, &inbox)
	if len(inbox) != 1 || inbox[0].ID != first.ID {
		t.Fatal(inbox)
	}
	call(other, "POST", "/team-invitations/"+first.ID+"/accept", nil, 404, nil)
	call(member, "POST", "/team-invitations/"+first.ID+"/reject", nil, 200, nil)
	call(member, "POST", "/team-invitations/"+first.ID+"/accept", nil, 409, nil)
	second := invite(member)
	call(owner, "POST", base+"/invitations/"+second.ID+"/revoke", nil, 200, nil)
	call(member, "POST", "/team-invitations/"+second.ID+"/accept", nil, 409, nil)
	third := invite(member)
	accept := "/team-invitations/" + third.ID + "/accept"
	call(member, "POST", accept, nil, 200, nil)
	call(member, "POST", accept, nil, 200, nil)
	var spaces []repository.TeamSummary
	call(member, "GET", "/teams", nil, 200, &spaces)
	if len(spaces) != 1 || spaces[0].ID != team.ID || spaces[0].Role != model.TeamMember {
		t.Fatal(spaces)
	}
	call(member, "POST", base+"/invitations", gin.H{"inviteeUserId": other}, 403, nil)
	if _, err := repository.New(db).AdjustCredits(owner, owner, 10_000_000, "测试团队转入"); err != nil {
		t.Fatal(err)
	}
	fund := gin.H{"amountMicrocredits": 8_000_000, "idempotencyKey": "team-fund"}
	call(owner, "POST", base+"/wallet/fund", fund, 200, nil)
	call(owner, "POST", base+"/wallet/fund", fund, 200, nil)
	allocate := gin.H{"amountMicrocredits": 3_000_000, "idempotencyKey": "assign-member"}
	allocatePath := base + "/members/" + spaces[0].MembershipID + "/allocate"
	call(member, "POST", allocatePath, allocate, 403, nil)
	call(owner, "POST", allocatePath, allocate, 200, nil)
	var memberWallet repository.TeamWalletView
	call(member, "GET", base+"/wallet", nil, 200, &memberWallet)
	if memberWallet.Pool != nil || len(memberWallet.Members) != 0 || memberWallet.MyAccount.AvailableMicrocredits != 3_000_000 {
		t.Fatalf("member wallet: %+v", memberWallet)
	}
	source := model.Asset{ID: "member-script-source", UserID: member, Kind: "text", Title: "分镜设定", Status: model.AssetVersionStatusDraft, PayloadJSON: `{"data":{"content":"图书馆。内景。"}}`}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	var publication service.PublishTeamAssetsResult
	call(member, "POST", base+"/asset-publications", gin.H{"assetIds": []string{source.ID}, "idempotencyKey": "share-script"}, 200, &publication)
	if len(publication.Results) != 1 || publication.Results[0].Asset == nil {
		t.Fatalf("publish result: %+v", publication)
	}
	shared := publication.Results[0].Asset
	workspace := base + "/workspace"
	call(other, "GET", workspace+"/assets/"+shared.ID, nil, 403, nil)
	call(member, "GET", "/assets/"+shared.ID, nil, 404, nil)
	canvasPath := workspace + "/canvas-projects/shared-story"
	call(owner, "PATCH", canvasPath+"/operations", gin.H{"mutationId": "create", "operations": []gin.H{{"type": "create_canvas", "id": "shared-story", "patch": gin.H{"title": "第一稿"}}}}, 200, nil)
	call(other, "GET", canvasPath, nil, 403, nil)
	call(member, "GET", "/canvas-projects/shared-story", nil, 404, nil)
	save := gin.H{"mutationId": "connect", "operations": []gin.H{
		{"type": "create_node", "node": gin.H{"id": "note", "type": "text", "metadata": gin.H{"assetId": shared.ID, "content": "剧本摘要"}}},
		{"type": "create_node", "node": gin.H{"id": "end", "type": "text", "metadata": gin.H{"content": "结尾"}}},
		{"type": "create_connection", "connection": gin.H{"id": "link", "fromNodeId": "note", "toNodeId": "end"}},
	}}
	call(member, "PATCH", canvasPath+"/operations", save, 200, nil)
	verifyWorkspaceAssetLifecycle(t, db, call, team.ID, owner, member, source.ID)
	call(other, "GET", workspace+"/tasks", nil, 403, nil)
	call(owner, "POST", base+"/leave", nil, 409, nil)
	call(owner, "DELETE", base+"/members/"+spaces[0].MembershipID, nil, 200, nil)
	call(member, "PATCH", canvasPath+"/operations", save, 403, nil)
	call(member, "GET", canvasPath, nil, 403, nil)
	call(member, "GET", workspace+"/assets/"+shared.ID, nil, 403, nil)
	call(member, "GET", workspace+"/tasks/foreign/text-events", nil, 403, nil)
	var ownerWallet repository.TeamWalletView
	call(owner, "GET", base+"/wallet", nil, 200, &ownerWallet)
	if ownerWallet.Pool == nil || ownerWallet.Pool.AvailableMicrocredits != 8_000_000 {
		t.Fatalf("exit did not return member funds: %+v", ownerWallet)
	}
	if err := db.Delete(&source).Error; err != nil {
		t.Fatal(err)
	}
	var retained struct {
		Asset struct {
			Data             struct{ Content string }
			PrimaryVersionID string
		}
	}
	call(owner, "GET", workspace+"/assets/"+shared.ID, nil, 200, &retained)
	if retained.Asset.Data.Content != "图书馆。内景。" || retained.Asset.PrimaryVersionID != shared.PrimaryVersionID {
		t.Fatalf("team lost its copy: %+v", retained)
	}
	var fetched struct {
		Project struct {
			Nodes       []gin.H
			Connections []struct{ FromNodeID, ToNodeID string }
		}
	}
	call(owner, "GET", canvasPath, nil, 200, &fetched)
	if len(fetched.Project.Nodes) != 2 || len(fetched.Project.Connections) != 1 || fetched.Project.Connections[0].ToNodeID != "end" {
		t.Fatal(fetched)
	}
	invExpired := invite(member)
	if err = db.Model(&model.TeamInvitation{}).Where("id = ?", invExpired.ID).Update("expires_at", time.Now().Add(-time.Hour)).Error; err != nil {
		t.Fatal(err)
	}
	call(member, "POST", "/team-invitations/"+invExpired.ID+"/accept", nil, 409, nil)
	invRace := invite(member)
	out := make(chan int, 2)
	for _, path := range []string{"/team-invitations/" + invRace.ID + "/accept", base + "/invitations/" + invRace.ID + "/revoke"} {
		who := member
		if strings.HasSuffix(path, "/revoke") {
			who = owner
		}
		go func() { resp := profileRequest(router, "POST", "/api"+path, "", cookies[who]); out <- resp.Code }()
	}
	a, b := <-out, <-out
	if !((a == 200 && b == 409) || (b == 200 && a == 409)) {
		t.Fatalf("accept/revoke outcomes = %d,%d", a, b)
	}
	verifyCompanyCreditScopes(t, call, owner, other, member)
}

func verifyWorkspaceAssetLifecycle(t *testing.T, db *gorm.DB, call func(string, string, string, any, int, any), teamID, owner, member, personalID string) {
	t.Helper()
	base := "/teams/" + teamID + "/workspace"
	put := func(actor, id, status string, want int) {
		t.Helper()
		call(actor, "PUT", base+"/assets/"+id, gin.H{"asset": gin.H{"id": id, "kind": "text", "title": "参考剧本", "coverUrl": "", "tags": []string{}, "data": gin.H{"content": "开场"}, "status": status}}, want, nil)
	}
	const id = "member-text-asset"
	put(member, id, "confirmed", 200)
	put(owner, id, "confirmed", 200)
	asset, err := repository.New(db).AssetForUser(model.TeamContentKey(teamID), id)
	if err != nil || asset.CreatedBy != member {
		t.Fatalf("missing contributor: %+v, %v", asset, err)
	}
	put(owner, "owned-by-owner", "confirmed", 200)
	put(member, "owned-by-owner", "archived", 403)
	board := base + "/canvas-projects/text-board"
	ops := func(key string, want int, operations ...gin.H) {
		t.Helper()
		call(member, "PATCH", board+"/operations", gin.H{"mutationId": key, "operations": operations}, want, nil)
	}
	node := func(nodeID, assetID string) gin.H {
		return gin.H{"type": "create_node", "node": gin.H{"id": nodeID, "type": "text", "metadata": gin.H{"assetId": assetID, "content": "开场"}}}
	}
	ops("foreign-project", 400, gin.H{"type": "create_canvas", "patch": gin.H{"projectId": "personal"}})
	ops("create-text", 200, gin.H{"type": "create_canvas", "patch": gin.H{"title": "引用"}}, node("existing", id))
	ops("foreign-asset", 400, node("foreign", personalID))
	conversation := base + "/creation-conversations/scene/sync"
	message := gin.H{"id": "message", "role": "user", "createdAt": time.Now().UTC().Format(time.RFC3339Nano), "content": "剧本", "references": []gin.H{{"assetId": id}}}
	call(member, "POST", conversation, gin.H{"metadata": gin.H{"title": "创作历史"}, "messages": []gin.H{{"id": "message", "data": message}}}, 200, nil)
	put(member, id, "archived", 200)
	call(member, "DELETE", base+"/assets/"+id, nil, 403, nil)
	call(owner, "DELETE", base+"/assets/"+id, nil, 409, nil)
	ops("edit-existing", 200, gin.H{"type": "patch_node", "id": "existing", "before": gin.H{"metadata.content": "开场"}, "patch": gin.H{"metadata.content": "改稿"}})
	ops("new-archived-binding", 409, node("new", id))
	if err := db.Create(&model.CanvasSnapshot{ID: "retained-binding", CanvasID: "text-board", UserID: model.TeamContentKey(teamID), Revision: 2, PayloadJSON: `{"nodes":[{"metadata":{"assetId":"member-text-asset"}}]}`}).Error; err != nil {
		t.Fatal(err)
	}
	ops("unbind", 200, gin.H{"type": "patch_node", "id": "existing", "before": gin.H{"metadata.assetId": id}, "patch": gin.H{"metadata.assetId": nil}})
	call(owner, "DELETE", base+"/assets/"+id, nil, 409, nil)
	call(owner, "DELETE", board, nil, 200, nil)
	call(owner, "DELETE", base+"/assets/"+id, nil, 409, nil)
	call(member, "POST", conversation, gin.H{"delete": true}, 200, nil)
	call(owner, "DELETE", base+"/assets/"+id, nil, 200, nil)
}

func verifyCompanyCreditScopes(t *testing.T, call func(string, string, string, any, int, any), owner, member, outsider string) {
	t.Helper()
	overview := func(user string) repository.SpaceCreditOverview {
		t.Helper()
		var result repository.SpaceCreditOverview
		call(user, "GET", "/teams/credit-overview", nil, 200, &result)
		return result
	}
	if fresh := overview(member); fresh.Spaces == nil || len(fresh.Spaces) != 0 || fresh.Personal.AvailableMicrocredits != 0 {
		t.Fatalf("expected personal-only overview: %+v", fresh)
	}
	create := func(path, name string) repository.TeamSummary {
		t.Helper()
		var space repository.TeamSummary
		call(owner, "POST", path, gin.H{"name": name}, 200, &space)
		return space
	}
	company := create("/teams", "北岸公司")
	second := create("/teams", "南岸公司")
	base := "/teams/" + company.ID
	group := create(base+"/groups", "剪辑组")
	groupBase := "/teams/" + group.ID
	pendingGroup := create(base+"/groups", "摄影组")
	if group.ParentID != company.ID || group.ParentName != company.Name {
		t.Fatalf("created group lost its company: %+v", group)
	}
	call(owner, "POST", groupBase+"/groups", gin.H{"name": "嵌套小组"}, 400, nil)
	invite := func(space repository.TeamSummary) repository.TeamInvitationView {
		t.Helper()
		var result repository.TeamInvitationView
		call(owner, "POST", "/teams/"+space.ID+"/invitations", gin.H{"inviteeUserId": member}, 200, &result)
		return result
	}
	join := func(space repository.TeamSummary) repository.TeamSummary {
		t.Helper()
		i := invite(space)
		if i.ParentName != space.ParentName {
			t.Fatalf("ambiguous invitation: %+v", i)
		}
		call(member, "POST", "/team-invitations/"+i.ID+"/accept", nil, 200, nil)
		var joined repository.TeamSummary
		call(member, "GET", "/teams/"+space.ID, nil, 200, &joined)
		return joined
	}
	call(owner, "POST", groupBase+"/invitations", gin.H{"inviteeUserId": member}, 409, nil)
	companyMember := join(company)
	join(second)
	call(member, "GET", groupBase+"/workspace/assets", nil, 403, nil)
	call(member, "POST", base+"/groups", gin.H{"name": "无权限"}, 403, nil)
	var candidates []repository.TeamInviteCandidate
	call(owner, "GET", groupBase+"/invite-candidates?q="+url.QueryEscape("相同昵称"), nil, 200, &candidates)
	if len(candidates) != 1 || candidates[0].ID != member {
		t.Fatalf("outside company: %+v", candidates)
	}
	groupMember := join(group)
	pending := invite(pendingGroup)
	move := func(path, key string, amount int64, status int) {
		t.Helper()
		call(owner, "POST", path, gin.H{"idempotencyKey": key, "amountMicrocredits": amount}, status, nil)
	}
	move(base+"/wallet/fund", "company-fund", 2_000_000, 200)
	move(groupBase+"/wallet/fund", "group-too-much", 2_000_001, 409)
	move(groupBase+"/wallet/fund", "group-fund", 1_500_000, 200)
	move(groupBase+"/wallet/fund", "group-fund", 1_500_000, 200)
	move(groupBase+"/wallet/withdraw", "group-return", 200_000, 200)
	move(groupBase+"/members/"+groupMember.MembershipID+"/allocate", "group-assign", 1_100_000, 200)
	move(base+"/members/"+companyMember.MembershipID+"/allocate", "company-assign", 600_000, 200)
	var got = overview(member)
	if got.Personal.AvailableMicrocredits != 0 || len(got.Spaces) != 3 {
		t.Fatalf("unexpected balances: %+v", got)
	}
	byID := map[string]repository.TeamSpaceCredit{}
	for _, row := range got.Spaces {
		byID[row.TeamID] = row
	}
	if a, b := byID[company.ID], byID[group.ID]; a.AvailableMicrocredits != 600_000 || a.PoolAvailableMicrocredits != 100_000 || b.AvailableMicrocredits != 1_100_000 || b.PoolAvailableMicrocredits != 200_000 || b.ParentName != company.Name || b.Role != model.TeamMember || byID[second.ID].Name != second.Name {
		t.Fatalf("pooled or incorrect member balances: %+v", got)
	}
	if overview(owner).Personal.AvailableMicrocredits != 0 {
		t.Fatal("group transfer charged owner's personal wallet")
	}
	for _, space := range overview(outsider).Spaces {
		if space.TeamID == company.ID || space.TeamID == group.ID {
			t.Fatal("foreign space leaked")
		}
	}
	var ledger struct{ Entries []model.CreditLedgerEntry }
	for _, scope := range []struct {
		team  string
		delta int64
	}{{company.ID, -1_500_000}, {group.ID, 1_500_000}} {
		call(owner, "GET", "/teams/"+scope.team+"/wallet/ledger", nil, 200, &ledger)
		matches := 0
		for _, entry := range ledger.Entries {
			if entry.Note == "group_fund" {
				matches++
				if entry.AvailableDeltaMicrocredits != scope.delta || entry.AccountID != model.TeamPoolCreditAccountID(scope.team) {
					t.Fatal(entry)
				}
			}
		}
		if matches != 1 {
			t.Fatalf("expected one in-scope ledger leg: %+v", ledger)
		}
	}
	call(member, "GET", groupBase+"/wallet/ledger", nil, 200, &ledger)
	if len(ledger.Entries) != 1 || ledger.Entries[0].MembershipID != groupMember.MembershipID {
		t.Fatalf("member ledger leaked: %+v", ledger)
	}
	call(owner, "PATCH", "/admin/settings/features", gin.H{"creditsEnabled": false}, 200, nil)
	call(member, "GET", groupBase+"/workspace/canvas-projects", nil, 200, nil)
	call(member, "GET", "/teams/credit-overview", nil, 403, nil)
	call(member, "GET", groupBase+"/wallet", nil, 403, nil)
	call(owner, "PATCH", "/admin/settings/features", gin.H{"creditsEnabled": true, "teamsEnabled": false}, 200, nil)
	for _, path := range []string{"/team-invitations", "/teams", "/teams/credit-overview", groupBase + "/wallet", groupBase + "/workspace/canvas-projects", groupBase + "/workspace/resources/r/file"} {
		call(member, "GET", path, nil, 403, nil)
	}
	call(member, "POST", "/team-invitations/"+pending.ID+"/accept", nil, 403, nil)
	call(member, "POST", groupBase+"/workspace/tasks/quote", gin.H{}, 403, nil)
	call(owner, "PATCH", "/admin/settings/features", gin.H{"teamsEnabled": true}, 200, nil)
	var wallet repository.TeamWalletView
	call(member, "GET", groupBase+"/wallet", nil, 200, &wallet)
	if wallet.MyAccount.AvailableMicrocredits != 1_100_000 || wallet.PoolAvailableMicrocredits != 200_000 || wallet.Pool != nil || wallet.Members != nil {
		t.Fatalf("feature toggle or privacy changed balances: %+v", wallet)
	}
	call(member, "POST", base+"/leave", nil, 200, nil)
	call(member, "POST", "/team-invitations/"+pending.ID+"/accept", nil, 409, nil)
	call(member, "GET", groupBase+"/workspace/canvas-projects", nil, 403, nil)
	if remaining := overview(member); len(remaining.Spaces) != 1 || remaining.Spaces[0].TeamID != second.ID {
		t.Fatalf("cascade crossed a company boundary: %+v", remaining)
	}
	for _, space := range overview(owner).Spaces {
		if (space.TeamID == group.ID && space.PoolAvailableMicrocredits != 1_300_000) || (space.TeamID == company.ID && space.PoolAvailableMicrocredits != 700_000) {
			t.Fatalf("reclaimed to wrong pool: %+v", space)
		}
	}
}
