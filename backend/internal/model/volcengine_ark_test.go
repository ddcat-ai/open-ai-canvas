package model

import "testing"

func TestIsVolcengineArkProtocols(t *testing.T) {
	if !IsVolcengineArkImageProtocol(ChannelInterfaceVolcengineArkImage) {
		t.Fatal("official ark image should match")
	}
	if !IsVolcengineArkImageProtocol(ChannelInterfaceVolcengineArkAgentPlanImage) {
		t.Fatal("agent plan image should match")
	}
	if IsVolcengineArkImageProtocol(ChannelInterfaceOpenAIImage) {
		t.Fatal("openai image should not match ark image")
	}
	if !IsVolcengineArkVideoProtocol(ChannelInterfaceVolcengineArkVideo) {
		t.Fatal("official ark video should match")
	}
	if !IsVolcengineArkVideoProtocol(ChannelInterfaceVolcengineArkAgentPlanVideo) {
		t.Fatal("agent plan video should match")
	}
	if IsVolcengineArkVideoProtocol(ChannelInterfaceNewAPIVideo) {
		t.Fatal("newapi video should not match ark video")
	}
}
