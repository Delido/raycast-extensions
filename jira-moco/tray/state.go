package main

// The timer state is shared with the Raycast extension (src/lib/timers.ts) through one JSON
// file. Both sides change it only while holding <file>.lock and replace it atomically, and
// the tray keeps every field it doesn't know, so the formats can grow independently.

import (
	"encoding/json"
	"errors"
	"os"
	"sort"
	"strings"
	"time"
)

type Segment struct {
	Start float64  `json:"start"`
	End   *float64 `json:"end,omitempty"`
}

// Timer is the part of a timer the tray reads and changes; Raw keeps the rest.
type Timer struct {
	Raw      map[string]json.RawMessage
	ID       string
	Label    string
	Summary  string
	Segments []Segment
	OffsetMs float64
	Touched  float64
}

type State struct {
	raw           map[string]json.RawMessage
	SingleRunning bool
	Timers        []*Timer
}

func nowMs() float64 { return float64(time.Now().UnixMilli()) }

func (t *Timer) Running() bool {
	return len(t.Segments) > 0 && t.Segments[len(t.Segments)-1].End == nil
}

func (t *Timer) Elapsed(now float64) time.Duration {
	sum := t.OffsetMs
	for _, s := range t.Segments {
		end := now
		if s.End != nil {
			end = *s.End
		}
		sum += end - s.Start
	}
	if sum < 0 {
		sum = 0
	}
	return time.Duration(sum) * time.Millisecond
}

func (t *Timer) pause(now float64) {
	if !t.Running() {
		return
	}
	end := now
	t.Segments[len(t.Segments)-1].End = &end
	t.Touched = now
}

func (t *Timer) resume(now float64) {
	if t.Running() {
		return
	}
	t.Segments = append(t.Segments, Segment{Start: now})
	t.Touched = now
}

func str(raw json.RawMessage) string {
	var s string
	_ = json.Unmarshal(raw, &s)
	return s
}

func parseTimer(raw map[string]json.RawMessage) *Timer {
	t := &Timer{Raw: raw, ID: str(raw["id"])}
	_ = json.Unmarshal(raw["segments"], &t.Segments)
	_ = json.Unmarshal(raw["offsetMs"], &t.OffsetMs)
	_ = json.Unmarshal(raw["touched"], &t.Touched)
	var issue struct {
		Key     string `json:"key"`
		Summary string `json:"summary"`
	}
	if raw["issue"] != nil && json.Unmarshal(raw["issue"], &issue) == nil && issue.Key != "" {
		t.Label, t.Summary = issue.Key, issue.Summary
	} else {
		t.Label = strings.TrimSpace(str(raw["title"]))
		if t.Label == "" {
			t.Label = "Timer without issue"
		}
	}
	if note := strings.TrimSpace(str(raw["note"])); note != "" {
		t.Summary = note
	}
	return t
}

func readState(path string) (*State, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	st := &State{raw: map[string]json.RawMessage{}, SingleRunning: true}
	if err := json.Unmarshal(data, &st.raw); err != nil {
		return nil, err
	}
	if v, ok := st.raw["singleRunning"]; ok {
		_ = json.Unmarshal(v, &st.SingleRunning)
	}
	var timers []map[string]json.RawMessage
	_ = json.Unmarshal(st.raw["timers"], &timers)
	for _, raw := range timers {
		st.Timers = append(st.Timers, parseTimer(raw))
	}
	return st, nil
}

func writeState(path string, st *State) error {
	timers := make([]map[string]json.RawMessage, 0, len(st.Timers))
	for _, t := range st.Timers {
		seg, _ := json.Marshal(t.Segments)
		touched, _ := json.Marshal(t.Touched)
		t.Raw["segments"], t.Raw["touched"] = seg, touched
		timers = append(timers, t.Raw)
	}
	st.raw["timers"], _ = json.Marshal(timers)
	data, err := json.Marshal(st.raw)
	if err != nil {
		return err
	}
	tmp := path + ".tray.tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	// Raycast may be reading the file right now: retry the replace briefly
	for i := 0; ; i++ {
		if err = os.Rename(tmp, path); err == nil || i == 20 {
			return err
		}
		time.Sleep(25 * time.Millisecond)
	}
}

// withLock serializes changes with the extension: <file>.lock is created exclusively,
// a lock older than 5 s is considered left over from a crash.
func withLock(path string, fn func() error) error {
	lock := path + ".lock"
	deadline := time.Now().Add(3 * time.Second)
	for {
		f, err := os.OpenFile(lock, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err == nil {
			f.Close()
			break
		}
		if info, statErr := os.Stat(lock); statErr == nil && time.Since(info.ModTime()) > 5*time.Second {
			_ = os.Remove(lock)
			continue
		}
		if time.Now().After(deadline) {
			return errors.New("timer file is locked")
		}
		time.Sleep(20 * time.Millisecond)
	}
	defer os.Remove(lock)
	return fn()
}

// change reads, modifies and writes the state under the lock.
func change(path string, fn func(st *State, now float64)) (*State, error) {
	var st *State
	err := withLock(path, func() error {
		var err error
		if st, err = readState(path); err != nil {
			return err
		}
		fn(st, nowMs())
		return writeState(path, st)
	})
	return st, err
}

// Sorted returns running timers first, then the most recently used.
func (st *State) Sorted() []*Timer {
	list := append([]*Timer(nil), st.Timers...)
	sort.SliceStable(list, func(i, j int) bool {
		if list[i].Running() != list[j].Running() {
			return list[i].Running()
		}
		return list[i].Touched > list[j].Touched
	})
	return list
}

// Toggle pauses a running timer, or resumes it (pausing the others when only one may run).
func (st *State) Toggle(id string, now float64) {
	for _, t := range st.Timers {
		if t.ID != id {
			continue
		}
		if t.Running() {
			t.pause(now)
			return
		}
		if st.SingleRunning {
			for _, o := range st.Timers {
				o.pause(now)
			}
		}
		t.resume(now)
		return
	}
}

// PauseOrResume pauses everything that runs, or resumes the most recently used timer.
func (st *State) PauseOrResume(now float64) {
	any := false
	for _, t := range st.Timers {
		if t.Running() {
			t.pause(now)
			any = true
		}
	}
	if !any && len(st.Timers) > 0 {
		st.Toggle(st.Sorted()[0].ID, now)
	}
}

func (st *State) PauseAll(now float64) {
	for _, t := range st.Timers {
		t.pause(now)
	}
}
