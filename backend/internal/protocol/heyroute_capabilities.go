package protocol

import (
	_ "embed"
	"encoding/json"
)

//go:embed heyroute-capabilities.json
var heyrouteCapabilitiesJSON []byte

// HeyrouteCapabilityDefaults returns an independent JSON value for a known
// model/protocol pair. Aliases stay explicit because model IDs are case-sensitive.
func HeyrouteCapabilityDefaults(protocolID, modelID string) json.RawMessage {
	var configs map[string]map[string]json.RawMessage
	if json.Unmarshal(heyrouteCapabilitiesJSON, &configs) != nil {
		return nil
	}
	return configs[protocolID][modelID]
}
