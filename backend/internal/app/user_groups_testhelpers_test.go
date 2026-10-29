package app

import (
	"errors"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

const testGroupUserIDValue = "test-group-user"

// testGroupUserID 返回一个默认分组下的真实用户，供报价和目录测试走与线上相同的分组解析。
// 夹具没有 users 表时只返回 ID：只测入参校验的用例不会走到分组解析。
func testGroupUserID(svc *Service) string {
	if svc == nil || svc.repo == nil {
		return testGroupUserIDValue
	}
	if _, err := svc.repo.User(testGroupUserIDValue); err == nil || !errors.Is(err, gorm.ErrRecordNotFound) {
		return testGroupUserIDValue
	}
	user := &model.User{ID: testGroupUserIDValue, Username: testGroupUserIDValue, DisplayName: "分组测试用户", Role: model.UserRoleUser, Status: model.UserStatusActive}
	_ = svc.repo.Create(user)
	return testGroupUserIDValue
}

// testGroupAccess 返回不过滤渠道的默认分组上下文。
func testGroupAccess(svc *Service) *userGroupAccess {
	if access, err := svc.systemGroupAccess(); err == nil {
		return access
	}
	// 部分夹具只迁移了渠道表：用内存中的默认分组，价格与未分组前一致。
	group := &resolvedUserGroup{UserGroup: model.UserGroup{Code: model.DefaultUserGroupCode, RatioBasisPoints: 10_000, PointsPerUSD: defaultPointsPerUSDSeed, PointsPerCNY: defaultPointsPerCNYSeed, AllChannels: true}, channels: map[string]bool{}, overrides: map[string]model.UserGroupModelOverride{}}
	return &userGroupAccess{group: group, bypassVisibility: true}
}

// ensureTestUsers 为只迁移部分表的夹具补齐分组相关表和账单引用的用户。
func ensureTestUsers(t interface{ Fatal(...any) }, db *gorm.DB, ids ...string) {
	if err := db.AutoMigrate(&model.User{}, &model.UserGroup{}, &model.UserGroupChannel{}); err != nil {
		t.Fatal(err)
	}
	for _, id := range ids {
		if err := db.FirstOrCreate(&model.User{}, model.User{ID: id, Username: id, Role: model.UserRoleUser, Status: model.UserStatusActive}).Error; err != nil {
			t.Fatal(err)
		}
	}
}
