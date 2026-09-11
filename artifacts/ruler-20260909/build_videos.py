from pathlib import Path
import json
import subprocess

root = Path(__file__).resolve().parent
invalid_captures = {'06-local-down', '07-local-down-verified', '08-local-up-drag', '09-local-dismiss', '10-local-reverse', '11-local-shift-click'}
for folder in sorted(root.iterdir()):
    if folder.name in invalid_captures:
        continue
    capture = folder / 'capture.json'
    if not capture.exists():
        continue
    frames = json.loads(capture.read_text())
    concat = folder / 'frames.ffconcat'
    content = 'ffconcat version 1.0\n'
    for index, frame in enumerate(frames):
        duration = ((frames[index + 1]['time'] - frame['time']) / 1000) if index + 1 < len(frames) else 0.7
        content += f"file '{(folder / frame['file']).as_posix()}'\nduration {duration}\n"
    content += f"file '{(folder / frames[-1]['file']).as_posix()}'\n"
    concat.write_text(content)
    video = root / (folder.name + '.mp4')
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-safe', '0', '-i', str(concat), '-vf', 'scale=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', str(video)], check=True)
    seconds = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', str(video)]))
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(video), '-vf', f'fps={9 / seconds},scale=640:-1,tile=3x3', '-frames:v', '1', '-y', str(root / (folder.name + '-review.jpg'))], check=True)
    print(video.name, len(frames), 'source frames')
