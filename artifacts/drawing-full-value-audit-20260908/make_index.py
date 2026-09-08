"""Build a local, independently playable evidence index from capture manifests."""
import html
import json
from pathlib import Path
from html.parser import HTMLParser

root = Path(__file__).resolve().parent
reference = json.loads((root / 'tv-tool-log.json').read_text(encoding='utf-8-sig'))
before = json.loads((root / 'rtx-tool-log.json').read_text(encoding='utf-8-sig'))[:44]
post_file = root / 'rtx-post-tool-log.json'
post = json.loads(post_file.read_text(encoding='utf-8-sig')) if post_file.exists() else []
def link(name, label='Play'):
    path = root / 'videos' / (name + '.mp4')
    return f'<a href="videos/{html.escape(name)}.mp4">{label}</a>' if path.exists() else 'Unavailable'

rows = []
for tv, rtx in zip(reference, before):
    matched = next((item for item in post if item['slug'] == rtx['slug']), None)
    position_clip = {'long-position': 'rtx-post-long-configured', 'short-position': 'rtx-post-short-configured'}.get(rtx['slug'])
    after_link = link(matched['capture']['name'], 'RTX5 after') if matched else link(position_clip, 'RTX5 after') if position_clip else 'See checks/report'
    tv_link = link(tv['capture']['name'], 'TradingView')
    before_link = link(rtx['capture']['name'], 'RTX5 before')
    if rtx['slug'] == 'ghost-feed':
        tv_link += ' / ' + link('tv-ghost-feed-completion', 'finish')
        before_link += ' / ' + link('rtx-ghost-feed-completion', 'finish')
    rows.append(f'<tr><th>{html.escape(rtx["label"])}</th><td>{tv_link}</td><td>{before_link}</td><td>{after_link}</td></tr>')

detail_names = ['tv-01-live-scale-ohlc', 'tv-02-candle-zoom-baseline', 'tv-position-input-change-verified',
    'rtx-post-long-configured', 'rtx-post-long-scale-verified', 'rtx-post-long-historical-and-stop',
    'rtx-post-long-level-drag', 'rtx-post-short-configured']
details = ''.join(f'<article><h3>{html.escape(name)}</h3><video controls preload="none" src="videos/{name}.mp4"></video></article>' for name in detail_names if (root / 'videos' / (name + '.mp4')).exists())
page = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RTX5 drawing value verification</title>
<style>body{font:16px/1.5 system-ui;margin:32px auto;padding:0 20px;max-width:1200px;background:#101319;color:#e5e9f0}a{color:#82b7ff}table{border-collapse:collapse;width:100%}th,td{padding:9px;text-align:left;border-bottom:1px solid #353c49}video{width:100%;background:#000}article{margin:32px 0}p{max-width:950px}.note{padding:16px;background:#202936;border-radius:8px}</style>
<h1>Drawing value verification — 8 September 2026</h1>
<p>44 tools were placed on TradingView and RTX5 before changes: 17 Trend tools, 15 Gann/Fibonacci tools, and 12 Forecasting/measurement tools. Read <a href="REVIEW.md">the findings, formulas, checks and limits</a>.</p>
<p class="note">These MP4s contain continuously sampled browser screenshots, preserving original timestamps and capture gaps. They are not native 60 fps recordings; the OS pointer is not captured. Crosshairs and drawing previews are visible. Reference and RTX5 use different broker feeds and dates, so absolute market prices should not match.</p>
<h2>Reference and before recordings</h2><table><thead><tr><th>Tool</th><th>Reference</th><th>Before</th><th>After</th></tr></thead><tbody>'''+''.join(rows)+'''</tbody></table><h2>Detailed value and zoom verification</h2>'''+details+'''<p>Contact sheets and original timestamped PNG samples are stored alongside the videos. Incomplete captures and the stale-runtime attempt are excluded from the verification links.</p></html>'''
(root / 'index.html').write_text(page, encoding='utf-8')
class LinkCheck(HTMLParser):
    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key in ('href', 'src'):
                assert (root / value).is_file(), f'Missing evidence link: {value}'
LinkCheck().feed(page)
print(json.dumps({'reference_tools': len(reference), 'before_tools': len(before), 'after_tools': len(post), 'rows': len(rows)}))
