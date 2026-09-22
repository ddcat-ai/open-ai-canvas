// Copyright 2024 The Casdoor Authors. All Rights Reserved.
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
	"errors"
	"fmt"
	"strings"

	unisms "github.com/apistd/uni-go-sdk/sms"
)

type UnismsClient struct {
	core     *unisms.UniSMSClient
	sign     string
	template string
}

func GetUnismsClient(accessId string, accessKey string, signature string, templateId string) (*UnismsClient, error) {
	client := unisms.NewClient(accessId, accessKey)

	// Check the correctness of the accessId and accessKey
	msg := unisms.BuildMessage()
	msg.SetTo("test")
	msg.SetTemplateId("pub_verif_register") // free template
	_, err := client.Send(msg)
	if strings.Contains(err.Error(), "[104111] InvalidAccessKeyId") {
		return nil, err
	}

	unismsClient := &UnismsClient{
		core:     client,
		sign:     signature,
		template: templateId,
	}

	return unismsClient, nil
}

func (c *UnismsClient) SendMessage(param map[string]string, targetPhoneNumber ...string) error {
	if len(targetPhoneNumber) == 0 {
		return fmt.Errorf("missing parameter: targetPhoneNumber")
	}

	msg := unisms.BuildMessage()
	msg.SetTo(targetPhoneNumber...)
	msg.SetSignature(c.sign)
	msg.SetTemplateId(c.template)

	resp, err := c.core.Send(msg)
	if err != nil {
		return err
	}

	if resp.Code != "0" {
		return errors.New(resp.Message)
	}

	return nil
}
