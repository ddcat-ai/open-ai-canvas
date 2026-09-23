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
	"net/http"
	"strings"
)

type InfobipClient struct {
	baseUrl  string
	sender   string
	apiKey   string
	template string
}

type InfobipConfigService struct {
	baseUrl string
	sender  string
	apiKey  string
}

type SmsService struct {
	configService InfobipConfigService
}

type MessageData struct {
	Messages []Message `json:"messages"`
}

type Message struct {
	From         string        `json:"from"`
	Destinations []Destination `json:"destinations"`
	Text         string        `json:"text"`
}

type Destination struct {
	To string `json:"to"`
}

func GetInfobipClient(sender string, apiKey string, template string, baseUrl []string) (*InfobipClient, error) {
	if len(baseUrl) == 0 {
		return nil, fmt.Errorf("missing parameter: baseUrl")
	}

	infobipClient := &InfobipClient{
		baseUrl:  baseUrl[0],
		sender:   sender,
		apiKey:   apiKey,
		template: template,
	}

	return infobipClient, nil
}

func (c *InfobipClient) SendMessage(param map[string]string, targetPhoneNumber ...string) error {
	code, ok := param["code"]
	if !ok {
		return fmt.Errorf("missing parameter: code")
	}

	if len(targetPhoneNumber) == 0 {
		return fmt.Errorf("missin parer: trgetPhoneNumber")
	}

	mobile := targetPhoneNumber[0]

	if strings.HasPrefix(mobile, "0") {
		mobile = "886" + mobile[1:]
	}
	if strings.HasPrefix(mobile, "+") {
		mobile = mobile[1:]
	}

	endpoint := fmt.Sprintf("%s/sms/2/text/advanced", c.baseUrl)
	text := fmt.Sprintf(c.template, code)

	messageData := MessageData{
		Messages: []Message{
			{
				From: c.sender,
				Destinations: []Destination{
					{
						To: mobile,
					},
				},
				Text: text,
			},
		},
	}
	headers := map[string]string{
		"Authorization": fmt.Sprintf("App %s", c.apiKey),
		"Content-Type":  "application/json",
	}

	messageDataBytes, _ := json.Marshal(messageData)
	req, _ := http.NewRequest("POST", endpoint, bytes.NewBuffer(messageDataBytes))
	for key, value := range headers {
		req.Header.Set(key, value)
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	return nil
}
