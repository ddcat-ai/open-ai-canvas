package app

import (
	"encoding/json"
	"sort"
	"strings"
	"time"

	"infinite-canvas/backend/internal/canvas/contract"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

const cloudAgentMediaQuoteLifetime = 30 * time.Minute

type cloudAgentMediaQuote struct {
	ID                 string    `json:"id"`
	AmountMicrocredits int64     `json:"amountMicrocredits"`
	BillingMode        string    `json:"billingMode"`
	PriceVersion       int64     `json:"priceVersion"`
	PriceTierID        string    `json:"priceTierId,omitempty"`
	PriceTierVersion   int64     `json:"priceTierVersion"`
	ExpiresAt          time.Time `json:"expiresAt"`
}

// Prepared inputs contain public resource selectors, never resolved credentials.
// Re-admission must reproduce the same execution and quote before committing.
type cloudAgentPreparedMedia struct {
	Version            int                  `json:"version"`
	Hash               string               `json:"hash"`
	GenerationID       string               `json:"generationId"`
	DependencyHash     string               `json:"dependencyHash"`
	ResolvedHash       string               `json:"resolvedHash"`
	QuoteHash          string               `json:"quoteHash"`
	Quote              cloudAgentMediaQuote `json:"quote"`
	Input              map[string]any       `json:"input,omitempty"`
	ResourceSignatures map[string]string    `json:"resourceSignatures,omitempty"`
}

func (p *cloudAgentPreparedMedia) publicView() *cloudAgentPreparedMedia {
	if p == nil {
		return nil
	}
	copy := *p
	copy.Input, copy.ResourceSignatures = nil, nil
	return &copy
}

func cloudAgentApprovalOutput(approval *cloudAgentApproval) *cloudAgentApproval {
	if approval == nil {
		return nil
	}
	copy := *approval
	copy.Prepared = approval.Prepared.publicView()
	return &copy
}

func cloudAgentMediaDependencyHash(doc map[string]any, args cloudAgentMediaArgs) (string, error) {
	nodes, err := creationObjects(doc["nodes"])
	if err != nil {
		return "", err
	}
	projectionNode := func(node map[string]any) (map[string]any, error) {
		metadata, _ := node["metadata"].(map[string]any)
		input, err := contract.NodeGenerationProjection(metadata)
		if err != nil {
			return nil, BadAuthRequest("生成依赖字段无效：" + err.Error())
		}
		return input, nil
	}
	resourceProjection := func(metadata map[string]any) map[string]any {
		resource := map[string]any{}
		for _, key := range []string{"storageKey", "assetId", "resourceId", "generationTaskId", "outputReference", "status", "mimeType", "naturalWidth", "naturalHeight", "width", "height", "durationMs", "etag"} {
			if value, exists := metadata[key]; exists {
				resource[key] = value
			}
		}
		return resource
	}
	target := nodes[args.NodeID]
	var targetInput any
	if target != nil {
		input, err := projectionNode(target)
		if err != nil {
			return "", err
		}
		metadata, _ := target["metadata"].(map[string]any)
		for _, key := range []string{"locked", "taskId", "generationTaskId", "agentDraftRunId", "status"} {
			input[key] = metadata[key]
		}
		targetInput = map[string]any{"id": target["id"], "type": target["type"], "locked": target["locked"], "input": input, "resource": resourceProjection(metadata)}
	}
	bindings := make([]any, 0, len(args.ReferenceNodeIDs))
	for _, id := range args.ReferenceNodeIDs {
		node := nodes[id]
		binding := map[string]any{"id": id, "exists": node != nil}
		if node != nil {
			input, err := projectionNode(node)
			if err != nil {
				return "", err
			}
			metadata, _ := node["metadata"].(map[string]any)
			binding["type"] = node["type"]
			binding["input"] = input
			binding["resource"] = resourceProjection(metadata)
		}
		bindings = append(bindings, binding)
	}
	var source any
	if args.SourceNodeID != "" {
		node := nodes[args.SourceNodeID]
		metadata, _ := node["metadata"].(map[string]any)
		source = map[string]any{"id": args.SourceNodeID, "type": node["type"], "content": metadata["content"], "prompt": metadata["prompt"]}
	}
	edges := []any{}
	for _, edge := range creationMaps(doc["connections"]) {
		if stringValue(edge["toNodeId"]) == args.NodeID {
			edges = append(edges, map[string]any{"fromNodeId": edge["fromNodeId"], "toNodeId": edge["toNodeId"], "fromPort": edge["fromPort"], "toPort": edge["toPort"], "role": edge["role"]})
		}
	}
	return creationHash(map[string]any{"version": 2, "target": targetInput, "bindings": bindings, "source": source, "edges": edges}), nil
}

func cloudAgentResourceSignature(resource *model.Resource) string {
	return creationHash(map[string]any{"id": resource.ID, "userId": resource.UserID, "provider": resource.Provider, "endpoint": resource.Endpoint, "bucket": resource.Bucket, "objectKey": resource.ObjectKey, "storageSettingId": resource.StorageSettingID, "etag": resource.ETag, "size": resource.Size, "mimeType": resource.MimeType, "width": resource.Width, "height": resource.Height, "durationMs": resource.DurationMs})
}

func cloudAgentPreparedReferences(repo *repository.Repository, userID string, prepared *cloudAgentPreparedMedia) (map[string]any, error) {
	refs := map[string]any{}
	for _, field := range []string{"referenceImages", "referenceVideos", "referenceAudios"} {
		items := []any{}
		for _, ref := range creationMaps(prepared.Input[field]) {
			id := strings.TrimPrefix(stringValue(ref["storageKey"]), "resource:")
			resource, err := repo.ResourceForUser(userID, id)
			if err != nil || resource.Status != model.ResourceStatusReady || prepared.ResourceSignatures[id] != cloudAgentResourceSignature(resource) {
				return nil, creationConflict("已批准的参考资源已失效或不再属于当前用户，请重新准备生成；未提交任务")
			}
			copy := map[string]any{}
			for key, value := range ref {
				copy[key] = value
			}
			items = append(items, copy)
		}
		if len(items) > 0 {
			refs[field] = items
		}
	}
	return refs, nil
}

func cloudAgentResolvedMediaHash(task *model.Task) (string, error) {
	var input map[string]any
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		return "", err
	}
	config, _ := input["config"].(map[string]any)
	public := map[string]any{}
	for _, key := range []string{"channelId", "channelModelKey", "providerModelKey", "priceTierId", "model", "apiFormat", "interfaceType", "capabilityConfig", "size", "quality", "transparentBackground", "count", "videoSeconds", "vquality", "videoGenerateAudio", "videoWatermark", "audioVoice", "audioFormat", "audioSpeed", "audioInstructions"} {
		if value, exists := config[key]; exists {
			public[key] = value
		}
	}
	return creationHash(map[string]any{"mode": input["mode"], "prompt": input["prompt"], "config": public, "referenceImages": input["referenceImages"], "referenceVideos": input["referenceVideos"], "referenceAudios": input["referenceAudios"], "operation": task.Operation, "logicalModelId": task.LogicalModelID, "logicalModelRevisionId": task.LogicalModelRevisionID, "channelModelId": task.ChannelModelID}), nil
}

func cloudAgentQuoteHash(order *model.BillingOrder) string {
	if order == nil {
		return creationHash(nil)
	}
	return creationHash(map[string]any{"amount": order.AmountMicrocredits, "billingMode": order.BillingMode, "priceVersion": order.PriceVersion, "priceTierId": order.PriceTierID, "priceTierVersion": order.PriceTierVersion, "quantity": order.Quantity, "unitPrice": order.UnitPriceMicrocredits, "inputTokenPrice": order.InputTokenPriceMicrocredits, "outputTokenPrice": order.OutputTokenPriceMicrocredits, "cachedTokenPrice": order.CachedTokenPriceMicrocredits, "multiplier": order.MultiplierBasisPoints})
}

func prepareCloudAgentMediaApproval(repo *repository.Repository, userID string, doc map[string]any, plan *cloudAgentMediaPlan, request CreateTaskRequest, task *model.Task, order *model.BillingOrder) (*cloudAgentPreparedMedia, error) {
	dependency, err := cloudAgentMediaDependencyHash(doc, plan.Args)
	if err != nil {
		return nil, err
	}
	resolved, err := cloudAgentResolvedMediaHash(task)
	if err != nil {
		return nil, err
	}
	prepared := &cloudAgentPreparedMedia{Version: 1, GenerationID: newID(), DependencyHash: dependency, ResolvedHash: resolved, QuoteHash: cloudAgentQuoteHash(order), Input: request.Input, ResourceSignatures: map[string]string{}, Quote: cloudAgentMediaQuote{ID: newID(), ExpiresAt: time.Now().UTC().Add(cloudAgentMediaQuoteLifetime)}}
	if order != nil {
		prepared.Quote.AmountMicrocredits, prepared.Quote.BillingMode = order.AmountMicrocredits, order.BillingMode
		prepared.Quote.PriceVersion, prepared.Quote.PriceTierID, prepared.Quote.PriceTierVersion = order.PriceVersion, order.PriceTierID, order.PriceTierVersion
	}
	for _, field := range []string{"referenceImages", "referenceVideos", "referenceAudios"} {
		for _, ref := range creationMaps(request.Input[field]) {
			key := stringValue(ref["storageKey"])
			if !strings.HasPrefix(key, "resource:") {
				return nil, BadAuthRequest("生成引用必须先保存到资源库")
			}
			id := strings.TrimPrefix(key, "resource:")
			resource, err := repo.ResourceForUser(userID, id)
			if err != nil || resource.Status != model.ResourceStatusReady {
				return nil, BadAuthRequest("参考资源已失效")
			}
			prepared.ResourceSignatures[id] = cloudAgentResourceSignature(resource)
		}
	}
	prepared.Hash = creationHash(prepared)
	return prepared, nil
}

func pinCloudAgentPreparedMedia(repo *repository.Repository, userID, runID, approvalID string, prepared *cloudAgentPreparedMedia) error {
	ids := make([]string, 0, len(prepared.ResourceSignatures))
	for id := range prepared.ResourceSignatures {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return repo.UpsertCloudAgentResourceLeases(userID, runID, approvalID, ids, prepared.Quote.ExpiresAt)
}

func validateCloudAgentPreparedAdmission(repo *repository.Repository, userID string, prepared *cloudAgentPreparedMedia, task *model.Task, order *model.BillingOrder, doc map[string]any, args cloudAgentMediaArgs) error {
	if prepared == nil || prepared.Version != 1 || prepared.Hash == "" || time.Now().After(prepared.Quote.ExpiresAt) {
		return creationConflict("生成报价已过期，请刷新报价并重新批准；未提交任务")
	}
	dependency, err := cloudAgentMediaDependencyHash(doc, args)
	if err != nil {
		return err
	}
	if dependency != prepared.DependencyHash {
		return creationConflict("画布生成依赖已变化，请重新准备并批准；未提交任务")
	}
	hash, err := cloudAgentResolvedMediaHash(task)
	if err != nil {
		return err
	}
	if hash != prepared.ResolvedHash || cloudAgentQuoteHash(order) != prepared.QuoteHash {
		return creationConflict("模型规格或价格已变化，请刷新报价并重新批准；未提交任务")
	}
	if _, err := cloudAgentPreparedReferences(repo, userID, prepared); err != nil {
		return err
	}
	return nil
}
