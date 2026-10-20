package app

import (
	"encoding/json"
	"fmt"
	"math"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestCloudAgentConcurrentRetryAdmissionCannotSpendSharedBudgetTwice(t *testing.T) {
	forEachRetryDispatchDatabase(t, func(t *testing.T, s *Service, db *gorm.DB) {
		s.disablePiRuntime, s.legacyCloudAgentRootTask = true, false
		capability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-test")
		for _, row := range []any{
			&model.User{ID: "user", Username: "budget-test", Role: model.UserRoleUser, Status: model.UserStatusActive},
			&model.ModelChannel{ID: "channel", Scope: model.ChannelScopeSystem, Enabled: true, Name: "test"},
			&model.ChannelModel{ID: "cm", ChannelID: "channel", ModelKey: "text-test", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, capability), BillingMode: "fixed_request", PriceConfigured: true, Enabled: true},
			&model.ChannelModelPriceTier{ID: "tier", ChannelModelID: "cm", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 1, PriceConfigured: true, Enabled: true},
			&model.CreditAccount{UserID: "user", AvailableMicrocredits: 10000},
		} {
			if err := db.Create(row).Error; err != nil {
				t.Fatal(err)
			}
		}
		testCloudAgentConcurrentRetryAdmission(t, s, db)
	})
}

func testCloudAgentConcurrentRetryAdmission(t *testing.T, s *Service, db *gorm.DB) {
	t.Helper()
	installCreationParallelImageModel(t, db)
	req := creationAgentRequest()
	req.PermissionMode = "auto"
	req.Budget.MaxCredits = 1 / float64(CreditScale)
	req.MediaSettings = &CloudAgentCreationMedia{Image: &CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "image-test"}, ParameterMode: "auto"}}
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	completeCreationReferenceRun(t, db, root.ID)
	type submission struct {
		run   *model.CloudAgentExecution
		state cloudAgentRuntime
		item  cloudAgentCommerceBatchItem
	}
	var submissions []submission
	parentID := root.ID
	for _, id := range []string{"left", "right"} {
		input := map[string]any{"mode": "image", "prompt": "Original " + id, "config": map[string]any{"channelId": "channel", "channelModelKey": "image-test", "model": "image-test", "size": "1024x1024", "count": "1"}, "metadata": map[string]any{"source": "cloud_agent_creation", "agentRunId": root.ID}}
		if err := db.Create(&model.Task{ID: id, UserID: "user", AgentRunID: root.ID, Type: "canvas_image", Operation: "text_to_image", Model: "image-test", Prompt: "Original " + id, InputJSON: mustMarshal(input), Status: model.TaskStatusFailed, ExecutionDiagnosticJSON: `{"submissionOutcome":"not_submitted"}`}).Error; err != nil {
			t.Fatal(err)
		}
		req.IdempotencyKey, req.SessionID, req.Retry = "retry-"+id, root.SessionID, &CloudAgentCreationRetry{RunID: root.ID, TaskID: id}
		next, err := s.CreateCloudAgentRun("user", req, parentID)
		if err != nil {
			t.Fatal(err)
		}
		run, state := agentInterjectionState(t, s, next.ID)
		batch, err := s.prepareCloudAgentReplayBatch(run, &state, state.Calls[0])
		if err != nil {
			t.Fatal(err)
		}
		state.CommerceBatch = batch
		if err := s.repo.MutateCloudAgentRun(run, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			return cloudAgentSave(current, &state)
		}); err != nil {
			t.Fatal(err)
		}
		run, state = agentInterjectionState(t, s, run.ID)
		submissions = append(submissions, submission{run, state, batch.Items[0]})
		parentID = run.ID
		if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", run.ID).Update("status", "completed").Error; err != nil {
			t.Fatal(err)
		}
	}
	// Admission now prevents new concurrent creation rounds. Restore two
	// previously admitted workers to exercise the budget fence for legacy
	// executions and resumption races, without bypassing it in production.
	for _, entry := range submissions {
		if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", entry.run.ID).Update("status", entry.run.Status).Error; err != nil {
			t.Fatal(err)
		}
	}
	// Both replicas quote against the same remaining allowance before either
	// takes its execution write lock. Only transaction-time accounting can win.
	ready := make(chan struct{})
	var arrivals atomic.Int32
	const callback = "test:shared-retry-budget"
	if err := db.Callback().Update().Before("gorm:update").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Table != "cloud_agent_executions" {
			return
		}
		n := arrivals.Add(1)
		if n == 2 {
			close(ready)
		}
		if n <= 2 {
			select {
			case <-ready:
			case <-time.After(10 * time.Second):
				tx.AddError(fmt.Errorf("concurrent admission did not arrive"))
			}
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Callback().Update().Remove(callback) })
	results := make(chan error, 2)
	for _, submit := range submissions {
		go func(entry submission) {
			replica := &Service{repo: repository.New(db), dataDir: s.dataDir, disablePiRuntime: true}
			media := &cloudAgentMediaPlan{Args: entry.item.Args, CallID: entry.state.Calls[0].ID, TaskID: entry.item.TaskID, Prepared: entry.item.Prepared}
			results <- replica.enqueueCloudAgentTask(entry.run, &entry.state, entry.item.Request, media)
		}(submit)
	}
	for range submissions {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	var tasks []model.Task
	if err := db.Where("agent_run_id IN ? AND type = ?", []string{submissions[0].run.ID, submissions[1].run.ID}, "canvas_image").Find(&tasks).Error; err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 1 {
		t.Fatalf("shared one-image budget admitted %d tasks", len(tasks))
	}
	orders, err := s.repo.BillingOrdersByTaskIDs("user", []string{submissions[0].item.TaskID, submissions[1].item.TaskID})
	if err != nil || len(orders) != 1 {
		t.Fatalf("reserved sibling orders=%d err=%v", len(orders), err)
	}
}

func TestCloudAgentNaturalLanguageRetryBudgetKeepsOriginalAllowance(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	for _, item := range []struct{ id, source, task string }{
		{"original", "", "first-charge"}, {"spoken-retry", "original", "second-charge"},
	} {
		state := map[string]any{"request": map[string]any{"surface": "creation", "sessionId": "natural-session", "budget": map[string]any{"maxCredits": 3}}, "taskIds": []string{item.task}, "retryBudgetRunId": item.source}
		if err := db.Create(&model.CloudAgentExecution{ID: item.id, UserID: "user", Surface: "creation", SessionID: "natural-session", StateJSON: mustMarshal(state)}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.BillingOrder{ID: item.task, TaskID: item.task, UserID: "user", IdempotencyKey: item.task, Status: model.BillingStatusSettled, ActualAmountMicrocredits: CreditScale}).Error; err != nil {
			t.Fatal(err)
		}
	}
	var state cloudAgentRuntime
	if err := json.Unmarshal([]byte(`{"request":{"surface":"creation","sessionId":"natural-session","budget":{"maxCredits":100}},"retryBudgetRunId":"spoken-retry"}`), &state); err != nil {
		t.Fatal(err)
	}
	remaining, err := s.cloudAgentRemainingBudget("user", &state)
	if err != nil || remaining != CreditScale {
		t.Fatalf("natural retry reset allowance: remaining=%d err=%v", remaining, err)
	}
}

func TestCloudAgentRetryBudgetBindingPreservesRequestAndRejectsAnotherRoot(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	for _, item := range []struct{ id, session, source string }{{"original", "session", ""}, {"child", "session", "original"}, {"unrelated", "session", ""}, {"foreign-session", "other", ""}} {
		state := cloudAgentRuntime{Request: CloudAgentRequest{Surface: "creation", SessionID: item.session}, RetryBudgetRunID: item.source}
		state.Request.Budget.MaxCredits = 3
		if err := db.Create(&model.CloudAgentExecution{ID: item.id, UserID: "user", Surface: "creation", SessionID: item.session, StateJSON: mustMarshal(state)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	state := cloudAgentRuntime{RuntimeRunID: "current", Request: CloudAgentRequest{Surface: "creation", SessionID: "session"}, Fingerprint: "unchanged"}
	before := mustMarshal(state.Request)
	task := &model.Task{UserID: "user", AgentRunID: "original", InputJSON: `{"metadata":{"agentRunId":"original"}}`}
	if err := s.bindCloudAgentRetryBudget("user", &state, task); err != nil || state.RetryBudgetRunID != "original" {
		t.Fatalf("first source not bound: %s %v", state.RetryBudgetRunID, err)
	}
	task.AgentRunID, task.InputJSON = "child", `{"metadata":{"agentRunId":"child"}}`
	if err := s.bindCloudAgentRetryBudget("user", &state, task); err != nil || state.RetryBudgetRunID != "child" {
		t.Fatalf("same-root retry rejected: %v", err)
	}
	for _, source := range []string{"unrelated", "foreign-session", "missing"} {
		task.AgentRunID, task.InputJSON = source, mustMarshal(map[string]any{"metadata": map[string]any{"agentRunId": source}})
		if err := s.bindCloudAgentRetryBudget("user", &state, task); err == nil || state.RetryBudgetRunID != "child" {
			t.Fatalf("rebound allowance to %s: %v", source, err)
		}
	}
	task.AgentRunID, task.InputJSON = "original", `{"metadata":{"agentRunId":"unrelated"}}`
	if err := s.bindCloudAgentRetryBudget("user", &state, task); err == nil {
		t.Fatal("accepted conflicting task source")
	}
	if mustMarshal(state.Request) != before || state.Fingerprint != "unchanged" {
		t.Fatal("binding changed user request or idempotency fingerprint")
	}
	state.RetryBudgetRunID = ""
	task.AgentRunID, task.InputJSON = state.RuntimeRunID, `{}`
	if err := s.bindCloudAgentRetryBudget("user", &state, task); err != nil || state.RetryBudgetRunID != "" {
		t.Fatalf("same-run repair created self-cycle: %v", err)
	}
}

func TestCloudAgentRemainingBudgetUsesSettledReservedAndRefundedAmounts(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	state := cloudAgentRuntime{TaskIDs: []string{"settled", "refunded", "reserved", "uncertain", "settled"}}
	state.Request.Budget.MaxCredits = 10
	for _, order := range []model.BillingOrder{
		{ID: "settled", TaskID: "settled", Status: model.BillingStatusSettled, AmountMicrocredits: 9 * CreditScale, ActualAmountMicrocredits: 2 * CreditScale},
		{ID: "refunded", TaskID: "refunded", Status: model.BillingStatusRefunded, AmountMicrocredits: 9 * CreditScale},
		{ID: "reserved", TaskID: "reserved", Status: model.BillingStatusReserved, AmountMicrocredits: CreditScale, ReservedAmountMicrocredits: 2 * CreditScale},
		{ID: "uncertain", TaskID: "uncertain", Status: model.BillingStatusUncertain, AmountMicrocredits: CreditScale},
	} {
		order.UserID, order.IdempotencyKey = "user", order.ID
		if err := db.Create(&order).Error; err != nil {
			t.Fatal(err)
		}
	}
	remaining, err := s.cloudAgentRemainingBudget("user", &state)
	if err != nil || remaining != 5*CreditScale {
		t.Fatalf("remaining=%d want=%d err=%v", remaining, 5*CreditScale, err)
	}
}

func TestCloudAgentRetryBudgetIncludesSiblingChainsAndUsesOriginalLimit(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	putRun := func(id, session, source string, limit float64, tasks ...string) {
		t.Helper()
		request := CloudAgentRequest{Surface: "creation", SessionID: session}
		request.Budget.MaxCredits = limit
		if source != "" {
			request.Retry = &CloudAgentCreationRetry{RunID: source}
		}
		state := cloudAgentRuntime{Request: request, TaskIDs: tasks}
		run := model.CloudAgentExecution{ID: id, UserID: "user", SessionID: session, Surface: "creation", Status: "completed", StateJSON: mustMarshal(state), CreatedAt: time.Now()}
		if err := db.Create(&run).Error; err != nil {
			t.Fatal(err)
		}
	}
	putRun("original", "session", "", 10, "original-task")
	putRun("retry-a", "session", "original", 100, "retry-a-task")
	putRun("retry-b", "session", "original", 100, "retry-b-task")
	putRun("retry-nested", "session", "retry-a", 100, "retry-a-task", "nested-task")
	putRun("unrelated", "session", "", 100, "unrelated-task")
	putRun("other-session", "other-session", "", 100, "other-session-task")
	for _, id := range []string{"original-task", "retry-a-task", "retry-b-task", "nested-task", "current-task", "unrelated-task", "other-session-task"} {
		if err := db.Create(&model.BillingOrder{ID: id, UserID: "user", TaskID: id, IdempotencyKey: id, Status: model.BillingStatusSettled, ActualAmountMicrocredits: CreditScale}).Error; err != nil {
			t.Fatal(err)
		}
	}
	state := cloudAgentRuntime{Request: CloudAgentRequest{Surface: "creation", SessionID: "session", Retry: &CloudAgentCreationRetry{RunID: "retry-nested"}}, TaskIDs: []string{"current-task"}}
	state.Request.Budget.MaxCredits = 100
	remaining, err := s.cloudAgentRemainingBudget("user", &state)
	if err != nil || remaining != 5*CreditScale {
		t.Fatalf("retry reset original or sibling budget: remaining=%d err=%v", remaining, err)
	}
	state.Request.Budget.MaxCredits = 6
	remaining, err = s.cloudAgentRemainingBudget("user", &state)
	if err != nil || remaining != CreditScale {
		t.Fatalf("current reduced limit ignored: remaining=%d err=%v", remaining, err)
	}
	state.Request.Retry.RunID = "other-session"
	if _, err := s.cloudAgentRemainingBudget("user", &state); err == nil {
		t.Fatal("accepted cross-session retry source")
	}
	state.Request.Retry.RunID = "missing"
	if _, err := s.cloudAgentRemainingBudget("user", &state); err == nil {
		t.Fatal("accepted missing retry source")
	}
	putRun("cycle-one", "session", "cycle-two", 100)
	putRun("cycle-two", "session", "cycle-one", 100)
	state.Request.Retry.RunID = "cycle-one"
	if _, err := s.cloudAgentRemainingBudget("user", &state); err == nil {
		t.Fatal("accepted cyclic retry lineage")
	}
}

func TestCloudAgentRetryBudgetReadsPastSessionPage(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	now := time.Now()
	runs := make([]model.CloudAgentExecution, 0, 502)
	for index := 0; index < 502; index++ {
		state := cloudAgentRuntime{Request: CloudAgentRequest{Surface: "creation", SessionID: "paged"}}
		state.Request.Budget.MaxCredits = 10
		id := fmt.Sprintf("page-%04d", index)
		if index > 0 {
			state.Request.Retry = &CloudAgentCreationRetry{RunID: "page-0000"}
		} else {
			state.TaskIDs = []string{"old-charge"}
		}
		runs = append(runs, model.CloudAgentExecution{ID: id, UserID: "user", SessionID: "paged", Surface: "creation", StateJSON: mustMarshal(state), CreatedAt: now.Add(time.Duration(index) * time.Second)})
	}
	if err := db.CreateInBatches(runs, 50).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.BillingOrder{ID: "old-charge", UserID: "user", TaskID: "old-charge", IdempotencyKey: "old-charge", Status: model.BillingStatusSettled, ActualAmountMicrocredits: 3 * CreditScale}).Error; err != nil {
		t.Fatal(err)
	}
	state := cloudAgentRuntime{Request: CloudAgentRequest{Surface: "creation", SessionID: "paged", Retry: &CloudAgentCreationRetry{RunID: "page-0501"}}}
	state.Request.Budget.MaxCredits = 100
	remaining, err := s.cloudAgentRemainingBudget("user", &state)
	if err != nil || remaining != 7*CreditScale {
		t.Fatalf("older source charge or limit missing: remaining=%d err=%v", remaining, err)
	}
}

func TestCloudAgentRemainingBudgetRejectsInvalidOrExhaustedAmounts(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	state := cloudAgentRuntime{}
	for _, limit := range []float64{-1, math.NaN(), math.Inf(1), float64(math.MaxInt64)} {
		state.Request.Budget.MaxCredits = limit
		if _, err := s.cloudAgentRemainingBudget("user", &state); err == nil {
			t.Fatalf("accepted invalid budget %v", limit)
		}
	}
	state.Request.Budget.MaxCredits = 1
	state.TaskIDs = []string{"spent"}
	if err := db.Create(&model.BillingOrder{ID: "spent", UserID: "user", TaskID: "spent", Status: model.BillingStatusSettled, ActualAmountMicrocredits: 2 * CreditScale}).Error; err != nil {
		t.Fatal(err)
	}
	remaining, err := s.cloudAgentRemainingBudget("user", &state)
	if err != nil || remaining >= 0 {
		t.Fatalf("exhausted budget became available: %d %v", remaining, err)
	}
}
