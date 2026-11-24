package app

import (
	"encoding/json"
	"os"
	"os/exec"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func probeRows(t *testing.T, query string) []map[string]any {
	db := os.Getenv("PROBE_DB")
	if db == "" {
		t.Skip("PROBE_DB not set")
	}
	out, err := exec.Command("sqlite3", "-json", db, query).Output()
	if err != nil {
		t.Fatal(err)
	}
	var rows []map[string]any
	if strings.TrimSpace(string(out)) != "" {
		_ = json.Unmarshal(out, &rows)
	}
	return rows
}

func TestProbeSpecMismatch(t *testing.T) {
	models := probeRows(t, "select id, model_key, protocol, capability, capability_config_json from channel_models where enabled=1 and capability in ('image','video')")
	type combo struct {
		size, quality, res string
		dur                int
	}
	imageCombos := []combo{{"16:9", "", "", 0}, {"9:16", "high", "", 0}, {"16:9", "", "2k", 0}, {"1:1", "2k", "", 0}, {"1024x1024", "", "", 0}, {"16:9", "", "1k", 0}, {"3:4", "", "4k", 0}}
	videoCombos := []combo{{"16:9", "", "", 0}, {"9:16", "1080p", "", 10}, {"16:9", "720p", "", 5}, {"9:16", "", "", 8}, {"1280x720", "", "", 6}}
	for _, m := range models {
		cap := m["capability"].(string)
		combos := imageCombos
		if cap == "video" {
			combos = videoCombos
		}
		for _, c := range combos {
			s, db, a := agentMediaFixture(t)
			tiers := probeRows(t, "select selector_key, selector_json from channel_model_price_tiers where enabled=1 and channel_model_id='"+m["id"].(string)+"'")
			if err := db.Create(&model.ChannelModel{ID: "probe-cm", ChannelID: "channel", ModelKey: m["model_key"].(string), Capability: cap, Protocol: model.ChannelInterfaceType(m["protocol"].(string)), CapabilityConfigJSON: m["capability_config_json"].(string), BillingMode: "fixed_request", PriceConfigured: true, Enabled: true}).Error; err != nil {
				t.Fatal(err)
			}
			seen := map[string]bool{}
			for i, tier := range tiers {
				k := tier["selector_key"].(string)
				if seen[k] {
					continue
				}
				seen[k] = true
				db.Create(&model.ChannelModelPriceTier{ID: "pt-" + string(rune('a'+i)), ChannelModelID: "probe-cm", SelectorKey: k, SelectorJSON: tier["selector_json"].(string), BillingMode: "fixed_request", UnitPriceMicrocredits: 10, PriceConfigured: true, Enabled: true})
			}
			a.ChannelModelKey = m["model_key"].(string)
			a.Size, a.Quality, a.ImageResolution = c.size, c.quality, c.res
			if cap == "image" {
				a.Mode, a.NodeID, a.Duration, a.VideoGenerateAudio, a.SourceNodeID, a.ReferenceNodeIDs = "image", "img-probe", 0, nil, "", nil
			} else {
				a.Duration = c.dur
				a.ReferenceNodeIDs = nil
			}
			run, _ := agentMediaRun(t, s, a, "request_approval")
			_ = s.advanceCloudAgentByID("user", run.ID)
			run, state := agentInterjectionState(t, s, run.ID)
			msg := run.FailureMessage
			if state.Approval == nil {
				// last tool result
				for i := len(state.Canonical.Messages) - 1; i >= 0; i-- {
					if state.Canonical.Messages[i]["role"] == "tool" {
						msg += " | tool=" + truncateRunes(stringValue(state.Canonical.Messages[i]["content"]), 220)
						break
					}
				}
			}
			status := "approval"
			if state.Approval == nil {
				status = run.Status
			}
			t.Logf("%-28s %-6s %-10s q=%-6s r=%-4s d=%-2d => %s %s", m["model_key"], cap, c.size, c.quality, c.res, c.dur, status, msg)
		}
	}
}
