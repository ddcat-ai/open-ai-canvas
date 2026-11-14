//go:build !windows

package app

func restrictSettingsKey(string) error { return nil }
