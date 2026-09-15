from pathlib import Path
import json, subprocess
root=Path('artifacts/fib-time-zone-20260912')
for name in ['tradingview-placement','rtx-before','rtx-after']:
    folder=root/name
    frames=json.loads((folder/'capture.json').read_text())
    manifest='ffconcat version 1.0\n'
    for frame in frames:
        manifest+=f"file '{(folder/frame['file']).resolve().as_posix()}'\nduration 1.5\n"
    manifest+=f"file '{(folder/frames[-1]['file']).resolve().as_posix()}'\n"
    (folder/'frames.ffconcat').write_text(manifest)
    video=root/(name+'.mp4')
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-safe','0','-i',str(folder/'frames.ffconcat'),'-vf','scale=ceil(iw/2)*2:ceil(ih/2)*2','-r','12','-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-movflags','+faststart','-y',str(video)],check=True)
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-i',str(video),'-vf','fps=0.6666667,scale=640:-1,tile=3x5','-frames:v','1','-y',str(root/(name+'-review.jpg'))],check=True)
    print(str(video),len(frames),'sampled frames')

