package app

import (
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

const publicModelAvailabilityMinimumSamples = 10

type publicModelAvailabilityKey struct {
	channelID string
	modelKey  string
}

type publicModelAvailabilityAccumulator struct {
	total   int
	success int
	latest  time.Time
}

// publicModelAvailability builds a deliberately small public read model. The
// current binary Available field remains owned by the catalog/route-health
// logic; these values describe only recorded user-facing create outcomes.
func (s *Service) publicModelAvailability(channels []PublicChannelCatalog, now time.Time) (map[publicModelAvailabilityKey]*PublicModelAvailability, error) {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	now = now.UTC()
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	trendFrom := dayStart.AddDate(0, 0, -6)
	channelIDs := make([]string, 0, len(channels))
	known := make(map[publicModelAvailabilityKey]struct{})
	for _, channel := range channels {
		if channel.ID == "" {
			continue
		}
		channelIDs = append(channelIDs, channel.ID)
		for _, item := range channel.Models {
			known[publicModelAvailabilityKey{channelID: channel.ID, modelKey: item.ModelKey}] = struct{}{}
		}
	}
	result := make(map[publicModelAvailabilityKey]*PublicModelAvailability, len(known))
	if len(channelIDs) == 0 || len(known) == 0 {
		return result, nil
	}

	from := trendFrom
	logs, err := s.repo.PublicModelAvailabilityLogs(repository.PublicModelAvailabilityFilter{From: from, To: now, ChannelIDs: channelIDs})
	if err != nil {
		return nil, err
	}

	last24 := make(map[publicModelAvailabilityKey]*publicModelAvailabilityAccumulator)
	trend := make([]map[publicModelAvailabilityKey]*publicModelAvailabilityAccumulator, 7)
	for index := range trend {
		trend[index] = make(map[publicModelAvailabilityKey]*publicModelAvailabilityAccumulator)
	}
	for _, log := range logs {
		key := publicModelAvailabilityKey{channelID: log.ChannelID, modelKey: log.Model}
		if _, ok := known[key]; !ok {
			continue
		}
		if !log.CreatedAt.Before(now.Add(-24 * time.Hour)) {
			addAvailabilityLog(last24, key, log)
		}
		segment := int(log.CreatedAt.Sub(from) / (24 * time.Hour))
		if segment >= 0 && segment < len(trend) {
			addAvailabilityLog(trend[segment], key, log)
		}
	}

	for key := range known {
		primary := last24[key]
		item := &PublicModelAvailability{
			Trend7d:    make([]PublicModelAvailabilityDay, 0, 7),
			DataState:  publicAvailabilityState(sampleCount(primary), publicModelAvailabilityMinimumSamples),
			ComputedAt: now,
		}
		if primary != nil {
			item.SampleCount = primary.total
			if primary.total >= publicModelAvailabilityMinimumSamples {
				item.Rate24h = publicAvailabilityRate(primary)
			}
			if !primary.latest.IsZero() {
				latest := primary.latest.UTC()
				item.DataThrough = &latest
			}
		}
		for index := range trend {
			bucket := trend[index][key]
			bucketStart := from.Add(time.Duration(index) * 24 * time.Hour)
			day := PublicModelAvailabilityDay{
				Day:         bucketStart.UTC().Format("2006-01-02"),
				SampleCount: sampleCount(bucket),
				DataState:   publicAvailabilityState(sampleCount(bucket), publicModelAvailabilityMinimumSamples),
			}
			if bucket != nil {
				if bucket.total >= publicModelAvailabilityMinimumSamples {
					day.Rate = publicAvailabilityRate(bucket)
				}
				if item.DataThrough == nil || bucket.latest.After(*item.DataThrough) {
					latest := bucket.latest.UTC()
					item.DataThrough = &latest
				}
			}
			item.Trend7d = append(item.Trend7d, day)
		}
		result[key] = item
	}
	return result, nil
}

func addAvailabilityLog(target map[publicModelAvailabilityKey]*publicModelAvailabilityAccumulator, key publicModelAvailabilityKey, log model.ApiCallLog) {
	item := target[key]
	if item == nil {
		item = &publicModelAvailabilityAccumulator{}
		target[key] = item
	}
	item.total++
	if log.Status == model.ApiCallStatusSucceeded {
		item.success++
	}
	if log.CreatedAt.After(item.latest) {
		item.latest = log.CreatedAt
	}
}

func sampleCount(item *publicModelAvailabilityAccumulator) int {
	if item == nil {
		return 0
	}
	return item.total
}

func publicAvailabilityRate(item *publicModelAvailabilityAccumulator) *float64 {
	if item == nil || item.total == 0 {
		return nil
	}
	rate := float64(item.success) / float64(item.total)
	return &rate
}

func publicAvailabilityState(samples int, minimum int) PublicModelAvailabilityDataState {
	switch {
	case samples == 0:
		return PublicModelAvailabilityNoData
	case samples < minimum:
		return PublicModelAvailabilityInsufficient
	default:
		return PublicModelAvailabilityReady
	}
}

func attachPublicModelAvailability(channels []PublicChannelCatalog, availability map[publicModelAvailabilityKey]*PublicModelAvailability) {
	for channelIndex := range channels {
		for modelIndex := range channels[channelIndex].Models {
			item := channels[channelIndex].Models[modelIndex]
			if value := availability[publicModelAvailabilityKey{channelID: channels[channelIndex].ID, modelKey: item.ModelKey}]; value != nil {
				channels[channelIndex].Models[modelIndex].Availability = value
			}
		}
	}
}
