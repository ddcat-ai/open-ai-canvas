package app

import (
	"encoding/json"
	"log/slog"
	"strings"

	"yingce/backend/internal/ecommerceagent"
	"yingce/backend/internal/ecommerceskills"
	"yingce/backend/internal/model"
)

// Each direction mode reads different knowledge domains first. The first
// domain decides the direction's primary method; KB01 and KB10 are always
// appended as product and quality boundaries.
var ecommerceModeKnowledgeDomains = map[string][]string{
	"hero":        {"KB06", "KB03"},
	"lifestyle":   {"KB07", "KB02"},
	"creative":    {"KB03", "KB09"},
	"feature":     {"KB04", "KB05"},
	"macro":       {"KB06", "KB04"},
	"editorial":   {"KB03", "KB04"},
	"documentary": {"KB07", "KB06"},
	"scale":       {"KB07", "KB04"},
	"desk":        {"KB07", "KB06"},
	"display":     {"KB03", "KB06"},
	"table":       {"KB07", "KB06"},
	"gift":        {"KB03", "KB02"},
	"lab":         {"KB06", "KB03"},
	"instruction": {"KB04", "KB05"},
}

// Workbench directions follow the "一稳 二进 一破" order of the style method.
var ecommerceWorkbenchDirectionModes = []string{"hero", "lifestyle", "editorial", "creative"}

type ecommerceDirectionInput struct {
	Seed     ecommerceDirectionSeed
	Palette  []string
	Lighting string
	Layout   string
}

type ecommerceDirectionPlan struct {
	Seed     ecommerceDirectionSeed
	Basis    []model.EcommerceKnowledgeEntry
	Analysis *ecommerceskills.ProductAnalysisOutput
	Visual   *ecommerceskills.VisualStrategyOutput
	Copy     *ecommerceskills.CopywritingOutput
	Trace    []ecommerceskills.Invocation
}

type ecommerceProductAnalysisResult struct {
	Output     *ecommerceskills.ProductAnalysisOutput
	Invocation ecommerceskills.Invocation
}

func ecommerceKnowledgeRefs(entries []model.EcommerceKnowledgeEntry) []ecommerceskills.KnowledgeRef {
	refs := make([]ecommerceskills.KnowledgeRef, 0, len(entries))
	for _, entry := range entries {
		var content struct {
			Guidance string `json:"guidance"`
		}
		_ = json.Unmarshal([]byte(entry.ContentJSON), &content)
		refs = append(refs, ecommerceskills.KnowledgeRef{ID: entry.ID, Domain: ecommerceEntryDomain(entry), Title: entry.Title, Guidance: content.Guidance})
	}
	return refs
}

func runEcommerceProductAnalysis(category string, req EcommerceCreativeDirectionsRequest, knowledge []model.EcommerceKnowledgeEntry) ecommerceProductAnalysisResult {
	skill := ecommerceskills.ProductAnalysisSkill{}
	output, invocation := skill.Run("creative-directions", ecommerceskills.ProductAnalysisInput{ProductName: req.ProductName, CategoryKey: category, Category: req.Category, Description: req.Description, Claims: req.Claims, Materials: req.Materials, Colors: req.Colors, Specifications: req.Specifications, Knowledge: ecommerceKnowledgeRefs(knowledge)})
	slog.Info("ecommerce skill invoked", "skill", invocation.Skill, "stage", invocation.Stage, "category", category, "knowledgeBasis", invocation.KnowledgeBasis)
	return ecommerceProductAnalysisResult{Output: output, Invocation: invocation}
}

// planEcommerceDirectionsWithKnowledge gives every direction its own primary
// knowledge method and runs the visual and copy skills on that basis. Removing
// or rejecting an entry therefore changes the basis, the visual lock and the
// summary of the direction that used it.
func planEcommerceDirectionsWithKnowledge(seeds []ecommerceDirectionSeed, knowledge []model.EcommerceKnowledgeEntry, analysis ecommerceProductAnalysisResult) []ecommerceDirectionPlan {
	inputs := make([]ecommerceDirectionInput, 0, len(seeds))
	for _, seed := range seeds {
		inputs = append(inputs, ecommerceDirectionInput{Seed: seed})
	}
	plans := planEcommerceDirectionInputs(inputs, knowledge, analysis, "creative-directions")
	for i := range plans {
		if len(plans[i].Basis) > 0 {
			plans[i].Seed.Summary = strings.TrimRight(plans[i].Seed.Summary, "。") + "；知识方法：" + plans[i].Basis[0].Title + "。"
		}
	}
	return plans
}

func planEcommerceDirectionInputs(inputs []ecommerceDirectionInput, knowledge []model.EcommerceKnowledgeEntry, analysis ecommerceProductAnalysisResult, stage string) []ecommerceDirectionPlan {
	byDomain := map[string][]model.EcommerceKnowledgeEntry{}
	for _, entry := range knowledge {
		domain := ecommerceEntryDomain(entry)
		byDomain[domain] = append(byDomain[domain], entry)
	}
	primaryUsed := map[string]bool{}
	plans := make([]ecommerceDirectionPlan, 0, len(inputs))
	for _, input := range inputs {
		basis, inBasis := []model.EcommerceKnowledgeEntry{}, map[string]bool{}
		add := func(entry model.EcommerceKnowledgeEntry) {
			if !inBasis[entry.ID] {
				basis, inBasis[entry.ID] = append(basis, entry), true
			}
		}
		domains := ecommerceModeKnowledgeDomains[input.Seed.Mode]
		if len(domains) == 0 {
			domains = []string{"KB03", "KB06"}
		}
		for index, domain := range domains {
			candidates := byDomain[domain]
			picked := -1
			for i, entry := range candidates {
				if !primaryUsed[entry.ID] {
					picked = i
					break
				}
			}
			if picked < 0 && len(candidates) > 0 {
				picked = 0
			}
			if picked >= 0 {
				if index == 0 || len(basis) == 0 {
					primaryUsed[candidates[picked].ID] = true
				}
				add(candidates[picked])
			}
		}
		for _, domain := range []string{"KB01", "KB10"} {
			if len(byDomain[domain]) > 0 {
				add(byDomain[domain][0])
			}
		}
		refs := ecommerceKnowledgeRefs(basis)
		visualSkill, copySkill := ecommerceskills.VisualStrategySkill{}, ecommerceskills.CopywritingSkill{}
		emphasis := []string{}
		category := ""
		if analysis.Output != nil {
			emphasis, category = analysis.Output.VisualEmphasis, analysis.Output.CategoryKey
		}
		visual, visualCall := visualSkill.Run(stage, ecommerceskills.VisualStrategyInput{CategoryKey: category, DirectionName: input.Seed.Name, Mode: input.Seed.Mode, Palette: input.Palette, Lighting: input.Lighting, Layout: input.Layout, VisualEmphasis: emphasis, Knowledge: refs})
		facts := []string{}
		if analysis.Output != nil {
			facts = analysis.Output.ConfirmedFacts
		}
		copyOut, copyCall := copySkill.Run(stage, ecommerceskills.CopywritingInput{DirectionName: input.Seed.Name, Mode: input.Seed.Mode, ConfirmedFacts: facts, Knowledge: append(refs, ecommerceKnowledgeRefs(byDomain["KB05"])...)})
		trace := []ecommerceskills.Invocation{analysis.Invocation, visualCall, copyCall}
		slog.Info("ecommerce direction planned", "direction", input.Seed.Name, "mode", input.Seed.Mode, "knowledgeBasis", knowledgeIDs(basis))
		plans = append(plans, ecommerceDirectionPlan{Seed: input.Seed, Basis: basis, Analysis: analysis.Output, Visual: visual, Copy: copyOut, Trace: trace})
	}
	return plans
}

func (p ecommerceDirectionPlan) attach(strategy map[string]any) {
	basis := make([]map[string]string, 0, len(p.Basis))
	for _, entry := range p.Basis {
		basis = append(basis, map[string]string{"id": entry.ID, "domain": ecommerceEntryDomain(entry), "title": entry.Title})
	}
	strategy["knowledgeBasis"] = basis
	strategy["skills"] = map[string]any{"productAnalysis": p.Analysis, "visualStrategy": p.Visual, "copywriting": p.Copy}
	strategy["skillTrace"] = p.Trace
	if p.Visual != nil {
		strategy["visualLock"] = p.Visual.PromptLock
	}
}

func ecommerceWorkbenchDirectionInputs(recs []ecommerceagent.Recommendation) []ecommerceDirectionInput {
	inputs := make([]ecommerceDirectionInput, 0, len(recs))
	for i, rec := range recs {
		mode := ecommerceWorkbenchDirectionModes[i%len(ecommerceWorkbenchDirectionModes)]
		input := ecommerceDirectionInput{Seed: ecommerceDirectionSeed{Name: rec.Label, Summary: rec.Style, Mode: mode}}
		if rec.VisualSystem != nil {
			input.Palette, input.Lighting, input.Layout = rec.VisualSystem.Palette, rec.VisualSystem.Lighting, rec.VisualSystem.Layout
		}
		inputs = append(inputs, input)
	}
	return inputs
}

// ecommercePlanningSkillBlock re-runs the copywriting skill for the confirmed
// direction with the planning draft (image type and no-text rule), and returns
// the prompt block, the visual lock and the invocation trace.
func ecommercePlanningSkillBlock(draft EcommerceDraft, strategy map[string]any) (string, string, []ecommerceskills.Invocation) {
	lock := stringValue(strategy["visualLock"])
	skills, _ := strategy["skills"].(map[string]any)
	if lock == "" || skills == nil {
		return "", "", nil
	}
	direction, mode := "", stringValue(strategy["mode"])
	if visual, ok := skills["visualStrategy"].(map[string]any); ok {
		direction = stringValue(visual["directionName"])
		if mode == "" {
			mode = stringValue(visual["mode"])
		}
	}
	noText := draft.NoText || draft.ImageType == "white" || draft.ImageType == "three-view" || (draft.CreativeOptions != nil && draft.CreativeOptions.TextMode == "none")
	facts := nonEmptyFacts(ecommerceDraftKnowledgeRequest(draft))
	refs := []ecommerceskills.KnowledgeRef{}
	if raw, err := json.Marshal(strategy["knowledgeContext"]); err == nil {
		var items []map[string]string
		if json.Unmarshal(raw, &items) == nil {
			for _, item := range items {
				refs = append(refs, ecommerceskills.KnowledgeRef{ID: item["id"], Domain: item["domain"], Title: item["title"], Guidance: item["content"]})
			}
		}
	}
	skill := ecommerceskills.CopywritingSkill{}
	copyOut, call := skill.Run("planning", ecommerceskills.CopywritingInput{ProductName: draft.ProductName, DirectionName: direction, Mode: mode, ImageType: draft.ImageType, ConfirmedFacts: facts, NoText: noText, Knowledge: refs})
	slog.Info("ecommerce skill invoked", "skill", call.Skill, "stage", call.Stage, "direction", direction, "knowledgeBasis", call.KnowledgeBasis)
	copyJSON, _ := json.Marshal(copyOut)
	block := "【视觉策略 Skill 输出：每张 prompt 必须原样包含下面的视觉锁定句】\n" + lock + "\n【文案 Skill 输出：copy 的语气、开场方式与证据位】\n" + string(copyJSON) + "\n证据位以外不得出现参数或承诺；forbidden 中的内容不得写入 copy。"
	return block, lock, []ecommerceskills.Invocation{call}
}
