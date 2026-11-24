/** Prime the persistent call audio element during a real user gesture.
 * Browsers may still require a second tap after a remote track arrives. */
export function primeCallAudio(audio: HTMLAudioElement | null) {
  if (!audio || audio.srcObject || audio.dataset.callPrime) return;
  // A short silent PCM WAV keeps one media element activated until ontrack.
  const bytes = new Uint8Array(44 + 1600), view = new DataView(bytes.buffer);
  const write = (at: number, text: string) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  write(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); write(8, "WAVE"); write(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, 1600, true);
  const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  audio.dataset.callPrime = url; audio.src = url; audio.loop = true; audio.muted = false; audio.volume = 1;
  void audio.play().catch(() => {});
}
export function clearCallAudio(audio: HTMLAudioElement | null) {
  if (!audio) return;
  audio.pause(); audio.srcObject = null;
  if (audio.dataset.callPrime) { URL.revokeObjectURL(audio.dataset.callPrime); delete audio.dataset.callPrime; }
  audio.removeAttribute("src"); audio.loop = false;
}
export async function attachCallAudio(audio: HTMLAudioElement, stream: MediaStream, volume = 1) {
  clearCallAudio(audio); audio.muted = false; audio.volume = volume; audio.srcObject = stream;
  await audio.play();
}
