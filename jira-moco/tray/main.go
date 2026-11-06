// jira-moco-tray shows the timers of the Raycast extension "Jira MOCO Time Tracking" in the
// Windows notification area: the icon shows the running time, a click pauses or resumes,
// the menu switches between timers and opens Raycast to book.
//
//	jira-moco-tray launch -state <timers.json> -data <dir> -deeplink raycast://extensions/<author>/<name>/
//
// "launch" starts "run" detached from Raycast's job object and returns at once.
package main

import (
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"unsafe"

	"golang.org/x/sys/windows"
)

var logger = log.New(io.Discard, "", 0)

func logf(format string, args ...any) { logger.Printf(format, args...) }

func openLog(dir string) {
	path := filepath.Join(dir, "tray.log")
	if info, err := os.Stat(path); err == nil && info.Size() > 256<<10 {
		_ = os.Rename(path, path+".old")
	}
	if f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
		logger = log.New(f, "", log.LstdFlags)
	}
}

func launch(args []string) {
	exe, _ := os.Executable()
	cmdline := windows.ComposeCommandLine(append([]string{exe, "run"}, args...))
	cmd, _ := windows.UTF16PtrFromString(cmdline)
	var si windows.StartupInfo
	si.Cb = uint32(unsafe.Sizeof(si))
	var pi windows.ProcessInformation
	const breakaway, detached, newGroup = 0x01000000, 0x00000008, 0x00000200
	err := windows.CreateProcess(nil, cmd, nil, nil, false, breakaway|detached|newGroup, nil, nil, &si, &pi)
	if err != nil {
		// The job may not allow breakaway; start normally then.
		err = windows.CreateProcess(nil, cmd, nil, nil, false, detached|newGroup, nil, nil, &si, &pi)
	}
	if err != nil {
		fmt.Printf("{\"ok\":false,\"error\":%q}\n", err.Error())
		os.Exit(1)
	}
	windows.CloseHandle(pi.Thread)
	windows.CloseHandle(pi.Process)
	fmt.Printf("{\"ok\":true,\"pid\":%d}\n", pi.ProcessId)
}

func main() {
	if len(os.Args) < 2 {
		fmt.Println("usage: jira-moco-tray run|launch -state <timers.json> -data <dir> -deeplink <raycast://extensions/author/name/>")
		os.Exit(2)
	}
	mode := os.Args[1]
	fs := flag.NewFlagSet(mode, flag.ExitOnError)
	statePath := fs.String("state", "", "timers.json shared with the extension")
	dataDir := fs.String("data", "", "folder for log, heartbeat and the hidden flag")
	deeplink := fs.String("deeplink", "raycast://extensions/mendyka/jira-moco/", "deeplink prefix of the extension")
	_ = fs.Parse(os.Args[2:])
	if *statePath == "" || *dataDir == "" {
		fmt.Println("-state and -data are required")
		os.Exit(2)
	}

	switch mode {
	case "launch":
		launch(os.Args[2:])
		return
	case "run":
	default:
		fmt.Println("unknown mode", mode)
		os.Exit(2)
	}

	_ = os.MkdirAll(*dataDir, 0o755)
	openLog(*dataDir)

	// One tray icon per user session
	name, _ := windows.UTF16PtrFromString(`Local\JiraMocoTray`)
	mutex, err := windows.CreateMutex(nil, false, name)
	if err == windows.ERROR_ALREADY_EXISTS {
		logf("already running")
		os.Exit(0)
	}
	if err != nil {
		logf("mutex: %v", err)
	}
	defer windows.CloseHandle(mutex)

	// Window messages are delivered to the thread that created the window
	runtime.LockOSThread()
	logf("starting (pid %d), state %s", os.Getpid(), *statePath)
	t := &Tray{
		statePath: *statePath,
		offFile:   filepath.Join(*dataDir, "tray-off"),
		beatFile:  filepath.Join(*dataDir, "tray.json"),
		deeplink:  *deeplink,
	}
	if err := runTray(t); err != nil {
		logf("tray: %v", err)
		os.Exit(1)
	}
	_ = os.Remove(t.beatFile)
	logf("stopped")
}
