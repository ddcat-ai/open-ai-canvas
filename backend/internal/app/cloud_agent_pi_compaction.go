package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// Pi 原生压缩只改变有效上下文；原始 journal 不删除。成功事件与新快照同事务落库。
func (s *Service) handlePiCompaction(userID, runID string, data map[string]any, fences ...*model.CloudAgentFence) (any, error) {
	eventType := "context_compaction_requested"
	payload := map[string]any{"mode": "pi", "reason": data["reason"], "keepRecentTokens": data["keepRecentTokens"]}
	snapshot, compactionID, digest := "", "", ""
	if data["type"] == "compaction_end" {
		result, _ := data["result"].(map[string]any)
		if data["aborted"] == true || strings.TrimSpace(stringValue(data["errorMessage"])) != "" || result == nil {
			eventType = "context_compaction_failed"
			payload["aborted"], payload["error"] = data["aborted"] == true, firstNonEmpty(stringValue(data["errorMessage"]), "压缩未完成，原会话保留")
		} else {
			snapshot, _ = data["sessionJSONL"].(string)
			if snapshot == "" {
				return nil, fmt.Errorf("Pi compaction completion requires native snapshot")
			}
			for _, line := range strings.Split(strings.TrimSpace(snapshot), "\n") {
				var entry map[string]any
				if err := json.Unmarshal([]byte(line), &entry); err != nil {
					return nil, fmt.Errorf("invalid Pi compaction snapshot: %w", err)
				}
				if entry["type"] == "compaction" && entry["summary"] == result["summary"] && entry["firstKeptEntryId"] == result["firstKeptEntryId"] {
					compactionID = stringValue(entry["id"])
				}
			}
			if compactionID == "" {
				return nil, fmt.Errorf("Pi snapshot does not contain the completed compaction")
			}
			digest = hashContentSHA256(mustMarshal(result))
			eventType = "context_compacted"
			payload["compactionId"] = compactionID
			payload["tokensBefore"], payload["estimatedTokensAfter"] = result["tokensBefore"], result["estimatedTokensAfter"]
			payload["measurementSource"] = "estimate"
		}
	}
	for attempt := 0; attempt < 8; attempt++ {
		run, err := s.repo.CloudAgent(userID, runID)
		if err != nil {
			return nil, err
		}
		cloudAgentBindFence(run, fences)
		err = s.repo.MutateCloudAgentRun(run, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
			state, err := cloudAgentDecode(current)
			if err != nil {
				return err
			}
			if compactionID != "" {
				receipt, lookupErr := repo.CloudAgentReceipt(userID, runID, "pi_compaction", compactionID)
				if lookupErr == nil {
					if receipt.InputSHA256 != digest {
						return NewAppError(409, "压缩记录与已保存结果不一致")
					}
					return nil
				}
				if !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
					return lookupErr
				}
				existing, lookupErr := repo.CloudAgentPiSession(userID, runID)
				expected := int64(0)
				if lookupErr == nil {
					expected = existing.Revision
				} else if !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
					return lookupErr
				}
				if err := repo.SaveCloudAgentPiSession(&model.CloudAgentPiSession{RunID: runID, UserID: userID, SessionJSONL: snapshot, UpdatedAt: time.Now()}, expected); err != nil {
					return err
				}
				saved, err := repo.CloudAgentPiSession(userID, runID)
				if err != nil {
					return err
				}
				if saved.SessionJSONL != snapshot {
					return repository.ErrCreationConflict
				}
				if err := repo.SaveCloudAgentReceipt(&model.CloudAgentReceipt{RunID: runID, UserID: userID, Kind: "pi_compaction", OperationKey: compactionID, Name: "native_compaction", InputSHA256: digest, Status: "committed"}); err != nil {
					return err
				}
				if state.TokenAnchor != nil {
					state.TokenAnchor.Accepted = false
					state.TokenAnchor.RejectReason = "上下文已压缩，等待下一次上游实测"
				}
			}
			state.event(runID, eventType, payload)
			return cloudAgentSave(current, &state)
		})
		if err == nil {
			return map[string]any{"ok": true}, nil
		}
		if !errors.Is(err, repository.ErrCreationConflict) {
			return nil, err
		}
	}
	return nil, repository.ErrCreationConflict
}
