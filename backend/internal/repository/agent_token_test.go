package repository

import (
	"fmt"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func newAgentTokenTestRepository(t *testing.T) (*Repository, *model.AgentToken) {
	t.Helper()
	repo, db := newAssetLibraryTestRepository(t)
	if err := db.AutoMigrate(&model.AgentToken{}); err != nil {
		t.Fatal(err)
	}
	return repo, nil
}

func TestAgentTokenStoredOnlyAsHashAndLookedUpByHash(t *testing.T) {
	repo, _ := newAgentTokenTestRepository(t)
	now := time.Now().UTC()
	secret := "ycat_TESTSECRETVALUE"
	record := &model.AgentToken{
		ID:          "token-1",
		UserID:      "user-1",
		Name:        "测试令牌",
		TokenHash:   "hash-of-secret",
		TokenPrefix: secret[:12],
		ScopesJSON:  `["yingce.shot.read"]`,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := repo.CreateAgentToken(record); err != nil {
		t.Fatal(err)
	}

	// 明文不能查到（数据库里根本没有明文列的值可匹配）
	if _, err := repo.AgentTokenByHash(secret); err != nil {
		t.Fatal(err)
	}
	found, err := repo.AgentTokenByHash("hash-of-secret")
	if err != nil {
		t.Fatal(err)
	}
	if found == nil || found.ID != "token-1" {
		t.Fatalf("按 hash 未查到令牌：%#v", found)
	}
	missing, err := repo.AgentTokenByHash("nope")
	if err != nil || missing != nil {
		t.Fatalf("未知 hash 应返回 nil，实际 %#v err=%v", missing, err)
	}
}

func TestAgentTokenRevokeEnforcesOwnership(t *testing.T) {
	repo, _ := newAgentTokenTestRepository(t)
	now := time.Now().UTC()
	for _, item := range []model.AgentToken{
		{ID: "token-1", UserID: "user-1", TokenHash: "h1", CreatedAt: now, UpdatedAt: now},
		{ID: "token-2", UserID: "user-2", TokenHash: "h2", CreatedAt: now, UpdatedAt: now},
	} {
		copyItem := item
		if err := repo.CreateAgentToken(&copyItem); err != nil {
			t.Fatal(err)
		}
	}

	// 别人的令牌：吊销 0 行
	ok, err := repo.RevokeAgentToken("token-2", "user-1", now)
	if err != nil || ok {
		t.Fatalf("越权吊销应返回 false，实际 ok=%v err=%v", ok, err)
	}

	// 自己的：首次 true，重复 false
	ok, err = repo.RevokeAgentToken("token-1", "user-1", now)
	if err != nil || !ok {
		t.Fatalf("吊销自己的令牌应成功，实际 ok=%v err=%v", ok, err)
	}
	ok, err = repo.RevokeAgentToken("token-1", "user-1", now)
	if err != nil || ok {
		t.Fatalf("重复吊销应返回 false，实际 ok=%v err=%v", ok, err)
	}
}

func TestAgentTokenMarksLastUsedAt(t *testing.T) {
	repo, _ := newAgentTokenTestRepository(t)
	now := time.Now().UTC()
	record := &model.AgentToken{ID: "token-1", UserID: "user-1", TokenHash: "h1", CreatedAt: now, UpdatedAt: now}
	if err := repo.CreateAgentToken(record); err != nil {
		t.Fatal(err)
	}
	usedAt := now.Add(time.Minute)
	if err := repo.MarkAgentTokenUsed("token-1", usedAt); err != nil {
		t.Fatal(err)
	}
	found, err := repo.AgentTokenByID("token-1")
	if err != nil || found == nil {
		t.Fatal(err)
	}
	if found.LastUsedAt == nil || !found.LastUsedAt.Equal(usedAt) {
		t.Fatalf("last_used_at 未正确写入：%#v", found.LastUsedAt)
	}
}

var _ = fmt.Sprintf
