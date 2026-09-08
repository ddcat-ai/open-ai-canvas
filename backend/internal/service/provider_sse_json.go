package service

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

type providerSSEJSONKey struct{}

// readProviderSSEJSON consumes exactly one terminal image result. Closing the
// HTTP body is the caller's responsibility; EOF/done without completion fails.
func readProviderSSEJSON(body io.Reader, limit int64) ([]byte, error) {
	if limit <= 0 {
		return nil, errors.New("invalid SSE response limit")
	}
	reader := bufio.NewReader(io.LimitReader(body, limit+1))
	var event string
	var data bytes.Buffer
	var consumed int64
	finish := func() ([]byte, bool, error) {
		switch event {
		case "completed", "error":
			payload := bytes.TrimSpace(data.Bytes())
			var decoded map[string]json.RawMessage
			if err := json.Unmarshal(payload, &decoded); err != nil || decoded == nil {
				return nil, true, errors.New("上游 SSE 终态数据不是有效 JSON 对象")
			}
			if event == "error" {
				// Preserve the structured error for the adapter and accounting.
				if len(decoded["error"]) == 0 || bytes.Equal(bytes.TrimSpace(decoded["error"]), []byte("null")) {
					return nil, true, errors.New("上游 SSE 返回生成错误，但缺少错误详情")
				}
			}
			return append([]byte(nil), payload...), true, nil
		case "done":
			return nil, true, errors.New("上游 SSE 已结束但未返回生成结果")
		}
		return nil, false, nil
	}
	for {
		line, err := reader.ReadString('\n')
		consumed += int64(len(line))
		if consumed > limit {
			return nil, fmt.Errorf("上游 SSE 响应超过 %d 字节限制", limit)
		}
		line = strings.TrimSuffix(strings.TrimSuffix(line, "\n"), "\r")
		if line == "" {
			if payload, done, finishErr := finish(); done {
				return payload, finishErr
			}
			event = ""
			data.Reset()
		} else if !strings.HasPrefix(line, ":") {
			field, value, _ := strings.Cut(line, ":")
			value = strings.TrimPrefix(value, " ")
			switch field {
			case "event":
				event = value
			case "data":
				if data.Len() > 0 {
					data.WriteByte('\n')
				}
				data.WriteString(value)
			}
		}
		if err != nil {
			if !errors.Is(err, io.EOF) {
				return nil, fmt.Errorf("读取上游 SSE 失败：%w", err)
			}
			if payload, done, finishErr := finish(); done {
				return payload, finishErr
			}
			return nil, errors.New("上游 SSE 中断，未收到 completed/error；请勿自动重复提交")
		}
	}
}
