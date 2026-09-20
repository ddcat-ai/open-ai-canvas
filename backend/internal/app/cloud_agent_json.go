package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strings"
)

var errCloudAgentJSONSingleObject = errors.New("参数必须是单个 JSON 对象")

// Only syntax/schema errors may be repaired by the model; authorization and
// unsupported mutations still fail admission before any write or approval.
type cloudAgentArgumentError struct{ error }

func (e *cloudAgentArgumentError) Unwrap() error { return e.error }

type cloudAgentFieldArgumentError struct {
	error
	Field string
	Issue string
}

func (e *cloudAgentFieldArgumentError) Unwrap() error { return e.error }

func cloudAgentFieldError(field, issue, message string) error {
	return &cloudAgentFieldArgumentError{
		error: &cloudAgentArgumentError{BadAuthRequest(message)}, Field: field, Issue: issue,
	}
}

// Decode operations individually so feedback identifies the failing array item.
// Only field names declared by our structs are echoed; arbitrary keys/values
// supplied by a model are never used as diagnostics.
func decodeCloudAgentCanvasArgs(raw string) (agentCanvasArgs, error) {
	var envelope struct {
		SnapshotHash string            `json:"snapshotHash"`
		Ops          []json.RawMessage `json:"ops"`
	}
	args := agentCanvasArgs{}
	if err := decodeCloudAgentJSONObject(raw, &envelope); err != nil {
		return args, cloudAgentJSONArgumentError(err)
	}
	if envelope.SnapshotHash == "" {
		return args, cloudAgentFieldError("snapshotHash", "required", "画布参数 snapshotHash 不能为空，请先读取画布")
	}
	if len(envelope.Ops) < 1 || len(envelope.Ops) > 20 {
		return args, cloudAgentFieldError("ops", "item_count", "画布参数 ops 必须包含1到20项操作")
	}
	args.SnapshotHash = envelope.SnapshotHash
	for i, rawOp := range envelope.Ops {
		path := fmt.Sprintf("ops[%d]", i)
		var op agentCanvasOp
		if err := decodeCloudAgentJSONObject(string(rawOp), &op); err != nil {
			field, issue := path, "invalid_value"
			name := ""
			var typeErr *json.UnmarshalTypeError
			if errors.As(err, &typeErr) {
				issue = "type_mismatch"
				name = typeErr.Field
			} else if strings.HasPrefix(err.Error(), "json: unknown field ") {
				issue = "unexpected_field"
				name = strings.Trim(strings.TrimPrefix(err.Error(), "json: unknown field "), "\"")
			}
		knownField:
			for _, typ := range []reflect.Type{reflect.TypeOf(agentCanvasArgs{}), reflect.TypeOf(agentCanvasOp{})} {
				for j := 0; j < typ.NumField(); j++ {
					if typ.Field(j).Tag.Get("json") == name {
						field += "." + name
						break knownField
					}
				}
			}
			return args, cloudAgentFieldError(field, issue, fmt.Sprintf("画布参数 %s 无效：%s", field, cloudAgentSafeToolError(cloudAgentJSONArgumentError(err))))
		}
		required := ""
		switch {
		case op.Type == "":
			required = "type"
		case op.ID == "":
			required = "id"
		case op.Type == "add_node" && op.NodeType == "":
			required = "nodeType"
		case op.Type == "update_node" && len(op.Patch) == 0:
			required = "patch"
		case op.Type == "connect_nodes" && op.FromNodeID == "":
			required = "fromNodeId"
		case op.Type == "connect_nodes" && op.ToNodeID == "":
			required = "toNodeId"
		}
		if required != "" {
			field := path + "." + required
			return args, cloudAgentFieldError(field, "required", fmt.Sprintf("画布参数 %s 不能为空", field))
		}
		args.Ops = append(args.Ops, op)
	}
	return args, nil
}

// Report the failure category without echoing model-controlled keys or values.
// The runtime attaches the advertised schema so the model can correct its call.
func cloudAgentJSONArgumentError(err error) error {
	message := "工具参数 JSON 格式无效，请按参数规范修正后重试"
	var typeErr *json.UnmarshalTypeError
	switch {
	case errors.Is(err, errCloudAgentJSONSingleObject):
		message = "工具参数必须是单个 JSON 对象，不能是字符串、数组、null 或多个对象；无参数时传 {}"
	case errors.As(err, &typeErr):
		message = "工具参数字段类型不匹配，请按参数规范使用整数、字符串或数组，不要把数字或数组写成字符串"
	case strings.HasPrefix(err.Error(), "json: unknown field "):
		message = "工具参数含有不支持的字段，请移除参数规范以外的字段后重试"
	}
	return &cloudAgentArgumentError{BadAuthRequest(message)}
}

// decodeCloudAgentJSONObject is used for model tool arguments. Tool arguments
// are an untrusted protocol boundary: reject non-objects, unknown fields and
// trailing JSON instead of silently accepting an ambiguous payload.
func decodeCloudAgentJSONObject(raw string, target any) error {
	data := bytes.TrimSpace([]byte(raw))
	if len(data) == 0 || data[0] != '{' {
		return errCloudAgentJSONSingleObject
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return errCloudAgentJSONSingleObject
		}
		return err
	}
	return nil
}
