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

	"github.com/twilio/twilio-go"
	openapi "github.com/twilio/twilio-go/rest/api/v2010"
)

type TwilioClient struct {
	template string
	core     *twilio.RestClient
}

func GetTwilioClient(accessId string, accessKey string, template string) (*TwilioClient, error) {
	client := twilio.NewRestClientWithParams(twilio.ClientParams{
		Username: accessId,
		Password: accessKey,
	})

	twilioClient := &TwilioClient{
		core:     client,
		template: template,
	}

	return twilioClient, nil
}

// SendMessage targetPhoneNumber[0] is the sender's number, so targetPhoneNumber should have at least two parameters
func (c *TwilioClient) SendMessage(param map[string]string, targetPhoneNumber ...string) error {
	code, ok := param["code"]
	if !ok {
		return fmt.Errorf("missing parameter: code")
	}

	bodyContent := fmt.Sprintf(c.template, code)

	if len(targetPhoneNumber) < 2 {
		return fmt.Errorf("bad parameter: targetPhoneNumber")
	}

	params := &openapi.CreateMessageParams{}
	params.SetFrom(targetPhoneNumber[0])
	params.SetBody(bodyContent)

	for i := 1; i < len(targetPhoneNumber); i++ {
		params.SetTo(targetPhoneNumber[i])
		_, err := c.core.Api.CreateMessage(params)
		if err != nil {
			return err
		}
	}

	return nil
}
