/**
 * AURA staff chime — a short two-tone cue synthesised with the Web Audio API.
 * No audio assets, no dependency: two oscillators, modest gain, ~180 ms total.
 */
let context: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!context) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      context = new Ctor();
    }
    // Browsers suspend audio until a gesture; a running staff session qualifies.
    if (context.state === "suspended") void context.resume();
    return context;
  } catch {
    return null;
  }
}

/** Play a discreet "new request" cue. Silently does nothing if audio is blocked. */
export function playStaffChime(): void {
  const ctx = getContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const tones = [
    { frequency: 880, start: 0, duration: 0.09 },
    { frequency: 1320, start: 0.11, duration: 0.1 },
  ];
  for (const tone of tones) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = tone.frequency;
    const start = now + tone.start;
    const end = start + tone.duration;
    // Soft attack/release so the cue reads as a chime, not a click.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.09, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  }
}
