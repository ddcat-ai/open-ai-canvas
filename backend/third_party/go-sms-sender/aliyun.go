// Copyright 2021 The Casdoor Authors. All Rights Reserved.
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
	"strings"

	"github.com/aliyun/alibaba-cloud-sdk-go/services/dysmsapi"
)

type AliyunClient struct {
	template string
	sign     string
	core     *dysmsapi.Client
}

type AliyunResult struct {
	RequestId string
	Message   string
}

func GetAliyunClient(accessId string, accessKey string, sign string, template string) (*AliyunClient, error) {
	region := "cn-hangzhou"
	client, err := dysmsapi.NewClientWithAccessKey(region, accessId, accessKey)
	if err != nil {
		return nil, err
	}

	aliyunClient := &AliyunClient{
		template: template,
		core:     client,
		sign:     sign,
	}

	return aliyunClient, nil
}

func (c *AliyunClient) SendMessage(param map[string]string, targetPhoneNumber ...string) error {
	requestParam, err := json.Marshal(param)
	if err != nil {
		return err
	}

	if len(targetPhoneNumber) == 0 {
		return fmt.Errorf("missing parameter: targetPhoneNumber")
	}

	request := dysmsapi.CreateSendSmsRequest()
	request.Scheme = "https"
	request.PhoneNumbers = strings.Join(targetPhoneNumber, ",")
	request.TemplateCode = c.template
	request.TemplateParam = string(requestParam)
	request.SignName = c.sign

	response, err := c.core.SendSms(request)
	if err != nil {
		return err
	}

	if response.Code != "OK" {
		aliyunResult := AliyunResult{}
		err = json.Unmarshal(response.GetHttpContentBytes(), &aliyunResult)
		if err != nil {
			return err
		}

		if aliyunResult.Message != "" {
			return fmt.Errorf(aliyunResult.Message)
		}
	}

	return nil
}
