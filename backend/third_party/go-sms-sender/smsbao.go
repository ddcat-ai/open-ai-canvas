// Copyright 2022 The Casdoor Authors. All Rights Reserved.
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
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

type SmsBaoClient struct {
	username string
	apikey   string
	sign     string
	template string
	goodsid  string
}

func GetSmsbaoClient(username string, apikey string, sign string, template string, other []string) (*SmsBaoClient, error) {
	var goodsid string
	if len(other) == 0 {
		goodsid = ""
	} else {
		goodsid = other[0]
	}
	return &SmsBaoClient{
		username: username,
		apikey:   apikey,
		sign:     sign,
		template: template,
		goodsid:  goodsid,
	}, nil
}

func (c *SmsBaoClient) SendMessage(param map[string]string, targetPhoneNumber ...string) error {
	code, ok := param["code"]
	if !ok {
		return fmt.Errorf("missing parameter: code")
	}

	if len(targetPhoneNumber) == 0 {
		return fmt.Errorf("missing parameter: targetPhoneNumber")
	}

	smsContent := url.QueryEscape("【" + c.sign + "】" + fmt.Sprintf(c.template, code))
	for _, mobile := range targetPhoneNumber {
		if strings.HasPrefix(mobile, "+86") {
			mobile = mobile[3:]
		} else if strings.HasPrefix(mobile, "+") {
			return fmt.Errorf("unsupported country code")
		}
		// https://api.smsbao.com/sms?u=USERNAME&p=PASSWORD&g=GOODSID&m=PHONE&c=CONTENT
		url := fmt.Sprintf("https://api.smsbao.com/sms?u=%s&p=%s&g=%s&m=%s&c=%s", c.username, c.apikey, c.goodsid, mobile, smsContent)

		client := &http.Client{}
		req, _ := http.NewRequest("GET", url, nil)
		resp, err := client.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return err
		}
		switch string(body) {
		case "30":
			return fmt.Errorf("password error")
		case "40":
			return fmt.Errorf("account not exist")
		case "41":
			return fmt.Errorf("overdue account")
		case "43":
			return fmt.Errorf("IP address limit")
		case "50":
			return fmt.Errorf("content contain forbidden words")
		case "51":
			return fmt.Errorf("phone number incorrect")
		}
	}

	return nil
}
