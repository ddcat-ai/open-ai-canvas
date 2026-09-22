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
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type Msg91Client struct {
	authKey    string
	senderId   string
	templateId string
}

func GetMsg91Client(senderId string, authKey string, templateId string) (*Msg91Client, error) {
	msg91Client := &Msg91Client{
		authKey:    authKey,
		senderId:   senderId,
		templateId: templateId,
	}

	return msg91Client, nil
}

func (m *Msg91Client) SendMessage(param map[string]string, targetPhoneNumber ...string) error {
	if len(targetPhoneNumber) == 0 {
		return fmt.Errorf("missing parameter: targetPhoneNumber")
	}

	url := "https://control.msg91.com/api/v5/flow/"

	for _, mobile := range targetPhoneNumber {
		if strings.HasPrefix(mobile, "+") {
			mobile = mobile[1:]
		}

		payload, err := buildPayload(m.templateId, m.senderId, "0", mobile, param)
		if err != nil {
			return fmt.Errorf("SMS build payload failed: %v", err)
		}

		err = postMsg91SendRequest(url, strings.NewReader(payload), m.authKey)
		if err != nil {
			return fmt.Errorf("send message failed: %v", err)
		}
	}

	return nil
}

func buildPayload(templateId, senderId, shortURL, mobiles string, variables map[string]string) (string, error) {
	payload := make(map[string]interface{})

	payload["template_id"] = templateId
	payload["sender"] = senderId
	payload["short_url"] = shortURL
	payload["mobiles"] = mobiles

	for k, v := range variables {
		payload[k] = v
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	return string(jsonData), nil
}

func postMsg91SendRequest(url string, payload io.Reader, authKey string) error {
	req, _ := http.NewRequest("POST", url, payload)

	req.Header.Add("accept", "application/json")
	req.Header.Add("content-type", "application/json")
	req.Header.Add("authkey", authKey)

	res, _ := http.DefaultClient.Do(req)

	err := res.Body.Close()
	if err != nil {
		return err
	}

	return nil
}
