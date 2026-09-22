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
)

type ACSClient struct {
	AccessToken string
	Endpoint    string
	Message     string
	Sender      string
}

type reqBody struct {
	From          string         `json:"from"`
	Message       string         `json:"message"`
	SMSRecipients []smsRecipient `json:"smsRecipients"`
}

type smsRecipient struct {
	To string `json:"to"`
}

func GetACSClient(accessToken string, message string, other []string) (*ACSClient, error) {
	if len(other) < 2 {
		return nil, fmt.Errorf("missing parameter: endpoint or sender")
	}

	acsClient := &ACSClient{
		AccessToken: accessToken,
		Endpoint:    other[0],
		Message:     message,
		Sender:      other[1],
	}

	return acsClient, nil
}

func (a *ACSClient) SendMessage(param map[string]string, targetPhoneNumber ...string) error {
	if len(targetPhoneNumber) == 0 {
		return fmt.Errorf("missing parameter: targetPhoneNumber")
	}

	reqBody := &reqBody{
		From:          a.Sender,
		Message:       a.Message,
		SMSRecipients: make([]smsRecipient, 0),
	}
	for _, mobile := range targetPhoneNumber {
		reqBody.SMSRecipients = append(reqBody.SMSRecipients, smsRecipient{To: mobile})
	}

	url := fmt.Sprintf("%s/sms?api-version=2021-03-07", a.Endpoint)

	client := &http.Client{}

	requestBody, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("error creating request body: %w", err)
	}

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(requestBody))
	if err != nil {
		return fmt.Errorf("error creating request: %w", err)
	}

	req.Header.Add("Authorization", "Bearer "+a.AccessToken)
	req.Header.Add("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("error sending request: %w", err)
	}

	resp.Body.Close()

	return nil
}
