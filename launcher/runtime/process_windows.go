//go:build windows

package main

import (
	"fmt"
	"os/exec"
	"sync"
	"syscall"
	"unsafe"
)

var kernel = syscall.NewLazyDLL("kernel32.dll")
var createJob = kernel.NewProc("CreateJobObjectW")
var setJob = kernel.NewProc("SetInformationJobObject")
var assignJob = kernel.NewProc("AssignProcessToJobObject")
var terminateJob = kernel.NewProc("TerminateJobObject")
var closeHandle = kernel.NewProc("CloseHandle")
var openProcess = kernel.NewProc("OpenProcess")

type basicLimits struct {
	PerProcess, PerJob     int64
	Flags                  uint32
	MinWorking, MaxWorking uintptr
	Active                 uint32
	Affinity               uintptr
	Priority, Scheduling   uint32
}
type ioCounters struct{ ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes uint64 }
type extendedLimits struct {
	Basic                                                      basicLimits
	IO                                                         ioCounters
	ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory uintptr
}

func startManaged(cmd *exec.Cmd) (func(), error) {
	job, _, err := createJob.Call(0, 0)
	if job == 0 {
		return nil, fmt.Errorf("create backend job: %w", err)
	}
	limits := extendedLimits{}
	limits.Basic.Flags = 0x2000 // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	ok, _, err := setJob.Call(job, 9, uintptr(unsafe.Pointer(&limits)), unsafe.Sizeof(limits))
	if ok == 0 {
		closeHandle.Call(job)
		return nil, fmt.Errorf("configure backend job: %w", err)
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x200, HideWindow: true} // new process group
	if err := cmd.Start(); err != nil {
		closeHandle.Call(job)
		return nil, err
	}
	process, _, err := openProcess.Call(0x0100|0x0001, falseValue, uintptr(cmd.Process.Pid))
	if process == 0 {
		cmd.Process.Kill()
		cmd.Wait()
		closeHandle.Call(job)
		return nil, fmt.Errorf("open owned backend process: %w", err)
	}
	ok, _, err = assignJob.Call(job, process)
	closeHandle.Call(process)
	if ok == 0 {
		cmd.Process.Kill()
		cmd.Wait()
		closeHandle.Call(job)
		return nil, fmt.Errorf("assign owned backend job: %w", err)
	}
	var once sync.Once
	return func() { once.Do(func() { terminateJob.Call(job, 1); closeHandle.Call(job) }) }, nil
}

const falseValue = 0

func signalManaged(cmd *exec.Cmd) {
	// A GUI launcher has no shared console for CTRL_BREAK. The private HTTP
	// hook is the graceful path; only the caller deadline may terminate the job.
}
