# Reference Measurements & Visual Look

This document details the visual and encoding standards derived from Frame.io turntable reference renders.

---

## 1. Stream & Encoding Measurements

Inspected from `reference/frameio.mp4` via `ffprobe`:

| Property | Measured Value | Blender Mapping |
| :--- | :--- | :--- |
| **Dimensions** | `1080 × 1080` (1:1) | `scene.render.resolution_x = 1080`, `resolution_y = 1080` |
| **Frame Rate** | `6.0 fps` CFR | `scene.render.fps = 6` |
| **Frame Count** | `24 frames` | `scene.frame_start = 1`, `scene.frame_end = 24` |
| **Duration** | `4.000 seconds` | 24 frames / 6 fps |
| **Codec** | `H.264 / AVC` (Main profile, level 3.2) | `ffmpeg.codec = 'H264'`, `constant_rate_factor = 'MEDIUM'` |
| **Pixel Format** | `yuv420p` (tv bt709) | `color_mode = 'RGB'` |
| **GOP Structure** | **1 I-frame** at index 0, **23 P-frames** | `ffmpeg.gopsize = 24`, `ffmpeg.max_b_frames = 0` |
| **Bitrate** | ~550 kbps | Bitrate resulting from CRF/quality preset |
| **File Size** | ~275 KB | Compact and fast-loading |

---

## 2. Animation & Framing Semantics

- **Angular Coverage**: `360°` over 24 frames in `15°` increments ($0^\circ, 15^\circ, 30^\circ, \dots, 345^\circ$).
- **End Frame Handling**: `includeEndFrame = false`. Frame 24 is $345^\circ$, so looping back to Frame 0 ($0^\circ$) is seamless and does not repeat.
- **Direction**: Clockwise (`cw`) as viewed from above with a stationary camera.
- **Framing**:
  - `framingMode = fixed` (computed once from the model's bounding sphere).
  - Target: Bounding-box center translated to `(0, 0, 0)`.
  - Margin: `framingMargin ≈ 1.35` (model fills ~74% of the frame).
  - Elevation: `10°` above horizontal plane.
  - FOV: `35°` perspective lens.

---

## 3. Lighting & Background

- **Background**: Pure black (`#000000`).
- **Lighting Mode**: `studio-dark`
  - Overhead softbox: Area light located directly above model pointing down.
  - Left & Right side strip lights: Vertically elongated area lights angled towards origin.
  - No frontal key light: Highlights model contours with subtle edge reflections against dark background.
