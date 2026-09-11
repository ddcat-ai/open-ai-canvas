package app

import (
	"encoding/json"
	"errors"
	"strings"

	"infinite-canvas/backend/internal/model"
)

// The browser sends one protocol-neutral conversation. Only the selected
// provider body is materialized; declarative plugins retain their request paths.
type canonicalAgentRequest struct {
	Messages     []map[string]interface{} `json:"messages"`
	Tools        []map[string]interface{} `json:"tools"`
	ToolChoice   interface{}              `json:"toolChoice"`
	SystemPrompt string                   `json:"systemPrompt"`
}

func expandCanonicalAgentRequest(source *canonicalAgentRequest, config providerConfig, declarative bool) (*agentToolRequests, error) {
	if len(source.Messages) == 0 {
		return nil, errors.New("画布 Agent 请求缺少会话内容")
	}
	for _, message := range source.Messages {
		if stringField(message, "type") == "function_call" {
			if stringField(message, "call_id") == "" || stringField(message, "name") == "" {
				return nil, errors.New("画布 Agent 工具调用缺少标识或名称")
			}
			if _, ok := message["arguments"].(string); !ok {
				return nil, errors.New("画布 Agent 工具调用参数无效")
			}
			continue
		}
		if stringField(message, "type") != "" {
			return nil, errors.New("画布 Agent 会话条目类型无效")
		}
		switch stringField(message, "role") {
		case "system", "user", "assistant":
		case "tool":
			if stringField(message, "tool_call_id") == "" {
				return nil, errors.New("画布 Agent 工具结果缺少调用标识")
			}
			if _, ok := message["content"].(string); !ok {
				return nil, errors.New("画布 Agent 工具结果内容无效")
			}
		default:
			return nil, errors.New("画布 Agent 会话角色无效")
		}
		if err := validateCanonicalAgentContent(message["content"]); err != nil {
			return nil, err
		}
	}
	for _, tool := range source.Tools {
		function, ok := tool["function"].(map[string]interface{})
		if !ok || stringField(function, "name") == "" {
			return nil, errors.New("画布 Agent 工具定义缺少名称")
		}
	}
	switch choice := source.ToolChoice.(type) {
	case string:
		if choice != "auto" && choice != "required" {
			return nil, errors.New("画布 Agent 工具选择无效")
		}
	case map[string]interface{}:
		if stringField(choice, "type") != "function" || stringField(choice, "name") == "" {
			return nil, errors.New("画布 Agent 工具选择缺少名称")
		}
	default:
		return nil, errors.New("画布 Agent 请求缺少工具选择")
	}
	messages := source.Messages
	if prompt := strings.TrimSpace(source.SystemPrompt); prompt != "" {
		present := false
		for _, message := range messages {
			if stringField(message, "role") == "system" && strings.TrimSpace(stringField(message, "content")) == prompt {
				present = true
				break
			}
		}
		if !present {
			messages = append([]map[string]interface{}{{"role": "system", "content": prompt}}, messages...)
		}
	}
	request := *source
	request.Messages = messages
	result := &agentToolRequests{}
	if declarative {
		result.ChatCompletion = canonicalAgentChatBody(&request, false)
		result.Responses = canonicalAgentResponsesBody(&request)
		result.Claude = claudeAgentBody(canonicalAgentChatBody(&request, true))
		result.Claude["model"] = config.Model
		result.Gemini = canonicalAgentGeminiBody(&request)
		return result, nil
	}
	switch config.InterfaceType {
	case string(model.ChannelInterfaceOpenAIResponse):
		result.Responses = canonicalAgentResponsesBody(&request)
	case string(model.ChannelInterfaceClaudeAPI):
		result.Claude = claudeAgentBody(canonicalAgentChatBody(&request, true))
	default:
		result.ChatCompletion = canonicalAgentChatBody(&request, false)
	}
	return result, nil
}

func canonicalAgentChatBody(source *canonicalAgentRequest, claude bool) map[string]interface{} {
	messages := make([]interface{}, 0, len(source.Messages))
	format := "chat"
	if claude {
		format = "claude"
	}
	for index := 0; index < len(source.Messages); {
		message := source.Messages[index]
		if stringField(message, "type") == "function_call" {
			calls := []interface{}{}
			for index < len(source.Messages) && stringField(source.Messages[index], "type") == "function_call" {
				call := source.Messages[index]
				arguments := call["arguments"]
				if claude {
					arguments = canonicalAgentJSONObject(arguments)
				}
				calls = append(calls, map[string]interface{}{
					"id": call["call_id"], "type": "function",
					"function": map[string]interface{}{"name": call["name"], "arguments": arguments},
				})
				index++
			}
			messages = append(messages, map[string]interface{}{"role": "assistant", "content": nil, "tool_calls": calls})
			continue
		}
		converted := map[string]interface{}{"role": message["role"], "content": canonicalAgentContent(message["content"], format)}
		if claude && stringField(message, "role") == "system" {
			converted["content"] = canonicalAgentText(message["content"])
		}
		if stringField(message, "role") == "tool" {
			converted["tool_call_id"] = message["tool_call_id"]
		}
		messages = append(messages, converted)
		index++
	}
	tools := make([]interface{}, 0, len(source.Tools))
	for _, tool := range source.Tools {
		tools = append(tools, tool)
	}
	choice := source.ToolChoice
	if named, ok := choice.(map[string]interface{}); ok {
		choice = map[string]interface{}{"type": "function", "function": map[string]interface{}{"name": named["name"]}}
	}
	return map[string]interface{}{"messages": messages, "tools": tools, "tool_choice": choice, "parallel_tool_calls": false}
}

func canonicalAgentResponsesBody(source *canonicalAgentRequest) map[string]interface{} {
	messages := make([]interface{}, 0, len(source.Messages))
	for _, message := range source.Messages {
		switch {
		case stringField(message, "type") == "function_call":
			messages = append(messages, map[string]interface{}{
				"type": "function_call", "call_id": message["call_id"], "name": message["name"], "arguments": message["arguments"],
			})
		case stringField(message, "role") == "tool":
			messages = append(messages, map[string]interface{}{"type": "function_call_output", "call_id": message["tool_call_id"], "output": message["content"]})
		default:
			messages = append(messages, map[string]interface{}{"role": message["role"], "content": canonicalAgentContent(message["content"], "responses")})
		}
	}
	tools := make([]interface{}, 0, len(source.Tools))
	for _, tool := range source.Tools {
		function, _ := tool["function"].(map[string]interface{})
		converted := cloneStringAnyMap(function)
		converted["type"] = "function"
		tools = append(tools, converted)
	}
	return map[string]interface{}{"input": messages, "tools": tools, "tool_choice": source.ToolChoice, "parallel_tool_calls": false}
}

func canonicalAgentGeminiBody(source *canonicalAgentRequest) map[string]interface{} {
	contents := make([]interface{}, 0, len(source.Messages))
	var system []string
	callNames := map[string]string{}
	for _, message := range source.Messages {
		role := "user"
		var parts interface{}
		switch {
		case stringField(message, "type") == "function_call":
			id, name := stringField(message, "call_id"), stringField(message, "name")
			callNames[id] = name
			part := map[string]interface{}{"functionCall": map[string]interface{}{"id": id, "name": name, "args": canonicalAgentJSONObject(message["arguments"])}}
			if signature := stringField(message, "thoughtSignature"); signature != "" {
				part["thoughtSignature"] = signature
			}
			role, parts = "model", []interface{}{part}
		case stringField(message, "role") == "system":
			if text := canonicalAgentText(message["content"]); text != "" {
				system = append(system, text)
			}
			continue
		case stringField(message, "role") == "tool":
			id := stringField(message, "tool_call_id")
			name := callNames[id]
			if name == "" {
				name = "tool_result"
			}
			parts = []interface{}{map[string]interface{}{"functionResponse": map[string]interface{}{
				"id": id, "name": name, "response": map[string]interface{}{"result": canonicalAgentJSONValue(message["content"])},
			}}}
		default:
			if stringField(message, "role") == "assistant" {
				role = "model"
			}
			parts = canonicalAgentContent(message["content"], "gemini")
		}
		contents = append(contents, map[string]interface{}{"role": role, "parts": parts})
	}
	body := map[string]interface{}{"contents": contents}
	if len(system) > 0 {
		body["systemInstruction"] = map[string]interface{}{"parts": []interface{}{map[string]interface{}{"text": strings.Join(system, "\n\n")}}}
	}
	if len(source.Tools) > 0 {
		declarations := make([]interface{}, 0, len(source.Tools))
		for _, tool := range source.Tools {
			function, _ := tool["function"].(map[string]interface{})
			declaration := cloneStringAnyMap(function)
			delete(declaration, "strict")
			declarations = append(declarations, declaration)
		}
		choice := map[string]interface{}{"mode": "AUTO"}
		if named, ok := source.ToolChoice.(map[string]interface{}); ok {
			choice["mode"], choice["allowedFunctionNames"] = "ANY", []interface{}{named["name"]}
		} else if source.ToolChoice == "required" {
			choice["mode"] = "ANY"
		}
		body["tools"] = []interface{}{map[string]interface{}{"functionDeclarations": declarations}}
		body["toolConfig"] = map[string]interface{}{"functionCallingConfig": choice}
	}
	return body
}

func canonicalAgentContent(content interface{}, format string) interface{} {
	items, array := content.([]interface{})
	if !array {
		if content == nil {
			content = ""
		}
		if format == "gemini" {
			return []interface{}{map[string]interface{}{"text": content}}
		}
		return content
	}
	result := make([]interface{}, 0, len(items))
	for _, value := range items {
		item, _ := value.(map[string]interface{})
		kind := stringField(item, "type")
		if kind == "text" {
			part := map[string]interface{}{"text": item["text"]}
			if format != "gemini" {
				part["type"] = "text"
				if format == "responses" {
					part["type"] = "input_text"
				}
			}
			result = append(result, part)
			continue
		}
		file, _ := item[kind].(map[string]interface{})
		url := stringField(file, "url")
		mimeType := stringField(file, "mimeType")
		if kind == "image_url" {
			mimeType = "image/png"
		}
		inlineMIME, inlineData, inline := canonicalAgentDataURL(url)
		var part map[string]interface{}
		switch format {
		case "responses":
			part = map[string]interface{}{"type": "input_image", "image_url": url}
			if kind == "file_url" {
				part = map[string]interface{}{"type": "input_file", "filename": file["name"]}
				if strings.HasPrefix(url, "data:") {
					part["file_data"] = url
				} else {
					part["file_url"] = url
				}
			}
		case "claude":
			if inline {
				blockType := "image"
				if kind == "file_url" && inlineMIME == "application/pdf" {
					blockType = "document"
				}
				part = map[string]interface{}{"type": blockType, "source": map[string]interface{}{"type": "base64", "media_type": inlineMIME, "data": inlineData}}
			} else if kind == "image_url" {
				part = map[string]interface{}{"type": "image", "source": map[string]interface{}{"type": "url", "url": url}}
			} else {
				part = map[string]interface{}{"type": "text", "text": stringField(file, "name") + ": " + url}
			}
		case "gemini":
			if inline {
				part = map[string]interface{}{"inlineData": map[string]interface{}{"mimeType": inlineMIME, "data": inlineData}}
			} else {
				part = map[string]interface{}{"fileData": map[string]interface{}{"fileUri": url, "mimeType": mimeType}}
			}
		default:
			part = item
			if kind == "file_url" {
				converted := map[string]interface{}{"filename": file["name"]}
				if strings.HasPrefix(url, "data:") {
					converted["file_data"] = url
				} else {
					converted["file_url"] = url
				}
				part = map[string]interface{}{"type": "file", "file": converted}
			}
		}
		result = append(result, part)
	}
	return result
}

func canonicalAgentDataURL(value string) (string, string, bool) {
	if !strings.HasPrefix(value, "data:") {
		return "", "", false
	}
	mimeType, data, ok := strings.Cut(strings.TrimPrefix(value, "data:"), ";base64,")
	return mimeType, data, ok && mimeType != "" && data != ""
}

func validateCanonicalAgentContent(content interface{}) error {
	if _, ok := content.(string); ok {
		return nil
	}
	parts, ok := content.([]interface{})
	if !ok {
		return errors.New("画布 Agent 消息内容无效")
	}
	for _, value := range parts {
		part, _ := value.(map[string]interface{})
		switch kind := stringField(part, "type"); kind {
		case "text":
			if _, ok := part["text"].(string); !ok {
				return errors.New("画布 Agent 文本内容无效")
			}
		case "image_url", "file_url":
			file, _ := part[kind].(map[string]interface{})
			if stringField(file, "url") == "" {
				return errors.New("画布 Agent 素材地址为空")
			}
			if kind == "file_url" && (stringField(file, "name") == "" || stringField(file, "mimeType") == "") {
				return errors.New("画布 Agent 文件缺少名称或类型")
			}
		default:
			return errors.New("画布 Agent 消息内容类型无效")
		}
	}
	return nil
}

func canonicalAgentJSONValue(value interface{}) interface{} {
	if raw, ok := value.(string); ok {
		var parsed interface{}
		if json.Unmarshal([]byte(raw), &parsed) == nil {
			return parsed
		}
	}
	return value
}

func canonicalAgentJSONObject(value interface{}) map[string]interface{} {
	if parsed, ok := canonicalAgentJSONValue(value).(map[string]interface{}); ok {
		return parsed
	}
	return map[string]interface{}{}
}

func canonicalAgentText(content interface{}) string {
	if text, ok := content.(string); ok {
		return text
	}
	var texts []string
	if parts, ok := content.([]interface{}); ok {
		for _, value := range parts {
			part, _ := value.(map[string]interface{})
			if stringField(part, "type") == "text" {
				texts = append(texts, stringField(part, "text"))
			} else if image, ok := part["image_url"].(map[string]interface{}); ok {
				texts = append(texts, stringField(image, "url"))
			} else if file, ok := part["file_url"].(map[string]interface{}); ok {
				texts = append(texts, stringField(file, "name")+": "+stringField(file, "url"))
			}
		}
	}
	return strings.Join(texts, "\n")
}
