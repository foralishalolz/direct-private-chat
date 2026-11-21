"use client";

let context: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!context) context = new Ctor();
  if (context.state === "suspended") void context.resume();
  return context;
}

interface ToneStep {
  frequency: number;
  start: number;
  duration: number;
  gain?: number;
  type?: OscillatorType;
}

function play(steps: ToneStep[]) {
  const ctx = getContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  for (const step of steps) {
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = step.type ?? "sine";
    oscillator.frequency.setValueAtTime(step.frequency, now + step.start);

    const peak = step.gain ?? 0.08;
    gainNode.gain.setValueAtTime(0.0001, now + step.start);
    gainNode.gain.exponentialRampToValueAtTime(peak, now + step.start + 0.012);
    gainNode.gain.exponentialRampToValueAtTime(
      0.0001,
      now + step.start + step.duration,
    );

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start(now + step.start);
    oscillator.stop(now + step.start + step.duration + 0.02);
  }
}

/** Soft two-note "pop" for an incoming message. */
export function playIncoming() {
  play([
    { frequency: 660, start: 0, duration: 0.14, gain: 0.055 },
    { frequency: 880, start: 0.075, duration: 0.2, gain: 0.045 },
  ]);
}

/** Lighter, single blip for your own send confirmation. */
export function playSent() {
  play([{ frequency: 520, start: 0, duration: 0.09, gain: 0.03 }]);
}

/** Sweet arpeggio for hearts, notes and plans. */
export function playSparkle() {
  play([
    { frequency: 784, start: 0, duration: 0.16, gain: 0.05 },
    { frequency: 988, start: 0.08, duration: 0.18, gain: 0.045 },
    { frequency: 1319, start: 0.16, duration: 0.24, gain: 0.04 },
  ]);
}

/** Alert for a scheduled plan firing. */
export function playReminder() {
  play([
    { frequency: 523, start: 0, duration: 0.18, gain: 0.06, type: "triangle" },
    { frequency: 659, start: 0.18, duration: 0.18, gain: 0.06, type: "triangle" },
    { frequency: 784, start: 0.36, duration: 0.3, gain: 0.055, type: "triangle" },
  ]);
}

/** Unlock audio on first user gesture (mobile browsers require it). */
export function primeAudio() {
  getContext();
}
