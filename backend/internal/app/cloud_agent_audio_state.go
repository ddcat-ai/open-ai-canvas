package app

func cloudAgentAudioReferenceState(meta, doc map[string]any) map[string]any {
	nodes := map[string]map[string]any{}
	for _, node := range creationMaps(doc["nodes"]) {
		nodes[stringValue(node["id"])] = node
	}
	bindings := []any{}
	for _, binding := range creationMaps(meta["audioVoiceBindings"]) {
		characterID, audioID := stringValue(binding["characterNodeId"]), stringValue(binding["audioNodeId"])
		character, audio := nodes[characterID], nodes[audioID]
		audioMeta, _ := audio["metadata"].(map[string]any)
		available := cloudAgentCharacterNode(character) && stringValue(audio["type"]) == "audio" && (stringValue(audioMeta["storageKey"]) != "" || stringValue(audioMeta["content"]) != "")
		bindings = append(bindings, map[string]any{"characterNodeId": characterID, "characterName": truncateRunes(stringValue(character["title"]), 240), "audioNodeId": audioID, "audioName": truncateRunes(stringValue(audio["title"]), 240), "available": available})
	}
	mode := stringValue(meta["audioMode"])
	if raw, ok := meta["generationSpec"].(map[string]any); ok {
		if options, ok := raw["options"].(map[string]any); ok && stringValue(options["audioMode"]) != "" {
			mode = stringValue(options["audioMode"])
		}
	}
	if mode == "" {
		mode = "auto"
	}
	return map[string]any{"mode": mode, "voiceBindings": bindings, "bindingScope": "current_generation"}
}
