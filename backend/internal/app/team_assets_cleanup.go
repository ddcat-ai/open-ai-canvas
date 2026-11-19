package app

import (
	"log/slog"
	"time"

	"yingce/backend/internal/repository"
)

// Recovery releases the temporary source FK only after its unfinished private files are gone.
func (s *Service) cleanupExpiredTeamAssetPublications() {
	teams, err := s.repo.ExpiredTeamAssetPublicationTeams(time.Now(), 32)
	if err != nil {
		slog.Error("query expired team asset publications", "error", err)
		return
	}
	for _, teamID := range teams {
		err := s.repo.Transaction(func(tx *repository.Repository) error {
			if _, err := tx.LockTeam(teamID); err != nil {
				return err
			}
			rows, err := tx.ExpiredTeamAssetPublications(teamID, time.Now())
			if err != nil {
				return err
			}
			for _, row := range rows {
				if err := tx.FailTeamAssetPublication(row.ID, "发布已超时"); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			slog.Error("clean up expired team asset publications", "team", teamID, "error", err)
		}
	}
}
