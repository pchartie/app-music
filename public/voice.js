// Commande vocale : capture du micro, détection de fin de phrase, envoi au serveur local (whisper.cpp).
// Aucune donnée ne quitte la machine.

export async function voiceAvailable() {
  try { return (await fetch('/api/voice/status').then((r) => r.json())).available; } catch { return false; }
}

// Écoute jusqu'à un silence de ~1 s après la parole (ou 8 s max). onLevel(0..1) anime l'interface.
export async function listen({ onLevel, onState, signal }) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  const t0 = performance.now();
  let noise = 0.01, noiseN = 0, spoke = false, lastVoice = 0;
  try {
    await new Promise((resolve, reject) => {
      const stop = () => resolve();
      signal?.addEventListener('abort', () => reject(new DOMException('annulé', 'AbortError')));
      proc.onaudioprocess = (ev) => {
        const d = ev.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(d));
        let sum = 0; for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
        const rms = Math.sqrt(sum / d.length);
        const now = performance.now() - t0;
        if (now < 350) { noise = (noise * noiseN + rms) / ++noiseN; return; } // bruit de fond
        const threshold = Math.max(0.012, noise * 3);
        onLevel?.(Math.min(1, rms / (threshold * 4)));
        if (rms > threshold) { if (!spoke) onState?.('speaking'); spoke = true; lastVoice = now; }
        if ((spoke && now - lastVoice > 1000) || now > 8000) stop();
        if (!spoke && now > 5000) reject(new Error('Je n’ai rien entendu'));
      };
      src.connect(proc); proc.connect(ctx.destination);
    });
  } finally {
    proc.disconnect(); src.disconnect(); stream.getTracks().forEach((t) => t.stop());
  }
  onState?.('thinking');
  const wav = await toWav16k(chunks, ctx.sampleRate);
  ctx.close();
  const r = await fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav, signal });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error === 'not-installed' ? 'not-installed' : 'La reconnaissance a échoué');
  return data.text;
}

async function toWav16k(chunks, rate) {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const buf = new AudioBuffer({ length: len, numberOfChannels: 1, sampleRate: rate });
  let off = 0; for (const c of chunks) { buf.copyToChannel(c, 0, off); off += c.length; }
  const off16 = new OfflineAudioContext(1, Math.ceil(len * 16000 / rate), 16000);
  const s = off16.createBufferSource(); s.buffer = buf; s.connect(off16.destination); s.start();
  const pcm = (await off16.startRendering()).getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (o, t) => { for (let i = 0; i < t.length; i++) out.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, 16000, true);
  out.setUint32(28, 32000, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Blob([out.buffer], { type: 'audio/wav' });
}
