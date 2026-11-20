package app

import (
	"time"

	"yingce/backend/internal/repository"
)

// earliest只是最早留存证据，不是启用时间，也不保证采集连续；未知历史不能补成真实零。
func siteTrafficHistoryStatus(from, to time.Time, earliest *int64, known bool) string {
	if !from.Before(to) {
		return "unknown"
	}
	if earliest != nil && *earliest <= from.Unix() {
		return "retained"
	}
	if known || (earliest != nil && *earliest < to.Unix()) {
		return "partial"
	}
	return "unknown"
}

func buildSiteTrafficInsights(aggregates *repository.SiteTrafficAggregates, from, to, effectiveTo, now time.Time) SiteTrafficInsights {
	result := SiteTrafficInsights{
		Heatmap: make([]SiteTrafficHeatmapCell, 168), FeatureTrend: make([]SiteTrafficFeaturePoint, 0, 365),
		PageEngagement: make([]SiteTrafficPageEngagement, 0, 13),
		Depth: SiteTrafficDepth{Visits: aggregates.Depth.Visits, Buckets: []SiteTrafficDepthBucket{
			{Key: "1", Visits: aggregates.Depth.One},
			{Key: "2-3", Visits: aggregates.Depth.TwoThree},
			{Key: "4+", Visits: aggregates.Depth.FourPlus},
		}},
	}
	for index := range result.Heatmap {
		result.Heatmap[index] = SiteTrafficHeatmapCell{Weekday: index/24 + 1, Hour: index % 24, HistoryStatus: "outside_range"}
	}
	hourly := make(map[int64]int64, len(aggregates.Heatmap))
	for _, point := range aggregates.Heatmap {
		hourly[point.HourNumber] = point.PageViews
	}
	var totals [168]int64
	var knownHours, retainedHours [168]int
	// 只计与有效半开窗有正时长交集的绝对小时，再折叠；整点截止不虚增一个当前小时。
	for hour := from.In(siteTrafficLocation).Truncate(time.Hour); hour.Before(effectiveTo); hour = hour.Add(time.Hour) {
		start, end := hour, hour.Add(time.Hour)
		if start.Before(from) {
			start = from
		}
		if end.After(effectiveTo) {
			end = effectiveTo
		}
		if !start.Before(end) {
			continue
		}
		weekday := (int(hour.Weekday()) + 6) % 7
		index := weekday*24 + hour.Hour()
		cell := &result.Heatmap[index]
		cell.Hours++
		if start.Equal(hour) && end.Equal(hour.Add(time.Hour)) {
			cell.CompletedHours++
		} else {
			cell.Partial = true
		}
		views := hourly[(hour.Unix()+28800)/3600]
		totals[index] += views
		status := siteTrafficHistoryStatus(start, end, aggregates.EarliestEpoch, views > 0)
		if status != "unknown" {
			knownHours[index]++
		}
		if status == "retained" {
			retainedHours[index]++
		}
	}
	for index := range result.Heatmap {
		cell := &result.Heatmap[index]
		if cell.Hours == 0 {
			continue
		}
		cell.HistoryStatus = "unknown"
		if knownHours[index] > 0 {
			cell.HistoryStatus = "partial"
			cell.PageViews = &totals[index]
		}
		if retainedHours[index] == cell.Hours {
			cell.HistoryStatus = "retained"
		}
	}

	daily := make(map[int64]map[string]int64, len(aggregates.FeatureTrend))
	for _, point := range aggregates.FeatureTrend {
		if daily[point.DayNumber] == nil {
			daily[point.DayNumber] = make(map[string]int64, len(siteTrafficActions))
		}
		daily[point.DayNumber][point.Action] = point.Count
	}
	today := siteTrafficToday(now)
	for day := from; day.Before(to); day = day.AddDate(0, 0, 1) {
		end := day.AddDate(0, 0, 1)
		if end.After(effectiveTo) {
			end = effectiveTo
		}
		counts := daily[(day.Unix()+28800)/86400]
		point := SiteTrafficFeaturePoint{
			Date: day.Format("2006-01-02"), Partial: day.Equal(today),
			HistoryStatus: siteTrafficHistoryStatus(day, end, aggregates.EarliestEpoch, len(counts) > 0),
		}
		if point.HistoryStatus != "unknown" {
			point.Counts = make(map[string]int64, len(siteTrafficActions))
			for action := range siteTrafficActions {
				point.Counts[action] = counts[action]
			}
		}
		result.FeatureTrend = append(result.FeatureTrend, point)
	}

	pages := make(map[string]repository.SiteTrafficPageEngagementCounts, len(aggregates.PageEngagement))
	for _, page := range aggregates.PageEngagement {
		pages[page.Page] = page
	}
	for _, page := range []string{
		"inspirations", "create", "canvas_list", "canvas", "assets", "history", "ecommerce", "ecommerce_pipeline", "drama",
		"skills", "referral", "tools_image", "tools_video",
	} {
		counts := pages[page]
		point := SiteTrafficPageEngagement{Page: page, Measurement: "supported", Visits: counts.Visits}
		switch page {
		case "auth":
			point.Measurement = "unsupported"
		default:
			engaged := counts.EngagedVisits
			point.EngagedVisits = &engaged
			if counts.Visits > 0 {
				rate := float64(engaged) / float64(counts.Visits)
				point.Rate = &rate
			}
		}
		result.PageEngagement = append(result.PageEngagement, point)
	}
	for index := range result.Depth.Buckets {
		if result.Depth.Visits > 0 {
			rate := float64(result.Depth.Buckets[index].Visits) / float64(result.Depth.Visits)
			result.Depth.Buckets[index].Rate = &rate
		}
	}
	return result
}
