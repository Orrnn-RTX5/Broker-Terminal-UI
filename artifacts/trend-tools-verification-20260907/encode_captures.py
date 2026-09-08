"""Encode capture.json browser screenshot streams without changing their timing."""

import argparse
import json
import math
from pathlib import Path
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
METHOD = (
    "Continuously sampled browser screenshots with variable sampling intervals "
    "with possible longer capture gaps. Original timestamps are preserved. "
    "OS pointer is not captured. This is not a native 60 fps screen recording."
)


def run(command, **kwargs):
    return subprocess.run(command, check=True, capture_output=True, text=True, **kwargs)


def concat_path(path):
    return str(path).replace("\\", "/").replace("'", "'\\''")


def sheet(folder, frames, output, complete=None):
    indices = list(range(len(frames)))
    if len(indices) > 24:
        indices = sorted({round(i * (len(frames) - 1) / 23) for i in range(24)})
    width, height, gap, top = 512, 256, 12, 65
    columns = min(3, len(indices))
    rows = math.ceil(len(indices) / columns)
    canvas = Image.new("RGB", (columns * (width + gap) + gap, top + rows * (height + 32 + gap)), "#181b22")
    draw = ImageDraw.Draw(canvas)
    font_file = Path("C:/Windows/Fonts/segoeui.ttf")
    font = ImageFont.truetype(str(font_file), 16) if font_file.exists() else ImageFont.load_default()
    draw.text((gap, 9), folder.name, fill="white", font=font)
    prefix = "INCOMPLETE CAPTURE | " if complete is False else ""
    draw.text((gap, 33), prefix + "Timestamped browser samples | OS pointer not captured", fill="#bcc3cf", font=font)
    for slot, index in enumerate(indices):
        frame = frames[index]
        image = Image.open(folder / frame["file"]).convert("RGB")
        image.thumbnail((width, height), Image.Resampling.LANCZOS)
        x = gap + (slot % columns) * (width + gap)
        y = top + (slot // columns) * (height + 32 + gap)
        canvas.paste(image, (x, y))
        draw.text((x, y + height + 4), f'{index + 1}/{len(frames)}  {frame["ms"] / 1000:.3f}s', fill="white", font=font)
    canvas.save(output, quality=90)


def encode(folder, force=False):
    capture_path = folder / "capture.json"
    capture = json.loads(capture_path.read_text(encoding="utf-8-sig"))
    frames = capture["frames"]
    if not frames:
        raise ValueError(f"No frames: {folder.name}")
    times = [int(frame["ms"]) for frame in frames]
    if times[0] < 0 or any(b <= a for a, b in zip(times, times[1:])):
        raise ValueError(f"Expected nonnegative strictly increasing timestamps: {folder.name}")
    for frame in frames:
        source = (folder / frame["file"]).resolve()
        if not source.is_relative_to(folder.resolve()) or not source.is_file():
            raise ValueError(f"Invalid frame path in {folder.name}")
    requested_end_ms = max(int(capture["durationMs"]), times[-1] + 1)
    video_dir = ROOT / "videos"
    sheet_dir = ROOT / "contact-sheets"
    video_dir.mkdir(exist_ok=True)
    sheet_dir.mkdir(exist_ok=True)
    output = video_dir / f"{folder.name}.mp4"
    contact = sheet_dir / f"{folder.name}.jpg"
    probe_output = video_dir / f"{folder.name}.probe.json"
    latest_source = max([capture_path.stat().st_mtime] + [(folder / f["file"]).stat().st_mtime for f in frames])
    if not force and output.exists() and probe_output.exists() and contact.exists() and min(output.stat().st_mtime, probe_output.stat().st_mtime, contact.stat().st_mtime) > latest_source:
        return json.loads(probe_output.read_text(encoding="utf-8"))

    entries = [(folder / frame["file"], time) for frame, time in zip(frames, times)]
    if times[0] > 0:
        # Hold the first sample over the uncaptured initial interval while
        # retaining every original timestamp rather than shifting the stream.
        entries.insert(0, (folder / frames[0]["file"], 0))
    # A final repeated sample gives the last image its requested hold time.
    # A capture whose last sample equals duration needs one extra millisecond
    # for that final visible sample to be represented in the MP4 container.
    if requested_end_ms > times[-1] + 1:
        entries.append((folder / frames[-1]["file"], requested_end_ms - 1))
    manifest = folder / "frames.ffconcat"
    lines = ["ffconcat version 1.0"]
    for index, (path, time) in enumerate(entries):
        next_time = entries[index + 1][1] if index + 1 < len(entries) else requested_end_ms
        lines.extend([f"file '{concat_path(path.resolve())}'", "option framerate 1000", f"duration {(next_time - time) / 1000:.6f}"])
    manifest.write_text("\n".join(lines) + "\n", encoding="utf-8")
    run([
        shutil.which("ffmpeg") or "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "concat", "-safe", "0", "-i", str(manifest),
        "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-fps_mode", "vfr",
        "-enc_time_base", "1:1000", "-c:v", "libx264", "-preset", "fast",
        "-crf", "19", "-bf", "0", "-pix_fmt", "yuv420p", "-video_track_timescale", "1000",
        "-movflags", "+faststart", "-metadata", f"comment={METHOD}", str(output),
    ])
    probe = json.loads(run([
        shutil.which("ffprobe") or "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,nb_frames,duration,time_base:frame=best_effort_timestamp_time,pkt_duration_time",
        "-show_frames", "-of", "json", str(output),
    ]).stdout)
    stream = probe["streams"][0]
    encoded_times = [round(float(frame["best_effort_timestamp_time"]) * 1000) for frame in probe["frames"]]
    expected_times = [time for _, time in entries]
    duration = float(stream["duration"])
    if encoded_times != expected_times or abs(duration * 1000 - requested_end_ms) > 2:
        raise ValueError(f"Timing mismatch: {folder.name}: {encoded_times}, duration={duration}")
    sheet(folder, frames, contact, capture.get("complete"))
    report = {
        "capture": folder.name, "method": METHOD,
        "source_frames": len(frames), "encoded_frames": int(stream["nb_frames"]),
        "source_duration_ms": capture["durationMs"], "encoded_duration_ms": round(duration * 1000),
        "width": stream["width"], "height": stream["height"],
        "source_timestamps_ms": times, "encoded_timestamps_ms": encoded_times,
        "initial_first_sample_hold_ms": times[0],
        "timing_verified": True, "video": str(output.relative_to(ROOT)),
        "capture_complete": capture.get("complete"),
        "contact_sheet": str(contact.relative_to(ROOT)), "capture_errors": capture.get("errors", []),
    }
    probe_output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folders", nargs="*", help="Capture folder names; default: every direct child with capture.json")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    folders = [ROOT / name for name in args.folders] if args.folders else sorted(p.parent for p in ROOT.glob("*/capture.json"))
    reports = [encode(folder, args.force) for folder in folders]
    for report in reports:
        suffix = "; INCOMPLETE CAPTURE" if report.get("capture_complete") is False else ""
        print(f'{report["capture"]}: {report["encoded_frames"]} frames, {report["encoded_duration_ms"] / 1000:.3f}s, {report["width"]}x{report["height"]}; timestamps verified{suffix}')
    (ROOT / "encoding-report.json").write_text(json.dumps(reports, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
