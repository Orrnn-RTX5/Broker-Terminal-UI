let audioCtx: AudioContext | null = null;

const initAudio = () => {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
    }
    return audioCtx;
};

export const playSystemSound = (type: 'open' | 'close' | 'login' | 'welcome') => {
    try {
        if (type === 'open') {
            // Keep the exact same buy/sell mouse click sound as requested
            const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZUQ0PVKvn77BfGAg+ltvy0H0pBSl+zPLaizsIGGS56+OZUQ4OUKXi8LaHMwU2jdXzz38qBSl9y/Lai0YIDVmw6+6cUw8LTqPf87acPQU0itbyynspBCt7y+/aijsIGWO56+OaUA0OUKXi8LWHMwU2jdXzz38qBSl9y/Lai0YIDVmw6+6cUw8LTqPf87acPQU0itbyynspBCt7y+/aijsI');
            audio.volume = 0.3;
            audio.play().catch(() => {});
            return;
        }

        const ctx = initAudio();
        const now = ctx.currentTime;
        const gain = ctx.createGain();
        gain.connect(ctx.destination);

        if (type === 'close') {
            // MT5 Close sound: Sharp, distinct metallic/paper click (double pulse)
            const osc = ctx.createOscillator();
            osc.type = 'square';
            osc.connect(gain);
            
            osc.frequency.setValueAtTime(600, now);
            osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);
            
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            
            osc.start(now);
            osc.stop(now + 0.1);
            
            // Second swift thud
            const osc2 = ctx.createOscillator();
            osc2.type = 'triangle';
            osc2.connect(gain);
            osc2.frequency.setValueAtTime(300, now + 0.12);
            osc2.frequency.exponentialRampToValueAtTime(50, now + 0.2);
            
            gain.gain.setValueAtTime(0.2, now + 0.12);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
            
            osc2.start(now + 0.12);
            osc2.stop(now + 0.2);
        } else if (type === 'login') {
            // MT5 Login: Happy, bright ascending double-chime (Connect sound)
            const osc1 = ctx.createOscillator();
            const osc2 = ctx.createOscillator();
            osc1.type = 'sine';
            osc2.type = 'sine';
            osc1.connect(gain);
            osc2.connect(gain);

            // First note (C5)
            osc1.frequency.setValueAtTime(523.25, now);
            // Second note (G5) pops in quickly
            osc2.frequency.setValueAtTime(783.99, now + 0.1);

            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.2, now + 0.05);
            gain.gain.setValueAtTime(0.2, now + 0.15);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);

            osc1.start(now); osc1.stop(now + 0.5);
            osc2.start(now + 0.1); osc2.stop(now + 0.5);
        } else if (type === 'welcome') {
            // Welcome RTX: A soft, premium startup chime (lush chord swell)
            const osc1 = ctx.createOscillator();
            const osc2 = ctx.createOscillator();
            const osc3 = ctx.createOscillator();
            
            osc1.type = 'triangle';
            osc2.type = 'triangle';
            osc3.type = 'sine';
            
            osc1.connect(gain);
            osc2.connect(gain);
            osc3.connect(gain);

            osc1.frequency.setValueAtTime(440.00, now); // A4
            osc2.frequency.setValueAtTime(554.37, now); // C#5
            osc3.frequency.setValueAtTime(659.25, now); // E5

            // Slow fade in and long fade out
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.15, now + 0.2);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 1.5);

            osc1.start(now); osc1.stop(now + 1.5);
            osc2.start(now); osc2.stop(now + 1.5);
            osc3.start(now); osc3.stop(now + 1.5);
        }
    } catch (e) {
        console.warn('System sound playback skipped/blocked by browser policy without interaction.', e);
    }
};
