package repository

import "sort"

// Acquire a database write lock before reading versions. SQLite has one writer;
// PostgreSQL locks the actor and targets in stable order for the entire batch.
func (r *Repository) LockChannelConfiguration(actorID string, channelIDs []string) error {
	// Lock the actor first so permission changes serialize before the batch.
	if _, err := r.lockChannelConfigurationActor(actorID); err != nil {
		return err
	}
	channels, err := r.SystemChannelsByIDs(channelIDs, true)
	if err != nil {
		return err
	}
	websiteIDs := []string{}
	seen := map[string]bool{}
	for _, channel := range channels {
		if channel.WebsiteID != "" && !seen[channel.WebsiteID] {
			seen[channel.WebsiteID] = true
			websiteIDs = append(websiteIDs, channel.WebsiteID)
		}
	}
	sort.Strings(websiteIDs)
	for _, id := range websiteIDs {
		if _, err := r.LockChannelWebsite(id); err != nil {
			return err
		}
	}
	if err := r.LockSystemChannelConfiguration(channelIDs); err != nil {
		return err
	}
	for _, channel := range channels {
		current, err := r.AdminSystemChannel(channel.ID)
		if err != nil {
			return err
		}
		if current.WebsiteID != channel.WebsiteID {
			return ErrTaskStateConflict
		}
	}
	return nil
}
