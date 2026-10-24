package main

import (
	"runtime"
	"strings"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32                                = windows.NewLazySystemDLL("user32.dll")
	dwmapi                                = windows.NewLazySystemDLL("dwmapi.dll")
	procSetWindowsHookEx                  = user32.NewProc("SetWindowsHookExW")
	procCallNextHookEx                    = user32.NewProc("CallNextHookEx")
	procGetMessage                        = user32.NewProc("GetMessageW")
	procWindowFromPoint                   = user32.NewProc("WindowFromPoint")
	procGetAncestor                       = user32.NewProc("GetAncestor")
	procGetWindowRect                     = user32.NewProc("GetWindowRect")
	procSetWindowPos                      = user32.NewProc("SetWindowPos")
	procGetAsyncKeyState                  = user32.NewProc("GetAsyncKeyState")
	procIsZoomed                          = user32.NewProc("IsZoomed")
	procShowWindow                        = user32.NewProc("ShowWindow")
	procGetClassName                      = user32.NewProc("GetClassNameW")
	procMonitorFromPoint                  = user32.NewProc("MonitorFromPoint")
	procGetMonitorInfo                    = user32.NewProc("GetMonitorInfoW")
	procSetForegroundWindow               = user32.NewProc("SetForegroundWindow")
	procKeybdEvent                        = user32.NewProc("keybd_event")
	procSetProcessDpiAwarenessCtx         = user32.NewProc("SetProcessDpiAwarenessContext")
	procDwmGetWindowAttribute             = dwmapi.NewProc("DwmGetWindowAttribute")
	hookProcCallback                      = windows.NewCallback(hookProc)
	hookHandle                    uintptr = 0
)

const (
	whMouseLL       = 14
	wmMouseMove     = 0x0200
	wmLButtonDown   = 0x0201
	wmLButtonUp     = 0x0202
	wmRButtonDown   = 0x0204
	wmRButtonUp     = 0x0205
	wmMButtonDown   = 0x0207
	wmMButtonUp     = 0x0208
	gaRoot          = 2
	swRestore       = 9
	swpNoSize       = 0x0001
	swpNoZOrder     = 0x0004
	swpNoActivate   = 0x0010
	monitorNearest  = 2
	keyUp           = 0x0002
	vkUnassigned    = 0xE8 // a key press nobody listens to: stops Alt from opening menus, Win the Start menu
	dwmaFrameBounds = 9
	minW, minH      = 160, 100
)

type point struct{ X, Y int32 }
type rect struct{ Left, Top, Right, Bottom int32 }

type msllhook struct {
	Pt        point
	MouseData uint32
	Flags     uint32
	Time      uint32
	Extra     uintptr
}

type monitorInfo struct {
	Size    uint32
	Monitor rect
	Work    rect
	Flags   uint32
}

// dragState describes the running drag. The hook thread owns `drag`; the mover gets a copy.
type dragState struct {
	active                   bool
	resize                   bool
	upMsg                    uintptr
	hwnd                     uintptr
	start                    point
	rect                     rect
	border                   rect // invisible resize borders (GetWindowRect minus visible frame)
	left, right, top, bottom bool
}

var drag dragState

// The hook must return within microseconds, and a 1000 Hz mouse would flood the target window
// with SetWindowPos calls. So the hook only stores the latest cursor position; the mover thread
// applies it synchronously and skips positions that piled up meanwhile (no backlog, no lag).
var mover = struct {
	mu    sync.Mutex
	state dragState
	pt    point
	dirty bool
	wake  chan struct{}
}{wake: make(chan struct{}, 1)}

func queueMove(pt point) {
	mover.mu.Lock()
	mover.pt, mover.dirty = pt, true
	mover.mu.Unlock()
	select {
	case mover.wake <- struct{}{}:
	default:
	}
}

func runMover() {
	runtime.LockOSThread()
	for range mover.wake {
		for {
			mover.mu.Lock()
			if !mover.dirty {
				mover.mu.Unlock()
				break
			}
			pt, ds := mover.pt, mover.state
			mover.dirty = false
			mover.mu.Unlock()
			update(pt, ds)
		}
	}
}

func runHook() {
	procSetProcessDpiAwarenessCtx.Call(^uintptr(3)) // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 (-4)
	h, _, err := procSetWindowsHookEx.Call(whMouseLL, hookProcCallback, 0, 0)
	if h == 0 {
		logf("SetWindowsHookEx failed: %v", err)
		return
	}
	hookHandle = h
	go runMover()
	logf("mouse hook installed")
	var msg [48]byte
	for {
		r, _, _ := procGetMessage.Call(uintptr(unsafe.Pointer(&msg[0])), 0, 0, 0)
		if int32(r) <= 0 {
			return
		}
	}
}

func buttonMessages(name string) (down, up uintptr) {
	switch name {
	case "left":
		return wmLButtonDown, wmLButtonUp
	case "right":
		return wmRButtonDown, wmRButtonUp
	case "middle":
		return wmMButtonDown, wmMButtonUp
	}
	return 0, 0
}

func modifierHeld(name string) bool {
	keys := map[string][]uintptr{"alt": {0x12}, "ctrl": {0x11}, "shift": {0x10}, "win": {0x5B, 0x5C}}[name]
	for _, vk := range keys {
		if s, _, _ := procGetAsyncKeyState.Call(vk); s&0x8000 != 0 {
			return true
		}
	}
	return false
}

func next(nCode, wParam, lParam uintptr) uintptr {
	r, _, _ := procCallNextHookEx.Call(hookHandle, nCode, wParam, lParam)
	return r
}

func hookProc(nCode, wParam, lParam uintptr) uintptr {
	if int32(nCode) < 0 {
		return next(nCode, wParam, lParam)
	}
	info := *(**msllhook)(unsafe.Pointer(&lParam)) // lParam points to MSLLHOOKSTRUCT

	if drag.active {
		switch wParam {
		case wmMouseMove:
			queueMove(info.Pt)
		case drag.upMsg:
			queueMove(info.Pt) // final position
			drag.active = false
			app.mu.Lock()
			app.moves++
			app.mu.Unlock()
			return 1 // swallow: no context menu / click after the drag
		}
		return next(nCode, wParam, lParam)
	}

	if wParam != wmLButtonDown && wParam != wmRButtonDown && wParam != wmMButtonDown {
		return next(nCode, wParam, lParam)
	}
	if !app.active() {
		return next(nCode, wParam, lParam)
	}
	cfg := app.Config()
	moveDown, moveUp := buttonMessages(cfg.MoveButton)
	resizeDown, resizeUp := buttonMessages(cfg.ResizeButton)
	if (wParam != moveDown && wParam != resizeDown) || !modifierHeld(cfg.Modifier) {
		return next(nCode, wParam, lParam)
	}
	if !begin(info.Pt, cfg, wParam == resizeDown) {
		return next(nCode, wParam, lParam)
	}
	drag.upMsg = moveUp
	if drag.resize {
		drag.upMsg = resizeUp
	}
	mover.mu.Lock()
	mover.state, mover.dirty = drag, false
	mover.mu.Unlock()
	// Tap an unused key so releasing Alt/Win afterwards doesn't open a menu or the Start menu.
	procKeybdEvent.Call(vkUnassigned, 0, 0, 0)
	procKeybdEvent.Call(vkUnassigned, 0, keyUp, 0)
	return 1 // swallow the button press
}

func className(hwnd uintptr) string {
	buf := make([]uint16, 128)
	n, _, _ := procGetClassName.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	return windows.UTF16ToString(buf[:n])
}

func windowRect(hwnd uintptr) rect {
	var r rect
	procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r)))
	return r
}

func monitorAt(pt point) monitorInfo {
	mon, _, _ := procMonitorFromPoint.Call(uintptr(uint32(pt.X))|uintptr(uint32(pt.Y))<<32, monitorNearest)
	mi := monitorInfo{Size: uint32(unsafe.Sizeof(monitorInfo{}))}
	procGetMonitorInfo.Call(mon, uintptr(unsafe.Pointer(&mi)))
	return mi
}

func invisibleBorder(hwnd uintptr, r rect) rect {
	var vis rect
	if res, _, _ := procDwmGetWindowAttribute.Call(hwnd, dwmaFrameBounds, uintptr(unsafe.Pointer(&vis)), unsafe.Sizeof(vis)); res != 0 {
		return rect{}
	}
	return rect{vis.Left - r.Left, vis.Top - r.Top, r.Right - vis.Right, r.Bottom - vis.Bottom}
}

var ignoredClasses = map[string]bool{
	"Progman": true, "WorkerW": true, "Shell_TrayWnd": true, "Shell_SecondaryTrayWnd": true,
	"#32768": true, "Windows.UI.Core.CoreWindow": true, "XamlExplorerHostIslandWindow": true,
}

func begin(pt point, cfg Config, resize bool) bool {
	child, _, _ := procWindowFromPoint.Call(uintptr(uint32(pt.X)) | uintptr(uint32(pt.Y))<<32)
	if child == 0 {
		return false
	}
	hwnd, _, _ := procGetAncestor.Call(child, gaRoot)
	if hwnd == 0 || ignoredClasses[className(hwnd)] {
		return false
	}
	exe := exeName(windows.HWND(hwnd))
	for _, x := range cfg.Exclude {
		if x = strings.ToLower(strings.TrimSpace(x)); x != "" && (exe == x || exe == x+".exe") {
			return false
		}
	}
	zoomed, _, _ := procIsZoomed.Call(hwnd)
	r := windowRect(hwnd)
	if cfg.SkipFull && zoomed == 0 {
		if m := monitorAt(pt).Monitor; r.Left <= m.Left && r.Top <= m.Top && r.Right >= m.Right && r.Bottom >= m.Bottom {
			return false // fullscreen game or video: leave Alt+click alone
		}
	}
	if zoomed != 0 {
		// Restore first and keep the cursor at the same relative position on the title bar.
		ratio := float64(pt.X-r.Left) / float64(max(1, r.Right-r.Left))
		procShowWindow.Call(hwnd, swRestore)
		nr := windowRect(hwnd)
		w, h := nr.Right-nr.Left, nr.Bottom-nr.Top
		x := pt.X - int32(ratio*float64(w))
		y := pt.Y - min(pt.Y-r.Top, h/2)
		procSetWindowPos.Call(hwnd, 0, uintptr(x), uintptr(y), 0, 0, swpNoSize|swpNoZOrder|swpNoActivate)
		r = windowRect(hwnd)
	}
	if cfg.Raise {
		procSetForegroundWindow.Call(hwnd)
	}
	drag.active, drag.resize, drag.hwnd, drag.start, drag.rect = true, resize, hwnd, pt, r
	drag.border = invisibleBorder(hwnd, r)
	if resize {
		// Grab the nearest edges: thirds of the window decide which sides move.
		w, h := r.Right-r.Left, r.Bottom-r.Top
		rx, ry := pt.X-r.Left, pt.Y-r.Top
		drag.left, drag.right = rx < w/3, rx > 2*w/3
		drag.top, drag.bottom = ry < h/3, ry > 2*h/3
		if !drag.left && !drag.right && !drag.top && !drag.bottom {
			drag.right, drag.bottom = true, true // middle: resize from the bottom-right
		}
	}
	return true
}

func snap(v, edge, dist int32) int32 {
	if dist > 0 && v-edge < dist && edge-v < dist {
		return edge
	}
	return v
}

func update(pt point, drag dragState) {
	cfg := app.Config()
	dx, dy := pt.X-drag.start.X, pt.Y-drag.start.Y
	r, b := drag.rect, drag.border
	wa := monitorAt(pt).Work
	d := int32(cfg.Snap)
	if !drag.resize {
		w, h := r.Right-r.Left, r.Bottom-r.Top
		x, y := r.Left+dx, r.Top+dy
		// Snap the visible frame (not the invisible resize border) to the work area edges.
		x = snap(x+b.Left, wa.Left, d) - b.Left
		x = snap(x+w-b.Right, wa.Right, d) - w + b.Right
		y = snap(y+b.Top, wa.Top, d) - b.Top
		y = snap(y+h-b.Bottom, wa.Bottom, d) - h + b.Bottom
		procSetWindowPos.Call(drag.hwnd, 0, uintptr(x), uintptr(y), 0, 0, swpNoSize|swpNoZOrder|swpNoActivate)
		return
	}
	n := r
	if drag.left {
		n.Left = min(snap(r.Left+dx+b.Left, wa.Left, d)-b.Left, r.Right-minW)
	}
	if drag.right {
		n.Right = max(snap(r.Right+dx-b.Right, wa.Right, d)+b.Right, r.Left+minW)
	}
	if drag.top {
		n.Top = min(snap(r.Top+dy+b.Top, wa.Top, d)-b.Top, r.Bottom-minH)
	}
	if drag.bottom {
		n.Bottom = max(snap(r.Bottom+dy-b.Bottom, wa.Bottom, d)+b.Bottom, r.Top+minH)
	}
	procSetWindowPos.Call(drag.hwnd, 0, uintptr(n.Left), uintptr(n.Top), uintptr(n.Right-n.Left), uintptr(n.Bottom-n.Top),
		swpNoZOrder|swpNoActivate)
}
