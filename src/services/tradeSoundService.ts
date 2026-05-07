/**
 * Trade Sound Service — Professional Audio Tones
 *
 * Uses the Web Audio API to synthesise real trading platform sounds
 * entirely in code — no files, no TTS, no external dependencies.
 *
 * Sound design inspired by MT5 / Bloomberg terminal behaviour:
 *
 *  ✅ ORDER FILLED   — rich multi-note ascending chime  (positive, satisfying)
 *  ⚠️ MARGIN ERROR  — triple pulsed warning beep       (urgent, mid-tone)
 *  ❌ ORDER FAILED   — descending two-note error buzz   (negative, sharp)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

type OscType = OscillatorType;

interface ToneConfig {
  frequency: number;       // Hz
  type: OscType;           // waveform
  duration: number;        // ms — total note duration
  attack: number;          // ms — fade-in
  release: number;         // ms — fade-out
  gain: number;            // 0–1 peak volume
  startDelay?: number;     // ms — delay before this note plays
}

// ─── TradeSoundService ────────────────────────────────────────────────────────

class TradeSoundService {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private activeNodes: Set<AudioNode> = new Set();

  // Global volume (0–1)
  private readonly MASTER_VOLUME = 0.75;

  // ─── AudioContext (lazy-init, respects browser autoplay policy) ────────────

  private getCtx(): AudioContext | null {
    try {
      if (!this.ctx || this.ctx.state === 'closed') {
        this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.MASTER_VOLUME;
        this.masterGain.connect(this.ctx.destination);
      }

      // Resume if suspended (browser autoplay policy)
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }

      return this.ctx;
    } catch {
      return null;
    }
  }

  // ─── Core: play a single tone with smooth envelope ────────────────────────

  private playTone(ctx: AudioContext, master: GainNode, config: ToneConfig): void {
    const { frequency, type, duration, attack, release, gain, startDelay = 0 } = config;

    const now = ctx.currentTime + startDelay / 1000;
    const durationSec = duration / 1000;
    const attackSec   = attack  / 1000;
    const releaseSec  = release / 1000;

    // Oscillator
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);

    // Gain envelope (prevents clicks)
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(gain, now + attackSec);
    gainNode.gain.setValueAtTime(gain, now + durationSec - releaseSec);
    gainNode.gain.linearRampToValueAtTime(0, now + durationSec);

    osc.connect(gainNode);
    gainNode.connect(master);

    osc.start(now);
    osc.stop(now + durationSec + 0.01);

    this.activeNodes.add(osc);
    osc.onended = () => this.activeNodes.delete(osc);
  }

  // ─── Stop all currently playing sounds ───────────────────────────────────

  private stopAll(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    // Rapid fade-out to avoid click artifacts
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
    this.masterGain.gain.linearRampToValueAtTime(0, now + 0.02);

    setTimeout(() => {
      if (!this.ctx || !this.masterGain) return;
      this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.masterGain.gain.setValueAtTime(this.MASTER_VOLUME, this.ctx.currentTime);
    }, 30);
  }

  // ─── Sound Recipes ────────────────────────────────────────────────────────

  /**
   * ✅ ORDER FILLED — Rich Professional Chime
   * Multi-layered ascending chord: C5 → E5 → G5 with harmonics
   * Full, satisfying, unmistakably positive. Bloomberg/MT5 inspired.
   *
   * Used by: onOrderExecuted(), onOrderClosed()
   */
  private playOrderFilled(): void {
    const ctx = this.getCtx();
    if (!ctx || !this.masterGain) return;
    this.stopAll();

    const notes: ToneConfig[] = [
      // ── Layer 1: Primary ascending chord ──
      // Note 1: C5 (523 Hz) — bright start
      { frequency: 523.25, type: 'sine', duration: 180, attack: 5,  release: 80,  gain: 0.7,  startDelay: 0   },
      // Note 2: E5 (659 Hz) — major third, builds positivity
      { frequency: 659.25, type: 'sine', duration: 200, attack: 5,  release: 90,  gain: 0.75, startDelay: 100 },
      // Note 3: G5 (783 Hz) — perfect fifth, resolves the chord
      { frequency: 783.99, type: 'sine', duration: 300, attack: 5,  release: 140, gain: 0.8,  startDelay: 200 },

      // ── Layer 2: Sub-harmonics (warmth / body) ──
      { frequency: 261.63, type: 'sine', duration: 350, attack: 10, release: 160, gain: 0.15, startDelay: 0   },
      { frequency: 329.63, type: 'sine', duration: 300, attack: 10, release: 140, gain: 0.12, startDelay: 100 },

      // ── Layer 3: Shimmer / sparkle (triangle wave, subtle high octave) ──
      { frequency: 1046.5, type: 'triangle', duration: 250, attack: 8,  release: 120, gain: 0.08, startDelay: 200 },

      // ── Layer 4: Resonance tail (sustained hum for richness) ──
      { frequency: 392.0,  type: 'sine', duration: 500, attack: 20, release: 300, gain: 0.10, startDelay: 150 },
    ];

    notes.forEach(n => this.playTone(ctx, this.masterGain!, n));
  }

  /**
   * ⚠️ INSUFFICIENT MARGIN
   * Three pulsed mid-frequency warning beeps — A4 (880 Hz)
   * Fast, rhythmic, urgent. Classic "warning" pattern.
   *
   * Used by: onMarginError()
   */
  private playMarginError(): void {
    const ctx = this.getCtx();
    if (!ctx || !this.masterGain) return;
    this.stopAll();

    const PULSE_GAP = 160; // ms between beep starts
    const BEEP: Omit<ToneConfig, 'startDelay'> = {
      frequency: 880, type: 'square', duration: 100, attack: 3, release: 30, gain: 0.35,
    };

    [0, PULSE_GAP, PULSE_GAP * 2].forEach(delay => {
      this.playTone(ctx, this.masterGain!, { ...BEEP, startDelay: delay });
    });
  }

  /**
   * ❌ ORDER FAILED / REJECTED
   * Descending two-note buzz — A4 → E4
   * Low, sharp, conveys rejection without being jarring.
   *
   * Used by: onOrderRejected()
   */
  private playOrderFailed(): void {
    const ctx = this.getCtx();
    if (!ctx || !this.masterGain) return;
    this.stopAll();

    const notes: ToneConfig[] = [
      // Note 1: A4 (440 Hz) — sawtooth for edge
      { frequency: 440, type: 'sawtooth', duration: 110, attack: 4,  release: 50, gain: 0.45, startDelay: 0   },
      // Note 2: E4 (330 Hz) — drops, resolves negatively
      { frequency: 329.6, type: 'sawtooth', duration: 180, attack: 4,  release: 80, gain: 0.5,  startDelay: 100 },
    ];

    notes.forEach(n => this.playTone(ctx, this.masterGain!, n));
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /** Trade order successfully executed (buy/sell filled). */
  onOrderExecuted(): void {
    this.playOrderFilled();
  }

  /** Position successfully closed. Dedicated close sound is handled via playSystemSound. */
  onOrderClosed(): void {
    // Intentionally empty. We no longer play the entry chime here.
  }

  /** Trade rejected due to insufficient margin (MT5 retcode 10019). */
  onMarginError(): void {
    this.playMarginError();
  }

  /** Trade rejected for any other reason. */
  onOrderRejected(): void {
    this.playOrderFailed();
  }

  /** Immediately silence all sounds. */
  cancel(): void {
    this.stopAll();
  }

  /** True if Web Audio API is available in this environment. */
  get isSupported(): boolean {
    return typeof window !== 'undefined' &&
      ('AudioContext' in window || 'webkitAudioContext' in (window as any));
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const tradeSoundService = new TradeSoundService();
export default tradeSoundService;
