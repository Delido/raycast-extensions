// mtr-probe sends ICMP echo requests with increasing TTL (like WinMTR) and
// prints one JSON object per line. It uses the Windows ICMP API, so it needs
// no administrator rights. The Raycast extension starts it as a child process.
//
//	mtr-probe -target example.com [-rounds 0] [-interval 1000] [-timeout 1000] [-maxhops 30] [-size 64] [-stagger 15] [-nodns]
//
// Output lines:
//
//	{"type":"start","target":"example.com","ip":"93.184.216.34"}
//	{"type":"round","round":1,"time":1700000000000,"hops":[{"ttl":1,"addr":"192.168.1.1","rtt":1,"status":"ttl-expired"},...]}
//	{"type":"host","addr":"192.168.1.1","name":"router.local"}
//	{"type":"error","message":"..."}
package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"os"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

var (
	iphlpapi            = syscall.NewLazyDLL("iphlpapi.dll")
	procIcmpCreateFile  = iphlpapi.NewProc("IcmpCreateFile")
	procIcmpCloseHandle = iphlpapi.NewProc("IcmpCloseHandle")
	procIcmpSendEcho    = iphlpapi.NewProc("IcmpSendEcho")
)

// IP_OPTION_INFORMATION (64-bit layout)
type ipOptionInformation struct {
	Ttl         uint8
	Tos         uint8
	Flags       uint8
	OptionsSize uint8
	OptionsData uintptr
}

const (
	ipSuccess            = 0
	ipDestNetUnreachable = 11002
	ipDestHostUnreach    = 11003
	ipDestProtUnreach    = 11004
	ipDestPortUnreach    = 11005
	ipReqTimedOut        = 11010
	ipTTLExpiredTransit  = 11013
	ipTTLExpiredReassem  = 11014
)

type Hop struct {
	TTL    int     `json:"ttl"`
	Addr   string  `json:"addr,omitempty"`
	RTT    *uint32 `json:"rtt,omitempty"`
	Status string  `json:"status"`
}

var out = json.NewEncoder(os.Stdout)
var outMu sync.Mutex

func emit(v any) {
	outMu.Lock()
	defer outMu.Unlock()
	_ = out.Encode(v)
}

func fail(format string, args ...any) {
	emit(map[string]string{"type": "error", "message": fmt.Sprintf(format, args...)})
	os.Exit(1)
}

func statusName(code uint32) string {
	switch code {
	case ipSuccess:
		return "reply"
	case ipTTLExpiredTransit, ipTTLExpiredReassem:
		return "ttl-expired"
	case ipReqTimedOut:
		return "timeout"
	case ipDestNetUnreachable, ipDestHostUnreach, ipDestProtUnreach, ipDestPortUnreach:
		return "unreachable"
	default:
		return fmt.Sprintf("error-%d", code)
	}
}

// probe sends one echo request with the given TTL.
func probe(dest uint32, ttl int, payload []byte, timeout time.Duration) Hop {
	handle, _, err := procIcmpCreateFile.Call()
	if handle == 0 || handle == uintptr(syscall.InvalidHandle) {
		return Hop{TTL: ttl, Status: "error: " + err.Error()}
	}
	defer procIcmpCloseHandle.Call(handle)

	opts := ipOptionInformation{Ttl: uint8(ttl)}
	reply := make([]byte, 1024+len(payload))
	n, _, callErr := procIcmpSendEcho.Call(
		handle,
		uintptr(dest),
		uintptr(unsafe.Pointer(&payload[0])),
		uintptr(len(payload)),
		uintptr(unsafe.Pointer(&opts)),
		uintptr(unsafe.Pointer(&reply[0])),
		uintptr(len(reply)),
		uintptr(timeout.Milliseconds()),
	)

	// ICMP_ECHO_REPLY starts with Address (in_addr), Status, RoundTripTime.
	addr := binary.LittleEndian.Uint32(reply[0:4])
	status := binary.LittleEndian.Uint32(reply[4:8])
	rtt := binary.LittleEndian.Uint32(reply[8:12])
	if n == 0 {
		code := uint32(0)
		if errno, ok := callErr.(syscall.Errno); ok {
			code = uint32(errno)
		}
		if addr == 0 || code == ipReqTimedOut {
			if code == 0 {
				code = ipReqTimedOut
			}
			return Hop{TTL: ttl, Status: statusName(code)}
		}
		status = code
	}
	hop := Hop{TTL: ttl, Status: statusName(status)}
	if addr != 0 {
		hop.Addr = net.IPv4(byte(addr), byte(addr>>8), byte(addr>>16), byte(addr>>24)).String()
		hop.RTT = &rtt
	}
	return hop
}

func resolve(target string) (net.IP, uint32) {
	ip := net.ParseIP(target)
	if ip == nil {
		ips, err := net.LookupIP(target)
		if err != nil {
			fail("Cannot resolve %s: %v", target, err)
		}
		for _, candidate := range ips {
			if candidate.To4() != nil {
				ip = candidate
				break
			}
		}
		if ip == nil {
			fail("%s has no IPv4 address (IPv6 is not supported yet)", target)
		}
	}
	v4 := ip.To4()
	if v4 == nil {
		fail("%s is not an IPv4 address (IPv6 is not supported yet)", target)
	}
	return v4, uint32(v4[0]) | uint32(v4[1])<<8 | uint32(v4[2])<<16 | uint32(v4[3])<<24
}

func main() {
	target := flag.String("target", "", "host name or IPv4 address")
	rounds := flag.Int("rounds", 0, "number of rounds, 0 = until killed")
	interval := flag.Int("interval", 1000, "ms between round starts")
	timeoutMs := flag.Int("timeout", 1000, "ms to wait for each reply")
	maxHops := flag.Int("maxhops", 30, "maximum TTL")
	size := flag.Int("size", 64, "payload size in bytes")
	noDNS := flag.Bool("nodns", false, "skip reverse DNS lookups")
	stagger := flag.Int("stagger", 15, "ms between the probes of one round (routers rate-limit bursts)")
	flag.Parse()

	*target = strings.TrimSpace(*target)
	if *target == "" {
		fail("No target given")
	}
	if *maxHops < 1 || *maxHops > 64 {
		fail("maxhops must be between 1 and 64")
	}
	ip, dest := resolve(*target)
	emit(map[string]string{"type": "start", "target": *target, "ip": ip.String()})

	payload := make([]byte, max(*size, 1))
	for i := range payload {
		payload[i] = byte('a' + i%26)
	}
	timeout := time.Duration(*timeoutMs) * time.Millisecond

	resolved := map[string]bool{}
	lookup := func(addr string) {
		if *noDNS || resolved[addr] {
			return
		}
		resolved[addr] = true
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			names, err := net.DefaultResolver.LookupAddr(ctx, addr)
			if err == nil && len(names) > 0 {
				emit(map[string]string{"type": "host", "addr": addr, "name": strings.TrimSuffix(names[0], ".")})
			}
		}()
	}

	destHop := 0    // TTL at which the target answered last time, 0 = unknown
	lastAnswer := 0 // highest TTL that answered in the previous round
	for round := 1; *rounds == 0 || round <= *rounds; round++ {
		start := time.Now()
		limit := *maxHops
		if destHop > 0 {
			limit = min(destHop+2, *maxHops)
		} else if round > 1 && lastAnswer > 0 {
			// Target not reached: don't keep probing 30 silent hops.
			limit = min(lastAnswer+5, *maxHops)
		}

		hops := make([]Hop, limit)
		var wg sync.WaitGroup
		for ttl := 1; ttl <= limit; ttl++ {
			wg.Add(1)
			go func(ttl int) {
				defer wg.Done()
				hops[ttl-1] = probe(dest, ttl, payload, timeout)
			}(ttl)
			if *stagger > 0 && ttl < limit {
				time.Sleep(time.Duration(*stagger) * time.Millisecond)
			}
		}
		wg.Wait()

		lastAnswer = 0
		for _, hop := range hops {
			if hop.Addr != "" {
				lastAnswer = hop.TTL
			}
		}

		// Cut the list at the first hop where the target itself answered.
		reached := 0
		for _, hop := range hops {
			if hop.Addr == ip.String() && (hop.Status == "reply" || hop.Status == "unreachable") {
				reached = hop.TTL
				break
			}
		}
		if reached > 0 {
			hops = hops[:reached]
			destHop = reached
		} else if destHop > 0 && limit < *maxHops {
			destHop = 0 // route got longer or target is down: search the full range next time
		}
		for _, hop := range hops {
			if hop.Addr != "" {
				lookup(hop.Addr)
			}
		}
		emit(map[string]any{"type": "round", "round": round, "time": start.UnixMilli(), "hops": hops})

		if *rounds != 0 && round == *rounds {
			break
		}
		if wait := time.Duration(*interval)*time.Millisecond - time.Since(start); wait > 0 {
			time.Sleep(wait)
		}
	}
	// Give pending reverse lookups a moment to finish.
	time.Sleep(300 * time.Millisecond)
}
