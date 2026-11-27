package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

// 用不可变版本本身作持久回执，角色/用户参与派生，避免跨账号操作号冲突和刷新后重复保存。
func (s *Service) replaceCharacterRepresentationsMutation(userID string, asset *model.Asset, req ReplaceCharacterRepresentationsRequest) (CharacterAssetSummary, error) {
	if strings.TrimSpace(req.OperationID) == "" || len(req.OperationID) > 100 || strings.TrimSpace(req.ExpectedVersionID) == "" {
		return CharacterAssetSummary{}, BadAuthRequest("保存形象必须提供有效操作标识和角色版本")
	}
	key := sha256.Sum256([]byte(userID + "\x00" + asset.ID + "\x00" + req.OperationID))
	versionID := hex.EncodeToString(key[:16])
	encoded, err := json.Marshal(req)
	if err != nil {
		return CharacterAssetSummary{}, err
	}
	fingerprint := sha256.Sum256(encoded)
	receipt := "character-mutation:" + hex.EncodeToString(fingerprint[:])
	readReceipt := func() (bool, error) {
		version, err := s.repo.AssetVersion(versionID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		if version.AssetID != asset.ID || version.Note != receipt {
			return false, &kernel.AppError{Status: 409, Code: 409, Reason: "idempotency_conflict", Message: "操作标识已用于不同的保存请求"}
		}
		return true, nil
	}
	if exists, err := readReceipt(); err != nil {
		return CharacterAssetSummary{}, err
	} else if exists {
		return s.Character(userID, asset.ID)
	}
	if asset.PrimaryVersionID != req.ExpectedVersionID {
		return CharacterAssetSummary{}, characterVersionConflict()
	}
	if err := s.validateCharacterDressingSources(userID, asset.ID, req.Definition); err != nil {
		return CharacterAssetSummary{}, err
	}
	definition, err := normalizedCharacterDefinition(req.Definition)
	if err != nil {
		return CharacterAssetSummary{}, err
	}
	if req.Definition == nil {
		definition = nil
	}
	representations, err := s.characterRepresentationsForInputs(userID, req.Representations, newID(), time.Now())
	if err != nil {
		return CharacterAssetSummary{}, err
	}
	nextAsset, version, representations, voice, err := s.prepareNextCharacterVersion(asset, asset.Title, string(definition), representations, nil, false)
	if err != nil {
		return CharacterAssetSummary{}, err
	}
	version.ID, version.Note, nextAsset.PrimaryVersionID = versionID, receipt, versionID
	for i := range representations {
		representations[i].AssetVersionID = versionID
	}
	if voice != nil {
		voice.AssetVersionID = versionID
	}
	payload, err := characterAssetPayload(asset.ID, versionID, asset.Title, json.RawMessage(version.DefinitionJSON), asset.CreatedAt, version.UpdatedAt)
	if err != nil {
		return CharacterAssetSummary{}, err
	}
	nextAsset.PayloadJSON = payload
	if err := s.repo.SaveCharacterVersion("", &nextAsset, &version, representations, voice, req.ExpectedVersionID); err != nil {
		// 两个页面可能同时提交同一操作；事务赢家已落库时，输家应返回同一成功结果。
		if exists, receiptErr := readReceipt(); receiptErr != nil {
			return CharacterAssetSummary{}, receiptErr
		} else if exists {
			return s.Character(userID, asset.ID)
		}
		if errors.Is(err, repository.ErrCharacterVersionConflict) {
			return CharacterAssetSummary{}, characterVersionConflict()
		}
		return CharacterAssetSummary{}, err
	}
	return s.Character(userID, asset.ID)
}

func characterVersionConflict() error {
	return &kernel.AppError{Status: 409, Code: 409, Reason: "character_version_conflict", Message: "角色已被更新，请刷新角色后重新保存；生成结果仍保留"}
}
