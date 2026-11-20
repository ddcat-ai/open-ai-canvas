package ecommerceagent

import (
	"context"
	"errors"
	"fmt"
	"testing"
)

type simulationFixture struct {
	t         *testing.T
	generated int
	reviewed  bool
	failAt    int
	cancel    context.CancelFunc
}

func (f *simulationFixture) Understand(_ context.Context, ref string) (SimulationProduct, error) {
	if ref != "product" {
		f.t.Fatal("product reference lost")
	}
	return SimulationProduct{Category: "耳机", Visible: []string{"蓝色"}, Unconfirmed: []string{"降噪"}}, nil
}
func (f *simulationFixture) Retrieve(_ context.Context, p SimulationProduct) ([]SimulationKnowledge, error) {
	if p.Category != "耳机" {
		f.t.Fatal("category lost")
	}
	return []SimulationKnowledge{{ID: "k1", Source: "reviewed", Method: "可见结构"}}, nil
}
func (f *simulationFixture) Recommend(_ context.Context, p SimulationProduct, k []SimulationKnowledge) ([]SimulationDirection, error) {
	if p.Visible[0] != "蓝色" || len(k) != 1 || k[0].ID != "k1" {
		f.t.Fatal("evidence not passed")
	}
	return []SimulationDirection{{ID: "a"}, {ID: "b", Style: "暖色"}, {ID: "c"}, {ID: "d"}}, nil
}
func (f *simulationFixture) Plan(_ context.Context, p SimulationProduct, k []SimulationKnowledge, d SimulationDirection, count int) ([]SimulationPage, error) {
	if d.ID != "b" || d.Style != "暖色" || p.Category != "耳机" || k[0].Method != "可见结构" {
		f.t.Fatal("plan input lost")
	}
	pages := make([]SimulationPage, count)
	for i := range pages {
		pages[i] = SimulationPage{ID: fmt.Sprint(i), Theme: fmt.Sprintf("主题%d", i), Copy: "日常", Prompt: fmt.Sprintf("暖色镜头%d", i)}
	}
	return pages, nil
}
func (f *simulationFixture) Generate(_ context.Context, ref string, page SimulationPage) (SimulationImage, error) {
	f.generated++
	if ref != "product" || page.Prompt == "" {
		f.t.Fatal("image inputs missing")
	}
	if f.cancel != nil {
		f.cancel()
	}
	if f.failAt == f.generated {
		return SimulationImage{}, errors.New("fixture error")
	}
	return SimulationImage{PageID: page.ID, ResourceID: "result-" + page.ID}, nil
}
func (f *simulationFixture) Review(_ context.Context, ref string, p SimulationProduct, pages []SimulationPage, images []SimulationImage) ([]SimulationIssue, error) {
	f.reviewed = true
	if ref != "product" || len(pages) != 9 || len(images) != 9 || p.Category != "耳机" {
		f.t.Fatal("review input lost")
	}
	return []SimulationIssue{{PageID: pages[0].ID, Issue: "文字需核对", Suggestion: "检查标题后重新编辑"}}, nil
}

func TestOrchestrationSimulationPropagatesEvidenceAndSelectedDirection(t *testing.T) {
	f := &simulationFixture{t: t}
	result, err := SimulateOrchestration(context.Background(), f, "product", "b", 9)
	if err != nil || result.Version != 1 || len(result.Images) != 9 || len(result.Issues) != 1 || f.generated != 9 || !f.reviewed {
		t.Fatalf("simulation: %+v %v", result, err)
	}
}
func TestOrchestrationSimulationStopsOnFailureAndCancellation(t *testing.T) {
	f := &simulationFixture{t: t, failAt: 2}
	result, err := SimulateOrchestration(context.Background(), f, "product", "b", 9)
	if err == nil || len(result.Images) != 1 || f.reviewed {
		t.Fatal("failure did not stop or preserve completed work")
	}
	ctx, cancel := context.WithCancel(context.Background())
	f = &simulationFixture{t: t, cancel: cancel}
	_, err = SimulateOrchestration(ctx, f, "product", "b", 9)
	if !errors.Is(err, context.Canceled) || f.generated != 1 || f.reviewed {
		t.Fatal("cancellation ignored")
	}
}
