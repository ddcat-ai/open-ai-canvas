//go:build !linux && !darwin

package service

func platformMemory() (uint64, uint64, bool)         { return 0, 0, false }
func platformLoadAverage() ([3]float64, bool)        { return [3]float64{}, false }
func collectSystemDisk(string) SystemPerformanceDisk { return SystemPerformanceDisk{} }
