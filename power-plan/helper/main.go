// power-helper reads and switches Windows power plans and reports running
// processes plus the foreground window, as JSON for the Raycast extension.
// Nothing here needs administrator rights.
//
//	power-helper status            -> {"plans":[...],"active":"<guid>","processes":[...],"foreground":{...},"notificationState":"..."}
//	power-helper plans             -> {"plans":[...],"active":"<guid>"}
//	power-helper setplan <guid>    -> {"ok":true,"active":"<guid>"}
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	powrprof                  = windows.NewLazySystemDLL("powrprof.dll")
	procPowerEnumerate        = powrprof.NewProc("PowerEnumerate")
	procPowerReadFriendlyName = powrprof.NewProc("PowerReadFriendlyName")
	procPowerGetActiveScheme  = powrprof.NewProc("PowerGetActiveScheme")
	procPowerSetActiveScheme  = powrprof.NewProc("PowerSetActiveScheme")

	user32                       = windows.NewLazySystemDLL("user32.dll")
	procGetForegroundWindow      = user32.NewProc("GetForegroundWindow")
	procGetWindowThreadProcessId = user32.NewProc("GetWindowThreadProcessId")
	procGetWindowRect            = user32.NewProc("GetWindowRect")
	procMonitorFromWindow        = user32.NewProc("MonitorFromWindow")
	procGetMonitorInfoW          = user32.NewProc("GetMonitorInfoW")
	procGetClassNameW            = user32.NewProc("GetClassNameW")
	procGetWindowTextW           = user32.NewProc("GetWindowTextW")
	procIsZoomed                 = user32.NewProc("IsZoomed")

	shell32                          = windows.NewLazySystemDLL("shell32.dll")
	procSHQueryUserNotificationState = shell32.NewProc("SHQueryUserNotificationState")
)

const accessScheme = 16 // ACCESS_SCHEME

type Plan struct {
	GUID string `json:"guid"`
	Name string `json:"name"`
}

type Process struct {
	PID  uint32 `json:"pid"`
	Name string `json:"name"`
	Path string `json:"path,omitempty"`
}

type Foreground struct {
	PID        uint32 `json:"pid"`
	Name       string `json:"name,omitempty"`
	Path       string `json:"path,omitempty"`
	Title      string `json:"title,omitempty"`
	Class      string `json:"class,omitempty"`
	Fullscreen bool   `json:"fullscreen"`
}

func fail(format string, args ...any) {
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": false, "error": fmt.Sprintf(format, args...)})
	os.Exit(1)
}

func guidString(g *windows.GUID) string {
	return strings.ToLower(strings.Trim(g.String(), "{}"))
}

func friendlyName(guid *windows.GUID) string {
	var size uint32
	procPowerReadFriendlyName.Call(0, uintptr(unsafe.Pointer(guid)), 0, 0, 0, uintptr(unsafe.Pointer(&size)))
	if size == 0 {
		return ""
	}
	buf := make([]uint16, size/2+1)
	r, _, _ := procPowerReadFriendlyName.Call(0, uintptr(unsafe.Pointer(guid)), 0, 0,
		uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)))
	if r != 0 {
		return ""
	}
	return windows.UTF16ToString(buf)
}

func listPlans() []Plan {
	plans := []Plan{}
	for index := uint32(0); ; index++ {
		var guid windows.GUID
		size := uint32(unsafe.Sizeof(guid))
		r, _, _ := procPowerEnumerate.Call(0, 0, 0, accessScheme, uintptr(index),
			uintptr(unsafe.Pointer(&guid)), uintptr(unsafe.Pointer(&size)))
		if r != 0 { // ERROR_NO_MORE_ITEMS or a real error
			break
		}
		plans = append(plans, Plan{GUID: guidString(&guid), Name: friendlyName(&guid)})
	}
	return plans
}

func activePlan() string {
	var ptr *windows.GUID
	r, _, _ := procPowerGetActiveScheme.Call(0, uintptr(unsafe.Pointer(&ptr)))
	if r != 0 || ptr == nil {
		return ""
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(ptr)))
	return guidString(ptr)
}

func setPlan(id string) {
	guid, err := windows.GUIDFromString("{" + strings.Trim(id, "{}") + "}")
	if err != nil {
		fail("invalid GUID %q", id)
	}
	r, _, _ := procPowerSetActiveScheme.Call(0, uintptr(unsafe.Pointer(&guid)))
	if r != 0 {
		fail("PowerSetActiveScheme failed: %v", syscall.Errno(r))
	}
}

func processPath(pid uint32) string {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(h)
	buf := make([]uint16, windows.MAX_LONG_PATH)
	size := uint32(len(buf))
	if err := windows.QueryFullProcessImageName(h, 0, &buf[0], &size); err != nil {
		return ""
	}
	return windows.UTF16ToString(buf[:size])
}

func listProcesses() []Process {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil
	}
	defer windows.CloseHandle(snap)
	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	procs := []Process{}
	for err = windows.Process32First(snap, &entry); err == nil; err = windows.Process32Next(snap, &entry) {
		if entry.ProcessID == 0 {
			continue
		}
		procs = append(procs, Process{
			PID:  entry.ProcessID,
			Name: windows.UTF16ToString(entry.ExeFile[:]),
			Path: processPath(entry.ProcessID),
		})
	}
	return procs
}

type rect struct{ Left, Top, Right, Bottom int32 }

type monitorInfo struct {
	Size    uint32
	Monitor rect
	Work    rect
	Flags   uint32
}

func windowText(proc *windows.LazyProc, hwnd uintptr) string {
	buf := make([]uint16, 256)
	n, _, _ := proc.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	return windows.UTF16ToString(buf[:n])
}

func foreground() *Foreground {
	hwnd, _, _ := procGetForegroundWindow.Call()
	if hwnd == 0 {
		return nil
	}
	var pid uint32
	procGetWindowThreadProcessId.Call(hwnd, uintptr(unsafe.Pointer(&pid)))
	fg := &Foreground{PID: pid, Class: windowText(procGetClassNameW, hwnd), Title: windowText(procGetWindowTextW, hwnd)}
	fg.Path = processPath(pid)
	if i := strings.LastIndex(fg.Path, `\`); i >= 0 {
		fg.Name = fg.Path[i+1:]
	}

	// The desktop and shell windows cover the whole screen but aren't apps.
	if fg.Class == "Progman" || fg.Class == "WorkerW" || fg.Class == "Shell_TrayWnd" {
		return fg
	}
	// A maximized window overlaps the screen edges by its border, which would look
	// like fullscreen when the taskbar auto-hides, so maximized windows don't count.
	if zoomed, _, _ := procIsZoomed.Call(hwnd); zoomed != 0 {
		return fg
	}
	var wr rect
	procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&wr)))
	monitor, _, _ := procMonitorFromWindow.Call(hwnd, 2) // MONITOR_DEFAULTTONEAREST
	mi := monitorInfo{Size: uint32(unsafe.Sizeof(monitorInfo{}))}
	if r, _, _ := procGetMonitorInfoW.Call(monitor, uintptr(unsafe.Pointer(&mi))); r != 0 {
		fg.Fullscreen = wr == mi.Monitor // borderless and exclusive fullscreen match the monitor exactly
	}
	return fg
}

var notificationStates = map[uint32]string{
	1: "not-present", 2: "busy", 3: "d3d-fullscreen", 4: "presentation", 5: "normal", 6: "quiet-time", 7: "app",
}

func notificationState() string {
	var state uint32
	if r, _, _ := procSHQueryUserNotificationState.Call(uintptr(unsafe.Pointer(&state))); r != 0 {
		return ""
	}
	return notificationStates[state]
}

func main() {
	out := json.NewEncoder(os.Stdout)
	if len(os.Args) < 2 {
		fail("usage: power-helper status | plans | setplan <guid>")
	}
	switch os.Args[1] {
	case "status":
		_ = out.Encode(map[string]any{
			"ok":                true,
			"plans":             listPlans(),
			"active":            activePlan(),
			"processes":         listProcesses(),
			"foreground":        foreground(),
			"notificationState": notificationState(),
		})
	case "plans":
		_ = out.Encode(map[string]any{"ok": true, "plans": listPlans(), "active": activePlan()})
	case "setplan":
		if len(os.Args) < 3 {
			fail("setplan needs a GUID")
		}
		setPlan(os.Args[2])
		_ = out.Encode(map[string]any{"ok": true, "active": activePlan()})
	default:
		fail("unknown command %q", os.Args[1])
	}
}
