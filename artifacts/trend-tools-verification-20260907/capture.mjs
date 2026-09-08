import fs from 'node:fs/promises';
import path from 'node:path';

// Called from the approved browser runtime. Samples continuously while native
// tab.cua / locator actions run; does not drive or inspect the browser itself.
export function createRecorder(root) {
  return async function record(tab, name, actions) {
    const dir = path.join(root, name);
    await fs.mkdir(dir, { recursive: true });
    const frames = [], errors = [], start = Date.now();
    let done = false, completed = false;
    const manifest = () => fs.writeFile(path.join(dir, 'capture.json'), JSON.stringify({
      method: 'Continuously sampled browser screenshots during native UI actions; OS pointer not captured',
      durationMs: Date.now() - start, complete: completed, frames, errors,
    }, null, 2));
    const sample = async () => {
      const ms = Date.now() - start;
      const bytes = await tab.screenshot({});
      const file = String(frames.length).padStart(5, '0') + '.png';
      await fs.writeFile(path.join(dir, file), bytes);
      frames.push({ file, ms });
      await manifest();
    };
    const capture = (async () => {
      while (!done) {
        try { await sample(); } catch (e) { errors.push(String(e)); break; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    })();
    try {
      await actions();
      // Record a one-second final hold so playback includes the settled state.
      await new Promise(resolve => setTimeout(resolve, 1000));
      completed = true;
    }
    catch (error) { errors.push(`UI action failed: ${String(error)}`); throw error; }
    finally { done = true; await capture; await sample(); await manifest(); }
    return { name, frames: frames.length, durationMs: Date.now() - start, errors };
  };
}
