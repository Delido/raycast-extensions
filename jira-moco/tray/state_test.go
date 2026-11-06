package main

import (
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const sample = `{"version":1,"singleRunning":true,"future":"kept","timers":[
 {"id":"a","issue":{"key":"ABC-1","summary":"Relaunch","job":"P1"},"segments":[{"start":1000}],"offsetMs":0,"note":"","touched":1000},
 {"id":"b","title":"Weekly","project":{"id":7,"identifier":"P7","name":"Intern"},"segments":[{"start":0,"end":60000}],"offsetMs":60000,"note":"Planung","touched":500}
]}`

func writeSample(t *testing.T) string {
	path := filepath.Join(t.TempDir(), "timers.json")
	if err := os.WriteFile(path, []byte(sample), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestReadAndLabels(t *testing.T) {
	st, err := readState(writeSample(t))
	if err != nil {
		t.Fatal(err)
	}
	a, b := st.Timers[0], st.Timers[1]
	if a.Label != "ABC-1" || a.Summary != "Relaunch" || !a.Running() {
		t.Fatalf("a: %+v", a)
	}
	if b.Label != "Weekly" || b.Summary != "Planung" || b.Running() || b.Elapsed(0) != 2*time.Minute {
		t.Fatalf("b: %+v elapsed %v", b, b.Elapsed(0))
	}
}

func TestToggleKeepsUnknownFields(t *testing.T) {
	path := writeSample(t)
	if _, err := change(path, func(st *State, now float64) { st.Toggle("b", now) }); err != nil {
		t.Fatal(err)
	}
	st, _ := readState(path)
	if st.Timers[0].Running() || !st.Timers[1].Running() {
		t.Fatal("single running: a must be paused, b running")
	}
	data, _ := os.ReadFile(path)
	for _, want := range []string{`"future":"kept"`, `"identifier":"P7"`, `"job":"P1"`, `"note":"Planung"`} {
		if !strings.Contains(string(data), want) {
			t.Fatalf("lost %s in %s", want, data)
		}
	}
	// The TypeScript side reads "end" only when set
	var raw struct {
		Timers []struct {
			Segments []map[string]any `json:"segments"`
		} `json:"timers"`
	}
	_ = json.Unmarshal(data, &raw)
	last := raw.Timers[1].Segments[len(raw.Timers[1].Segments)-1]
	if _, has := last["end"]; has {
		t.Fatal("open segment must not have end")
	}
	if _, err := os.Stat(path + ".lock"); err == nil {
		t.Fatal("lock not released")
	}
}

func TestPauseOrResume(t *testing.T) {
	path := writeSample(t)
	st, _ := change(path, func(st *State, now float64) { st.PauseOrResume(now) })
	if st.Timers[0].Running() || st.Timers[1].Running() {
		t.Fatal("all paused")
	}
	st, _ = change(path, func(st *State, now float64) { st.PauseOrResume(now) })
	if !st.Timers[0].Running() {
		t.Fatal("most recent (a) resumed")
	}
}

func TestStaleLock(t *testing.T) {
	path := writeSample(t)
	_ = os.WriteFile(path+".lock", nil, 0o644)
	old := time.Now().Add(-time.Minute)
	_ = os.Chtimes(path+".lock", old, old)
	if _, err := change(path, func(st *State, now float64) {}); err != nil {
		t.Fatal(err)
	}
}

func TestIconText(t *testing.T) {
	for d, want := range map[time.Duration]string{
		0: "0", 42 * time.Minute: "42", 83 * time.Minute: "1:23", 11 * time.Hour: "11h",
	} {
		if got := iconText(d); got != want {
			t.Errorf("%v: %q, want %q", d, got, want)
		}
	}
}

// PREVIEW_DIR=<dir> go test -run TestPreview writes the icons as PNG to look at.
func TestPreview(t *testing.T) {
	dir := os.Getenv("PREVIEW_DIR")
	if dir == "" {
		t.Skip("PREVIEW_DIR not set")
	}
	for _, size := range []int{16, 24, 32} {
		for i, c := range []struct {
			kind iconKind
			text string
		}{{iconRunning, "7"}, {iconRunning, "42"}, {iconPaused, "1:23"}, {iconIdle, "-"}, {iconRunning, "11h"}} {
			px := renderIcon(size, c.kind, c.text)
			img := image.NewNRGBA(image.Rect(0, 0, size, size))
			for y := 0; y < size; y++ {
				for x := 0; x < size; x++ {
					v := px[y*size+x]
					img.Set(x, y, color.NRGBA{uint8(v >> 16), uint8(v >> 8), uint8(v), uint8(v >> 24)})
				}
			}
			f, _ := os.Create(filepath.Join(dir, strings.ReplaceAll(
				filepath.Base(t.Name())+"-"+string(rune('0'+size/8))+"-"+string(rune('a'+i))+".png", "/", "_")))
			_ = png.Encode(f, img)
			f.Close()
		}
	}
}
