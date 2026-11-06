package main

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strings"
	"syscall"
	"time"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	shell32  = windows.NewLazySystemDLL("shell32.dll")
	gdi32    = windows.NewLazySystemDLL("gdi32.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")

	procGetModuleHandle = kernel32.NewProc("GetModuleHandleW")

	procRegisterClassEx        = user32.NewProc("RegisterClassExW")
	procCreateWindowEx         = user32.NewProc("CreateWindowExW")
	procDefWindowProc          = user32.NewProc("DefWindowProcW")
	procGetMessage             = user32.NewProc("GetMessageW")
	procTranslateMessage       = user32.NewProc("TranslateMessage")
	procDispatchMessage        = user32.NewProc("DispatchMessageW")
	procPostQuitMessage        = user32.NewProc("PostQuitMessage")
	procPostMessage            = user32.NewProc("PostMessageW")
	procDestroyWindow          = user32.NewProc("DestroyWindow")
	procSetTimer               = user32.NewProc("SetTimer")
	procRegisterWindowMessage  = user32.NewProc("RegisterWindowMessageW")
	procCreatePopupMenu        = user32.NewProc("CreatePopupMenu")
	procAppendMenu             = user32.NewProc("AppendMenuW")
	procTrackPopupMenu         = user32.NewProc("TrackPopupMenu")
	procDestroyMenu            = user32.NewProc("DestroyMenu")
	procSetForegroundWindow    = user32.NewProc("SetForegroundWindow")
	procGetCursorPos           = user32.NewProc("GetCursorPos")
	procGetSystemMetrics       = user32.NewProc("GetSystemMetrics")
	procDestroyIcon            = user32.NewProc("DestroyIcon")
	procCreateIconIndirect     = user32.NewProc("CreateIconIndirect")
	procSetProcessDpiAwareness = user32.NewProc("SetProcessDpiAwarenessContext")
	procShellNotifyIcon        = shell32.NewProc("Shell_NotifyIconW")
	procShellExecute           = shell32.NewProc("ShellExecuteW")
	procCreateDIBSection       = gdi32.NewProc("CreateDIBSection")
	procCreateBitmap           = gdi32.NewProc("CreateBitmap")
	procDeleteObject           = gdi32.NewProc("DeleteObject")
)

const (
	wmDestroy     = 0x0002
	wmCommand     = 0x0111
	wmTimer       = 0x0113
	wmNull        = 0x0000
	wmLButtonUp   = 0x0202
	wmRButtonUp   = 0x0205
	wmApp         = 0x8000
	wmTrayIcon    = wmApp + 1
	nimAdd        = 0
	nimModify     = 1
	nimDelete     = 2
	nifMessage    = 0x1
	nifIcon       = 0x2
	nifTip        = 0x4
	mfString      = 0x0
	mfGrayed      = 0x1
	mfChecked     = 0x8
	mfSeparator   = 0x800
	tpmReturnCmd  = 0x0100
	tpmRightBtn   = 0x0002
	tpmBottomAlgn = 0x0020
	smCxSmIcon    = 49

	cmdPauseAll = 1
	cmdBook     = 2
	cmdOpen     = 3
	cmdBookings = 4
	cmdExit     = 5
	cmdTimer0   = 100
)

type wndClassEx struct {
	Size       uint32
	Style      uint32
	WndProc    uintptr
	ClsExtra   int32
	WndExtra   int32
	Instance   windows.Handle
	Icon       windows.Handle
	Cursor     windows.Handle
	Background windows.Handle
	MenuName   *uint16
	ClassName  *uint16
	IconSm     windows.Handle
}

type msg struct {
	Hwnd    windows.HWND
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      struct{ X, Y int32 }
}

type notifyIconData struct {
	Size            uint32
	Wnd             windows.HWND
	ID              uint32
	Flags           uint32
	CallbackMessage uint32
	Icon            windows.Handle
	Tip             [128]uint16
	State           uint32
	StateMask       uint32
	Info            [256]uint16
	Version         uint32
	InfoTitle       [64]uint16
	InfoFlags       uint32
	GuidItem        windows.GUID
	BalloonIcon     windows.Handle
}

type Tray struct {
	statePath string
	offFile   string
	beatFile  string
	deeplink  string

	hwnd     windows.HWND
	nid      notifyIconData
	icon     windows.Handle
	shown    string // kind + text currently on the icon
	tip      string
	modTime  time.Time
	state    *State
	menuIDs  map[uintptr]string
	taskbarC uint32 // "TaskbarCreated": Explorer restarted, add the icon again
	lastBeat time.Time
	missing  time.Time // since when the state file is gone
}

var tray *Tray

func utf16Ptr(s string) *uint16 {
	p, _ := windows.UTF16PtrFromString(s)
	return p
}

func setTip(dst *[128]uint16, s string) {
	u := utf16.Encode([]rune(s))
	if len(u) > len(dst)-1 {
		u = u[:len(dst)-1]
	}
	copy(dst[:], u)
	dst[len(u)] = 0
}

func wndProc(hwnd windows.HWND, message uint32, wParam, lParam uintptr) uintptr {
	switch {
	case message == wmTrayIcon:
		switch lParam & 0xFFFF {
		case wmLButtonUp:
			tray.onClick()
		case wmRButtonUp:
			tray.showMenu()
		}
		return 0
	case message == wmTimer:
		tray.tick()
		return 0
	case message == wmDestroy:
		procShellNotifyIcon.Call(nimDelete, uintptr(unsafe.Pointer(&tray.nid)))
		procPostQuitMessage.Call(0)
		return 0
	case tray.taskbarC != 0 && message == tray.taskbarC:
		tray.shown = ""
		procShellNotifyIcon.Call(nimAdd, uintptr(unsafe.Pointer(&tray.nid)))
		tray.tick()
		return 0
	}
	r, _, _ := procDefWindowProc.Call(uintptr(hwnd), uintptr(message), wParam, lParam)
	return r
}

func runTray(t *Tray) error {
	tray = t
	t.menuIDs = map[uintptr]string{}
	// Crisp icon on scaled displays: per-monitor DPI awareness v2
	procSetProcessDpiAwareness.Call(^uintptr(3)) // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4

	h, _, _ := procGetModuleHandle.Call(0)
	instance := windows.Handle(h)
	className := utf16Ptr("JiraMocoTray")
	wc := wndClassEx{
		Size:      uint32(unsafe.Sizeof(wndClassEx{})),
		WndProc:   syscall.NewCallback(wndProc),
		Instance:  instance,
		ClassName: className,
	}
	if r, _, err := procRegisterClassEx.Call(uintptr(unsafe.Pointer(&wc))); r == 0 {
		return fmt.Errorf("RegisterClassEx: %v", err)
	}
	// A hidden top-level window (not message-only) so that TaskbarCreated reaches us
	hwnd, _, err := procCreateWindowEx.Call(0, uintptr(unsafe.Pointer(className)), uintptr(unsafe.Pointer(utf16Ptr("Jira MOCO Tray"))),
		0, 0, 0, 0, 0, 0, 0, uintptr(instance), 0)
	if hwnd == 0 {
		return fmt.Errorf("CreateWindowEx: %v", err)
	}
	t.hwnd = windows.HWND(hwnd)
	tc, _, _ := procRegisterWindowMessage.Call(uintptr(unsafe.Pointer(utf16Ptr("TaskbarCreated"))))
	t.taskbarC = uint32(tc)

	t.nid = notifyIconData{
		Size:            uint32(unsafe.Sizeof(notifyIconData{})),
		Wnd:             t.hwnd,
		ID:              1,
		Flags:           nifMessage | nifIcon | nifTip,
		CallbackMessage: wmTrayIcon,
	}
	t.reload()
	t.render()
	if r, _, err := procShellNotifyIcon.Call(nimAdd, uintptr(unsafe.Pointer(&t.nid))); r == 0 {
		logf("Shell_NotifyIcon add: %v (Explorer not ready yet?)", err)
	}
	procSetTimer.Call(hwnd, 1, 1000, 0)
	t.beat()

	var m msg
	for {
		r, _, _ := procGetMessage.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 {
			return nil
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		procDispatchMessage.Call(uintptr(unsafe.Pointer(&m)))
	}
}

func (t *Tray) quit() {
	procDestroyWindow.Call(uintptr(t.hwnd))
}

// reload reads the state file when it changed.
func (t *Tray) reload() {
	info, err := os.Stat(t.statePath)
	if err != nil {
		if t.missing.IsZero() {
			t.missing = time.Now()
		}
		t.state = &State{SingleRunning: true}
		return
	}
	t.missing = time.Time{}
	if t.state != nil && info.ModTime().Equal(t.modTime) {
		return
	}
	st, err := readState(t.statePath)
	if err != nil {
		return // being replaced right now, next tick
	}
	t.state, t.modTime = st, info.ModTime()
}

func (t *Tray) tick() {
	// Hidden in Raycast ("Hide Tray Icon"), or the extension was removed
	if _, err := os.Stat(t.offFile); err == nil {
		t.quit()
		return
	}
	if !t.missing.IsZero() && time.Since(t.missing) > 10*time.Minute {
		if _, err := os.Stat(strings.TrimSuffix(t.statePath, `\timers.json`)); err != nil {
			t.quit()
			return
		}
	}
	t.reload()
	t.render()
	if time.Since(t.lastBeat) > 10*time.Second {
		t.beat()
	}
}

// beat tells the extension that the tray is alive, so it doesn't start a second one.
func (t *Tray) beat() {
	t.lastBeat = time.Now()
	_ = os.WriteFile(t.beatFile, []byte(fmt.Sprintf(`{"pid":%d,"beat":%d}`, os.Getpid(), time.Now().UnixMilli())), 0o644)
}

// render updates icon and tooltip when what they show has changed.
func (t *Tray) render() {
	now := nowMs()
	kind, text, tip := iconIdle, "-", "Jira MOCO: no timer\nClick to start one in Raycast"
	if t.state != nil && len(t.state.Timers) > 0 {
		sorted := t.state.Sorted()
		first := sorted[0]
		kind = iconPaused
		if first.Running() {
			kind = iconRunning
		}
		text = iconText(first.Elapsed(now))
		var lines []string
		for i, tm := range sorted {
			if i == 4 {
				lines = append(lines, fmt.Sprintf("+%d more", len(sorted)-4))
				break
			}
			mark := "⏸"
			if tm.Running() {
				mark = "▶"
			}
			lines = append(lines, fmt.Sprintf("%s %s  %s", mark, tm.Label, clockText(tm.Elapsed(now))))
		}
		tip = strings.Join(lines, "\n")
	}
	key := fmt.Sprint(kind, text)
	if key == t.shown && tip == t.tip {
		return
	}
	if key != t.shown {
		size, _, _ := procGetSystemMetrics.Call(smCxSmIcon)
		if size < 16 {
			size = 16
		}
		icon, err := createIcon(int(size), renderIcon(int(size), kind, text))
		if err != nil {
			logf("icon: %v", err)
			return
		}
		if t.icon != 0 {
			procDestroyIcon.Call(uintptr(t.icon))
		}
		t.icon = icon
		t.nid.Icon = icon
	}
	setTip(&t.nid.Tip, tip)
	t.shown, t.tip = key, tip
	procShellNotifyIcon.Call(nimModify, uintptr(unsafe.Pointer(&t.nid)))
}

func clockText(d time.Duration) string {
	m := int(d.Minutes())
	return fmt.Sprintf("%d:%02d", m/60, m%60)
}

func (t *Tray) apply(fn func(st *State, now float64)) {
	st, err := change(t.statePath, fn)
	if err != nil {
		logf("change: %v", err)
		return
	}
	t.state = st
	if info, err := os.Stat(t.statePath); err == nil {
		t.modTime = info.ModTime()
	}
	t.render()
}

func (t *Tray) onClick() {
	if t.state == nil || len(t.state.Timers) == 0 {
		t.open("track-time", nil)
		return
	}
	t.apply(func(st *State, now float64) { st.PauseOrResume(now) })
}

func (t *Tray) showMenu() {
	t.reload()
	menu, _, _ := procCreatePopupMenu.Call()
	defer procDestroyMenu.Call(menu)
	add := func(flags uintptr, id uintptr, text string) {
		procAppendMenu.Call(menu, flags, id, uintptr(unsafe.Pointer(utf16Ptr(text))))
	}
	clear(t.menuIDs)
	now := nowMs()
	var running *Timer
	sorted := []*Timer{}
	if t.state != nil {
		sorted = t.state.Sorted()
	}
	for i, tm := range sorted {
		if i == 15 {
			break
		}
		flags := uintptr(mfString)
		if tm.Running() {
			flags |= mfChecked
			if running == nil {
				running = tm
			}
		}
		label := fmt.Sprintf("%s\t%s", tm.Label, clockText(tm.Elapsed(now)))
		if tm.Summary != "" {
			summary := []rune(tm.Summary)
			if len(summary) > 40 {
				summary = append(summary[:39], '…')
			}
			label = fmt.Sprintf("%s  %s\t%s", tm.Label, string(summary), clockText(tm.Elapsed(now)))
		}
		id := uintptr(cmdTimer0 + i)
		t.menuIDs[id] = tm.ID
		add(flags, id, strings.ReplaceAll(label, "&", "&&"))
	}
	if len(sorted) == 0 {
		add(mfString|mfGrayed, 0, "No timer")
	}
	add(mfSeparator, 0, "")
	if running != nil {
		add(mfString, cmdPauseAll, "Pause")
		add(mfString, cmdBook, "Book "+strings.ReplaceAll(running.Label, "&", "&&")+"…")
	}
	add(mfString, cmdOpen, "Track Time…")
	add(mfString, cmdBookings, "Booked Time…")
	add(mfSeparator, 0, "")
	add(mfString, cmdExit, "Hide Tray Icon")

	var pt struct{ X, Y int32 }
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	// Without this the menu doesn't close when clicking elsewhere
	procSetForegroundWindow.Call(uintptr(t.hwnd))
	cmd, _, _ := procTrackPopupMenu.Call(menu, tpmReturnCmd|tpmRightBtn|tpmBottomAlgn, uintptr(pt.X), uintptr(pt.Y), 0, uintptr(t.hwnd), 0)
	procPostMessage.Call(uintptr(t.hwnd), wmNull, 0, 0)

	switch {
	case cmd == cmdPauseAll:
		t.apply(func(st *State, now float64) { st.PauseAll(now) })
	case cmd == cmdBook && running != nil:
		t.open("track-time", map[string]string{"bookTimerId": running.ID})
	case cmd == cmdOpen:
		t.open("track-time", nil)
	case cmd == cmdBookings:
		t.open("bookings", nil)
	case cmd == cmdExit:
		_ = os.WriteFile(t.offFile, []byte("hidden from the tray menu\n"), 0o644)
		t.quit()
	case cmd >= cmdTimer0:
		if id, ok := t.menuIDs[cmd]; ok {
			t.apply(func(st *State, now float64) { st.Toggle(id, now) })
		}
	}
}

// open starts a Raycast command by deeplink, optionally with launch context.
func (t *Tray) open(command string, context map[string]string) {
	link := t.deeplink + command
	if len(context) > 0 {
		data, _ := json.Marshal(context)
		link += "?context=" + url.QueryEscape(string(data))
	}
	r, _, _ := procShellExecute.Call(0, uintptr(unsafe.Pointer(utf16Ptr("open"))), uintptr(unsafe.Pointer(utf16Ptr(link))), 0, 0, 1)
	if r <= 32 {
		// Some setups refuse raycast:// from ShellExecute; Explorer hands it over
		logf("ShellExecute %s failed (%d), trying explorer", link, r)
		explorer := windows.ComposeCommandLine([]string{"explorer.exe", link})
		cmd, _ := windows.UTF16PtrFromString(explorer)
		var si windows.StartupInfo
		si.Cb = uint32(unsafe.Sizeof(si))
		var pi windows.ProcessInformation
		if err := windows.CreateProcess(nil, cmd, nil, nil, false, 0, nil, nil, &si, &pi); err == nil {
			windows.CloseHandle(pi.Thread)
			windows.CloseHandle(pi.Process)
		}
	}
}
