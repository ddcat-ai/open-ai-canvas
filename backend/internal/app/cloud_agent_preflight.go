package app

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"

	"yingce/backend/internal/repository"
)

// cloudAgentHandleMediaBatchControlFallback 只在调度绕过批次执行器时触发：
// media_batch_control 必须由 advanceCloudAgentMediaBatchControl 在检查点内处理。
func cloudAgentHandleMediaBatchControlFallback(*repository.Repository, string, *cloudAgentRuntime, cloudAgentCall, ...*Service) (any, error) {
	return nil, BadAuthRequest("批次控制只能在批次执行器里处理，请重试本次调用")
}

// cloudAgentHandleCanvasPreflight 是批量生成前的只读体检。静态检查（节点能否提交、提示词、
// 参考就绪、@标签）总会执行；带模型选择时再逐条做无扣费准入，核对能力、报价与本轮预算。
// 体检不创建任务、不预留积分，结果只是建议；真正提交时仍以准入为准。
func cloudAgentHandleCanvasPreflight(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	if len(services) == 0 || services[0] == nil || state == nil {
		return nil, BadAuthRequest("体检服务不可用")
	}
	s := services[0]
	args, err := decodeCloudAgentMediaBatchArgs(call.Function.Arguments)
	if err != nil {
		return nil, err
	}
	canvas, err := repo.CanvasProjectForUser(userID, state.Request.CanvasID)
	if err != nil {
		return nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, err
	}
	nodes, err := creationObjects(doc["nodes"])
	if err != nil {
		return nil, err
	}
	withModel := args.LogicalModelID != "" || (args.ChannelID != "" && args.ChannelModelKey != "")
	run, err := repo.CloudAgent(userID, state.RuntimeRunID)
	if err != nil {
		return nil, err
	}
	probe := cloudAgentMediaBatchProbeState(state)
	items := make([]map[string]any, 0, len(args.Items))
	failed, warned := 0, 0
	var total int64
	videoSeconds := 0
	activeLimitHit := false
	for index := range args.Items {
		nodeID := args.Items[index].NodeID
		entry := map[string]any{"index": index, "nodeId": nodeID}
		if node := nodes[nodeID]; node != nil {
			entry["title"] = truncateRunes(stringValue(node["title"]), 60)
		}
		level := "ok"
		issues := []string{}
		fail := func(message string) {
			issues = append(issues, truncateRunes(message, 160))
			level = "error"
		}
		warn := func(message string) {
			issues = append(issues, truncateRunes(message, 160))
			if level == "ok" {
				level = "warning"
			}
		}
		a, argErr := cloudAgentMediaBatchItemArgs(doc, args, index)
		if argErr != nil {
			fail(cloudAgentSafeToolError(argErr))
		} else {
			counts := map[string]int{}
			for _, refID := range a.ReferenceNodeIDs {
				ref := nodes[refID]
				label := truncateRunes(stringValue(ref["title"]), 30)
				if _, field, refErr := cloudAgentMediaReference(repo, userID, canvas.ProjectID, ref); refErr != nil {
					fail(fmt.Sprintf("参考《%s》还不能用：%s", label, cloudAgentSafeToolError(refErr)))
				} else {
					counts[field]++
				}
			}
			for _, mention := range cloudAgentMediaMention.FindAllString(a.Prompt, -1) {
				field := map[string]string{"图片": "referenceImages", "视频": "referenceVideos", "音频": "referenceAudios"}
				for label, key := range field {
					if strings.HasPrefix(mention, "@"+label) {
						number, _ := strconv.Atoi(strings.TrimPrefix(mention, "@"+label))
						if number > counts[key] {
							fail(fmt.Sprintf("提示词里的 %s 没有对应的参考连线", mention))
						}
					}
				}
			}
			if utf8.RuneCountInString(a.Prompt) > 16000 {
				fail("提示词超过 16000 字符")
			}
			if args.Mode == "video" && len(a.ReferenceNodeIDs) == 0 {
				warn("没有参考图，将按文生视频提交，人物和场景一致性靠提示词")
			}
			if args.Mode == "image" && len(a.ReferenceNodeIDs) == 0 {
				warn("没有资产参考，跨镜头一致性可能不稳定")
			}
			if withModel && level != "error" {
				itemCall, callErr := cloudAgentMediaBatchItemCall(call.ID, index, a)
				if callErr != nil {
					return nil, callErr
				}
				req, plan, prepareErr := s.prepareCloudAgentMedia(run, probe, itemCall)
				if prepareErr != nil {
					fail("准入未通过：" + cloudAgentSafeToolError(prepareErr))
				} else {
					preparation := &creationTaskPreparation{}
					req.creationPrepare = preparation
					task, createErr := s.CreateTask(userID, req)
					switch {
					case createErr != nil && strings.Contains(createErr.Error(), "同时排队或运行的任务"):
						activeLimitHit = true
						warn("当前同时任务已满，暂时无法核对报价")
					case createErr != nil:
						fail("准入未通过：" + cloudAgentSafeToolError(createErr))
					default:
						if defaultsErr := applyCloudAgentResolvedMediaDefaults(&req, plan, task); defaultsErr != nil {
							fail("规格解析未通过：" + cloudAgentSafeToolError(defaultsErr))
						} else {
							amount := int64(0)
							if preparation.Order != nil {
								amount = preparation.Order.AmountMicrocredits
							}
							total += amount
							videoSeconds += plan.Args.Duration
							entry["quote"] = cloudAgentCreditsLabel(amount)
							spec := []string{}
							for _, value := range []string{plan.Args.Size, plan.Args.Quality, plan.Args.ImageResolution} {
								if strings.TrimSpace(value) != "" {
									spec = append(spec, value)
								}
							}
							if plan.Args.Duration > 0 {
								spec = append(spec, fmt.Sprintf("%d秒", plan.Args.Duration))
							}
							entry["spec"] = strings.Join(spec, " · ")
						}
					}
				}
			}
		}
		switch level {
		case "error":
			failed++
		case "warning":
			warned++
		}
		entry["status"] = level
		if len(issues) > 0 {
			entry["issues"] = issues
		}
		items = append(items, entry)
	}
	result := map[string]any{
		"ok": failed == 0, "failed": failed, "warnings": warned, "total": len(items), "items": items,
	}
	budgetIssues := []string{}
	if withModel {
		budget := state.Request.Budget
		orders, err := repo.BillingOrdersByTaskIDs(userID, state.TaskIDs)
		if err != nil {
			return nil, err
		}
		remaining := int64(math.Floor(budget.MaxCredits * float64(CreditScale)))
		for _, order := range orders {
			remaining -= order.AmountMicrocredits
		}
		result["estimatedCredits"] = cloudAgentCreditsLabel(total)
		result["remainingCredits"] = cloudAgentCreditsLabel(remaining)
		if total > remaining {
			budgetIssues = append(budgetIssues, fmt.Sprintf("预计 %s，超过本轮剩余积分 %s", cloudAgentCreditsLabel(total), cloudAgentCreditsLabel(remaining)))
		}
		if budget.MaxGenerationTasks > 0 && state.Generations+len(items) > budget.MaxGenerationTasks {
			budgetIssues = append(budgetIssues, fmt.Sprintf("本轮最多还能生成 %d 条", budget.MaxGenerationTasks-state.Generations))
		}
		if args.Mode == "video" && budget.MaxVideoSeconds > 0 && state.VideoSeconds+videoSeconds > budget.MaxVideoSeconds {
			budgetIssues = append(budgetIssues, fmt.Sprintf("视频共 %d 秒，超过本轮剩余时长 %d 秒", videoSeconds, budget.MaxVideoSeconds-state.VideoSeconds))
		}
	}
	if len(budgetIssues) > 0 {
		result["ok"] = false
		result["budgetIssues"] = budgetIssues
	}
	summary := fmt.Sprintf("体检：%d 失败 / %d 警告（共 %d 条）", failed, warned, len(items))
	if total > 0 {
		summary += "，预计 " + cloudAgentCreditsLabel(total)
	}
	if len(budgetIssues) > 0 {
		summary += "；预算：" + strings.Join(budgetIssues, "；")
	}
	if activeLimitHit {
		summary += "；部分报价因同时任务已满未核对"
	}
	result["summary"] = summary
	if result["ok"] == true {
		result["next"] = "可以用相同参数调用 generate_media_batch 申请一次批准；条目多或模型新时建议 canary=true 先试跑"
	} else {
		result["next"] = "先修正失败项（补提示词、等待参考生成完成、移出已有结果的节点或拆批），再重新体检"
	}
	return result, nil
}
