package ecommerceagent

import (
	"context"
	"errors"
	"fmt"
)

// This contract is deliberately isolated from task admission and providers.
// It exercises data flow only; it cannot authorize, quote or settle production calls.
type SimulationProduct struct {
	Category    string
	Visible     []string
	Unconfirmed []string
}
type SimulationKnowledge struct{ ID, Source, Method string }
type SimulationDirection struct{ ID, Style string }
type SimulationPage struct{ ID, Theme, Copy, Prompt string }
type SimulationImage struct{ PageID, ResourceID string }
type SimulationIssue struct{ PageID, Issue, Suggestion string }
type SimulationResult struct {
	Version    int
	Product    SimulationProduct
	Knowledge  []SimulationKnowledge
	Directions []SimulationDirection
	Selected   SimulationDirection
	Pages      []SimulationPage
	Images     []SimulationImage
	Issues     []SimulationIssue
}

type SimulationDriver interface {
	Understand(context.Context, string) (SimulationProduct, error)
	Retrieve(context.Context, SimulationProduct) ([]SimulationKnowledge, error)
	Recommend(context.Context, SimulationProduct, []SimulationKnowledge) ([]SimulationDirection, error)
	Plan(context.Context, SimulationProduct, []SimulationKnowledge, SimulationDirection, int) ([]SimulationPage, error)
	Generate(context.Context, string, SimulationPage) (SimulationImage, error)
	Review(context.Context, string, SimulationProduct, []SimulationPage, []SimulationImage) ([]SimulationIssue, error)
}

// SimulateOrchestration invokes only the supplied driver, and is not wired to
// production task creation. The caller owns persistence and any billing gate.
func SimulateOrchestration(ctx context.Context, driver SimulationDriver, reference, selectedID string, count int) (SimulationResult, error) {
	result := SimulationResult{Version: 1}
	if driver == nil || reference == "" || selectedID == "" || count < 1 || count > 30 {
		return result, errors.New("invalid simulation input")
	}
	check := func() error { return ctx.Err() }
	if err := check(); err != nil {
		return result, err
	}
	product, err := driver.Understand(ctx, reference)
	if err != nil {
		return result, fmt.Errorf("understand: %w", err)
	}
	if product.Category == "" {
		return result, errors.New("understand: missing category")
	}
	result.Product = product
	if err := check(); err != nil {
		return result, err
	}
	result.Knowledge, err = driver.Retrieve(ctx, product)
	if err != nil {
		return result, fmt.Errorf("knowledge: %w", err)
	}
	if err := check(); err != nil {
		return result, err
	}
	result.Directions, err = driver.Recommend(ctx, product, result.Knowledge)
	if err != nil {
		return result, fmt.Errorf("recommend: %w", err)
	}
	if len(result.Directions) != 4 {
		return result, errors.New("recommend: expected four directions")
	}
	seenDirections := map[string]bool{}
	for _, direction := range result.Directions {
		if direction.ID == "" || seenDirections[direction.ID] {
			return result, errors.New("recommend: invalid direction identity")
		}
		seenDirections[direction.ID] = true
		if direction.ID == selectedID {
			result.Selected = direction
		}
	}
	if result.Selected.ID == "" {
		return result, errors.New("selected direction not found")
	}
	if err := check(); err != nil {
		return result, err
	}
	result.Pages, err = driver.Plan(ctx, product, result.Knowledge, result.Selected, count)
	if err != nil {
		return result, fmt.Errorf("plan: %w", err)
	}
	if len(result.Pages) != count {
		return result, errors.New("plan: page count mismatch")
	}
	seenPages := map[string]bool{}
	for _, page := range result.Pages {
		if page.ID == "" || page.Theme == "" || page.Prompt == "" || seenPages[page.ID] {
			return result, errors.New("plan: invalid page")
		}
		seenPages[page.ID] = true
	}
	for _, page := range result.Pages {
		if err := check(); err != nil {
			return result, err
		}
		image, err := driver.Generate(ctx, reference, page)
		if err != nil {
			return result, fmt.Errorf("image %s: %w", page.ID, err)
		}
		if image.PageID != page.ID || image.ResourceID == "" {
			return result, errors.New("image: invalid page binding")
		}
		result.Images = append(result.Images, image)
	}
	if err := check(); err != nil {
		return result, err
	}
	result.Issues, err = driver.Review(ctx, reference, product, result.Pages, result.Images)
	if err != nil {
		return result, fmt.Errorf("review: %w", err)
	}
	for _, issue := range result.Issues {
		if !seenPages[issue.PageID] || issue.Issue == "" || issue.Suggestion == "" {
			return result, errors.New("review: invalid issue")
		}
	}
	return result, nil
}
