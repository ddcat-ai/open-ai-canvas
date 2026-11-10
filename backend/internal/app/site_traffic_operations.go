package app

import (
	"math"
	"time"

	"yingce/backend/internal/repository"
)

type SiteTrafficVisitorMix struct {
	Status                string   `json:"status"`
	Visitors              int64    `json:"visitors"`
	FirstObservedVisitors *int64   `json:"firstObservedVisitors"`
	ReturningVisitors     *int64   `json:"returningVisitors"`
	FirstObservedRate     *float64 `json:"firstObservedRate"`
	ReturningRate         *float64 `json:"returningRate"`
	LookbackFrom          string   `json:"lookbackFrom"`
	LookbackTo            string   `json:"lookbackTo"`
}

type SiteTrafficEndpointPage struct {
	Page   string   `json:"page"`
	Visits int64    `json:"visits"`
	Rate   *float64 `json:"rate"`
}

type SiteTrafficEndpointSide struct {
	UndeterminedVisits int64                     `json:"undeterminedVisits"`
	Pages              []SiteTrafficEndpointPage `json:"pages"`
}

type SiteTrafficEndpoints struct {
	Visits int64                   `json:"visits"`
	First  SiteTrafficEndpointSide `json:"first"`
	Last   SiteTrafficEndpointSide `json:"last"`
}

type SiteTrafficPath struct {
	From   string   `json:"from"`
	To     string   `json:"to"`
	Visits int64    `json:"visits"`
	Rate   *float64 `json:"rate"`
}

type SiteTrafficPaths struct {
	Visits          int64             `json:"visits"`
	AmbiguousVisits int64             `json:"ambiguousVisits"`
	Rows            []SiteTrafficPath `json:"rows"`
}

type SiteTrafficFunnelStep struct {
	Key             string   `json:"key"`
	Visits          int64    `json:"visits"`
	PossibleVisits  int64    `json:"possibleVisits"`
	UncertainVisits int64    `json:"uncertainVisits"`
	Rate            *float64 `json:"rate"`
	PreviousRate    *float64 `json:"previousRate"`
}

type SiteTrafficFunnel struct {
	Steps []SiteTrafficFunnelStep `json:"steps"`
}

type SiteTrafficAnomalyRules struct {
	MinimumBaseline       int64   `json:"minimumBaseline"`
	MinimumAbsoluteChange int64   `json:"minimumAbsoluteChange"`
	RelativeThreshold     float64 `json:"relativeThreshold"`
}

type SiteTrafficAnomalyMetric struct {
	Key            string   `json:"key"`
	Current        int64    `json:"current"`
	Previous       *int64   `json:"previous"`
	RelativeChange *float64 `json:"relativeChange"`
	Status         string   `json:"status"`
}

type SiteTrafficAnomalies struct {
	Status  string                     `json:"status"`
	Rules   SiteTrafficAnomalyRules    `json:"rules"`
	Metrics []SiteTrafficAnomalyMetric `json:"metrics"`
}

type SiteTrafficOperations struct {
	VisitorMix SiteTrafficVisitorMix `json:"visitorMix"`
	Endpoints  SiteTrafficEndpoints  `json:"endpoints"`
	Paths      SiteTrafficPaths      `json:"paths"`
	Funnel     SiteTrafficFunnel     `json:"funnel"`
	Anomalies  SiteTrafficAnomalies  `json:"anomalies"`
}

func siteTrafficOperationRate(numerator, denominator int64) *float64 {
	if denominator == 0 {
		return nil
	}
	rate := float64(numerator) / float64(denominator)
	return &rate
}

func buildSiteTrafficOperations(aggregates repository.SiteTrafficOperationsAggregates, from, retentionStart time.Time, current repository.SiteTrafficCounts, comparison SiteTrafficComparison) SiteTrafficOperations {
	result := SiteTrafficOperations{
		VisitorMix: SiteTrafficVisitorMix{
			Status: "no_lookback", Visitors: aggregates.VisitorMix.Visitors,
			LookbackFrom: retentionStart.UTC().Format(time.RFC3339), LookbackTo: from.UTC().Format(time.RFC3339),
		},
		Endpoints: SiteTrafficEndpoints{
			Visits: aggregates.Endpoints.Visits,
			First:  SiteTrafficEndpointSide{UndeterminedVisits: aggregates.Endpoints.First.UndeterminedVisits, Pages: make([]SiteTrafficEndpointPage, 0, 13)},
			Last:   SiteTrafficEndpointSide{UndeterminedVisits: aggregates.Endpoints.Last.UndeterminedVisits, Pages: make([]SiteTrafficEndpointPage, 0, 13)},
		},
		Paths: SiteTrafficPaths{Visits: aggregates.Paths.Visits, AmbiguousVisits: aggregates.Paths.AmbiguousVisits, Rows: make([]SiteTrafficPath, 0, 10)},
		Funnel: SiteTrafficFunnel{Steps: []SiteTrafficFunnelStep{
			{Key: "inspirations"}, {Key: "open_create"}, {Key: "create"}, {Key: "submit"},
		}},
		Anomalies: buildSiteTrafficAnomalies(current, comparison),
	}
	// 可用历史早于个人首次观察与否无关；只有retentionStart到from的前置窗可用于混合分类。
	if from.After(retentionStart) {
		mix := &result.VisitorMix
		mix.Status = "ready"
		mix.FirstObservedVisitors, mix.ReturningVisitors = &aggregates.VisitorMix.FirstObservedVisitors, &aggregates.VisitorMix.ReturningVisitors
		mix.FirstObservedRate = siteTrafficOperationRate(*mix.FirstObservedVisitors, mix.Visitors)
		mix.ReturningRate = siteTrafficOperationRate(*mix.ReturningVisitors, mix.Visitors)
	}
	for _, page := range aggregates.Endpoints.First.Pages {
		result.Endpoints.First.Pages = append(result.Endpoints.First.Pages, SiteTrafficEndpointPage{
			Page: page.Page, Visits: page.Visits, Rate: siteTrafficOperationRate(page.Visits, result.Endpoints.Visits),
		})
	}
	for _, page := range aggregates.Endpoints.Last.Pages {
		result.Endpoints.Last.Pages = append(result.Endpoints.Last.Pages, SiteTrafficEndpointPage{
			Page: page.Page, Visits: page.Visits, Rate: siteTrafficOperationRate(page.Visits, result.Endpoints.Visits),
		})
	}
	for _, row := range aggregates.Paths.Rows {
		result.Paths.Rows = append(result.Paths.Rows, SiteTrafficPath{
			From: row.From, To: row.To, Visits: row.Visits, Rate: siteTrafficOperationRate(row.Visits, result.Paths.Visits),
		})
	}
	for _, counts := range aggregates.Funnel {
		step := &result.Funnel.Steps[counts.Step-1]
		step.Visits, step.PossibleVisits, step.UncertainVisits = counts.Visits, counts.PossibleVisits, counts.PossibleVisits-counts.Visits
	}
	for index := range result.Funnel.Steps {
		step := &result.Funnel.Steps[index]
		step.Rate = siteTrafficOperationRate(step.Visits, result.Funnel.Steps[0].Visits)
		if index > 0 {
			step.PreviousRate = siteTrafficOperationRate(step.Visits, result.Funnel.Steps[index-1].Visits)
		}
	}
	return result
}

// 异常摘要复用已完成的comparison，不添加查询、定时器或通知；各指标只使用自己的上期分母。
func buildSiteTrafficAnomalies(current repository.SiteTrafficCounts, comparison SiteTrafficComparison) SiteTrafficAnomalies {
	result := SiteTrafficAnomalies{
		Status: comparison.Status,
		Rules:  SiteTrafficAnomalyRules{MinimumBaseline: 30, MinimumAbsoluteChange: 10, RelativeThreshold: 0.3},
		Metrics: []SiteTrafficAnomalyMetric{
			{Key: "visitors", Current: current.Visitors, Status: "unavailable"},
			{Key: "pageViews", Current: current.PageViews, Status: "unavailable"},
			{Key: "visits", Current: current.Visits, Status: "unavailable"},
			{Key: "actions", Current: current.Actions, Status: "unavailable"},
		},
	}
	if comparison.Status != "ready" {
		return result
	}
	previous := []int64{comparison.KPI.Visitors, comparison.KPI.PageViews, comparison.KPI.Visits, comparison.KPI.Actions}
	for index := range result.Metrics {
		metric := &result.Metrics[index]
		metric.Previous = &previous[index]
		if *metric.Previous == 0 {
			metric.Status = "zero_baseline"
			continue
		}
		delta := metric.Current - *metric.Previous
		relative := float64(delta) / float64(*metric.Previous)
		metric.RelativeChange = &relative
		metric.Status = "stable"
		if *metric.Previous < result.Rules.MinimumBaseline {
			metric.Status = "insufficient_sample"
		} else if math.Abs(float64(delta)) >= float64(result.Rules.MinimumAbsoluteChange) && math.Abs(relative) >= result.Rules.RelativeThreshold {
			metric.Status = "increase"
			if delta < 0 {
				metric.Status = "decrease"
			}
		}
	}
	return result
}
