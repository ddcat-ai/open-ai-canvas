package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const storageMigrationMarker = ".storage-v2-migrated"

type StorageMigrationSummary struct {
	Tasks    int
	Assets   int
	Projects int
	Backup   string
}

func (s *Service) MigrateLegacyStorage() (StorageMigrationSummary, error) {
	if s.repo.Dialect() != "sqlite" {
		return StorageMigrationSummary{}, nil
	}
	marker := filepath.Join(s.dataDir, storageMigrationMarker)
	if _, err := os.Stat(marker); err == nil {
		return StorageMigrationSummary{}, nil
	}
	backupDir := filepath.Join(s.dataDir, "backups")
	if err := os.MkdirAll(backupDir, 0o750); err != nil {
		return StorageMigrationSummary{}, err
	}
	backup := filepath.Join(backupDir, "open_ai_canvas-before-storage-v2-"+time.Now().Format("20060102-150405")+".db")
	if err := s.repo.BackupSQLite(backup); err != nil {
		return StorageMigrationSummary{}, fmt.Errorf("备份数据库失败：%w", err)
	}
	summary := StorageMigrationSummary{Backup: backup}

	tasks, err := s.repo.AllTasks()
	if err != nil {
		return summary, err
	}
	// 迁移标记一旦写入，后续启动不会再次扫描旧数据。因此解析、脱敏和序列化都必须
	// 失败关闭；跳过坏记录再写 marker 会把未迁移数据永久伪装成“迁移完成”。
	for index := range tasks {
		changed := false
		if strings.Contains(tasks[index].InputJSON, "data:") {
			var input map[string]interface{}
			if err := json.Unmarshal([]byte(tasks[index].InputJSON), &input); err != nil {
				return summary, fmt.Errorf("解析任务 %s 的旧输入失败：%w", tasks[index].ID, err)
			}
			stored, storeErr := s.persistLegacyGeneratedMediaResult(tasks[index].UserID, input)
			if storeErr != nil {
				return summary, fmt.Errorf("迁移任务 %s 的旧输入媒体失败：%w", tasks[index].ID, storeErr)
			}
			encoded, err := json.Marshal(stored)
			if err != nil {
				return summary, fmt.Errorf("序列化任务 %s 的迁移输入失败：%w", tasks[index].ID, err)
			}
			tasks[index].InputJSON = string(encoded)
			changed = true
		}
		if strings.Contains(tasks[index].ResultJSON, "data:") {
			var result map[string]interface{}
			if err := json.Unmarshal([]byte(tasks[index].ResultJSON), &result); err != nil {
				return summary, fmt.Errorf("解析任务 %s 的旧结果失败：%w", tasks[index].ID, err)
			}
			stored, storeErr := s.persistLegacyGeneratedMediaResult(tasks[index].UserID, result)
			if storeErr != nil {
				return summary, fmt.Errorf("迁移任务 %s 的旧结果媒体失败：%w", tasks[index].ID, storeErr)
			}
			encoded, err := json.Marshal(stored)
			if err != nil {
				return summary, fmt.Errorf("序列化任务 %s 的迁移结果失败：%w", tasks[index].ID, err)
			}
			tasks[index].ResultJSON = string(encoded)
			changed = true
		}
		if strings.TrimSpace(tasks[index].InputJSON) != "" {
			var protected interface{}
			if err := json.Unmarshal([]byte(tasks[index].InputJSON), &protected); err != nil {
				return summary, fmt.Errorf("解析任务 %s 的输入以执行密钥保护失败：%w", tasks[index].ID, err)
			}
			if err := s.protectTaskSecrets(protected); err != nil {
				return summary, fmt.Errorf("保护任务 %s 的输入密钥失败：%w", tasks[index].ID, err)
			}
			encoded, err := json.Marshal(protected)
			if err != nil {
				return summary, fmt.Errorf("序列化任务 %s 的脱敏输入失败：%w", tasks[index].ID, err)
			}
			if string(encoded) != tasks[index].InputJSON {
				tasks[index].InputJSON = string(encoded)
				changed = true
			}
		}
		if tasks[index].Status == "succeeded" {
			compacted := publicTaskInputJSON(tasks[index].InputJSON)
			if compacted != tasks[index].InputJSON {
				tasks[index].InputJSON = compacted
				changed = true
			}
		}
		if changed {
			if err := s.repo.Save(&tasks[index]); err != nil {
				return summary, err
			}
			summary.Tasks++
		}
	}

	assets, err := s.repo.AllAssets()
	if err != nil {
		return summary, err
	}
	for index := range assets {
		if !strings.Contains(assets[index].PayloadJSON, "data:") {
			continue
		}
		var payload map[string]interface{}
		if err := json.Unmarshal([]byte(assets[index].PayloadJSON), &payload); err != nil {
			return summary, fmt.Errorf("解析素材 %s 的旧载荷失败：%w", assets[index].ID, err)
		}
		stored, err := s.persistLegacyGeneratedMediaResult(assets[index].UserID, payload)
		if err != nil {
			return summary, fmt.Errorf("迁移素材 %s 的旧媒体失败：%w", assets[index].ID, err)
		}
		encoded, err := json.Marshal(stored)
		if err != nil {
			return summary, fmt.Errorf("序列化素材 %s 的迁移载荷失败：%w", assets[index].ID, err)
		}
		assets[index].PayloadJSON = string(encoded)
		if err := s.repo.Save(&assets[index]); err != nil {
			return summary, err
		}
		summary.Assets++
	}

	projects, err := s.repo.AllCanvasProjects()
	if err != nil {
		return summary, err
	}
	for index := range projects {
		if !strings.Contains(projects[index].PayloadJSON, "data:") {
			continue
		}
		var payload map[string]interface{}
		if err := json.Unmarshal([]byte(projects[index].PayloadJSON), &payload); err != nil {
			return summary, fmt.Errorf("解析画布项目 %s 的旧载荷失败：%w", projects[index].ID, err)
		}
		stored, err := s.persistLegacyGeneratedMediaResult(projects[index].UserID, payload)
		if err != nil {
			return summary, fmt.Errorf("迁移画布项目 %s 的旧媒体失败：%w", projects[index].ID, err)
		}
		encoded, err := json.Marshal(stored)
		if err != nil {
			return summary, fmt.Errorf("序列化画布项目 %s 的迁移载荷失败：%w", projects[index].ID, err)
		}
		projects[index].PayloadJSON = string(encoded)
		if err := s.repo.Save(&projects[index]); err != nil {
			return summary, err
		}
		summary.Projects++
	}

	if err := s.repo.CleanupDuplicateTaskPayloads(); err != nil {
		return summary, err
	}
	if err := s.repo.Vacuum(); err != nil {
		return summary, err
	}
	if err := os.WriteFile(marker, []byte(time.Now().UTC().Format(time.RFC3339)), 0o640); err != nil {
		return summary, err
	}
	return summary, nil
}
