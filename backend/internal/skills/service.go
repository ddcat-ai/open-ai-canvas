package skills

import (
	"context"

	"infinite-canvas/backend/internal/repository"
)

// Service 是技能域入口。组合根注入仓库、数据目录和后台循环，禁止 import internal/service。
type Service struct {
	repo          *repository.Repository
	dataDir       string
	runWorkerLoop func(func(context.Context)) bool
}

func New(repo *repository.Repository, dataDir string, runWorkerLoop func(func(context.Context)) bool) *Service {
	if runWorkerLoop == nil {
		runWorkerLoop = func(func(context.Context)) bool { return false }
	}
	return &Service{repo: repo, dataDir: dataDir, runWorkerLoop: runWorkerLoop}
}
