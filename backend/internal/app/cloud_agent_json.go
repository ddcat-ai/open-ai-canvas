package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strings"
)

var errCloudAgentJSONSingleObject = errors.New("参数必须是单个 JSON 对象")

// Only syntax/schema errors may be repaired by the model; authorization and
// unsupported mutations still fail admission before any write or approval.
type cloudAgentArgumentError struct{ error }

func (e *cloudAgentArgumentError) Unwrap() error { return e.error }

func canvasArgumentError() error {
	return &cloudAgentArgumentError{BadAuthRequest("画布工具参数无效：仅允许一个 JSON 对象；顶层只含 snapshotHash 和 ops，snapshotHash 不得放入 ops。请按工具 schema 修正后重试")}
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
