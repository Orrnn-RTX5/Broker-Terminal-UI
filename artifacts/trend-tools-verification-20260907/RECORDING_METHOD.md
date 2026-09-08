These videos contain browser screenshots sampled continuously while native browser actions ran. Sampling intervals vary, with occasional longer gaps; no fixed capture frame rate is claimed. They are not native screen recordings, and the operating-system pointer is not captured. The page-rendered cursor/crosshair can be visible. Per-video source timestamps document the actual sampling intervals.

Each `capture.json` preserves the original timestamps and any capture errors. The MP4 uses variable frame timing and holds each image until the next captured sample. No speedup or invented intermediate motion is applied. When the final sample timestamp equals the capture duration, the MP4 extends by one millisecond so that final sample remains represented.

The current `capture.mjs` sets `complete: true` only after the UI action function finishes successfully. A thrown action error is appended to `errors` with `UI action failed:` and leaves `complete: false`. This is a recorder metadata correction made during this audit: older manifests and videos are preserved, and their `complete: true` may mean only that the sampling loop stopped. Do not retroactively reinterpret those older flags as successful UI actions. Even the new completion flag confirms the action function returned without an exception; visible results and assertions are still required to establish correct behavior.

If the first sample arrives after timestamp zero, the encoder holds that first image over the initial uncaptured interval and retains its original timestamp too. The verification report records this interval as `initial_first_sample_hold_ms` (the Ray Shift baseline starts at 1ms).

Run from the repository root:

```powershell
python artifacts/trend-tools-verification-20260907/encode_captures.py
```

The utility requires FFmpeg, FFprobe, Python and Pillow. It processes every direct child containing `capture.json`, skips unchanged completed outputs, and also accepts selected folder names and `--force`. Normally encode finalized captures. If a stopped partial capture is intentionally encoded for investigation, its report records `capture_complete: false` and its contact sheet says `INCOMPLETE CAPTURE`; successful encoding does not imply the UI check completed.

- `videos/*.mp4`: timestamp-preserving recordings.
- `videos/*.probe.json`: verified source/encoded timestamps, frame count, duration and dimensions.
- `contact-sheets/*.jpg`: representative captured frames labelled by timestamp for visual review.
- `encoding-report.json`: report for the latest invocation.

This recording method demonstrates sampled rendered states. Its temporal resolution and absent OS pointer limit conclusions about pointer appearance, animation smoothness and short-lived interaction states.

Capture interpretation for the Trendline implementation pass:

- `01-trendline-rtx-after-first-anchor` and `01-trendline-rtx-after-complete` are inconclusive: the page retained stale drawing-service code after hot-module replacement (HMR). Keep them as investigation history; do not use them to claim the updated implementation passed or failed.
- `01-trendline-rtx-reloaded-first-anchor` and `01-trendline-rtx-reloaded-complete` were captured after a full reload and are the checks of the updated drawing service.
- `01-trendline-rtx-shift-before`: the newly appearing line is visibly diagonal, approximately `(1040, 180)` to `(1740, 430)` in the last 1920x864 source frame. Only its first endpoint handle is clearly visible; these images establish a diagonal rendered line/preview, not a completed two-handle drawing. The separate selected dashed ascending line is an existing drawing, not this new Shift test.
- `01-trendline-tradingview-shift`: the new selected line is horizontal, approximately `(611, 220)` to `(941, 220)`, with both endpoint handles visible in the final source frame. Its displayed price is `4,417.939` and its anchor time labels are `14:52` and `15:47`.

The two Shift captures show different rendered outcomes. The absent OS pointer and keyboard overlay mean the images alone do not independently prove that Shift was held; the browser interaction log supplies that input evidence.
