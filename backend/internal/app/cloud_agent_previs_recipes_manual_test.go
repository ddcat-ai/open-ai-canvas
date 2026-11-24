package app

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"yingce/backend/internal/prompts"
)

// previsManualRecipeTopics 是「可原样执行」的完整范例：每节从空模板开始，按顺序执行该节所有 JSON 补丁。
var previsManualRecipeTopics = []string{"recipes", "recipes_action", "recipes_epic"}

type previsManualRecipe struct {
	Topic   string
	Title   string
	Patches [][]cloudAgentPrevisPatchOperation
}

// previsManualRecipes 按「## 」二级标题切节，每节里的 ```json 块按出现顺序当作一次补丁。
func previsManualRecipes(t *testing.T) []previsManualRecipe {
	t.Helper()
	var recipes []previsManualRecipe
	for _, topic := range previsManualRecipeTopics {
		_, content, ok := prompts.PrevisManual(topic)
		if !ok {
			t.Fatalf("manual %s missing", topic)
		}
		for _, section := range strings.Split(content, "\n## ")[1:] {
			title, _, _ := strings.Cut(section, "\n")
			blocks := previsManualJSONBlock.FindAllStringSubmatch(section, -1)
			if len(blocks) == 0 {
				continue
			}
			recipe := previsManualRecipe{Topic: topic, Title: strings.TrimSpace(title)}
			for _, block := range blocks {
				decoder := json.NewDecoder(bytes.NewReader([]byte(block[1])))
				decoder.DisallowUnknownFields()
				var operations []cloudAgentPrevisPatchOperation
				if err := decoder.Decode(&operations); err != nil {
					t.Fatalf("manual %s「%s」patch does not decode: %v", topic, recipe.Title, err)
				}
				recipe.Patches = append(recipe.Patches, operations)
			}
			recipes = append(recipes, recipe)
		}
	}
	return recipes
}

// 每个完整范例都要能在空场景上原样执行，执行后整场景校验通过、每个镜头的 review 没有提示。
// 范例是给模型照抄的，抄出来的东西必须真的能用，而且本身就达到镜头设计的质量底线。
func TestCloudAgentPrevisManualRecipesExecuteAndPassReview(t *testing.T) {
	recipes := previsManualRecipes(t)
	if len(recipes) < 12 {
		t.Fatalf("complete recipes too few: %d", len(recipes))
	}
	for _, recipe := range recipes {
		name := recipe.Topic + "/" + recipe.Title
		t.Run(name, func(t *testing.T) {
			scene, err := cloudAgentPrevisSceneCreateTemplate(cloudAgentPrevisSceneCreateArgs{SceneID: "s", Title: recipe.Title, TemplateID: "empty"})
			if err != nil {
				t.Fatal(err)
			}
			if len(recipe.Patches) < 2 {
				t.Fatalf("recipe must be split into build / performance / camera patches, got %d", len(recipe.Patches))
			}
			cameraMoves := 0
			for patchIndex, operations := range recipe.Patches {
				if len(operations) == 0 || len(operations) > cloudAgentPrevisMaxOperations {
					t.Fatalf("patch %d has %d operations", patchIndex+1, len(operations))
				}
				for index, operation := range operations {
					item, err := cloudAgentPrevisApplyPatchOperation(scene, operation, index)
					if err != nil {
						t.Fatalf("patch %d operation %d (%s %s): %v", patchIndex+1, index, operation.Type, operation.ID, err)
					}
					if strings.Contains(item.Summary, "注意：") {
						t.Fatalf("patch %d operation %d warns: %s", patchIndex+1, index, item.Summary)
					}
					if operation.Type == "camera_move" {
						cameraMoves++
					}
				}
				cloudAgentPrevisGroundScene(scene)
				if err := cloudAgentPrevisValidateScene(scene); err != nil {
					t.Fatalf("scene invalid after patch %d: %v", patchIndex+1, err)
				}
			}
			if cameraMoves == 0 {
				t.Fatal("recipe must write camera moves")
			}
			for _, shot := range creationMaps(scene["shots"]) {
				camera := cloudAgentPrevisFindByID(creationMaps(scene["cameras"]), stringValue(shot["cameraId"]))
				if stored := len(creationMaps(camera["moves"])); stored < 2 {
					t.Fatalf("shot %s camera has %d moves; a complete recipe needs at least two", stringValue(shot["id"]), stored)
				}
				if strings.TrimSpace(stringValue(shot["prompt"])) == "" {
					t.Fatalf("shot %s needs a look prompt", stringValue(shot["id"]))
				}
				if stringValue(shot["aspectRatio"]) == "" {
					t.Fatalf("shot %s needs an aspect ratio", stringValue(shot["id"]))
				}
			}
			if reviews := cloudAgentPrevisShotReviews(scene); len(reviews) > 0 {
				raw, _ := json.Marshal(reviews)
				t.Fatalf("recipe must pass review: %s", raw)
			}
		})
	}
}

// 第 0 节的选范例表引用的范例编号都要存在。
func TestCloudAgentPrevisManualRecipeIndexPointsToRealSections(t *testing.T) {
	_, content, _ := prompts.PrevisManual("recipes")
	sections := map[string]int{}
	for _, recipe := range previsManualRecipes(t) {
		sections[recipe.Topic]++
	}
	for _, line := range strings.Split(content, "\n") {
		if !strings.HasPrefix(line, "| ") || !strings.Contains(line, "篇") && !strings.Contains(line, "`recipes_") {
			continue
		}
		cells := strings.Split(line, "|")
		if len(cells) < 3 {
			continue
		}
		target := strings.TrimSpace(cells[len(cells)-2])
		topic, number := "recipes", 0
		if strings.HasPrefix(target, "本篇 ") {
			fmt.Sscanf(strings.TrimPrefix(target, "本篇 "), "%d", &number)
		} else if strings.HasPrefix(target, "`recipes_") {
			parts := strings.Fields(strings.ReplaceAll(target, "`", ""))
			if len(parts) == 2 {
				topic = parts[0]
				fmt.Sscanf(parts[1], "%d", &number)
			}
		} else {
			continue
		}
		if number < 1 || number > sections[topic] {
			t.Fatalf("recipe index points to %s %d, which does not exist (have %d)", topic, number, sections[topic])
		}
	}
}
