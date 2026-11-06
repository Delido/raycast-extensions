package main

import (
	"fmt"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Pixel font, 5 rows high: digits, ':' and 'h'.
var glyphs = map[rune][]string{
	'0': {"###", "#.#", "#.#", "#.#", "###"},
	'1': {".#.", "##.", ".#.", ".#.", "###"},
	'2': {"###", "..#", "###", "#..", "###"},
	'3': {"###", "..#", ".##", "..#", "###"},
	'4': {"#.#", "#.#", "###", "..#", "..#"},
	'5': {"###", "#..", "###", "..#", "###"},
	'6': {"###", "#..", "###", "#.#", "###"},
	'7': {"###", "..#", ".#.", ".#.", ".#."},
	'8': {"###", "#.#", "###", "#.#", "###"},
	'9': {"###", "#.#", "###", "..#", "###"},
	':': {".", "#", ".", "#", "."},
	'h': {"#..", "#..", "###", "#.#", "#.#"},
	'-': {"...", "...", "###", "...", "..."},
}

type iconKind int

const (
	iconIdle iconKind = iota
	iconRunning
	iconPaused
)

// iconText is what fits on the icon: minutes below an hour, h:mm up to 10 hours, then hours.
func iconText(d time.Duration) string {
	m := int(d.Minutes())
	switch {
	case m < 60:
		return fmt.Sprint(m)
	case m < 600:
		return fmt.Sprintf("%d:%02d", m/60, m%60)
	default:
		return fmt.Sprintf("%dh", m/60)
	}
}

var colors = map[iconKind][3]uint8{
	iconIdle:    {110, 116, 128},
	iconRunning: {22, 163, 74},
	iconPaused:  {234, 128, 12},
}

// renderIcon draws a size×size BGRA image.
func renderIcon(size int, kind iconKind, text string) []uint32 {
	px := make([]uint32, size*size)
	c := colors[kind]
	bg := 0xFF000000 | uint32(c[0])<<16 | uint32(c[1])<<8 | uint32(c[2])
	r := size / 5
	inside := func(x, y int) bool {
		cx, cy := x, y
		if x < r {
			cx = r
		} else if x >= size-r {
			cx = size - r - 1
		}
		if y < r {
			cy = r
		} else if y >= size-r {
			cy = size - r - 1
		}
		dx, dy := x-cx, y-cy
		return dx*dx+dy*dy <= r*r
	}
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			if inside(x, y) {
				px[y*size+x] = bg
			}
		}
	}

	// Text width in font pixels: glyph widths plus one pixel between glyphs
	width := 0
	for i, ch := range text {
		if i > 0 {
			width++
		}
		width += len(glyphs[ch][0])
	}
	if width == 0 {
		return px
	}
	scale := (size - 2) / width
	if hs := (size * 7 / 10) / 5; hs < scale {
		scale = hs
	}
	if scale < 1 {
		scale = 1
	}
	ox := (size - width*scale) / 2
	oy := (size - 5*scale) / 2
	x0 := ox
	for _, ch := range text {
		g := glyphs[ch]
		for gy, row := range g {
			for gx, cell := range row {
				if cell != '#' {
					continue
				}
				for sy := 0; sy < scale; sy++ {
					for sx := 0; sx < scale; sx++ {
						x, y := x0+gx*scale+sx, oy+gy*scale+sy
						if x >= 0 && x < size && y >= 0 && y < size {
							px[y*size+x] = 0xFFFFFFFF
						}
					}
				}
			}
		}
		x0 += (len(g[0]) + 1) * scale
	}
	return px
}

type bitmapInfoHeader struct {
	Size          uint32
	Width         int32
	Height        int32
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}

type iconInfo struct {
	FIcon    int32
	XHotspot uint32
	YHotspot uint32
	HbmMask  windows.Handle
	HbmColor windows.Handle
}

// createIcon turns the pixels into an HICON (32-bit with alpha).
func createIcon(size int, px []uint32) (windows.Handle, error) {
	hdr := bitmapInfoHeader{
		Size:     uint32(unsafe.Sizeof(bitmapInfoHeader{})),
		Width:    int32(size),
		Height:   -int32(size), // top-down
		Planes:   1,
		BitCount: 32,
	}
	var bits unsafe.Pointer
	color, _, err := procCreateDIBSection.Call(0, uintptr(unsafe.Pointer(&hdr)), 0, uintptr(unsafe.Pointer(&bits)), 0, 0)
	if color == 0 {
		return 0, fmt.Errorf("CreateDIBSection: %v", err)
	}
	defer procDeleteObject.Call(color)
	copy(unsafe.Slice((*uint32)(bits), size*size), px)

	// Monochrome AND mask, rows padded to 16 bits; all zero, the alpha channel decides
	maskBits := make([]byte, ((size+15)/16)*2*size)
	mask, _, err := procCreateBitmap.Call(uintptr(size), uintptr(size), 1, 1, uintptr(unsafe.Pointer(&maskBits[0])))
	if mask == 0 {
		return 0, fmt.Errorf("CreateBitmap: %v", err)
	}
	defer procDeleteObject.Call(mask)

	info := iconInfo{FIcon: 1, HbmMask: windows.Handle(mask), HbmColor: windows.Handle(color)}
	icon, _, err := procCreateIconIndirect.Call(uintptr(unsafe.Pointer(&info)))
	if icon == 0 {
		return 0, fmt.Errorf("CreateIconIndirect: %v", err)
	}
	return windows.Handle(icon), nil
}
