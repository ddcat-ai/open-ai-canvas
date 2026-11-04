package app

import (
	"encoding/json"
	"fmt"

	"yingce/backend/internal/ecommerceknowledge"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const ecommerceKnowledgeBundleReceiptKey = "ecommerce_knowledge_bundle_receipt"

type EcommerceKnowledgeBundleReport struct {
	Digest           string `json:"digest"`
	AlreadyInstalled bool   `json:"alreadyInstalled"`
	SourcesInserted  int64  `json:"sourcesInserted"`
	EntriesInserted  int64  `json:"entriesInserted"`
}

// EnsureBundledEcommerceKnowledge initializes global reference data once per
// bundle version. Existing edits, review decisions and disabled sources win.
func (s *Service) EnsureBundledEcommerceKnowledge() (*EcommerceKnowledgeBundleReport, error) {
	report := &EcommerceKnowledgeBundleReport{Digest: ecommerceknowledge.Digest()}
	installed, err := ecommerceKnowledgeBundleInstalled(s.repo, report.Digest)
	if err != nil {
		return nil, err
	}
	if installed {
		report.AlreadyInstalled = true
		return report, nil
	}
	snapshot, err := ecommerceknowledge.Read()
	if err != nil {
		return nil, fmt.Errorf("读取内置电商知识数据包：%w", err)
	}
	err = s.repo.Transaction(func(tx *repository.Repository) error {
		installed, err := ecommerceKnowledgeBundleInstalled(tx, report.Digest)
		if err != nil {
			return err
		}
		if installed {
			report.AlreadyInstalled = true
			return nil
		}
		if report.SourcesInserted, err = tx.InsertEcommerceKnowledgeSources(snapshot.Sources); err != nil {
			return err
		}
		if report.EntriesInserted, err = tx.InsertEcommerceKnowledgeEntries(snapshot.Entries); err != nil {
			return err
		}
		receipt, err := json.Marshal(map[string]string{"digest": report.Digest})
		if err != nil {
			return err
		}
		return tx.SaveSystemSetting(&model.SystemSetting{Key: ecommerceKnowledgeBundleReceiptKey, ValueJSON: string(receipt)})
	})
	if err != nil {
		return nil, fmt.Errorf("初始化内置电商知识数据包：%w", err)
	}
	return report, nil
}

func ecommerceKnowledgeBundleInstalled(repo *repository.Repository, digest string) (bool, error) {
	setting, err := repo.SystemSettingOptional(ecommerceKnowledgeBundleReceiptKey)
	if err != nil || setting == nil {
		return false, err
	}
	var receipt struct {
		Digest string `json:"digest"`
	}
	if err := json.Unmarshal([]byte(setting.ValueJSON), &receipt); err != nil {
		return false, fmt.Errorf("电商知识数据包安装记录无效：%w", err)
	}
	return receipt.Digest == digest, nil
}
