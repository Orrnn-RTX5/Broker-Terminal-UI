The final source screenshots show materially different 3px dashed-line spacing between RTX5 and TradingView.

| Source | Median repetition distance | Median colored pixel footprint | Median clear gap |
| --- | ---: | ---: | ---: |
| TradingView 3px dashed | 32.88px | 16.26px | 16.97px |
| TradingView 3px dotted | 11.94px | 4.24px | 7.78px |
| RTX5 3px dashed | 12.12px | 11.17px | 0.91px |

Measurements come from connected blue pixels in a narrow strip along each line. Pixel positions are projected onto the line direction. The reported footprint includes the projected area of each pixel, so antialiasing and screenshot compression make it slightly larger than the nominal drawn segment. Repetition distance is more reliable than the exact edge position.

TradingView's measurements are consistent with nominal 15px dash / 18px gap and 3px dotted mark / 9px gap. Those nominal values are inferences from the raster measurements, not a reading of TradingView's implementation. RTX5's dashed pattern repeats about every 12px and has far less visible empty space.

Nearest-neighbor enlarged crops show apparently flat TradingView dash ends and rounded RTX5 ends. The 3px stroke and screenshot compression prevent an exact cap-API determination from these images alone.

Sources:

- `01-trendline-tradingview-lock/00005.png`, line approximately `(601,235)` to `(889,523)`.
- `01-trendline-tradingview-dotted/00003.png`, line approximately `(583,235)` to `(871,523)`.
- `01-trendline-rtx-style-lock-after/00004.png`, line approximately `(1301,420)` to `(1564,299)`.

Rerun `python artifacts/trend-tools-verification-20260907/measure_line_patterns.py` for the measurements. `line-pattern-measurement.json` contains the mask thresholds and individual components; `*-3px-pixel-crop.png` preserves enlarged raster evidence. No application source was changed for this measurement.
