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

	"github.com/ucloud/ucloud-sdk-go/services/usms"
	"github.com/ucloud/ucloud-sdk-go/ucloud"
	"github.com/ucloud/ucloud-sdk-go/ucloud/auth"
	"github.com/ucloud/ucloud-sdk-go/ucloud/config"
)

type UcloudClient struct {
	core       *usms.USMSClient
	ProjectId  string
	PrivateKey string
	PublicKey  string
	Sign       string
	Template   string
}

func GetUcloudClient(publicKey string, privateKey string, sign string, template string, projectId []string) (*UcloudClient, error) {
	if len(projectId) == 0 {
		return nil, fmt.Errorf("missing parameter: projectId")
	}

	cfg := config.NewConfig()
	cfg.ProjectId = projectId[0]
	credential := auth.NewCredential()
	credential.PublicKey = publicKey
	credential.PrivateKey = privateKey

	client := usms.NewClient(&cfg, &credential)

	ucloudClient := &UcloudClient{
		core:       client,
		ProjectId:  projectId[0],
		PrivateKey: privateKey,
		PublicKey:  publicKey,
		Sign:       sign,
		Template:   template,
	}

	return ucloudClient, nil
}

func (c *UcloudClient) SendMessage(param map[string]string, targetPhoneNumber ...string) error {
	code, ok := param["code"]
	if !ok {
		return fmt.Errorf("missing parameter: code")
	}

	if len(targetPhoneNumber) == 0 {
		return fmt.Errorf("missing parameter: targetPhoneNumber")
	}

	req := c.core.NewSendUSMSMessageRequest()
	req.SigContent = ucloud.String(c.Sign)
	req.TemplateId = ucloud.String(c.Template)
	req.PhoneNumbers = targetPhoneNumber
	req.TemplateParams = []string{code}
	response, err := c.core.SendUSMSMessage(req)
	if err != nil {
		return err
	}
	if response.RetCode != 0 {
		return fmt.Errorf(response.Message)
	}
	return nil
}
