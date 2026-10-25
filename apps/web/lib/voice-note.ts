// Decode the selected local recording and resample to the WAV format required by Muse Voice.
// No microphone permission, playback, or upload happens during this conversion.
export async function voiceNoteWav(file: File): Promise<Blob> {
  if (file.size > 8_000_000) throw Error('Choose a recording under 8 MB.');
  const context = new OfflineAudioContext(1, 16000, 16000);
  let audio: AudioBuffer;
  try { audio = await context.decodeAudioData(await file.arrayBuffer()); }
  catch { throw Error('This browser could not read that recording. Try WAV or MP3.'); }
  if (audio.duration > 120) throw Error('Keep voice notes under two minutes.');
  const buffer = new ArrayBuffer(44 + audio.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, audio.length * 2, true);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  for (let i = 0; i < audio.length; i++) {
    const sample = Math.max(-1, Math.min(1, channels.reduce((sum, channel) => sum + (channel[i] ?? 0), 0) / channels.length));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
