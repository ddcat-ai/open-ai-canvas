// Copyright 2023 The Casdoor Authors. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package go_sms_sender

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
)

type SubmailClient struct {
	api       string
	appid     string
	signature string
	project   string
}

type SubmailResult struct {
	Status string `json:"status"`
	Code   int    `json:"code"`
	Msg    string `json:"msg"`
}

func buildSubmailPostdata(param map[string]string, appid string, signature string, project string, targetPhoneNumber []string) (map[string]string, error) {
	multi := make([]map[string]interface{}, 0, 32)

	for _, phoneNumber := range targetPhoneNumber[0:] {
		multi = append(multi, map[string]interface{}{
			"to":   phoneNumber,
			"vars": param,
		})
	}

	m, err := json.Marshal(multi)
	if err != nil {
		return nil, err
	}

	postdata := make(map[string]string)
	postdata["appid"] = appid
	postdata["signature"] = signature
	postdata["project"] = project
	postdata["multi"] = string(m)
	return postdata, nil
}

func GetSubmailClient(appid string, signature string, project string) (*SubmailClient, error) {
	submailClient := &SubmailClient{
		api:       "https://api-v4.mysubmail.com/sms/multixsend",
		appid:     appid,
		signature: signature,
		project:   project,
	}
	return submailClient, nil
}

func (c *SubmailClient) SendMessage(param map[string]string, targetPhoneNumber ...string) error {
	postdata, err := buildSubmailPostdata(param, c.appid, c.signature, c.project, targetPhoneNumber)
	if err != nil {
		return err
	}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	for key, val := range postdata {
		err = writer.WriteField(key, val)
		if err != nil {
			return err
		}
	}

	contentType := writer.FormDataContentType()
	err = writer.Close()
	if err != nil {
		return err
	}

	resp, err := http.Post(c.api, contentType, body)
	if err != nil {
		return err
	}

	result, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	return handleSubmailResult(result)
}

func handleSubmailResult(result []byte) error {
	var submailSuccessResult []SubmailResult
	err := json.Unmarshal(result, &submailSuccessResult)
	if err != nil {
		var submailErrorResult SubmailResult
		err = json.Unmarshal(result, &submailErrorResult)
		if err != nil {
			return err
		}

		if submailErrorResult.Msg != "" {
			return fmt.Errorf(submailErrorResult.Msg)
		}
	}

	errMsgs := []string{}
	for _, submailResult := range submailSuccessResult {
		if submailResult.Status != "success" {
			errMsg := fmt.Sprintf("%s, %d, %s", submailResult.Status, submailResult.Code, submailResult.Msg)
			errMsgs = append(errMsgs, errMsg)
		}
	}

	if len(errMsgs) > 0 {
		return fmt.Errorf(strings.Join(errMsgs, "|"))
	}

	return nil
}
