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
	"fmt"
	"strings"

	"github.com/baidubce/bce-sdk-go/services/sms"
	"github.com/baidubce/bce-sdk-go/services/sms/api"
)

type BaiduClient struct {
	sign     string
	template string
	core     *sms.Client
}

func GetBceClient(accessId, accessKey, sign, template string, endpoint []string) (*BaiduClient, error) {
	if len(endpoint) == 0 {
		return nil, fmt.Errorf("missing parameter: endpoint")
	}

	client, err := sms.NewClient(accessId, accessKey, endpoint[0])
	if err != nil {
		return nil, err
	}

	bceClient := &BaiduClient{
		sign:     sign,
		template: template,
		core:     client,
	}

	return bceClient, nil
}

func (c *BaiduClient) SendMessage(param map[string]string, targetPhoneNumber ...string) error {
	code, ok := param["code"]
	if !ok {
		return fmt.Errorf("missing parameter: code")
	}

	if len(targetPhoneNumber) == 0 {
		return fmt.Errorf("missing parameter: targetPhoneNumber")
	}

	contentMap := make(map[string]interface{})
	contentMap["code"] = code

	sendSmsArgs := &api.SendSmsArgs{
		Mobile:      strings.Join(targetPhoneNumber, ","),
		SignatureId: c.sign,
		Template:    c.template,
		ContentVar:  contentMap,
	}

	_, err := c.core.SendSms(sendSmsArgs)
	if err != nil {
		return err
	}

	return nil
}
