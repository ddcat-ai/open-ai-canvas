package app

import (
	"encoding/json"
	"strings"
	"testing"
)

func creationRolePlan(t *testing.T, roles []map[string]any) cloudAgentCommercePlan {
	t.Helper()
	plan := commerceFixturePlan()
	plan.ProductFacts[0].SourceIDs = []string{"product"}
	plan.Items[0].AttachmentResourceIDs = []string{"scene", "product"}
	plan.Items[0].Prompt = "Keep the composition in @图片1 and replace its product with @图片2"
	raw, _ := json.Marshal(plan)
	var wire map[string]any
	_ = json.Unmarshal(raw, &wire)
	wire["references"] = roles
	raw, _ = json.Marshal(wire)
	_ = json.Unmarshal(raw, &plan)
	return plan
}

func TestCreationPlanResolvesUserImageRolesWithoutManualSelector(t *testing.T) {
	req := creationAgentRequest()
	req.Prompt = "图1是竞品场景，把其中的产品换成图2中的我的产品"
	req.Attachments = []CloudAgentAttachment{{ResourceID: "scene", Kind: "image", Role: "reference"}, {ResourceID: "product", Kind: "image", Role: "reference"}}
	plan := creationRolePlan(t, []map[string]any{{"resourceId": "scene", "role": "competitor", "usage": "retain composition only"}, {"resourceId": "product", "role": "product", "usage": "replace the scene product with this exact product"}})
	if err := validateCloudAgentCommercePlan(req, &plan); err != nil {
		t.Fatalf("user-specified product/competitor roles were not resolved: %v", err)
	}
	compiled, err := cloudAgentCommerceMediaCall(&plan, commerceConstraintsCall())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(compiled.Function.Arguments, "retain composition only") || !strings.Contains(compiled.Function.Arguments, "replace the scene product") {
		t.Fatal("role-specific usage did not reach media compilation")
	}
	review := cloudAgentCommerceReviewPayload(&plan, req, nil)
	references := creationMaps(review["references"])
	if len(references) != 2 || references[0]["index"] != 1 || references[0]["role"] != "competitor" || references[1]["index"] != 2 || references[1]["usage"] != "replace the scene product with this exact product" {
		t.Fatalf("review lost reference order, role or usage: %#v", references)
	}
	plan.ProductFacts[0].SourceIDs = []string{"scene"}
	if err := validateCloudAgentCommercePlan(req, &plan); err == nil {
		t.Fatal("competitor properties became product facts")
	}
}

func TestCreationPlanFirstImageProductFollowingImagesCompetitors(t *testing.T) {
	req := creationAgentRequest()
	req.Prompt = "图1是我的产品，图2之后是竞品图，只参考布局"
	req.Attachments = []CloudAgentAttachment{{ResourceID: "product", Kind: "image", Role: "reference"}, {ResourceID: "scene", Kind: "image", Role: "reference"}, {ResourceID: "scene-2", Kind: "image", Role: "reference"}}
	plan := creationRolePlan(t, []map[string]any{{"resourceId": "product", "role": "product", "usage": "preserve exact product"}, {"resourceId": "scene", "role": "competitor", "usage": "layout only"}, {"resourceId": "scene-2", "role": "competitor", "usage": "typography only"}})
	plan.Items[0].AttachmentResourceIDs = []string{"product", "scene", "scene-2"}
	if err := validateCloudAgentCommercePlan(req, &plan); err != nil {
		t.Fatal(err)
	}
	references := creationMaps(cloudAgentCommerceReviewPayload(&plan, req, nil)["references"])
	for index, role := range []string{"product", "competitor", "competitor"} {
		if references[index]["index"] != index+1 || references[index]["role"] != role {
			t.Fatalf("reference %d lost user-specified sequence or role: %#v", index+1, references[index])
		}
	}
	plan.ProductFacts[0].SourceIDs = []string{"scene-2"}
	if err := validateCloudAgentCommercePlan(req, &plan); err == nil {
		t.Fatal("following competitor became a product fact source")
	}
}

func TestCreationPlanRejectsUnknownOrConflictingReferenceRoles(t *testing.T) {
	req := creationAgentRequest()
	req.Attachments = []CloudAgentAttachment{{ResourceID: "scene", Kind: "image", Role: "competitor"}, {ResourceID: "product", Kind: "image", Role: "product"}}
	for _, roles := range [][]map[string]any{
		{{"resourceId": "private", "role": "product", "usage": "unknown resource"}},
		{{"resourceId": "scene", "role": "product", "usage": "override explicit competitor"}},
		{{"resourceId": "product", "role": "unsupported", "usage": "invalid role"}},
		{{"resourceId": "product", "role": "product", "usage": "first"}, {"resourceId": "product", "role": "product", "usage": "second"}},
	} {
		plan := creationRolePlan(t, roles)
		if err := validateCloudAgentCommercePlan(req, &plan); err == nil {
			t.Fatalf("accepted unauthorized or ambiguous roles: %#v", roles)
		}
	}
}
