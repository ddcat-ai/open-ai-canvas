package repository

import (
	"reflect"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

type siteTrafficFunnelEvent struct {
	step, second int
	page, action string
}

func siteTrafficFunnelEventRow(session string, source siteTrafficFunnelEvent, from time.Time) model.SiteTrafficEvent {
	page, kind, action := "inspirations", "page_view", ""
	switch source.step {
	case 0:
		page = "history"
	case 2:
		kind, action = "action", "open_create"
	case 3:
		page = "create"
	case 4:
		page, kind, action = "create", "action", "creation_submit_text"
	}
	if source.page != "" {
		page = source.page
	}
	if source.action != "" {
		action = source.action
	}
	return siteTrafficOperationEvent(session, page, kind, action, from.Add(time.Duration(source.second)*time.Second))
}

func TestSiteTrafficFunnelGreedilyMatchesStrictAndPossibleReceiptSubsequences(t *testing.T) {
	for _, test := range []struct {
		name             string
		events           []siteTrafficFunnelEvent
		strict, possible [4]int64
	}{
		{name: "empty"},
		{name: "strict", events: []siteTrafficFunnelEvent{{step: 1, second: 0}, {step: 2, second: 1}, {step: 3, second: 2}, {step: 4, second: 3}}, strict: [4]int64{1, 1, 1, 1}, possible: [4]int64{1, 1, 1, 1}},
		{name: "all-same-second", events: []siteTrafficFunnelEvent{{step: 4}, {step: 3}, {step: 2}, {step: 1}}, strict: [4]int64{1}, possible: [4]int64{1, 1, 1, 1}},
		{name: "last-three-same-second", events: []siteTrafficFunnelEvent{{step: 1}, {step: 4, second: 1}, {step: 2, second: 1}, {step: 3, second: 1}}, strict: [4]int64{1, 1}, possible: [4]int64{1, 1, 1, 1}},
		{name: "strict-second-missing", events: []siteTrafficFunnelEvent{{step: 1}, {step: 2}, {step: 3, second: 1}, {step: 4, second: 2}}, strict: [4]int64{1}, possible: [4]int64{1, 1, 1, 1}},
		{name: "reverse-order", events: []siteTrafficFunnelEvent{{step: 4}, {step: 3, second: 1}, {step: 2, second: 2}, {step: 1, second: 3}}, strict: [4]int64{1}, possible: [4]int64{1}},
		{name: "bad-early-events-then-valid-chain", events: []siteTrafficFunnelEvent{
			{step: 2}, {step: 3, second: 1}, {step: 4, second: 2}, {step: 1, second: 3},
			{step: 2, second: 4}, {step: 3, second: 5}, {step: 4, second: 6},
		}, strict: [4]int64{1, 1, 1, 1}, possible: [4]int64{1, 1, 1, 1}},
		{name: "third-before-second-then-good-third", events: []siteTrafficFunnelEvent{
			{step: 1}, {step: 3, second: 1}, {step: 4, second: 2}, {step: 2, second: 3}, {step: 3, second: 4}, {step: 4, second: 5},
		}, strict: [4]int64{1, 1, 1, 1}, possible: [4]int64{1, 1, 1, 1}},
		{name: "fourth-before-third-then-good-fourth", events: []siteTrafficFunnelEvent{
			{step: 1}, {step: 4, second: 1}, {step: 2, second: 2}, {step: 3, second: 3}, {step: 4, second: 4},
		}, strict: [4]int64{1, 1, 1, 1}, possible: [4]int64{1, 1, 1, 1}},
		{name: "possible-chain-must-not-share-strict-predecessors", events: []siteTrafficFunnelEvent{
			{step: 1}, {step: 2}, {step: 3, second: 1}, {step: 4, second: 2}, {step: 2, second: 3}, {step: 3, second: 4},
		}, strict: [4]int64{1, 1, 1}, possible: [4]int64{1, 1, 1, 1}},
		{name: "intervening-events-allowed", events: []siteTrafficFunnelEvent{
			{step: 1}, {step: 0, second: 1}, {step: 2, second: 2}, {step: 0, second: 3}, {step: 3, second: 4}, {step: 0, second: 5}, {step: 4, second: 6},
		}, strict: [4]int64{1, 1, 1, 1}, possible: [4]int64{1, 1, 1, 1}},
		{name: "repeated-chains-count-session-once", events: []siteTrafficFunnelEvent{
			{step: 1}, {step: 2, second: 1}, {step: 3, second: 2}, {step: 4, second: 3},
			{step: 1, second: 4}, {step: 2, second: 5}, {step: 3, second: 6}, {step: 4, second: 7},
		}, strict: [4]int64{1, 1, 1, 1}, possible: [4]int64{1, 1, 1, 1}},
		{name: "direct-create-does-not-fill-chain", events: []siteTrafficFunnelEvent{{step: 3}, {step: 4, second: 1}}},
		{name: "missing-open-create", events: []siteTrafficFunnelEvent{{step: 1}, {step: 3, second: 1}, {step: 4, second: 2}}, strict: [4]int64{1}, possible: [4]int64{1}},
		{name: "open-from-other-page", events: []siteTrafficFunnelEvent{{step: 1}, {step: 2, second: 1, page: "assets"}, {step: 3, second: 2}, {step: 4, second: 3}}, strict: [4]int64{1}, possible: [4]int64{1}},
		{name: "submit-from-other-page", events: []siteTrafficFunnelEvent{{step: 1}, {step: 2, second: 1}, {step: 3, second: 2}, {step: 4, second: 3, page: "assets"}}, strict: [4]int64{1, 1, 1}, possible: [4]int64{1, 1, 1}},
		{name: "start-outside-window", events: []siteTrafficFunnelEvent{{step: 1, second: -1}, {step: 2}, {step: 3, second: 1}, {step: 4, second: 2}}},
		{name: "second-at-upper-bound", events: []siteTrafficFunnelEvent{{step: 1}, {step: 2, second: 3600}, {step: 3, second: 3601}, {step: 4, second: 3602}}, strict: [4]int64{1}, possible: [4]int64{1}},
		{name: "submit-at-upper-bound", events: []siteTrafficFunnelEvent{{step: 1}, {step: 2, second: 1}, {step: 3, second: 2}, {step: 4, second: 3600}}, strict: [4]int64{1, 1, 1}, possible: [4]int64{1, 1, 1}},
	} {
		t.Run(test.name, func(t *testing.T) {
			repo, _ := siteTrafficRepositoryFixture(t)
			from := time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC)
			var rows []model.SiteTrafficEvent
			// 倒序插入以避免把插入序或随机ID误作收到秒内的事件顺序。
			for index := len(test.events) - 1; index >= 0; index-- {
				rows = append(rows, siteTrafficFunnelEventRow("session", test.events[index], from))
			}
			if _, err := repo.InsertSiteTrafficEvents(rows); err != nil {
				t.Fatal(err)
			}
			result, err := repo.siteTrafficOperations(from, from.Add(time.Hour), from)
			if err != nil {
				t.Fatal(err)
			}
			if len(result.Funnel) != 4 {
				t.Fatalf("fixed four steps missing: %+v", result.Funnel)
			}
			for index, point := range result.Funnel {
				if point != (SiteTrafficFunnelCounts{Step: index + 1, Visits: test.strict[index], PossibleVisits: test.possible[index]}) || point.PossibleVisits < point.Visits {
					t.Fatalf("step %d: got %+v want strict=%v possible=%v", index+1, result.Funnel, test.strict, test.possible)
				}
				if index == 0 && point.Visits != point.PossibleVisits {
					t.Fatal("stage one must have no uncertain visits")
				}
				if index > 0 && (point.Visits > result.Funnel[index-1].Visits || point.PossibleVisits > result.Funnel[index-1].PossibleVisits) {
					t.Fatalf("funnel stage increased: %+v", result.Funnel)
				}
			}
		})
	}
}

func TestSiteTrafficFunnelSubmitUnionRetriesAndSessionPartition(t *testing.T) {
	repo, _ := siteTrafficRepositoryFixture(t)
	from := time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC)
	var rows []model.SiteTrafficEvent
	actions := []string{"creation_submit_text", "creation_submit_image", "creation_submit_video", "creation_submit_agent", "new_canvas", "creation_submit_text"}
	for index, action := range actions {
		session := "submit-" + action
		if index == 5 {
			session = "submit-wrong-source"
		}
		for _, source := range []siteTrafficFunnelEvent{{step: 1}, {step: 2, second: 1}, {step: 3, second: 2}} {
			rows = append(rows, siteTrafficFunnelEventRow(session, source, from))
		}
		page := "create"
		if index == 5 {
			page = "tools_video"
		}
		rows = append(rows, siteTrafficFunnelEventRow(session, siteTrafficFunnelEvent{step: 4, second: 3, page: page, action: action}, from))
		if index < 4 {
			// 同会话后续再点另一种提交意图，也只能在S4计一次。
			rows = append(rows, siteTrafficFunnelEventRow(session, siteTrafficFunnelEvent{step: 4, second: 4, action: "creation_submit_agent"}, from))
		}
	}
	rows = append(rows, siteTrafficFunnelEventRow("action-only", siteTrafficFunnelEvent{step: 4}, from))
	accepted, err := repo.InsertSiteTrafficEvents(append(append([]model.SiteTrafficEvent{}, rows...), rows...))
	if err != nil || accepted != int64(len(rows)) {
		t.Fatalf("same-ID duplicate batch = %d, %v", accepted, err)
	}
	if accepted, err := repo.InsertSiteTrafficEvents(rows); err != nil || accepted != 0 {
		t.Fatalf("same-ID retries = %d, %v", accepted, err)
	}
	result, err := repo.siteTrafficOperations(from, from.Add(time.Hour), from)
	if err != nil {
		t.Fatal(err)
	}
	want := []SiteTrafficFunnelCounts{{Step: 1, Visits: 6, PossibleVisits: 6}, {Step: 2, Visits: 6, PossibleVisits: 6}, {Step: 3, Visits: 6, PossibleVisits: 6}, {Step: 4, Visits: 4, PossibleVisits: 4}}
	if !reflect.DeepEqual(result.Funnel, want) {
		t.Fatalf("S4 must union four supported create submissions and deduplicate sessions/retries: %+v", result.Funnel)
	}

	partitionRepo, _ := siteTrafficRepositoryFixture(t)
	for step, session := range []string{"one", "two", "three", "four"} {
		if _, err := partitionRepo.InsertSiteTrafficEvents([]model.SiteTrafficEvent{siteTrafficFunnelEventRow(session, siteTrafficFunnelEvent{step: step + 1, second: step}, from)}); err != nil {
			t.Fatal(err)
		}
	}
	partitioned, err := partitionRepo.siteTrafficOperations(from, from.Add(time.Hour), from)
	if err != nil || !reflect.DeepEqual(partitioned.Funnel, []SiteTrafficFunnelCounts{{Step: 1, Visits: 1, PossibleVisits: 1}, {Step: 2}, {Step: 3}, {Step: 4}}) {
		t.Fatalf("different sessions were stitched into a funnel: %+v, %v", partitioned, err)
	}
}
