// drag-helper moves and resizes windows with a modifier key + mouse drag (like AltSnap),
// for the Raycast "Window Drag" extension. It installs a low-level mouse hook, so it has to
// keep running; Raycast starts and supervises it.
//
//	drag-helper run    -config <file> -data <dir>   run in the foreground
//	drag-helper launch -config <file> -data <dir>   start "run" detached and exit
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	version = "1.0.0"
	apiAddr = "127.0.0.1:3011"
)

var logger *log.Logger

func logf(format string, args ...any) {
	if logger != nil {
		logger.Printf(format, args...)
	}
}

type Config struct {
	Enabled      bool     `json:"enabled"`
	Modifier     string   `json:"modifier"`     // alt | win | ctrl | shift
	MoveButton   string   `json:"moveButton"`   // left | right | middle
	ResizeButton string   `json:"resizeButton"` // none | left | right | middle
	Snap         int      `json:"snap"`         // px, 0 = off
	Raise        bool     `json:"raise"`        // bring the window to the front
	SkipFull     bool     `json:"skipFullscreen"`
	Exclude      []string `json:"exclude"` // exe names
}

func defaultConfig() Config {
	return Config{Enabled: true, Modifier: "alt", MoveButton: "right", ResizeButton: "none", Snap: 15, Raise: true, SkipFull: true}
}

type App struct {
	configPath string
	mu         sync.RWMutex
	cfg        Config
	cfgTime    time.Time
	paused     bool
	started    time.Time
	moves      int
}

var app = &App{cfg: defaultConfig(), started: time.Now()}

func (a *App) Config() Config {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.cfg
}

func (a *App) active() bool {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.cfg.Enabled && !a.paused
}

func (a *App) loadConfig() {
	info, err := os.Stat(a.configPath)
	if err != nil || info.ModTime().Equal(a.cfgTime) {
		return
	}
	data, err := os.ReadFile(a.configPath)
	if err != nil {
		return
	}
	cfg := defaultConfig()
	if json.Unmarshal(data, &cfg) != nil {
		return
	}
	a.mu.Lock()
	a.cfg, a.cfgTime = cfg, info.ModTime()
	a.mu.Unlock()
	logf("config: modifier=%s move=%s resize=%s snap=%d", cfg.Modifier, cfg.MoveButton, cfg.ResizeButton, cfg.Snap)
}

func openLog(dir string) {
	_ = os.MkdirAll(dir, 0o755)
	path := filepath.Join(dir, "drag-helper.log")
	if info, err := os.Stat(path); err == nil && info.Size() > 512<<10 {
		_ = os.Rename(path, path+".old")
	}
	var w io.Writer = os.Stderr
	if f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
		w = f
	}
	logger = log.New(w, "", log.LstdFlags)
}

// launch starts "run" detached and outside Raycast's job object.
func launch(args []string) {
	exe, _ := os.Executable()
	cmd, _ := windows.UTF16PtrFromString(windows.ComposeCommandLine(append([]string{exe, "run"}, args...)))
	var si windows.StartupInfo
	si.Cb = uint32(unsafe.Sizeof(si))
	var pi windows.ProcessInformation
	const breakaway, detached, newGroup = 0x01000000, 0x00000008, 0x00000200
	err := windows.CreateProcess(nil, cmd, nil, nil, false, breakaway|detached|newGroup, nil, nil, &si, &pi)
	if err != nil {
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

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func serveAPI(ln net.Listener) {
	mux := http.NewServeMux()
	status := func() map[string]any {
		a := app
		a.mu.RLock()
		defer a.mu.RUnlock()
		return map[string]any{"ok": true, "version": version, "pid": os.Getpid(), "started": a.started,
			"enabled": a.cfg.Enabled, "paused": a.paused, "moves": a.moves, "config": a.cfg}
	}
	mux.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, status()) })
	mux.HandleFunc("/pause", func(w http.ResponseWriter, r *http.Request) {
		app.mu.Lock()
		switch r.URL.Query().Get("state") {
		case "on":
			app.paused = true
		case "off":
			app.paused = false
		default:
			app.paused = !app.paused
		}
		logf("paused=%v", app.paused)
		app.mu.Unlock()
		writeJSON(w, status())
	})
	mux.HandleFunc("/quit", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST required", 405)
			return
		}
		writeJSON(w, map[string]any{"ok": true})
		go func() { time.Sleep(100 * time.Millisecond); os.Exit(0) }()
	})
	_ = (&http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}).Serve(ln)
}

func main() {
	if len(os.Args) < 2 {
		fmt.Println("usage: drag-helper run|launch -config <file> -data <dir>")
		os.Exit(2)
	}
	fs := flag.NewFlagSet(os.Args[1], flag.ExitOnError)
	configPath := fs.String("config", "", "config JSON written by Raycast")
	dataDir := fs.String("data", "", "folder for the log")
	_ = fs.Parse(os.Args[2:])
	switch os.Args[1] {
	case "launch":
		launch(os.Args[2:])
		return
	case "run":
	default:
		os.Exit(2)
	}
	if *dataDir == "" {
		*dataDir = os.TempDir()
	}
	openLog(*dataDir)
	ln, err := net.Listen("tcp", apiAddr) // single instance
	if err != nil {
		logf("already running (%v)", err)
		os.Exit(3)
	}
	app.configPath = *configPath
	app.loadConfig()
	logf("drag-helper %s starting (pid %d)", version, os.Getpid())
	go serveAPI(ln)
	go func() {
		for range time.Tick(2 * time.Second) {
			app.loadConfig()
		}
	}()
	runtime.LockOSThread()
	runHook() // blocks: the hook needs a message loop on this thread
}

func exeName(hwnd windows.HWND) string {
	var pid uint32
	_, _ = windows.GetWindowThreadProcessId(hwnd, &pid)
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(h)
	buf := make([]uint16, windows.MAX_PATH)
	size := uint32(len(buf))
	if windows.QueryFullProcessImageName(h, 0, &buf[0], &size) != nil {
		return ""
	}
	return strings.ToLower(filepath.Base(windows.UTF16ToString(buf[:size])))
}
