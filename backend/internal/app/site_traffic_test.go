package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
	"yingce/backend/internal/repository"

	"github.com/google/uuid"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	_ "modernc.org/sqlite"
)

func siteTrafficServiceFixture(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Dialector{DriverName: "sqlite", DSN: ":memory:"}, &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	connection, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = connection.Close() })
	if err := db.AutoMigrate(&model.SiteTrafficEvent{}); err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db), coordinator: platform.NewCoordinatorWithRedis(nil, "site-traffic-test")}, db
}

func validSiteTrafficRequest() SiteTrafficBatchRequest {
	return SiteTrafficBatchRequest{Events: []SiteTrafficEventRequest{{
		ID: uuid.NewString(), VisitorID: uuid.NewString(), SessionID: uuid.NewString(), Type: "page_view", Page: "inspirations",
	}}}
}

func TestSiteTrafficPreparationStoresOnlyDigestsAndServerEpoch(t *testing.T) {
	request := validSiteTrafficRequest()
	event := request.Events[0]
	now := time.Date(2026, 10, 1, 0, 1, 0, 0, siteTrafficLocation)
	rows, err := prepareSiteTrafficEvents(request, now)
	if err != nil || len(rows) != 1 {
		t.Fatalf("prepare = %+v, %v", rows, err)
	}
	visitor := sha256.Sum256([]byte(event.VisitorID))
	session := sha256.Sum256([]byte(event.SessionID))
	if rows[0].VisitorHash != hex.EncodeToString(visitor[:]) || rows[0].SessionHash != hex.EncodeToString(session[:]) || rows[0].ReceivedAtEpoch != now.UTC().Unix() {
		t.Fatalf("wrong storage projection: %+v", rows[0])
	}
	upper := request
	upper.Events = append([]SiteTrafficEventRequest(nil), request.Events...)
	upper.Events[0].VisitorID = strings.ToUpper(event.VisitorID)
	canonical, err := prepareSiteTrafficEvents(upper, now)
	if err != nil || canonical[0].VisitorHash != rows[0].VisitorHash {
		t.Fatal("UUID casing must not split anonymous identity")
	}
}

func TestSiteTrafficPreparationKeepsThirteenPagesSevenActionsAndRejectsLegacyBatches(t *testing.T) {
	pages := []string{
		"inspirations", "create", "canvas_list", "canvas", "assets", "history", "ecommerce", "ecommerce_pipeline", "drama",
		"skills", "referral", "tools_image", "tools_video",
	}
	actions := []string{"open_create", "new_canvas", "open_ecommerce", "creation_submit_text", "creation_submit_image", "creation_submit_video", "creation_submit_agent"}
	if len(siteTrafficPages) != len(pages) || len(siteTrafficActions) != len(actions) {
		t.Fatalf("intake must keep exactly 13 pages and seven actions: %d/%d", len(siteTrafficPages), len(siteTrafficActions))
	}
	for _, page := range pages {
		t.Run(page, func(t *testing.T) {
			request := validSiteTrafficRequest()
			request.Events[0].Page = page
			for _, action := range actions {
				event := request.Events[0]
				event.ID, event.Type, event.Action = uuid.NewString(), "action", action
				request.Events = append(request.Events, event)
			}
			rows, err := prepareSiteTrafficEvents(request, time.Now())
			if err != nil || len(rows) != 8 {
				t.Fatalf("current page or registered action rejected: %s %+v, %v", page, rows, err)
			}
			for index, row := range rows {
				if row.Page != page || (index > 0 && row.Action != actions[index-1]) {
					t.Fatalf("page/action was remapped: %+v", row)
				}
			}
		})
	}
	for _, page := range []string{"welcome", "plugins", "share", "library", "runninghub", "other", "tools", "auth", "account"} {
		for _, kind := range []string{"page_view", "action"} {
			t.Run(page+"/"+kind, func(t *testing.T) {
				svc, db := siteTrafficServiceFixture(t)
				request := validSiteTrafficRequest()
				legacy := request.Events[0]
				legacy.ID, legacy.Page, legacy.Type = uuid.NewString(), page, kind
				if kind == "action" {
					legacy.Action = "open_create"
				}
				request.Events = append(request.Events, legacy)
				result, err := svc.RecordSiteTrafficEvents(context.Background(), request)
				var appErr *AppError
				if result != nil || !errors.As(err, &appErr) || appErr.Status != 400 {
					t.Fatalf("legacy event must reject the whole batch: %+v, %v", result, err)
				}
				var count int64
				if err := db.Model(&model.SiteTrafficEvent{}).Count(&count).Error; err != nil || count != 0 {
					t.Fatalf("legacy batch was filtered or partially persisted: %d, %v", count, err)
				}
			})
		}
	}
}

func TestSiteTrafficPreparationRejectsInvalidEventsBeforeAnyWrite(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(*SiteTrafficEventRequest)
	}{
		{"bad-id", func(e *SiteTrafficEventRequest) { e.ID = "bad" }},
		{"uuid-urn", func(e *SiteTrafficEventRequest) { e.ID = "urn:uuid:" + e.ID }},
		{"nil-visitor", func(e *SiteTrafficEventRequest) { e.VisitorID = uuid.Nil.String() }},
		{"uuid-v1", func(e *SiteTrafficEventRequest) { e.SessionID = "550e8400-e29b-11d4-a716-446655440000" }},
		{"bad-page", func(e *SiteTrafficEventRequest) { e.Page = "/canvas?token=secret" }},
		{"pv-action", func(e *SiteTrafficEventRequest) { e.Action = "new_canvas" }},
		{"unknown-type", func(e *SiteTrafficEventRequest) { e.Type = "success" }},
		{"action-missing", func(e *SiteTrafficEventRequest) { e.Type = "action" }},
		{"action-unknown", func(e *SiteTrafficEventRequest) { e.Type, e.Action = "action", "save_success" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			svc, db := siteTrafficServiceFixture(t)
			request := validSiteTrafficRequest()
			bad := request.Events[0]
			test.change(&bad)
			request.Events = append(request.Events, bad)
			if _, err := svc.RecordSiteTrafficEvents(context.Background(), request); err == nil {
				t.Fatal("invalid event accepted")
			}
			var count int64
			if err := db.Model(&model.SiteTrafficEvent{}).Count(&count).Error; err != nil || count != 0 {
				t.Fatalf("batch was partially written: %d, %v", count, err)
			}
		})
	}
	for _, count := range []int{0, 21} {
		request := SiteTrafficBatchRequest{Events: make([]SiteTrafficEventRequest, count)}
		if _, err := prepareSiteTrafficEvents(request, time.Now()); err == nil {
			t.Fatalf("accepted batch size %d", count)
		}
	}
	request := validSiteTrafficRequest()
	request.Events[0].Type, request.Events[0].Action, request.Events[0].Page = "action", "creation_submit_agent", "canvas"
	if _, err := prepareSiteTrafficEvents(request, time.Now()); err != nil {
		t.Fatalf("registered action intent rejected: %v", err)
	}
}

func TestSiteTrafficRangeValidationUsesInclusiveBeijingCalendarWindow(t *testing.T) {
	// UTC仍是11月9日，北京时间已经进入11月10日。
	now := time.Date(2026, 11, 9, 16, 1, 0, 0, time.UTC)
	from, to, err := parseSiteTrafficRange(SiteTrafficQuery{}, now)
	if err != nil || from.Format("2006-01-02") != "2026-10-12" || to.Format("2006-01-02") != "2026-11-11" || to.Sub(from) != 30*24*time.Hour {
		t.Fatalf("default range = %v/%v, %v", from, to, err)
	}
	cutoff := siteTrafficRetentionStart(now)
	if cutoff.Format("2006-01-02") != "2025-11-11" || cutoff.UTC().Hour() != 16 {
		t.Fatalf("retention cutoff = %v", cutoff)
	}
	from, to, err = parseSiteTrafficRange(SiteTrafficQuery{From: "2025-11-11", To: "2026-11-10"}, now)
	if err != nil || to.Sub(from) != 365*24*time.Hour {
		t.Fatalf("inclusive 365 days = %v/%v, %v", from, to, err)
	}
	for _, query := range []SiteTrafficQuery{
		{From: "2025-11-10", To: "2026-11-10"}, {From: "2026-11-10", To: "2026-11-09"},
		{To: "2026-11-11"}, {From: "2026-02-30"}, {From: "2026-1-01"}, {To: " 2026-11-10"},
		{From: "2026-11-10T00:00:00Z"}, {To: "2025-11-11"},
	} {
		if _, _, err := parseSiteTrafficRange(query, now); err == nil {
			t.Fatalf("invalid/out-of-window range silently accepted: %+v", query)
		}
	}
}

func TestSiteTrafficOverviewAuthorizesAndReportsEmptyStateWithoutCleanup(t *testing.T) {
	svc, db := siteTrafficServiceFixture(t)
	for index, actor := range []*model.User{nil, {ID: "regular", Role: model.UserRoleUser}} {
		result, err := svc.AdminSiteTrafficOverview(context.Background(), actor, SiteTrafficQuery{})
		var appErr *AppError
		want := 401
		if index == 1 {
			want = 403
		}
		if result != nil || !errors.As(err, &appErr) || appErr.Status != want {
			t.Fatalf("unauthorized actor accepted: %+v, %v, want %d", result, err, want)
		}
	}
	old := model.SiteTrafficEvent{ID: uuid.NewString(), ReceivedAtEpoch: siteTrafficRetentionStart(time.Now()).Unix() - 1}
	if err := db.Create(&old).Error; err != nil {
		t.Fatal(err)
	}
	result, err := svc.AdminSiteTrafficOverview(context.Background(), &model.User{ID: "admin", Role: model.UserRoleAdmin}, SiteTrafficQuery{})
	if err != nil || result.KPI != (repository.SiteTrafficCounts{}) || result.AvailableFrom != nil || len(result.Trend) != 30 || len(result.Pages) != 0 || len(result.Actions) != 0 {
		t.Fatalf("empty overview = %+v, %v", result, err)
	}
	for _, point := range result.Trend {
		if point.SiteTrafficCounts != (repository.SiteTrafficCounts{}) {
			t.Fatalf("empty day is not zero: %+v", point)
		}
	}
	data, err := json.Marshal(result)
	if err != nil || !strings.Contains(string(data), `"availableFrom":null`) || !strings.Contains(string(data), `"pages":[]`) || !strings.Contains(string(data), `"actions":[]`) || !strings.Contains(string(data), `"timeZone":"Asia/Shanghai"`) {
		t.Fatalf("empty JSON contract = %s, %v", data, err)
	}
	var count int64
	if err := db.Model(&model.SiteTrafficEvent{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("GET triggered cleanup: %d, %v", count, err)
	}
}

func TestSiteTrafficComparisonUsesSameSecondForCurrentAndPrevious(t *testing.T) {
	now := time.Date(2026, 11, 10, 12, 34, 56, 987000000, siteTrafficLocation)
	cutoff := now.Truncate(time.Second)
	for _, days := range []int{1, 7, 30} {
		t.Run((time.Duration(days) * 24 * time.Hour).String(), func(t *testing.T) {
			svc, db := siteTrafficServiceFixture(t)
			from := siteTrafficToday(now).AddDate(0, 0, -(days - 1))
			previousFrom, previousCutoff := from.AddDate(0, 0, -days), cutoff.AddDate(0, 0, -days)
			for _, at := range []time.Time{
				siteTrafficRetentionStart(now), from, cutoff, cutoff.Add(time.Second),
				previousFrom, previousCutoff, previousCutoff.Add(time.Second),
			} {
				if err := db.Create(&model.SiteTrafficEvent{
					ID: uuid.NewString(), VisitorHash: at.String(), SessionHash: at.String(),
					ReceivedAtEpoch: at.Unix(), Type: "page_view", Page: "inspirations",
				}).Error; err != nil {
					t.Fatal(err)
				}
			}
			result, err := svc.adminSiteTrafficOverviewAt(context.Background(), SiteTrafficQuery{
				From: from.Format("2006-01-02"), To: "2026-11-10",
			}, now.UTC())
			if err != nil {
				t.Fatal(err)
			}
			want := repository.SiteTrafficCounts{Visitors: 1, PageViews: 1, Visits: 1}
			if result.KPI != want || result.Comparison.Status != "ready" || result.Comparison.KPI == nil || *result.Comparison.KPI != want {
				t.Fatalf("same-time half-open counts = %+v, previous = %+v", result.KPI, result.Comparison)
			}
			if result.AsOf != cutoff.UTC().Format(time.RFC3339) || result.EffectiveTo != result.AsOf || result.EffectiveFrom != from.UTC().Format(time.RFC3339) ||
				result.Comparison.EffectiveFrom != previousFrom.UTC().Format(time.RFC3339) || result.Comparison.EffectiveTo != previousCutoff.UTC().Format(time.RFC3339) {
				t.Fatalf("effective instants differ from shared server cutoff: %+v", result)
			}
			if len(result.Trend) != days {
				t.Fatalf("nominal calendar trend length = %d, want %d", len(result.Trend), days)
			}
		})
	}
}

func TestSiteTrafficComparisonPreservesAdjacentNaturalDaysAcrossMonths(t *testing.T) {
	now := time.Date(2026, 3, 2, 10, 11, 12, 0, siteTrafficLocation)
	for _, test := range []struct {
		from, to, previousFrom, previousTo, effectiveTo string
	}{
		{"2026-03-02", "2026-03-02", "2026-03-01", "2026-03-01", "2026-03-01T10:11:12+08:00"},
		{"2026-02-24", "2026-03-02", "2026-02-17", "2026-02-23", "2026-02-23T10:11:12+08:00"},
		{"2026-02-01", "2026-03-02", "2026-01-02", "2026-01-31", "2026-01-31T10:11:12+08:00"},
		{"2026-01-30", "2026-02-02", "2026-01-26", "2026-01-29", "2026-01-30T00:00:00+08:00"},
		{"2025-12-30", "2026-01-02", "2025-12-26", "2025-12-29", "2025-12-30T00:00:00+08:00"},
	} {
		t.Run(test.from+"/"+test.to, func(t *testing.T) {
			svc, db := siteTrafficServiceFixture(t)
			if err := db.Create(&model.SiteTrafficEvent{
				ID: uuid.NewString(), ReceivedAtEpoch: siteTrafficRetentionStart(now).Unix(),
				VisitorHash: "earlier", SessionHash: "earlier", Type: "page_view", Page: "inspirations",
			}).Error; err != nil {
				t.Fatal(err)
			}
			result, err := svc.adminSiteTrafficOverviewAt(context.Background(), SiteTrafficQuery{From: test.from, To: test.to}, now)
			if err != nil {
				t.Fatal(err)
			}
			end, err := time.Parse(time.RFC3339, test.effectiveTo)
			if err != nil {
				t.Fatal(err)
			}
			wantRange := SiteTrafficRange{From: test.previousFrom, To: test.previousTo, TimeZone: "Asia/Shanghai"}
			if result.Comparison.Range != wantRange || result.Comparison.EffectiveTo != end.UTC().Format(time.RFC3339) {
				t.Fatalf("adjacent calendar period = %+v, want %+v ending %v", result.Comparison, wantRange, end)
			}
			if result.Comparison.Status != "ready" || result.Comparison.KPI == nil || *result.Comparison.KPI != (repository.SiteTrafficCounts{}) {
				t.Fatalf("retained earlier history with a truly empty previous period must stay ready/zero: %+v", result.Comparison)
			}
		})
	}
}

func TestSiteTrafficComparisonDistinguishesRetentionInsufficientHistoryAndRealZero(t *testing.T) {
	now := time.Date(2026, 11, 10, 10, 0, 0, 0, siteTrafficLocation)
	retained := siteTrafficRetentionStart(now)
	expired, late := retained.Add(-time.Second), retained.Add(time.Second)
	for _, test := range []struct {
		name   string
		date   time.Time
		first  *time.Time
		page   string
		status string
		want   *repository.SiteTrafficCounts
	}{
		{name: "empty", date: siteTrafficToday(now), status: "insufficient_history"},
		{name: "only-expired-record", date: siteTrafficToday(now), first: &expired, status: "insufficient_history"},
		{name: "legacy-tools-is-not-available-history", date: siteTrafficToday(now), first: &retained, page: "tools", status: "insufficient_history"},
		{name: "legacy-auth-is-not-available-history", date: siteTrafficToday(now), first: &retained, page: "auth", status: "insufficient_history"},
		{name: "legacy-account-is-not-available-history", date: siteTrafficToday(now), first: &retained, page: "account", status: "insufficient_history"},
		{name: "previous-outside-retention", date: retained, first: &retained, status: "outside_retention"},
		{name: "earliest-one-second-after-start", date: retained.AddDate(0, 0, 1), first: &late, status: "insufficient_history"},
		{name: "exact-retention-boundary", date: retained.AddDate(0, 0, 1), first: &retained, status: "ready", want: &repository.SiteTrafficCounts{Visitors: 1, PageViews: 1, Visits: 1}},
		{name: "previous-real-zero", date: siteTrafficToday(now), first: &retained, status: "ready", want: &repository.SiteTrafficCounts{}},
	} {
		t.Run(test.name, func(t *testing.T) {
			svc, db := siteTrafficServiceFixture(t)
			if test.first != nil {
				page := test.page
				if page == "" {
					page = "inspirations"
				}
				if err := db.Create(&model.SiteTrafficEvent{
					ID: uuid.NewString(), ReceivedAtEpoch: test.first.Unix(), VisitorHash: "v1", SessionHash: "s1", Type: "page_view", Page: page,
				}).Error; err != nil {
					t.Fatal(err)
				}
			}
			date := test.date.Format("2006-01-02")
			result, err := svc.adminSiteTrafficOverviewAt(context.Background(), SiteTrafficQuery{From: date, To: date}, now)
			if err != nil {
				t.Fatal(err)
			}
			comparison := result.Comparison
			if comparison.Status != test.status || (comparison.KPI == nil) != (test.want == nil) {
				t.Fatalf("history state = %+v, want %s/%+v", comparison, test.status, test.want)
			}
			if test.want != nil && *comparison.KPI != *test.want {
				t.Fatalf("previous KPI = %+v, want %+v", comparison.KPI, test.want)
			}
			if test.first == nil || test.first.Before(retained) || test.page == "tools" || test.page == "auth" || test.page == "account" {
				if result.AvailableFrom != nil {
					t.Fatalf("expired/empty/legacy history leaked availableFrom: %v", result.AvailableFrom)
				}
			}
			data, err := json.Marshal(result)
			if err != nil || (test.want == nil && !strings.Contains(string(data), `"kpi":null`)) || (result.Engagement.Visits == 0 && !strings.Contains(string(data), `"rate":null`)) {
				t.Fatalf("unknown previous KPI/zero denominator must serialize null: %s, %v", data, err)
			}
		})
	}
}

func TestSiteTrafficEngagementRateUsesDistinctVisitsAndNullableDenominator(t *testing.T) {
	now := time.Date(2026, 11, 10, 12, 0, 0, 0, siteTrafficLocation)
	zero, half, one := 0.0, 0.5, 1.0
	for _, test := range []struct {
		name                  string
		pageViews, actions    []string
		visits, engagedVisits int64
		rate                  *float64
	}{
		{name: "empty-null"},
		{name: "action-only-null", actions: []string{"only-action", "only-action"}},
		{name: "page-views-no-action", pageViews: []string{"s1", "s1"}, visits: 1, rate: &zero},
		{name: "intersection-not-event-ratio", pageViews: []string{"s1", "s1", "s2"}, actions: []string{"s1", "s1", "action-only"}, visits: 2, engagedVisits: 1, rate: &half},
		{name: "all-engaged", pageViews: []string{"s1", "s1"}, actions: []string{"s1", "s1"}, visits: 1, engagedVisits: 1, rate: &one},
	} {
		t.Run(test.name, func(t *testing.T) {
			svc, db := siteTrafficServiceFixture(t)
			for kind, sessions := range map[string][]string{"page_view": test.pageViews, "action": test.actions} {
				for _, session := range sessions {
					if err := db.Create(&model.SiteTrafficEvent{
						ID: uuid.NewString(), ReceivedAtEpoch: siteTrafficToday(now).Add(time.Second).Unix(),
						VisitorHash: session, SessionHash: session, Type: kind, Page: "create",
					}).Error; err != nil {
						t.Fatal(err)
					}
				}
			}
			result, err := svc.adminSiteTrafficOverviewAt(context.Background(), SiteTrafficQuery{From: "2026-11-10", To: "2026-11-10"}, now)
			if err != nil {
				t.Fatal(err)
			}
			engagement := result.Engagement
			if engagement.Visits != test.visits || engagement.EngagedVisits != test.engagedVisits || (engagement.Rate == nil) != (test.rate == nil) {
				t.Fatalf("engagement = %+v, want visits=%d engaged=%d rate=%v", engagement, test.visits, test.engagedVisits, test.rate)
			}
			if test.rate != nil && *engagement.Rate != *test.rate {
				t.Fatalf("rate = %v, want %v", *engagement.Rate, *test.rate)
			}
			if engagement.Visits != result.KPI.Visits {
				t.Fatalf("engagement denominator and KPI visits diverged: %+v/%+v", engagement, result.KPI)
			}
		})
	}
}

func TestSiteTrafficTodayRollingWindowCrossesMidnight(t *testing.T) {
	today := time.Date(2026, 11, 10, 0, 0, 0, 0, siteTrafficLocation)
	for _, elapsed := range []time.Duration{0, 150 * time.Second} {
		t.Run(elapsed.String(), func(t *testing.T) {
			svc, db := siteTrafficServiceFixture(t)
			cutoff := today.Add(elapsed)
			activeFrom := cutoff.Add(-300 * time.Second)
			for _, event := range []struct {
				at            time.Time
				visitor, kind string
			}{
				{activeFrom.Add(-time.Second), "expired", "action"},
				{activeFrom, "prior", "action"},
				{activeFrom.Add(time.Second), "prior", "page_view"},
				{today.Add(-time.Second), "prior", "action"},
				{today, "current", "page_view"},
				{today.Add(time.Second), "current", "page_view"},
				{cutoff, "at-end", "page_view"},
				{today.Add(time.Hour), "future", "page_view"},
			} {
				if err := db.Create(&model.SiteTrafficEvent{
					ID: uuid.NewString(), ReceivedAtEpoch: event.at.Unix(), VisitorHash: event.visitor,
					SessionHash: event.visitor, Type: event.kind, Page: "tools_video",
				}).Error; err != nil {
					t.Fatal(err)
				}
			}
			result, err := svc.adminSiteTrafficTodayAt(context.Background(), cutoff.Add(987*time.Millisecond).UTC())
			if err != nil {
				t.Fatal(err)
			}
			wantVisitors, wantCounts := int64(1), repository.SiteTrafficCounts{}
			if elapsed > 0 {
				wantVisitors = 2
				wantCounts = repository.SiteTrafficCounts{Visitors: 1, PageViews: 2, Visits: 1}
			}
			if result.Date != "2026-11-10" || result.TimeZone != "Asia/Shanghai" || result.AsOf != cutoff.UTC().Format(time.RFC3339) ||
				result.Active.Visitors != wantVisitors || result.Active.WindowFrom != activeFrom.UTC().Format(time.RFC3339) || result.Active.WindowTo != result.AsOf {
				t.Fatalf("shared second/cross-midnight active window = %+v", result)
			}
			if len(result.Hours) != 1 || result.Hours[0].Hour != 0 || !result.Hours[0].Partial || result.Hours[0].SiteTrafficCounts != wantCounts {
				t.Fatalf("midnight/current-hour counts must exclude upper endpoint and future hours: %+v", result.Hours)
			}
		})
	}
}

func TestSiteTrafficTodayFillsOnlyElapsedHoursWithIndependentDistinct(t *testing.T) {
	svc, db := siteTrafficServiceFixture(t)
	today := time.Date(2026, 11, 10, 0, 0, 0, 0, siteTrafficLocation)
	now := today.Add(2*time.Hour + 30*time.Minute + 45*time.Second + 999*time.Millisecond)
	for _, event := range []struct {
		offset        time.Duration
		visitor, kind string
	}{
		{0, "same", "page_view"}, {time.Second, "same", "page_view"},
		{time.Hour, "same", "page_view"}, {time.Hour + time.Second, "only-action", "action"},
		{3 * time.Hour, "future", "page_view"},
	} {
		if err := db.Create(&model.SiteTrafficEvent{
			ID: uuid.NewString(), ReceivedAtEpoch: today.Add(event.offset).Unix(), VisitorHash: event.visitor,
			SessionHash: event.visitor, Type: event.kind, Page: "tools_video",
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
	result, err := svc.adminSiteTrafficTodayAt(context.Background(), now)
	if err != nil {
		t.Fatal(err)
	}
	want := []repository.SiteTrafficCounts{
		{Visitors: 1, PageViews: 2, Visits: 1},
		{Visitors: 1, PageViews: 1, Visits: 1, Actions: 1},
		{},
	}
	if len(result.Hours) != len(want) || result.Active.Visitors != 0 {
		t.Fatalf("future hours were filled or old visitors stayed active: %+v", result)
	}
	for hour, counts := range want {
		point := result.Hours[hour]
		if point.Hour != hour || point.Partial != (hour == 2) || point.SiteTrafficCounts != counts {
			t.Fatalf("hour %d = %+v, want %+v", hour, point, counts)
		}
	}
}

func TestSiteTrafficTodayServiceRequiresAdminAndPropagatesCancellation(t *testing.T) {
	svc, _ := siteTrafficServiceFixture(t)
	for index, actor := range []*model.User{nil, {ID: "regular", Role: model.UserRoleUser}} {
		result, err := svc.AdminSiteTrafficToday(context.Background(), actor)
		var appErr *AppError
		wantStatus := 401
		if index == 1 {
			wantStatus = 403
		}
		if result != nil || !errors.As(err, &appErr) || appErr.Status != wantStatus {
			t.Fatalf("unauthorized today = %+v, %v, want %d", result, err, wantStatus)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result, err := svc.AdminSiteTrafficToday(ctx, &model.User{ID: "admin", Role: model.UserRoleAdmin})
	if result != nil || !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled today must fail, not return zeros: %+v, %v", result, err)
	}
}

func TestSiteTrafficHeatmapFoldsSundayMondayAndCurrentPartialInBeijing(t *testing.T) {
	svc, db := siteTrafficServiceFixture(t)
	from := time.Date(2026, 11, 1, 0, 0, 0, 0, siteTrafficLocation)
	now := time.Date(2026, 11, 9, 0, 30, 0, 0, siteTrafficLocation)
	for _, at := range []time.Time{from, from.AddDate(0, 0, 1), now.Add(-31 * time.Minute), now.Add(-time.Minute), now, now.Add(time.Hour)} {
		if err := db.Create(&model.SiteTrafficEvent{ID: uuid.NewString(), VisitorHash: "v", SessionHash: "s",
			ReceivedAtEpoch: at.Unix(), Type: "page_view", Page: "inspirations"}).Error; err != nil {
			t.Fatal(err)
		}
	}
	result, err := svc.adminSiteTrafficOverviewAt(context.Background(), SiteTrafficQuery{From: "2026-11-01", To: "2026-11-09"}, now.UTC())
	if err != nil {
		t.Fatal(err)
	}
	cells := result.Insights.Heatmap
	if len(cells) != 168 {
		t.Fatalf("heatmap length = %d", len(cells))
	}
	hours, completed := 0, 0
	for index, cell := range cells {
		if cell.Weekday != index/24+1 || cell.Hour != index%24 || cell.HistoryStatus != "retained" || cell.PageViews == nil || cell.CompletedHours > cell.Hours {
			t.Fatalf("weekday/hour/history contract = %+v", cell)
		}
		hours += cell.Hours
		completed += cell.CompletedHours
	}
	monday, sunday := cells[0], cells[6*24+23]
	if hours != 193 || completed != 192 || monday.Hours != 2 || monday.CompletedHours != 1 || !monday.Partial || *monday.PageViews != 2 ||
		sunday.Hours != 2 || sunday.CompletedHours != 2 || sunday.Partial || *sunday.PageViews != 1 {
		t.Fatalf("folded positive-hour fragments: total=%d/%d monday=%+v sunday=%+v", hours, completed, monday, sunday)
	}
}

func TestSiteTrafficHeatmapExcludesZeroDurationAndFutureHours(t *testing.T) {
	from := time.Date(2026, 11, 9, 0, 0, 0, 0, siteTrafficLocation)
	earliest := from.Add(-time.Hour).Unix()
	for _, elapsed := range []time.Duration{0, 30 * time.Minute, time.Hour, time.Hour + 30*time.Minute} {
		t.Run(elapsed.String(), func(t *testing.T) {
			now := from.Add(elapsed)
			result := buildSiteTrafficInsights(&repository.SiteTrafficAggregates{EarliestEpoch: &earliest}, from, from.AddDate(0, 0, 1), now, now)
			wantHours := int((elapsed + time.Hour - 1) / time.Hour)
			for index, cell := range result.Heatmap {
				if index >= wantHours {
					if cell.HistoryStatus != "outside_range" || cell.Hours != 0 || cell.CompletedHours != 0 || cell.Partial || cell.PageViews != nil {
						t.Fatalf("zero-duration/future cell must be absent, not zero PV: %+v", cell)
					}
					continue
				}
				completed := 1
				if time.Duration(index+1)*time.Hour > elapsed {
					completed = 0
				}
				if cell.Hours != 1 || cell.CompletedHours != completed || cell.Partial != (completed == 0) || cell.PageViews == nil || *cell.PageViews != 0 || cell.HistoryStatus != "retained" {
					t.Fatalf("elapsed fragment = %+v", cell)
				}
			}
			if len(result.FeatureTrend) != 1 || !result.FeatureTrend[0].Partial || (elapsed == 0 && (result.FeatureTrend[0].Counts != nil || result.FeatureTrend[0].HistoryStatus != "unknown")) {
				t.Fatalf("nominal today must remain represented at zero-duration midnight: %+v", result.FeatureTrend)
			}
		})
	}
}

func TestSiteTrafficHeatmapDistinguishesUnknownPartialRetainedAndKnownPV(t *testing.T) {
	from := time.Date(2026, 11, 9, 0, 0, 0, 0, siteTrafficLocation)
	earliest := from.Add(90 * time.Minute).Unix()
	result := buildSiteTrafficInsights(&repository.SiteTrafficAggregates{
		EarliestEpoch: &earliest,
		Heatmap:       []repository.SiteTrafficHourPageViews{{HourNumber: (from.Unix()+28800)/3600 + 1, PageViews: 2}},
	}, from, from.AddDate(0, 0, 1), from.Add(3*time.Hour), from.Add(3*time.Hour))
	unknown, partial, retained := result.Heatmap[0], result.Heatmap[1], result.Heatmap[2]
	if unknown.HistoryStatus != "unknown" || unknown.PageViews != nil || unknown.Partial || unknown.Hours != 1 || unknown.CompletedHours != 1 ||
		partial.HistoryStatus != "partial" || partial.PageViews == nil || *partial.PageViews != 2 || partial.Partial ||
		retained.HistoryStatus != "retained" || retained.PageViews == nil || *retained.PageViews != 0 || retained.Partial {
		t.Fatalf("coverage must not fabricate historical zeros: unknown=%+v partial=%+v retained=%+v", unknown, partial, retained)
	}
	for _, known := range []bool{false, true} {
		aggregates := &repository.SiteTrafficAggregates{}
		if known {
			aggregates.Heatmap = []repository.SiteTrafficHourPageViews{{HourNumber: (from.Unix() + 28800) / 3600, PageViews: 1}}
		}
		cells := buildSiteTrafficInsights(aggregates, from, from.AddDate(0, 0, 1), from.Add(time.Hour), from.Add(time.Hour)).Heatmap
		if known && (cells[0].HistoryStatus != "partial" || cells[0].PageViews == nil || *cells[0].PageViews != 1 || cells[0].Partial) {
			t.Fatalf("observed PV with unknown coverage was hidden or treated complete: %+v", cells[0])
		}
		if !known && (cells[0].HistoryStatus != "unknown" || cells[0].PageViews != nil) {
			t.Fatalf("unknown empty hour was fabricated as zero: %+v", cells[0])
		}
	}
	// 同一星期/小时跨周混有未知片段时，不能因后一次有覆盖而丢掉partial。
	later := from.AddDate(0, 0, 7)
	first := later.Unix()
	folded := buildSiteTrafficInsights(&repository.SiteTrafficAggregates{EarliestEpoch: &first,
		Heatmap: []repository.SiteTrafficHourPageViews{{HourNumber: (later.Unix() + 28800) / 3600, PageViews: 1}},
	}, from, later.AddDate(0, 0, 1), later.Add(time.Hour), later.Add(time.Hour)).Heatmap[0]
	if folded.Hours != 2 || folded.CompletedHours != 2 || folded.HistoryStatus != "partial" || folded.Partial || folded.PageViews == nil || *folded.PageViews != 1 {
		t.Fatalf("mixed historical coverage was reported complete: %+v", folded)
	}
}

func TestSiteTrafficFeatureTrendKeepsCalendarUnknownDaysAndAllSevenActions(t *testing.T) {
	svc, db := siteTrafficServiceFixture(t)
	now := time.Date(2026, 11, 10, 12, 34, 56, 0, siteTrafficLocation)
	first := time.Date(2026, 11, 9, 12, 0, 0, 0, siteTrafficLocation)
	for action := range siteTrafficActions {
		for _, at := range []time.Time{first, now, now.Add(time.Second)} {
			if err := db.Create(&model.SiteTrafficEvent{ID: uuid.NewString(), VisitorHash: "v", SessionHash: "action-only",
				ReceivedAtEpoch: at.Unix(), Type: "action", Page: "create", Action: action}).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	result, err := svc.adminSiteTrafficOverviewAt(context.Background(), SiteTrafficQuery{From: "2026-11-08", To: "2026-11-10"}, now)
	if err != nil {
		t.Fatal(err)
	}
	trend := result.Insights.FeatureTrend
	if len(trend) != 3 || trend[0].Date != "2026-11-08" || trend[1].Date != "2026-11-09" || trend[2].Date != "2026-11-10" ||
		trend[0].Partial || trend[1].Partial || !trend[2].Partial || trend[0].HistoryStatus != "unknown" || trend[0].Counts != nil ||
		trend[1].HistoryStatus != "partial" || trend[2].HistoryStatus != "retained" {
		t.Fatalf("continuous calendar coverage = %+v", trend)
	}
	for index, point := range trend[1:] {
		if len(point.Counts) != 7 {
			t.Fatalf("all seven operation keys are required: %+v", point)
		}
		for action := range siteTrafficActions {
			want := int64(1 - index)
			if count, exists := point.Counts[action]; !exists || count != want {
				t.Fatalf("date=%s action=%s got=%d want=%d", point.Date, action, count, want)
			}
		}
	}
	data, err := json.Marshal(result.Insights)
	if err != nil || !strings.Contains(string(data), `"counts":null`) || !strings.Contains(string(data), `"pageViews":null`) {
		t.Fatalf("unknown JSON must stay null: %s, %v", data, err)
	}
}

func TestSiteTrafficInsightsKeepThe365DayAnd8760HourBounds(t *testing.T) {
	now := time.Date(2026, 11, 10, 23, 59, 59, 0, siteTrafficLocation)
	from := siteTrafficRetentionStart(now)
	earliest := from.Unix()
	result := buildSiteTrafficInsights(&repository.SiteTrafficAggregates{EarliestEpoch: &earliest}, from, siteTrafficToday(now).AddDate(0, 0, 1), now, now)
	if len(result.Heatmap) != 168 || len(result.FeatureTrend) != 365 || result.FeatureTrend[0].Date != "2025-11-11" || result.FeatureTrend[364].Date != "2026-11-10" {
		t.Fatalf("retention range bounds = %+v", result)
	}
	hours, completed, partials := 0, 0, 0
	for _, cell := range result.Heatmap {
		hours += cell.Hours
		completed += cell.CompletedHours
		if cell.Partial {
			partials++
		}
		unfinished := 0
		if cell.Partial {
			unfinished = 1
		}
		if cell.HistoryStatus != "retained" || cell.Hours-cell.CompletedHours != unfinished || cell.PageViews == nil || *cell.PageViews != 0 {
			t.Fatalf("time completion must not include history coverage: %+v", cell)
		}
	}
	if hours != 8760 || completed != 8759 || partials != 1 {
		t.Fatalf("bounded hour fragments = %d completed=%d partial=%d", hours, completed, partials)
	}
	for index, point := range result.FeatureTrend {
		if point.Partial != (index == 364) || point.HistoryStatus != "retained" || len(point.Counts) != 7 {
			t.Fatalf("bounded daily operation map = %+v", point)
		}
	}
}

func TestSiteTrafficInsightPageMeasurementAndDepthHaveIndependentDenominators(t *testing.T) {
	from := time.Date(2026, 11, 9, 0, 0, 0, 0, siteTrafficLocation)
	aggregates := &repository.SiteTrafficAggregates{
		KPI: repository.SiteTrafficCounts{Visits: 999},
		PageEngagement: []repository.SiteTrafficPageEngagementCounts{
			{Page: "inspirations", Visits: 4, EngagedVisits: 2}, {Page: "canvas", Visits: 2},
			{Page: "auth", Visits: 3, EngagedVisits: 3}, {Page: "account", Visits: 2, EngagedVisits: 2},
			{Page: "tools_image", Visits: 2, EngagedVisits: 1}, {Page: "tools_video", Visits: 4, EngagedVisits: 3},
			{Page: "welcome", Visits: 3, EngagedVisits: 3}, {Page: "other", Visits: 2, EngagedVisits: 2},
			{Page: "plugins", Visits: 2}, {Page: "share", Visits: 2}, {Page: "library", Visits: 2},
			{Page: "runninghub", Visits: 2}, {Page: "tools", Visits: 2, EngagedVisits: 2},
		},
		Depth: repository.SiteTrafficDepthCounts{Visits: 7, One: 1, TwoThree: 4, FourPlus: 2},
	}
	result := buildSiteTrafficInsights(aggregates, from, from.AddDate(0, 0, 1), from.Add(time.Hour), from.Add(time.Hour))
	seen := make(map[string]bool)
	for _, page := range result.PageEngagement {
		if seen[page.Page] {
			t.Fatalf("duplicate page: %+v", page)
		}
		seen[page.Page] = true
		if _, current := siteTrafficPages[page.Page]; !current {
			t.Fatalf("legacy page leaked into fixed matrix: %+v", page)
		}
		switch page.Page {
		case "auth", "account":
			t.Fatalf("excluded page leaked into fixed engagement matrix: %+v", page)
		default:
			if page.Measurement != "supported" || page.EngagedVisits == nil || (page.Visits == 0 && (*page.EngagedVisits != 0 || page.Rate != nil)) {
				t.Fatalf("supported empty page denominator = %+v", page)
			}
			if page.Page == "inspirations" && (page.Visits != 4 || *page.EngagedVisits != 2 || page.Rate == nil || *page.Rate != 0.5) {
				t.Fatalf("measured ratio = %+v", page)
			}
			if page.Page == "canvas" && (page.Rate == nil || *page.Rate != 0) {
				t.Fatalf("measured zero numerator = %+v", page)
			}
			if page.Page == "tools_image" && (page.Visits != 2 || *page.EngagedVisits != 1 || page.Rate == nil || *page.Rate != 0.5) {
				t.Fatalf("image tool ratio = %+v", page)
			}
			if page.Page == "tools_video" && (page.Visits != 4 || *page.EngagedVisits != 3 || page.Rate == nil || *page.Rate != 0.75) {
				t.Fatalf("video tool ratio = %+v", page)
			}
		}
	}
	if len(seen) != 13 || result.Depth.Visits != 7 || len(result.Depth.Buckets) != 3 {
		t.Fatalf("page/depth shape = %+v", result)
	}
	var sum int64
	for index, bucket := range result.Depth.Buckets {
		if bucket.Key != []string{"1", "2-3", "4+"}[index] || bucket.Rate == nil || *bucket.Rate != float64(bucket.Visits)/7 {
			t.Fatalf("depth denominator must be its own aggregate, not KPI: %+v", bucket)
		}
		sum += bucket.Visits
	}
	if sum != result.Depth.Visits {
		t.Fatalf("depth buckets sum=%d denominator=%d", sum, result.Depth.Visits)
	}
	empty := buildSiteTrafficInsights(&repository.SiteTrafficAggregates{}, from, from.AddDate(0, 0, 1), from, from)
	for _, bucket := range empty.Depth.Buckets {
		if bucket.Visits != 0 || bucket.Rate != nil {
			t.Fatalf("empty depth = %+v", empty.Depth)
		}
	}
}

func TestSiteTrafficOverviewUsesThirteenOrFourteenQueriesAndPropagatesReadFailures(t *testing.T) {
	for _, mode := range []string{"unknown-history", "retained-history", "canceled", "database-error"} {
		t.Run(mode, func(t *testing.T) {
			svc, db := siteTrafficServiceFixture(t)
			now := time.Date(2026, 11, 10, 12, 0, 0, 0, siteTrafficLocation)
			if mode == "retained-history" {
				if err := db.Create(&model.SiteTrafficEvent{ID: uuid.NewString(), Type: "page_view", Page: "inspirations",
					ReceivedAtEpoch: siteTrafficRetentionStart(now).Unix()}).Error; err != nil {
					t.Fatal(err)
				}
			}
			if mode == "database-error" {
				if err := db.Migrator().DropTable(&model.SiteTrafficEvent{}); err != nil {
					t.Fatal(err)
				}
			}
			queries := 0
			callback := "site-traffic-app-query-count"
			if err := db.Callback().Row().Before("gorm:row").Register(callback, func(tx *gorm.DB) { queries++ }); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = db.Callback().Row().Remove(callback) })
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if mode == "canceled" {
				cancel()
			}
			result, err := svc.adminSiteTrafficOverviewAt(ctx, SiteTrafficQuery{From: "2026-11-10", To: "2026-11-10"}, now)
			if mode == "canceled" || mode == "database-error" {
				if result != nil || err == nil || (mode == "canceled" && !errors.Is(err, context.Canceled)) {
					t.Fatalf("failed overview became empty success: %+v, %v", result, err)
				}
				return
			}
			wantQueries := 13
			if mode == "retained-history" {
				wantQueries++
			}
			if err != nil || queries != wantQueries {
				t.Fatalf("overview aggregation count=%d want=%d err=%v", queries, wantQueries, err)
			}
		})
	}
}

func TestSiteTrafficCleanupUsesIndependentLeaseAndRetentionCutoff(t *testing.T) {
	svc, db := siteTrafficServiceFixture(t)
	cutoff := siteTrafficRetentionStart(time.Now())
	for _, event := range []model.SiteTrafficEvent{{ID: "old", ReceivedAtEpoch: cutoff.Unix() - 1}, {ID: "boundary", ReceivedAtEpoch: cutoff.Unix()}} {
		if err := db.Create(&event).Error; err != nil {
			t.Fatal(err)
		}
	}
	oldEvents := make([]model.SiteTrafficEvent, 1001)
	for index := range oldEvents {
		oldEvents[index] = model.SiteTrafficEvent{ID: uuid.NewString(), ReceivedAtEpoch: cutoff.Unix() - 1}
	}
	if err := db.CreateInBatches(oldEvents, 100).Error; err != nil {
		t.Fatal(err)
	}
	lease, acquired, err := svc.coordinator.AcquireLease(context.Background(), "site-traffic-event-cleanup", 1, time.Minute)
	if err != nil || !acquired {
		t.Fatalf("lease = %v, %v", acquired, err)
	}
	deleted, err := svc.CleanupSiteTrafficEvents(context.Background())
	lease.Release()
	if err != nil || deleted != 0 {
		t.Fatalf("concurrent cleanup bypassed lease: %d, %v", deleted, err)
	}
	// 原请求日志租约不能阻塞独立访问清理。
	logLease, acquired, err := svc.coordinator.AcquireLease(context.Background(), "api-call-log-cleanup", 1, time.Minute)
	if err != nil || !acquired {
		t.Fatalf("log lease = %v, %v", acquired, err)
	}
	defer logLease.Release()
	deleted, err = svc.CleanupSiteTrafficEvents(context.Background())
	if err != nil || deleted != 1002 {
		t.Fatalf("independent cleanup = %d, %v", deleted, err)
	}
	var count int64
	if err := db.Model(&model.SiteTrafficEvent{}).Where("id = ?", "boundary").Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("boundary deleted: %d, %v", count, err)
	}
}
