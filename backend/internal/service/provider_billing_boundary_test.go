package service

import (
	"context"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestWithProviderAnalyticsUsesTaskBillingCoordinator(t *testing.T) {
	billing := newTaskBillingCoordinator(&taskBillingRepositoryStub{})
	service := &Service{taskBillingCoordinator: billing}
	task := model.Task{ID: "task-1", UserID: "user-1"}

	ctx := withProviderAnalytics(context.Background(), service, task)
	metadata, ok := ctx.Value(providerAnalyticsKey{}).(providerAnalyticsContext)
	if !ok {
		t.Fatal("withProviderAnalytics() did not attach provider metadata")
	}
	if metadata.Billing != billing {
		t.Fatalf("provider analytics billing = %p, want injected coordinator %p", metadata.Billing, billing)
	}
}
