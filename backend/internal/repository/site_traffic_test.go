package repository

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"

	"yingce/backend/internal/model"

	"github.com/google/uuid"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	_ "modernc.org/sqlite"
)

func siteTrafficRepositoryFixture(t *testing.T) (*Repository, *gorm.DB) {
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
	return New(db), db
}

func TestSiteTrafficInsertDeduplicatesWithinBatchAndAcrossRetries(t *testing.T) {
	repo, db := siteTrafficRepositoryFixture(t)
	// 仓储原始行幂等合同也保护旧分类，重试不能改写历史。
	event := model.SiteTrafficEvent{ID: uuid.NewString(), VisitorHash: "visitor", SessionHash: "session", ReceivedAtEpoch: 1790000000, Type: "page_view", Page: "welcome"}
	accepted, err := repo.InsertSiteTrafficEvents([]model.SiteTrafficEvent{event, event})
	if err != nil || accepted != 1 {
		t.Fatalf("batch = %d, %v", accepted, err)
	}
	event.Page = "other"
	accepted, err = repo.InsertSiteTrafficEvents([]model.SiteTrafficEvent{event})
	if err != nil || accepted != 0 {
		t.Fatalf("retry = %d, %v", accepted, err)
	}
	var saved model.SiteTrafficEvent
	if err := db.First(&saved, "id = ?", event.ID).Error; err != nil || saved.Page != "welcome" {
		t.Fatalf("duplicate overwrote event: %+v, %v", saved, err)
	}
}

func TestSiteTrafficAggregatesUseBeijingDaysAndIndependentRangeDistinct(t *testing.T) {
	repo, _ := siteTrafficRepositoryFixture(t)
	firstDayEnd := time.Date(2026, 10, 1, 15, 59, 59, 0, time.UTC)
	secondDayStart := firstDayEnd.Add(time.Second)
	events := []model.SiteTrafficEvent{
		{ID: uuid.NewString(), VisitorHash: "v1", SessionHash: "s1", ReceivedAtEpoch: firstDayEnd.Unix(), Type: "page_view", Page: "create"},
		{ID: uuid.NewString(), VisitorHash: "v1", SessionHash: "s1", ReceivedAtEpoch: secondDayStart.Unix(), Type: "page_view", Page: "create"},
		{ID: uuid.NewString(), VisitorHash: "v2", SessionHash: "s2", ReceivedAtEpoch: secondDayStart.Unix(), Type: "page_view", Page: "assets"},
		{ID: uuid.NewString(), VisitorHash: "action-only", SessionHash: "not-a-visit", ReceivedAtEpoch: secondDayStart.Unix(), Type: "action", Page: "create", Action: "new_canvas"},
		{ID: uuid.NewString(), VisitorHash: "action-only", SessionHash: "not-a-visit", ReceivedAtEpoch: secondDayStart.Unix(), Type: "action", Page: "assets", Action: "new_canvas"},
		{ID: uuid.NewString(), VisitorHash: "v1", SessionHash: "s1", ReceivedAtEpoch: secondDayStart.Unix(), Type: "action", Page: "create", Action: "new_canvas"},
	}
	if _, err := repo.InsertSiteTrafficEvents(events); err != nil {
		t.Fatal(err)
	}
	from := time.Date(2026, 10, 1, 0, 0, 0, 0, time.FixedZone("Asia/Shanghai", 28800))
	result, err := repo.SiteTrafficOverview(from, from.AddDate(0, 0, 2), from.AddDate(0, 0, -10))
	if err != nil {
		t.Fatal(err)
	}
	if result.KPI != (SiteTrafficCounts{Visitors: 2, PageViews: 3, Visits: 2, Actions: 3}) {
		t.Fatalf("range counts include actions or sum daily distincts: %+v", result.KPI)
	}
	if len(result.Trend) != 2 || result.Trend[0].Visitors != 1 || result.Trend[1].Visitors != 2 || result.Trend[0].Visits != 1 || result.Trend[1].Visits != 2 || result.Trend[1].Actions != 3 {
		t.Fatalf("daily distincts: %+v", result.Trend)
	}
	if got := time.Unix(result.Trend[1].DayNumber*86400, 0).UTC().Format("2006-01-02"); got != "2026-10-02" {
		t.Fatalf("UTC+8 boundary grouped into %s", got)
	}
	if len(result.Pages) != 2 || result.Pages[0].Page != "create" || result.Pages[0].Visitors != 1 || result.Pages[0].Visits != 1 {
		t.Fatalf("page aggregates: %+v", result.Pages)
	}
	if len(result.Actions) != 2 || result.Actions[0].Action != "new_canvas" || result.Actions[0].Page != "create" || result.Actions[0].Count != 2 || result.Actions[0].Visitors != 2 || result.Actions[1].Page != "assets" {
		t.Fatalf("actions must group by action and source page: %+v", result.Actions)
	}
	if result.EarliestEpoch == nil || *result.EarliestEpoch != firstDayEnd.Unix() {
		t.Fatalf("earliest retained event: %v", result.EarliestEpoch)
	}
}

func TestSiteTrafficEmptyAggregatesAreRealZeros(t *testing.T) {
	repo, _ := siteTrafficRepositoryFixture(t)
	from := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	result, err := repo.SiteTrafficOverview(from, from.AddDate(0, 0, 1), from)
	if err != nil || result.KPI != (SiteTrafficCounts{}) || result.EarliestEpoch != nil || len(result.Trend) != 0 || result.Pages == nil || result.Actions == nil {
		t.Fatalf("empty = %+v, %v", result, err)
	}
}

func TestSiteTrafficCurrentPageScopeExcludesLegacyWithoutChangingStoredRows(t *testing.T) {
	from := time.Date(2026, 11, 10, 0, 0, 0, 0, time.FixedZone("Asia/Shanghai", 28800))
	to := from.Add(2*time.Hour + 2*time.Minute + 30*time.Second)
	previousFrom, previousTo := from.AddDate(0, 0, -1), to.AddDate(0, 0, -1)
	retentionStart := from.AddDate(0, 0, -30)
	for _, mixed := range []bool{false, true} {
		t.Run(fmt.Sprintf("mixed=%t", mixed), func(t *testing.T) {
			repo, db := siteTrafficRepositoryFixture(t)
			var events []model.SiteTrafficEvent
			add := func(page, kind, action, visitor, session string, at time.Time) {
				events = append(events, model.SiteTrafficEvent{ID: uuid.NewString(), Page: page, Type: kind, Action: action,
					VisitorHash: visitor, SessionHash: session, ReceivedAtEpoch: at.Unix()})
			}
			for _, page := range []string{"welcome", "plugins", "share", "library", "runninghub", "other", "tools", "auth", "account"} {
				for _, at := range []time.Time{retentionStart, previousFrom.Add(time.Minute), from.Add(time.Minute), to.Add(-time.Minute)} {
					add(page, "page_view", "", "legacy-"+page, "legacy-"+page, at)
					add(page, "action", "open_create", "legacy-"+page, "legacy-"+page, at)
				}
			}
			// 旧页action不能使当前图片会话参与；同session旧tools的PV不能抬高视频访问深度。
			add("welcome", "action", "open_create", "shared", "image", from.Add(time.Minute))
			add("tools", "page_view", "", "shared", "video", from)
			add("tools", "page_view", "", "shared", "video", from.Add(time.Second))
			if mixed {
				add("tools_image", "page_view", "", "shared", "image", previousFrom.Add(time.Minute))
				add("tools_image", "action", "open_create", "shared", "image", previousFrom.Add(time.Minute))
				add("tools_image", "page_view", "", "shared", "image", from.Add(time.Minute))
				add("tools_video", "page_view", "", "shared", "video", to.Add(-time.Minute))
				add("tools_video", "page_view", "", "shared", "video", to.Add(-30*time.Second))
				add("tools_video", "action", "open_ecommerce", "shared", "video", to.Add(-30*time.Second))
				add("canvas", "action", "open_create", "action-only", "action-only", to.Add(-time.Second))
			}
			if accepted, err := repo.InsertSiteTrafficEvents(events); err != nil || accepted != int64(len(events)) {
				t.Fatalf("seed raw current/legacy rows: %d, %v", accepted, err)
			}
			var before []model.SiteTrafficEvent
			if err := db.Order("id ASC").Find(&before).Error; err != nil {
				t.Fatal(err)
			}
			ctxRepo := repo.WithContext(context.Background())
			result, err := ctxRepo.SiteTrafficOverview(from, to, retentionStart)
			if err != nil {
				t.Fatal(err)
			}
			previous, err := ctxRepo.SiteTrafficKPI(previousFrom, previousTo)
			if err != nil {
				t.Fatal(err)
			}
			today, err := ctxRepo.SiteTrafficToday(from, to.Add(-300*time.Second), to)
			if err != nil {
				t.Fatal(err)
			}
			want := &SiteTrafficAggregates{
				Trend: []SiteTrafficDailyCounts{}, Pages: []SiteTrafficPage{}, Actions: []SiteTrafficAction{},
				Heatmap: []SiteTrafficHourPageViews{}, FeatureTrend: []SiteTrafficDailyActionCounts{}, PageEngagement: []SiteTrafficPageEngagementCounts{},
				Operations: SiteTrafficOperationsAggregates{
					Endpoints: SiteTrafficEndpointCounts{
						First: SiteTrafficEndpointSideCounts{Pages: []SiteTrafficEndpointPageCounts{}},
						Last:  SiteTrafficEndpointSideCounts{Pages: []SiteTrafficEndpointPageCounts{}},
					},
					Paths:  SiteTrafficPathCounts{Rows: []SiteTrafficPathPairCounts{}},
					Funnel: []SiteTrafficFunnelCounts{{Step: 1}, {Step: 2}, {Step: 3}, {Step: 4}},
				},
			}
			wantPrevious := SiteTrafficCounts{}
			wantToday := &SiteTrafficTodayAggregates{Hours: []SiteTrafficHourlyCounts{}}
			if mixed {
				counts := SiteTrafficCounts{Visitors: 1, PageViews: 3, Visits: 2, Actions: 2}
				day, hour := (from.Unix()+28800)/86400, (from.Unix()+28800)/3600
				first := previousFrom.Add(time.Minute).Unix()
				want = &SiteTrafficAggregates{
					KPI: counts, Engagement: SiteTrafficEngagementCounts{Visits: 2, EngagedVisits: 1},
					Depth: SiteTrafficDepthCounts{Visits: 2, One: 1, TwoThree: 1}, EarliestEpoch: &first,
					Operations: SiteTrafficOperationsAggregates{
						VisitorMix: SiteTrafficVisitorMixCounts{Visitors: 1, ReturningVisitors: 1},
						Endpoints: SiteTrafficEndpointCounts{Visits: 2,
							First: SiteTrafficEndpointSideCounts{Pages: []SiteTrafficEndpointPageCounts{{Page: "tools_image", Visits: 1}, {Page: "tools_video", Visits: 1}}},
							Last:  SiteTrafficEndpointSideCounts{Pages: []SiteTrafficEndpointPageCounts{{Page: "tools_image", Visits: 1}, {Page: "tools_video", Visits: 1}}},
						},
						Paths:  SiteTrafficPathCounts{Visits: 2, Rows: []SiteTrafficPathPairCounts{}},
						Funnel: []SiteTrafficFunnelCounts{{Step: 1}, {Step: 2}, {Step: 3}, {Step: 4}},
					},
					Trend: []SiteTrafficDailyCounts{{DayNumber: day, SiteTrafficCounts: counts}},
					Pages: []SiteTrafficPage{
						{Page: "tools_video", PageViews: 2, Visitors: 1, Visits: 1},
						{Page: "tools_image", PageViews: 1, Visitors: 1, Visits: 1},
					},
					Actions: []SiteTrafficAction{
						{Action: "open_create", Page: "canvas", Count: 1, Visitors: 1},
						{Action: "open_ecommerce", Page: "tools_video", Count: 1, Visitors: 1},
					},
					Heatmap: []SiteTrafficHourPageViews{{HourNumber: hour, PageViews: 1}, {HourNumber: hour + 2, PageViews: 2}},
					FeatureTrend: []SiteTrafficDailyActionCounts{
						{DayNumber: day, Action: "open_create", Count: 1}, {DayNumber: day, Action: "open_ecommerce", Count: 1},
					},
					PageEngagement: []SiteTrafficPageEngagementCounts{
						{Page: "canvas"}, {Page: "tools_image", Visits: 1}, {Page: "tools_video", Visits: 1, EngagedVisits: 1},
					},
				}
				wantPrevious = SiteTrafficCounts{Visitors: 1, PageViews: 1, Visits: 1, Actions: 1}
				wantToday = &SiteTrafficTodayAggregates{ActiveVisitors: 2, Hours: []SiteTrafficHourlyCounts{
					{Hour: 0, SiteTrafficCounts: SiteTrafficCounts{Visitors: 1, PageViews: 1, Visits: 1}},
					{Hour: 2, SiteTrafficCounts: SiteTrafficCounts{Visitors: 1, PageViews: 2, Visits: 1, Actions: 2}},
				}}
			}
			if !reflect.DeepEqual(result, want) || *previous != wantPrevious || !reflect.DeepEqual(today, wantToday) {
				t.Fatalf("read scopes diverged: overview=%+v want=%+v previous=%+v want=%+v today=%+v want=%+v", result, want, previous, wantPrevious, today, wantToday)
			}
			var after []model.SiteTrafficEvent
			if err := db.Order("id ASC").Find(&after).Error; err != nil || !reflect.DeepEqual(before, after) {
				t.Fatalf("read aggregation deleted or rewrote stored legacy rows: before=%d after=%d err=%v", len(before), len(after), err)
			}
		})
	}
}

func TestSiteTrafficEngagementUsesInRangeSessionIntersection(t *testing.T) {
	from := time.Date(2026, 11, 10, 0, 0, 0, 0, time.FixedZone("Asia/Shanghai", 28800))
	type event struct {
		session, kind string
		offset        time.Duration
	}
	for _, test := range []struct {
		name   string
		events []event
		want   SiteTrafficEngagementCounts
	}{
		{
			name: "intersection-not-actions-or-page-views",
			events: []event{
				{"engaged", "page_view", 0}, {"engaged", "page_view", time.Second},
				{"engaged", "action", 2 * time.Second}, {"engaged", "action", 3 * time.Second},
				{"action-at-end", "page_view", 4 * time.Second}, {"action-at-end", "action", time.Hour},
				{"pv-before-range", "page_view", -time.Second}, {"pv-before-range", "action", 5 * time.Second},
				{"action-before-range", "action", -time.Second}, {"action-before-range", "page_view", 6 * time.Second},
				{"action-only", "action", 7 * time.Second}, {"future", "page_view", time.Hour},
			},
			want: SiteTrafficEngagementCounts{Visits: 3, EngagedVisits: 1},
		},
		{name: "action-only-zero-denominator", events: []event{{"action-only", "action", 0}, {"action-only", "action", time.Second}}},
		{name: "empty-zero-denominator"},
	} {
		t.Run(test.name, func(t *testing.T) {
			repo, _ := siteTrafficRepositoryFixture(t)
			for _, source := range test.events {
				row := model.SiteTrafficEvent{
					ID: uuid.NewString(), VisitorHash: "visitor-" + source.session, SessionHash: source.session,
					ReceivedAtEpoch: from.Add(source.offset).Unix(), Type: source.kind, Page: "create",
				}
				if source.kind == "action" {
					row.Action = "new_canvas"
				}
				if _, err := repo.InsertSiteTrafficEvents([]model.SiteTrafficEvent{row}); err != nil {
					t.Fatal(err)
				}
			}
			result, err := repo.SiteTrafficOverview(from, from.Add(time.Hour), from.AddDate(0, 0, -1))
			if err != nil {
				t.Fatal(err)
			}
			if result.Engagement != test.want || result.KPI.Visits != test.want.Visits {
				t.Fatalf("session intersection = %+v, KPI = %+v, want %+v", result.Engagement, result.KPI, test.want)
			}
		})
	}
}

func TestSiteTrafficTodayKeepsHourlyDistinctAndActiveHalfOpenWindow(t *testing.T) {
	repo, _ := siteTrafficRepositoryFixture(t)
	dayStart := time.Date(2026, 11, 10, 0, 0, 0, 0, time.FixedZone("Asia/Shanghai", 28800))
	now := dayStart.Add(time.Hour + 2*time.Minute + 30*time.Second)
	activeFrom := now.Add(-300 * time.Second)
	for _, event := range []struct {
		at                     time.Time
		visitor, session, kind string
	}{
		{dayStart.Add(-time.Second), "yesterday", "yesterday", "page_view"},
		{dayStart.Add(time.Minute), "v1", "s1", "page_view"},
		{activeFrom.Add(-time.Second), "old", "old", "page_view"},
		{activeFrom, "v1", "s1", "page_view"},
		{activeFrom.Add(time.Second), "v1", "s1", "action"},
		{dayStart.Add(time.Hour), "v1", "s1", "page_view"},
		{now.Add(-2 * time.Second), "v1", "s1", "page_view"},
		{now.Add(-time.Second), "action-only", "action-only", "action"},
		{now.Add(-time.Second), "v1", "s1", "action"},
		{now, "at-end", "at-end", "page_view"},
		{dayStart.Add(2 * time.Hour), "future", "future", "page_view"},
	} {
		if _, err := repo.InsertSiteTrafficEvents([]model.SiteTrafficEvent{{
			ID: uuid.NewString(), ReceivedAtEpoch: event.at.Unix(), VisitorHash: event.visitor,
			SessionHash: event.session, Type: event.kind, Page: "create",
		}}); err != nil {
			t.Fatal(err)
		}
	}
	result, err := repo.SiteTrafficToday(dayStart, activeFrom, now)
	if err != nil {
		t.Fatal(err)
	}
	if result.ActiveVisitors != 2 || len(result.Hours) != 2 {
		t.Fatalf("active window/hour range = %+v", result)
	}
	want := []SiteTrafficCounts{
		{Visitors: 2, PageViews: 3, Visits: 2, Actions: 1},
		{Visitors: 1, PageViews: 2, Visits: 1, Actions: 2},
	}
	for hour, counts := range want {
		if result.Hours[hour].Hour != hour || result.Hours[hour].SiteTrafficCounts != counts {
			t.Fatalf("hour %d must independently deduplicate PV visitors/sessions: %+v", hour, result.Hours[hour])
		}
	}
}

func TestSiteTrafficInsightsReturnReadErrors(t *testing.T) {
	from := time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC)
	queries := []struct {
		name string
		run  func(*Repository) error
	}{
		{"overview", func(repo *Repository) error {
			_, err := repo.SiteTrafficOverview(from, from.Add(time.Hour), from)
			return err
		}},
		{"comparison-kpi", func(repo *Repository) error { _, err := repo.SiteTrafficKPI(from, from.Add(time.Hour)); return err }},
		{"today", func(repo *Repository) error {
			_, err := repo.SiteTrafficToday(from, from.Add(55*time.Minute), from.Add(time.Hour))
			return err
		}},
	}
	for _, mode := range []string{"canceled", "missing-table"} {
		t.Run(mode, func(t *testing.T) {
			repo, db := siteTrafficRepositoryFixture(t)
			if mode == "canceled" {
				ctx, cancel := context.WithCancel(context.Background())
				cancel()
				repo = repo.WithContext(ctx)
			} else if err := db.Migrator().DropTable(&model.SiteTrafficEvent{}); err != nil {
				t.Fatal(err)
			}
			for _, query := range queries {
				if err := query.run(repo); err == nil || (mode == "canceled" && !errors.Is(err, context.Canceled)) {
					t.Fatalf("%s returned zero/success instead of %s error: %v", query.name, mode, err)
				}
			}
		})
	}
}

func TestSiteTrafficInsightGroupsKeepAbsoluteBeijingHoursAndSevenActions(t *testing.T) {
	repo, _ := siteTrafficRepositoryFixture(t)
	from := time.Date(2026, 11, 8, 0, 0, 0, 0, time.FixedZone("Asia/Shanghai", 28800))
	monday := from.AddDate(0, 0, 1)
	to := monday.Add(time.Hour)
	var events []model.SiteTrafficEvent
	add := func(at time.Time, kind, action string) {
		events = append(events, model.SiteTrafficEvent{ID: uuid.NewString(), VisitorHash: "v", SessionHash: "s",
			ReceivedAtEpoch: at.Unix(), Type: kind, Page: "create", Action: action})
	}
	add(monday.Add(-time.Second), "page_view", "")
	add(monday, "page_view", "")
	add(monday.Add(time.Second), "page_view", "")
	add(from.Add(-time.Second), "page_view", "")
	add(to, "page_view", "")
	actions := []string{"open_create", "new_canvas", "open_ecommerce", "creation_submit_text", "creation_submit_image", "creation_submit_video", "creation_submit_agent"}
	for _, action := range actions {
		add(monday.Add(-time.Second), "action", action)
		add(monday, "action", action)
		add(to, "action", action)
	}
	add(monday, "action", "not-registered")
	if _, err := repo.InsertSiteTrafficEvents(events); err != nil {
		t.Fatal(err)
	}
	result, err := repo.WithContext(context.Background()).SiteTrafficOverview(from, to, from)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Heatmap) != 2 || result.Heatmap[0].HourNumber != (monday.Unix()+28800)/3600-1 ||
		result.Heatmap[1].HourNumber != (monday.Unix()+28800)/3600 || result.Heatmap[0].PageViews != 1 || result.Heatmap[1].PageViews != 2 {
		t.Fatalf("absolute UTC+8 hour groups = %+v", result.Heatmap)
	}
	if len(result.FeatureTrend) != 14 {
		t.Fatalf("day/action groups = %+v", result.FeatureTrend)
	}
	seen := make(map[int64]map[string]int64)
	for _, point := range result.FeatureTrend {
		if seen[point.DayNumber] == nil {
			seen[point.DayNumber] = make(map[string]int64)
		}
		seen[point.DayNumber][point.Action] = point.Count
	}
	for _, day := range []time.Time{from, monday} {
		counts := seen[(day.Unix()+28800)/86400]
		for _, action := range actions {
			if counts[action] != 1 {
				t.Fatalf("date=%s action=%s counts=%+v", day.Format("2006-01-02"), action, counts)
			}
		}
	}
}

func TestSiteTrafficPageEngagementUsesMeasuredSamePagePairsOnly(t *testing.T) {
	repo, _ := siteTrafficRepositoryFixture(t)
	from := time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC)
	to := from.Add(time.Hour)
	var events []model.SiteTrafficEvent
	add := func(session, page, kind, action string, at time.Time) {
		events = append(events, model.SiteTrafficEvent{ID: uuid.NewString(), VisitorHash: session, SessionHash: session,
			ReceivedAtEpoch: at.Unix(), Type: kind, Page: page, Action: action})
	}
	want := make(map[string]SiteTrafficPageEngagementCounts)
	pair := func(page, action string, valid bool) {
		session := page + ":" + action
		add(session, page, "page_view", "", from)
		add(session, page, "page_view", "", from.Add(time.Second))
		add(session, page, "action", action, from.Add(2*time.Second))
		add(session, page, "action", action, from.Add(3*time.Second))
		counts := want[page]
		counts.Page, counts.Visits = page, counts.Visits+1
		if valid {
			counts.EngagedVisits++
		}
		want[page] = counts
	}
	for _, page := range []string{"inspirations", "create", "canvas_list", "assets", "history", "ecommerce", "ecommerce_pipeline", "drama", "skills", "referral", "tools_image", "tools_video"} {
		pair(page, "open_create", true)
		pair(page, "open_ecommerce", true)
	}
	for _, page := range []string{"inspirations", "canvas_list", "canvas"} {
		pair(page, "new_canvas", true)
	}
	for _, action := range []string{"creation_submit_text", "creation_submit_image", "creation_submit_video", "creation_submit_agent"} {
		pair("create", action, true)
	}
	for _, invalid := range [][2]string{
		{"create", "new_canvas"}, {"assets", "creation_submit_text"}, {"canvas", "open_create"}, {"canvas", "open_ecommerce"},
		{"history", "new_canvas"},
	} {
		pair(invalid[0], invalid[1], false)
	}
	// 历史非法pair仍留作夹具，但旧页面现在应整页排除，而非返回零参与度。
	for _, legacy := range [][2]string{
		{"welcome", "open_create"}, {"plugins", "open_create"}, {"share", "new_canvas"}, {"library", "open_create"},
		{"runninghub", "open_ecommerce"}, {"other", "creation_submit_agent"}, {"tools", "open_create"},
		{"auth", "open_create"}, {"account", "open_create"},
	} {
		add("legacy-"+legacy[0], legacy[0], "page_view", "", from)
		add("legacy-"+legacy[0], legacy[0], "action", legacy[1], from)
	}
	for _, session := range []string{"cross-page", "action-before", "action-at-end"} {
		add(session, "create", "page_view", "", from)
		counts := want["create"]
		counts.Visits++
		want["create"] = counts
	}
	add("cross-page", "inspirations", "action", "new_canvas", from)
	add("action-before", "create", "action", "creation_submit_text", from.Add(-time.Second))
	add("action-at-end", "create", "action", "creation_submit_image", to)
	add("action-only", "create", "action", "creation_submit_agent", from)
	add("pv-before", "create", "page_view", "", from.Add(-time.Second))
	add("pv-before", "create", "action", "creation_submit_video", from)
	if _, err := repo.InsertSiteTrafficEvents(events); err != nil {
		t.Fatal(err)
	}
	result, err := repo.WithContext(context.Background()).SiteTrafficOverview(from, to, from)
	if err != nil {
		t.Fatal(err)
	}
	for _, point := range result.PageEngagement {
		if point != want[point.Page] {
			t.Fatalf("page=%s flags=%+v want=%+v", point.Page, point, want[point.Page])
		}
		delete(want, point.Page)
	}
	if len(want) != 0 {
		t.Fatalf("missing measured pages: %+v", want)
	}
}

func TestSiteTrafficDepthCountsOnlyInWindowPVPerSession(t *testing.T) {
	repo, _ := siteTrafficRepositoryFixture(t)
	from := time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC)
	var events []model.SiteTrafficEvent
	for _, count := range []int{1, 2, 3, 4, 6} {
		session := fmt.Sprintf("depth-%d", count)
		for index := -4; index < count+1; index++ {
			at := from.Add(time.Duration(index) * time.Second)
			if index == count {
				at = from.Add(time.Hour)
			}
			events = append(events, model.SiteTrafficEvent{ID: uuid.NewString(), VisitorHash: session, SessionHash: session,
				ReceivedAtEpoch: at.Unix(), Type: "page_view", Page: "create"})
		}
	}
	events = append(events, model.SiteTrafficEvent{ID: uuid.NewString(), SessionHash: "action-only", ReceivedAtEpoch: from.Unix(), Type: "action", Page: "create", Action: "open_create"})
	if _, err := repo.InsertSiteTrafficEvents(events); err != nil {
		t.Fatal(err)
	}
	result, err := repo.WithContext(context.Background()).SiteTrafficOverview(from, from.Add(time.Hour), from)
	if err != nil || result.Depth != (SiteTrafficDepthCounts{Visits: 5, One: 1, TwoThree: 2, FourPlus: 2}) {
		t.Fatalf("depth includes action-only or window-external PV: %+v, %v", result, err)
	}
}

func TestSiteTrafficOverviewUsesThirteenIndependentQueriesForAnyRange(t *testing.T) {
	repo, db := siteTrafficRepositoryFixture(t)
	queries := 0
	callback := "site-traffic-test-query-count"
	if err := db.Callback().Row().Before("gorm:row").Register(callback, func(tx *gorm.DB) { queries++ }); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Callback().Row().Remove(callback) })
	from := time.Date(2025, 11, 11, 0, 0, 0, 0, time.FixedZone("Asia/Shanghai", 28800))
	if _, err := repo.InsertSiteTrafficEvents([]model.SiteTrafficEvent{
		{ID: uuid.NewString(), VisitorHash: "v", SessionHash: "s", ReceivedAtEpoch: from.Unix(), Type: "page_view", Page: "create"},
		{ID: uuid.NewString(), VisitorHash: "v", SessionHash: "s", ReceivedAtEpoch: from.Unix(), Type: "action", Page: "create", Action: "creation_submit_text"},
	}); err != nil {
		t.Fatal(err)
	}
	ctxRepo := repo.WithContext(context.Background())
	for _, days := range []int{1, 7, 365, 1} {
		queries = 0
		result, err := ctxRepo.SiteTrafficOverview(from, from.AddDate(0, 0, days), from)
		if err != nil {
			t.Fatal(err)
		}
		if queries != 13 || result.KPI != (SiteTrafficCounts{Visitors: 1, PageViews: 1, Visits: 1, Actions: 1}) ||
			len(result.Heatmap) != 1 || len(result.FeatureTrend) != 1 || len(result.PageEngagement) != 1 ||
			result.EarliestEpoch == nil || *result.EarliestEpoch != from.Unix() || result.Depth.Visits != 1 {
			t.Fatalf("independent query state: days=%d queries=%d result=%+v", days, queries, result)
		}
	}
}

func TestSiteTrafficOverviewPropagatesFailureAtEachAggregate(t *testing.T) {
	for _, mode := range []string{"canceled", "database-error"} {
		for failAt := 1; failAt <= 13; failAt++ {
			t.Run(fmt.Sprintf("%s/%d", mode, failAt), func(t *testing.T) {
				repo, db := siteTrafficRepositoryFixture(t)
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				queries, sentinel := 0, errors.New("aggregate read failed")
				callback := "site-traffic-test-failing-aggregate"
				if err := db.Callback().Row().Before("gorm:row").Register(callback, func(tx *gorm.DB) {
					queries++
					if queries == failAt {
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
				from := time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC)
				result, err := repo.WithContext(ctx).SiteTrafficOverview(from, from.Add(time.Hour), from)
				want := sentinel
				if mode == "canceled" {
					want = context.Canceled
				}
				if result != nil || !errors.Is(err, want) || queries != failAt {
					t.Fatalf("partial success/swallowed failure at query %d: result=%+v err=%v queries=%d", failAt, result, err, queries)
				}
			})
		}
	}
}

func TestSiteTrafficCleanupIsBoundedAndRechecksCutoff(t *testing.T) {
	repo, db := siteTrafficRepositoryFixture(t)
	cutoff := time.Date(2025, 11, 11, 0, 0, 0, 0, time.FixedZone("Asia/Shanghai", 28800))
	events := make([]model.SiteTrafficEvent, 0, 1003)
	for index := 0; index < 1001; index++ {
		events = append(events, model.SiteTrafficEvent{ID: fmt.Sprintf("old-%04d", index), ReceivedAtEpoch: cutoff.Unix() - 1})
	}
	events = append(events, model.SiteTrafficEvent{ID: "at-cutoff", ReceivedAtEpoch: cutoff.Unix()}, model.SiteTrafficEvent{ID: "new", ReceivedAtEpoch: cutoff.Unix() + 1})
	if err := db.CreateInBatches(events, 100).Error; err != nil {
		t.Fatal(err)
	}
	// 模拟候选读取后被并发更新，DELETE必须再次校验时间，而非仅凭候选ID。
	changed := false
	callback := "site-traffic-test-change-before-delete"
	if err := db.Callback().Delete().Before("gorm:delete").Register(callback, func(tx *gorm.DB) {
		if changed || tx.Statement.Table != "site_traffic_events" {
			return
		}
		changed = true
		if err := tx.Session(&gorm.Session{NewDB: true}).Model(&model.SiteTrafficEvent{}).
			Where("id = ?", "old-0000").Update("received_at_epoch", cutoff.Unix()).Error; err != nil {
			t.Error(err)
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Callback().Delete().Remove(callback) })
	deleted, err := repo.DeleteSiteTrafficEventsBefore(cutoff, 5000)
	if err != nil || deleted != 999 || !changed {
		t.Fatalf("bounded/rechecked delete = %d, %v, changed=%v", deleted, err, changed)
	}
	var kept int64
	if err := db.Model(&model.SiteTrafficEvent{}).Where("received_at_epoch >= ?", cutoff.Unix()).Count(&kept).Error; err != nil || kept != 3 {
		t.Fatalf("cutoff/new/concurrently updated records: %d, %v", kept, err)
	}
	deleted, err = repo.DeleteSiteTrafficEventsBefore(cutoff, 1000)
	if err != nil || deleted != 1 {
		t.Fatalf("second bounded round = %d, %v", deleted, err)
	}
}
