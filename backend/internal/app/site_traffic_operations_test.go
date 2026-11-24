package app

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestSiteTrafficVisitorMixNoLookbackKeepsTotalAndNullableCategories(t *testing.T) {
	retained := time.Date(2025, 11, 11, 0, 0, 0, 0, siteTrafficLocation)
	for _, offset := range []time.Duration{-time.Second, 0, time.Second} {
		from := retained.Add(offset)
		result := buildSiteTrafficOperations(repository.SiteTrafficOperationsAggregates{
			VisitorMix: repository.SiteTrafficVisitorMixCounts{Visitors: 3, FirstObservedVisitors: 1, ReturningVisitors: 2},
		}, from, retained, repository.SiteTrafficCounts{Visitors: 999}, SiteTrafficComparison{Status: "insufficient_history"})
		mix := result.VisitorMix
		if mix.Visitors != 3 || mix.LookbackFrom != retained.UTC().Format(time.RFC3339) || mix.LookbackTo != from.UTC().Format(time.RFC3339) {
			t.Fatalf("mix lookback/own total = %+v", mix)
		}
		if offset <= 0 {
			if mix.Status != "no_lookback" || mix.FirstObservedVisitors != nil || mix.ReturningVisitors != nil || mix.FirstObservedRate != nil || mix.ReturningRate != nil {
				t.Fatalf("no preceding window must not invent first/returning classifications: %+v", mix)
			}
			data, err := json.Marshal(mix)
			if err != nil || !strings.Contains(string(data), `"firstObservedVisitors":null`) || !strings.Contains(string(data), `"returningVisitors":null`) || !strings.Contains(string(data), `"firstObservedRate":null`) || !strings.Contains(string(data), `"returningRate":null`) {
				t.Fatalf("no-lookback JSON = %s, %v", data, err)
			}
		} else if mix.Status != "ready" || mix.FirstObservedVisitors == nil || *mix.FirstObservedVisitors != 1 || mix.ReturningVisitors == nil || *mix.ReturningVisitors != 2 ||
			mix.FirstObservedRate == nil || *mix.FirstObservedRate != 1.0/3 || mix.ReturningRate == nil || *mix.ReturningRate != 2.0/3 {
			t.Fatalf("ready categories must use the mix's own PV visitor denominator: %+v", mix)
		}
	}
	empty := buildSiteTrafficOperations(repository.SiteTrafficOperationsAggregates{}, retained.Add(time.Second), retained, repository.SiteTrafficCounts{}, SiteTrafficComparison{Status: "insufficient_history"}).VisitorMix
	if empty.Status != "ready" || empty.FirstObservedVisitors == nil || *empty.FirstObservedVisitors != 0 || empty.ReturningVisitors == nil || *empty.ReturningVisitors != 0 || empty.FirstObservedRate != nil || empty.ReturningRate != nil {
		t.Fatalf("empty ready mix must have real zero counts but null rates: %+v", empty)
	}
}

func TestSiteTrafficOperationsUseIndependentDenominatorsAndFixedFunnelKeys(t *testing.T) {
	from := time.Date(2026, 11, 10, 0, 0, 0, 0, siteTrafficLocation)
	counts := repository.SiteTrafficOperationsAggregates{
		VisitorMix: repository.SiteTrafficVisitorMixCounts{Visitors: 3, FirstObservedVisitors: 1, ReturningVisitors: 2},
		Endpoints: repository.SiteTrafficEndpointCounts{Visits: 4,
			First: repository.SiteTrafficEndpointSideCounts{UndeterminedVisits: 2, Pages: []repository.SiteTrafficEndpointPageCounts{{Page: "assets", Visits: 2}}},
			Last:  repository.SiteTrafficEndpointSideCounts{UndeterminedVisits: 1, Pages: []repository.SiteTrafficEndpointPageCounts{{Page: "create", Visits: 3}}},
		},
		Paths: repository.SiteTrafficPathCounts{Visits: 2, AmbiguousVisits: 1, Rows: []repository.SiteTrafficPathPairCounts{
			{From: "assets", To: "create", Visits: 2}, {From: "create", To: "assets", Visits: 1},
		}},
		Funnel: []repository.SiteTrafficFunnelCounts{
			{Step: 1, Visits: 4, PossibleVisits: 4}, {Step: 2, Visits: 3, PossibleVisits: 4},
			{Step: 3, Visits: 2, PossibleVisits: 3}, {Step: 4, Visits: 1, PossibleVisits: 2},
		},
	}
	current := repository.SiteTrafficCounts{Visitors: 1000, PageViews: 2000, Visits: 999, Actions: 150}
	previous := repository.SiteTrafficCounts{Visitors: 1, PageViews: 1800, Visits: 1000, Actions: 100}
	result := buildSiteTrafficOperations(counts, from, from.AddDate(0, 0, -10), current, SiteTrafficComparison{Status: "ready", KPI: &previous})
	if result.Endpoints.Visits != 4 || result.Endpoints.First.UndeterminedVisits != 2 || result.Endpoints.Last.UndeterminedVisits != 1 ||
		len(result.Endpoints.First.Pages) != 1 || result.Endpoints.First.Pages[0].Rate == nil || *result.Endpoints.First.Pages[0].Rate != 0.5 ||
		len(result.Endpoints.Last.Pages) != 1 || result.Endpoints.Last.Pages[0].Rate == nil || *result.Endpoints.Last.Pages[0].Rate != 0.75 {
		t.Fatalf("endpoints must not borrow KPI/other aggregate denominators: %+v", result.Endpoints)
	}
	if result.Paths.Visits != 2 || result.Paths.AmbiguousVisits != 1 || len(result.Paths.Rows) != 2 ||
		result.Paths.Rows[0].Rate == nil || *result.Paths.Rows[0].Rate != 1 || result.Paths.Rows[1].Rate == nil || *result.Paths.Rows[1].Rate != 0.5 {
		t.Fatalf("path pairs may overlap; rates must not be normalized to a partition: %+v", result.Paths)
	}
	keys := []string{"inspirations", "open_create", "create", "submit"}
	previousRates := []float64{0, 0.75, 2.0 / 3, 0.5}
	if len(result.Funnel.Steps) != 4 {
		t.Fatalf("funnel shape = %+v", result.Funnel)
	}
	for index, step := range result.Funnel.Steps {
		uncertain := int64(1)
		if index == 0 {
			uncertain = 0
		}
		if step.Key != keys[index] || step.Visits != int64(4-index) || step.PossibleVisits != counts.Funnel[index].PossibleVisits || step.UncertainVisits != uncertain || step.Rate == nil || *step.Rate != float64(4-index)/4 {
			t.Fatalf("funnel step %d = %+v", index, step)
		}
		if index == 0 {
			if step.PreviousRate != nil {
				t.Fatalf("first step has no previous denominator: %+v", step)
			}
		} else if step.PreviousRate == nil || *step.PreviousRate != previousRates[index] {
			t.Fatalf("funnel previous rate = %+v", step)
		}
	}
	wantPrevious := []int64{1, 1800, 1000, 100}
	wantStatus := []string{"insufficient_sample", "stable", "stable", "increase"}
	for index, metric := range result.Anomalies.Metrics {
		if metric.Previous == nil || *metric.Previous != wantPrevious[index] || metric.Status != wantStatus[index] {
			t.Fatalf("anomaly used another metric's comparison denominator: %+v", result.Anomalies)
		}
	}
}

func TestSiteTrafficAnomalyRulesThresholdsZeroAndInsufficientSamples(t *testing.T) {
	for _, test := range []struct {
		name              string
		current, previous int64
		status            string
	}{
		{"both-zero", 0, 0, "zero_baseline"}, {"growth-from-zero", 100, 0, "zero_baseline"},
		{"small-positive-baseline", 100, 1, "insufficient_sample"}, {"just-under-baseline", 100, 29, "insufficient_sample"},
		{"baseline-and-absolute-increase-boundaries", 40, 30, "increase"}, {"baseline-and-absolute-decrease-boundaries", 20, 30, "decrease"},
		{"absolute-increase-under-ten", 39, 30, "stable"}, {"absolute-decrease-under-ten", 21, 30, "stable"},
		{"relative-increase-at-thirty-percent", 130, 100, "increase"}, {"relative-decrease-at-thirty-percent", 70, 100, "decrease"},
		{"relative-increase-under-thirty-percent", 129, 100, "stable"}, {"relative-decrease-under-thirty-percent", 71, 100, "stable"},
		{"absolute-ten-with-insufficient-relative-change", 44, 34, "stable"}, {"no-change", 30, 30, "stable"}, {"drop-to-zero", 0, 30, "decrease"},
	} {
		t.Run(test.name, func(t *testing.T) {
			current := repository.SiteTrafficCounts{Visitors: test.current, PageViews: test.current, Visits: test.current, Actions: test.current}
			previous := repository.SiteTrafficCounts{Visitors: test.previous, PageViews: test.previous, Visits: test.previous, Actions: test.previous}
			result := buildSiteTrafficAnomalies(current, SiteTrafficComparison{Status: "ready", KPI: &previous})
			if result.Status != "ready" || result.Rules != (SiteTrafficAnomalyRules{MinimumBaseline: 30, MinimumAbsoluteChange: 10, RelativeThreshold: 0.3}) || len(result.Metrics) != 4 {
				t.Fatalf("anomaly policy contract = %+v", result)
			}
			for index, metric := range result.Metrics {
				if metric.Key != []string{"visitors", "pageViews", "visits", "actions"}[index] || metric.Current != test.current || metric.Previous == nil || *metric.Previous != test.previous || metric.Status != test.status {
					t.Fatalf("anomaly metric contract = %+v", result)
				}
				if test.previous == 0 {
					if metric.RelativeChange != nil {
						t.Fatalf("zero baseline must not divide by zero: %+v", metric)
					}
				} else if metric.RelativeChange == nil || *metric.RelativeChange != float64(test.current-test.previous)/float64(test.previous) {
					t.Fatalf("relative change = %+v", metric)
				}
			}
		})
	}
	for _, status := range []string{"outside_retention", "insufficient_history"} {
		previous := repository.SiteTrafficCounts{Visitors: 30, PageViews: 100, Visits: 50, Actions: 70}
		result := buildSiteTrafficAnomalies(repository.SiteTrafficCounts{Visitors: 50}, SiteTrafficComparison{Status: status, KPI: &previous})
		if result.Status != status || len(result.Metrics) != 4 {
			t.Fatalf("history status must follow comparison: %+v", result)
		}
		for _, metric := range result.Metrics {
			if metric.Status != "unavailable" || metric.Previous != nil || metric.RelativeChange != nil {
				t.Fatalf("unavailable history cannot be zero or comparable: %+v", metric)
			}
		}
	}
}

func TestSiteTrafficOperationsJSONPreservesOldInsightsAndEmptyNullContract(t *testing.T) {
	for _, boundary := range []bool{false, true} {
		svc, _ := siteTrafficServiceFixture(t)
		now := time.Date(2026, 11, 10, 12, 0, 0, 0, siteTrafficLocation)
		from := siteTrafficToday(now)
		if boundary {
			from = siteTrafficRetentionStart(now)
		}
		date := from.Format("2006-01-02")
		result, err := svc.adminSiteTrafficOverviewAt(context.Background(), SiteTrafficQuery{From: date, To: date}, now)
		if err != nil {
			t.Fatal(err)
		}
		data, err := json.Marshal(result.Insights)
		if err != nil {
			t.Fatalf("null denominators must never produce NaN/Infinity: %v", err)
		}
		var insights map[string]json.RawMessage
		if err := json.Unmarshal(data, &insights); err != nil {
			t.Fatal(err)
		}
		if len(insights) != 5 || len(result.Insights.Heatmap) != 168 || len(result.Insights.FeatureTrend) != 1 || len(result.Insights.PageEngagement) != 13 || len(result.Insights.Depth.Buckets) != 3 {
			t.Fatalf("operations replaced old insight blocks: %s", data)
		}
		for _, key := range []string{"heatmap", "featureTrend", "pageEngagement", "depth", "operations"} {
			if _, ok := insights[key]; !ok {
				t.Fatalf("missing insight block %s", key)
			}
		}
		var operations map[string]json.RawMessage
		if err := json.Unmarshal(insights["operations"], &operations); err != nil || len(operations) != 5 {
			t.Fatalf("operations JSON shape = %s, %v", insights["operations"], err)
		}
		for _, key := range []string{"visitorMix", "endpoints", "paths", "funnel", "anomalies"} {
			if _, ok := operations[key]; !ok {
				t.Fatalf("missing operations key %s", key)
			}
		}
		if strings.Count(string(operations["endpoints"]), `"pages":[]`) != 2 || !strings.Contains(string(operations["paths"]), `"rows":[]`) ||
			strings.Contains(string(data), "visitorHash") || strings.Contains(string(data), "sessionHash") || strings.Contains(string(data), "events") {
			t.Fatalf("empty arrays or aggregate-only privacy contract = %s", data)
		}
		mix := result.Insights.Operations.VisitorMix
		if boundary && (mix.Status != "no_lookback" || mix.FirstObservedVisitors != nil || mix.ReturningVisitors != nil) {
			t.Fatalf("retention boundary lacks a prior window: %+v", mix)
		}
		if !boundary && (mix.Status != "ready" || mix.FirstObservedVisitors == nil || *mix.FirstObservedVisitors != 0 || mix.ReturningVisitors == nil || *mix.ReturningVisitors != 0) {
			t.Fatalf("unknown availableFrom is not a no-lookback signal: %+v", mix)
		}
		if mix.FirstObservedRate != nil || mix.ReturningRate != nil {
			t.Fatalf("zero PV visitors must not have mix rates: %+v", mix)
		}
		for index, step := range result.Insights.Operations.Funnel.Steps {
			if step.Key != []string{"inspirations", "open_create", "create", "submit"}[index] || step.Visits != 0 || step.PossibleVisits != 0 || step.UncertainVisits != 0 || step.Rate != nil || step.PreviousRate != nil {
				t.Fatalf("empty fixed funnel = %+v", step)
			}
		}
	}
}

func TestSiteTrafficOperationsAssembleAfterComparisonAndKeepTodayAtTwoQueries(t *testing.T) {
	for _, mode := range []string{"unknown-history", "retained-history", "ready-zero", "outside-retention"} {
		t.Run(mode, func(t *testing.T) {
			svc, db := siteTrafficServiceFixture(t)
			now := time.Date(2026, 11, 10, 12, 0, 0, 0, siteTrafficLocation)
			from := siteTrafficToday(now)
			retained := siteTrafficRetentionStart(now)
			if mode == "outside-retention" {
				from = retained
			}
			seed := []time.Time{from.Add(time.Second)}
			if mode == "retained-history" || mode == "ready-zero" {
				seed = append(seed, retained)
			}
			if mode == "retained-history" {
				seed = append(seed, from.AddDate(0, 0, -1))
			}
			for _, at := range seed {
				if err := db.Create(&model.SiteTrafficEvent{ID: uuid.NewString(), ReceivedAtEpoch: at.Unix(),
					VisitorHash: at.String(), SessionHash: at.String(), Type: "page_view", Page: "inspirations"}).Error; err != nil {
					t.Fatal(err)
				}
			}
			queries := 0
			callback := "site-traffic-operations-app-count"
			if err := db.Callback().Row().Before("gorm:row").Register(callback, func(tx *gorm.DB) { queries++ }); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = db.Callback().Row().Remove(callback) })
			date := from.Format("2006-01-02")
			result, err := svc.adminSiteTrafficOverviewAt(context.Background(), SiteTrafficQuery{From: date, To: date}, now)
			if err != nil {
				t.Fatal(err)
			}
			wantStatus, wantQueries := "insufficient_history", 13
			if mode == "retained-history" || mode == "ready-zero" {
				wantStatus, wantQueries = "ready", 14
			} else if mode == "outside-retention" {
				wantStatus = "outside_retention"
			}
			if queries != wantQueries || result.Comparison.Status != wantStatus || result.Insights.Operations.Anomalies.Status != wantStatus ||
				!reflect.DeepEqual(result.Insights.Operations.Anomalies, buildSiteTrafficAnomalies(result.KPI, result.Comparison)) {
				t.Fatalf("operations must use the completed comparison without querying again: queries=%d want=%d overview=%+v", queries, wantQueries, result)
			}
			queries = 0
			if today, err := svc.adminSiteTrafficTodayAt(context.Background(), now); err != nil || today == nil || queries != 2 {
				t.Fatalf("operations changed today query count: today=%+v queries=%d err=%v", today, queries, err)
			}
		})
	}
}

func TestSiteTrafficOperationsPropagateFourteenthComparisonFailure(t *testing.T) {
	for _, mode := range []string{"canceled", "database-error"} {
		t.Run(mode, func(t *testing.T) {
			svc, db := siteTrafficServiceFixture(t)
			now := time.Date(2026, 11, 10, 12, 0, 0, 0, siteTrafficLocation)
			if err := db.Create(&model.SiteTrafficEvent{ID: uuid.NewString(), ReceivedAtEpoch: siteTrafficRetentionStart(now).Unix(), Type: "page_view", Page: "inspirations"}).Error; err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			queries, sentinel := 0, errors.New("comparison failed after operations")
			callback := "site-traffic-operations-failing-comparison"
			if err := db.Callback().Row().Before("gorm:row").Register(callback, func(tx *gorm.DB) {
				queries++
				if queries == 14 {
					if mode == "canceled" {
						cancel()
					} else {
						tx.AddError(sentinel)
					}
				}
			}); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = db.Callback().Row().Remove(callback) })
			result, err := svc.adminSiteTrafficOverviewAt(ctx, SiteTrafficQuery{From: "2026-11-10", To: "2026-11-10"}, now)
			want := sentinel
			if mode == "canceled" {
				want = context.Canceled
			}
			if result != nil || !errors.Is(err, want) || queries != 14 {
				t.Fatalf("comparison failure became partial operations success: result=%+v err=%v queries=%d", result, err, queries)
			}
		})
	}
}
