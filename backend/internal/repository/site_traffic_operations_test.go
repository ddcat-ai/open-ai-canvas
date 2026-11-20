package repository

import (
	"context"
	"reflect"
	"testing"
	"time"

	"yingce/backend/internal/model"

	"github.com/google/uuid"
)

func siteTrafficOperationEvent(session, page, kind, action string, at time.Time) model.SiteTrafficEvent {
	return model.SiteTrafficEvent{ID: uuid.NewString(), VisitorHash: session, SessionHash: session,
		Page: page, Type: kind, Action: action, ReceivedAtEpoch: at.Unix()}
}

func TestSiteTrafficVisitorMixUsesOnlyRetainedPriorPVAndCurrentPVVisitors(t *testing.T) {
	repo, db := siteTrafficRepositoryFixture(t)
	from := time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC)
	to, retained := from.Add(time.Hour), from.AddDate(0, 0, -10)
	var events []model.SiteTrafficEvent
	add := func(visitor, session, page, kind string, at time.Time) {
		row := siteTrafficOperationEvent(session, page, kind, "", at)
		row.VisitorHash = visitor
		events = append(events, row)
	}
	add("returning", "prior", "tools_image", "page_view", retained)
	add("returning", "prior", "create", "page_view", from.Add(-time.Second))
	add("returning", "current-1", "inspirations", "page_view", from)
	add("returning", "current-2", "tools_video", "page_view", to.Add(-time.Second))
	add("expired", "old", "create", "page_view", retained.Add(-time.Second))
	add("expired", "current", "create", "page_view", from)
	add("prior-action", "old", "create", "action", from.Add(-time.Second))
	add("prior-action", "current", "create", "page_view", from)
	add("newcomer", "current", "assets", "page_view", from.Add(time.Second))
	add("at-start", "current", "canvas", "page_view", from)
	add("prior-only", "old", "assets", "page_view", retained)
	add("action-only", "current", "create", "action", from)
	add("at-end", "future", "create", "page_view", to)
	for _, page := range []string{"welcome", "plugins", "share", "library", "runninghub", "other", "tools", "auth", "account"} {
		add("legacy-prior", "old-"+page, page, "page_view", retained)
		add("legacy-current-"+page, "current-"+page, page, "page_view", from)
	}
	add("legacy-prior", "current", "create", "page_view", from)
	if _, err := repo.InsertSiteTrafficEvents(events); err != nil {
		t.Fatal(err)
	}
	var before []model.SiteTrafficEvent
	if err := db.Order("id ASC").Find(&before).Error; err != nil {
		t.Fatal(err)
	}
	result, err := repo.WithContext(context.Background()).siteTrafficOperations(from, to, retained)
	if err != nil {
		t.Fatal(err)
	}
	if result.VisitorMix != (SiteTrafficVisitorMixCounts{Visitors: 6, FirstObservedVisitors: 5, ReturningVisitors: 1}) ||
		result.VisitorMix.FirstObservedVisitors+result.VisitorMix.ReturningVisitors != result.VisitorMix.Visitors {
		t.Fatalf("mix must be mutually exclusive and based on prior retained current-page PV: %+v", result.VisitorMix)
	}
	var after []model.SiteTrafficEvent
	if err := db.Order("id ASC").Find(&after).Error; err != nil || !reflect.DeepEqual(before, after) {
		t.Fatalf("operations rewrote or cleared history: before=%d after=%d err=%v", len(before), len(after), err)
	}
}

func TestSiteTrafficEndpointsKeepSameSecondAmbiguityAndDuplicateSamePage(t *testing.T) {
	repo, _ := siteTrafficRepositoryFixture(t)
	from := time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC)
	var events []model.SiteTrafficEvent
	add := func(session, page string, second int) {
		events = append(events, siteTrafficOperationEvent(session, page, "page_view", "", from.Add(time.Duration(second)*time.Second)))
	}
	add("same-page", "create", 0)
	add("same-page", "create", 0)
	add("same-page", "create", 1)
	add("first-ambiguous", "assets", 2)
	add("first-ambiguous", "inspirations", 2)
	add("first-ambiguous", "create", 3)
	add("last-ambiguous", "history", 4)
	add("last-ambiguous", "canvas", 5)
	add("last-ambiguous", "assets", 5)
	add("both-ambiguous", "tools_image", 6)
	add("both-ambiguous", "tools_video", 6)
	add("single", "inspirations", 7)
	add("single", "inspirations", 7)
	add("middle-ambiguous", "assets", 8)
	add("middle-ambiguous", "history", 9)
	add("middle-ambiguous", "canvas", 9)
	add("middle-ambiguous", "tools_video", 10)
	add("single", "canvas", -1)
	add("single", "canvas", 3600)
	add("same-page", "auth", 0)
	events = append(events, siteTrafficOperationEvent("action-only", "create", "action", "open_create", from))
	// 同一访客可有多个会话，端点分母必须按本查询的PV session计数。
	for index := range events {
		events[index].VisitorHash = "shared-visitor"
	}
	if _, err := repo.InsertSiteTrafficEvents(events); err != nil {
		t.Fatal(err)
	}
	result, err := repo.siteTrafficOperations(from, from.Add(time.Hour), from)
	if err != nil {
		t.Fatal(err)
	}
	want := SiteTrafficEndpointCounts{Visits: 6,
		First: SiteTrafficEndpointSideCounts{UndeterminedVisits: 2, Pages: []SiteTrafficEndpointPageCounts{
			{Page: "assets", Visits: 1}, {Page: "create", Visits: 1}, {Page: "history", Visits: 1}, {Page: "inspirations", Visits: 1},
		}},
		Last: SiteTrafficEndpointSideCounts{UndeterminedVisits: 2, Pages: []SiteTrafficEndpointPageCounts{
			{Page: "create", Visits: 2}, {Page: "inspirations", Visits: 1}, {Page: "tools_video", Visits: 1},
		}},
	}
	if !reflect.DeepEqual(result.Endpoints, want) {
		t.Fatalf("range endpoints or deterministic sort = %+v, want %+v", result.Endpoints, want)
	}
	for _, side := range []SiteTrafficEndpointSideCounts{result.Endpoints.First, result.Endpoints.Last} {
		sum := side.UndeterminedVisits
		for _, page := range side.Pages {
			sum += page.Visits
		}
		if sum != result.Endpoints.Visits {
			t.Fatalf("endpoint sum %d differs from its own visits %d", sum, result.Endpoints.Visits)
		}
	}
}

func TestSiteTrafficOperationsKeepAllThirteenCurrentPagesAndBoundEndpointRows(t *testing.T) {
	repo, _ := siteTrafficRepositoryFixture(t)
	from := time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC)
	pages := []string{"assets", "canvas", "canvas_list", "create", "drama", "ecommerce", "ecommerce_pipeline", "history", "inspirations", "referral", "skills", "tools_image", "tools_video"}
	var events []model.SiteTrafficEvent
	for index := len(pages) - 1; index >= 0; index-- {
		row := siteTrafficOperationEvent(pages[index], pages[index], "page_view", "", from)
		row.VisitorHash = "one-visitor"
		events = append(events, row)
	}
	if _, err := repo.InsertSiteTrafficEvents(events); err != nil {
		t.Fatal(err)
	}
	result, err := repo.siteTrafficOperations(from, from.Add(time.Second), from)
	if err != nil {
		t.Fatal(err)
	}
	if result.VisitorMix.Visitors != 1 || result.Endpoints.Visits != 13 || result.Paths.Visits != 13 || len(result.Paths.Rows) != 0 {
		t.Fatalf("current-page scope or independent denominators = %+v", result)
	}
	for _, side := range []SiteTrafficEndpointSideCounts{result.Endpoints.First, result.Endpoints.Last} {
		if side.UndeterminedVisits != 0 || len(side.Pages) != 13 {
			t.Fatalf("current-page endpoints = %+v", side)
		}
		for index, page := range side.Pages {
			if page.Page != pages[index] || page.Visits != 1 {
				t.Fatalf("endpoint tie ordering = %+v", side.Pages)
			}
		}
	}
}

func TestSiteTrafficPathsDoNotBridgeAmbiguityAndDeduplicatePairsPerSession(t *testing.T) {
	repo, _ := siteTrafficRepositoryFixture(t)
	from := time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC)
	var events []model.SiteTrafficEvent
	add := func(session, page string, second int) {
		events = append(events, siteTrafficOperationEvent(session, page, "page_view", "", from.Add(time.Duration(second)*time.Second)))
	}
	add("ambiguous", "assets", 0)
	add("ambiguous", "history", 1)
	add("ambiguous", "canvas", 1)
	add("ambiguous", "create", 2)
	add("ambiguous", "inspirations", 3)
	for second, page := range []string{"assets", "create", "assets", "create", "create", "inspirations"} {
		add("repeat-pair", page, second)
	}
	add("repeat-pair", "create", 1)
	add("second-session", "assets", 0)
	add("second-session", "create", 1)
	add("single", "tools_image", 0)
	add("only-ambiguous", "tools_image", 0)
	add("only-ambiguous", "tools_video", 0)
	add("second-session", "auth", 0)
	add("second-session", "account", 1)
	add("ambiguous", "tools_video", -1)
	add("ambiguous", "tools_image", 3600)
	events = append(events, siteTrafficOperationEvent("action-only", "create", "action", "open_create", from))
	if _, err := repo.InsertSiteTrafficEvents(events); err != nil {
		t.Fatal(err)
	}
	result, err := repo.siteTrafficOperations(from, from.Add(time.Hour), from)
	if err != nil {
		t.Fatal(err)
	}
	want := SiteTrafficPathCounts{Visits: 5, AmbiguousVisits: 2, Rows: []SiteTrafficPathPairCounts{
		{From: "assets", To: "create", Visits: 2},
		{From: "create", To: "inspirations", Visits: 2},
		{From: "create", To: "assets", Visits: 1},
	}}
	if !reflect.DeepEqual(result.Paths, want) {
		t.Fatalf("adjacent unique buckets must not skip ambiguous buckets or repeat a session/pair: %+v, want %+v", result.Paths, want)
	}
}

func TestSiteTrafficPathsTopTenUseStablePairTieOrder(t *testing.T) {
	repo, _ := siteTrafficRepositoryFixture(t)
	from := time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC)
	pages := []string{"canvas", "canvas_list", "create", "drama", "ecommerce", "ecommerce_pipeline", "history", "inspirations", "referral", "skills", "tools_image", "tools_video"}
	var events []model.SiteTrafficEvent
	for index := len(pages) - 1; index >= 0; index-- {
		page := pages[index]
		events = append(events, siteTrafficOperationEvent(page, "assets", "page_view", "", from),
			siteTrafficOperationEvent(page, page, "page_view", "", from.Add(time.Second)))
	}
	if _, err := repo.InsertSiteTrafficEvents(events); err != nil {
		t.Fatal(err)
	}
	result, err := repo.siteTrafficOperations(from, from.Add(time.Minute), from)
	if err != nil {
		t.Fatal(err)
	}
	if result.Paths.Visits != 12 || result.Paths.AmbiguousVisits != 0 || len(result.Paths.Rows) != 10 {
		t.Fatalf("top ten must keep all PV sessions in denominator: %+v", result.Paths)
	}
	for index, row := range result.Paths.Rows {
		if row != (SiteTrafficPathPairCounts{From: "assets", To: pages[index], Visits: 1}) {
			t.Fatalf("top-ten count/from/to order = %+v", result.Paths.Rows)
		}
	}
}

func TestSiteTrafficOperationsEmptyAndActionOnlyHaveNoPVVisits(t *testing.T) {
	for _, actionOnly := range []bool{false, true} {
		repo, _ := siteTrafficRepositoryFixture(t)
		from := time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC)
		if actionOnly {
			if _, err := repo.InsertSiteTrafficEvents([]model.SiteTrafficEvent{
				siteTrafficOperationEvent("only", "inspirations", "action", "open_create", from),
				siteTrafficOperationEvent("only", "create", "action", "creation_submit_agent", from.Add(time.Second)),
			}); err != nil {
				t.Fatal(err)
			}
		}
		result, err := repo.siteTrafficOperations(from, from.Add(time.Hour), from)
		if err != nil {
			t.Fatal(err)
		}
		want := SiteTrafficOperationsAggregates{
			Endpoints: SiteTrafficEndpointCounts{
				First: SiteTrafficEndpointSideCounts{Pages: []SiteTrafficEndpointPageCounts{}},
				Last:  SiteTrafficEndpointSideCounts{Pages: []SiteTrafficEndpointPageCounts{}},
			},
			Paths:  SiteTrafficPathCounts{Rows: []SiteTrafficPathPairCounts{}},
			Funnel: []SiteTrafficFunnelCounts{{Step: 1}, {Step: 2}, {Step: 3}, {Step: 4}},
		}
		if !reflect.DeepEqual(result, want) {
			t.Fatalf("empty/action-only=%t returned visits or nullable arrays: %+v", actionOnly, result)
		}
	}
}
