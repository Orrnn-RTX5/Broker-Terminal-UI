import fs from 'node:fs/promises';
import path from 'node:path';

// No parallel browser calls: each sampled frame follows a completed UI action.
export async function createSequence(root, name, tab) {
  const folder = path.join(root, name);
  await fs.mkdir(folder, { recursive: true });
  const start = Date.now(), frames = [];
  const manifest = async (complete) => fs.writeFile(path.join(folder, 'capture.json'), JSON.stringify({
    method: 'Sequential browser screenshots before and after UI actions; intervening motion is not captured',
    complete, durationMs: Date.now() - start + (complete ? 1000 : 0), frames, errors: [],
  }, null, 2));
  const shot = async () => {
    const bytes = await tab.screenshot({});
    const frame = { file: String(frames.length).padStart(5, '0') + '.png', ms: Date.now() - start };
    await fs.writeFile(path.join(folder, frame.file), bytes);
    frames.push(frame);
    await manifest(false);
    return bytes;
  };
  return { shot, finish: async () => { await shot(); await manifest(true); return { folder, frames: frames.length }; } };
}
