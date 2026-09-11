"""Package the browser-frame captures into one short reference clip per tool."""
from pathlib import Path
import json
import subprocess

root = Path(__file__).resolve().parent
output = root / 'videos'
output.mkdir(exist_ok=True)
sources = {
    '01-text': ['01-text-browser'],
    '02-note': ['02-note-reference', '02-note-edit-reference', '02-note-content-reference'],
    '03-price-note': ['03-price-note-reference', '03-price-note-edit'],
    '04-pin': ['04-pin-reference', '04-pin-content-reference'],
    '05-table': ['05-table-placement-reference', '05-table-edit-reference', '05-table-cells-reference'],
    '06-callout': ['06-callout-reference', '06-callout-content-reference'],
    '07-comment': ['07-comment-reference', '07-comment-content-reference'],
    '08-price-label': ['08-price-label-reference', '08-price-label-drag-reference'],
    '09-signpost': ['09-signpost-reference', '09-signpost-content-reference'],
    '10-flag': ['10-flag-reference'],
    '11-image': ['11-image-reference', '11-image-dialog-reference'],
    '12-post': ['12-post-dialog-reference', '12-post-link-reference', '12-post-placement-reference'],
    '13-idea': ['13-idea-dialog-reference', '13-idea-link-reference', '13-idea-scale-reference', '13-idea-visible-reference'],
}
manifest = []
for tool, segments in sources.items():
    frames = []
    for segment in segments:
        captured = json.loads((root / segment / 'capture.json').read_text())
        for index, frame in enumerate(captured):
            end = captured[index + 1]['time'] if index + 1 < len(captured) else frame['time'] + 600
            frames.append(((root / segment / frame['file']).as_posix(), (end - frame['time']) / 1000))
    concat = output / f'{tool}-reference.ffconcat'
    concat.write_text('ffconcat version 1.0\n' + ''.join(f"file '{file}'\nduration {duration}\n" for file, duration in frames) + f"file '{frames[-1][0]}'\n")
    video = output / f'{tool}-reference.mp4'
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-safe', '0', '-i', str(concat), '-vf', 'scale=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', str(video)], check=True)
    manifest.append({'tool': tool, 'file': video.name, 'seconds': round(sum(duration for _, duration in frames), 2), 'frames': len(frames), 'segments': segments})
(output / 'manifest.json').write_text(json.dumps(manifest, indent=2))
print(json.dumps(manifest, indent=2))
