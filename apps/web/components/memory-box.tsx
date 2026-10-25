"use client";
// Photos and voice memos from an outing. Saved on this device (resized, location data stripped),
// with buttons that hand off to Instagram or Facebook. Nothing is posted automatically.
import { useEffect, useRef, useState } from "react";

export type Memory = { id: string; kind: "photo" | "voice"; src: string; at: number };
const MAX = 8;
const load = (key: string): Memory[] => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]");
  } catch {
    return [];
  }
};

async function shrink(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw Error("Choose a photo.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(Error("That photo couldn’t be opened. Try a JPEG or PNG."));
      i.src = url;
    });
    const scale = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82); // re-encoding drops EXIF, including location
  } finally {
    URL.revokeObjectURL(url);
  }
}
const asDataUrl = (blob: Blob) => new Promise<string>((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.readAsDataURL(blob); });

export function MemoryBox({ storageKey, title, onFirst }: { storageKey: string; title: string; onFirst?: () => void }) {
  const [items, setItems] = useState<Memory[]>([]);
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  useEffect(() => setItems(load(storageKey)), [storageKey]);
  useEffect(() => {
    if (!recording) return;
    const t = setTimeout(() => (recording >= 60 ? recorder.current?.stop() : setRecording((s) => s + 1)), 1000);
    return () => clearTimeout(t);
  }, [recording]);

  const add = (m: Memory) =>
    setItems((cur) => {
      const next = [m, ...cur].slice(0, MAX);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        setError("This device is out of space for more memories. Delete one first.");
        return cur;
      }
      if (!cur.length) onFirst?.();
      return next;
    });
  const remove = (id: string) =>
    setItems((cur) => {
      const next = cur.filter((m) => m.id !== id);
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });

  async function record() {
    setError("");
    if (recorder.current?.state === "recording") return recorder.current.stop();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(0);
        add({ id: crypto.randomUUID(), kind: "voice", src: await asDataUrl(new Blob(chunks, { type: rec.mimeType })), at: Date.now() });
      };
      recorder.current = rec;
      rec.start();
      setRecording(1);
    } catch {
      setError("Microphone access was blocked. You can upload a voice memo instead.");
    }
  }

  const photo = items.find((m) => m.kind === "photo");
  return (
    <section className="memory-box" aria-labelledby={`${storageKey}-title`}>
      <span className="eyebrow">Memories</span>
      <h2 id={`${storageKey}-title`}>Keep a bit of {title}</h2>
      <div className="memory-actions">
        <label className="memory-btn">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="14" rx="2" /><circle cx="12" cy="13" r="3.5" /><path d="M8 6l1.5-2h5L16 6" /></svg>
          Add photos
          <input type="file" accept="image/*" multiple onChange={(e) => { setError(""); [...(e.target.files ?? [])].slice(0, 4).forEach((f) => void shrink(f).then((src) => add({ id: crypto.randomUUID(), kind: "photo", src, at: Date.now() })).catch((err) => setError(err.message))); e.target.value = ""; }} />
        </label>
        <button type="button" className={`memory-btn${recording ? " is-recording" : ""}`} onClick={() => void record()} aria-pressed={Boolean(recording)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
          {recording ? `Stop · 0:${String(recording).padStart(2, "0")}` : "Record a voice memo"}
        </button>
        <label className="memory-btn is-quiet">
          Upload audio
          <input type="file" accept="audio/*" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 3_000_000) return setError("Choose a voice memo under 3 MB."); void asDataUrl(f).then((src) => add({ id: crypto.randomUUID(), kind: "voice", src, at: Date.now() })); e.target.value = ""; }} />
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      {items.length > 0 && (
        <ul className="memory-strip">
          {items.map((m) => (
            <li key={m.id} className={m.kind}>
              {m.kind === "photo" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.src} alt="Outing photo" />
              ) : (
                <audio controls src={m.src} aria-label="Voice memo" />
              )}
              <button type="button" className="memory-remove" aria-label="Delete this memory" onClick={() => remove(m.id)}>×</button>
            </li>
          ))}
        </ul>
      )}
      {photo && (
        <div className="memory-share">
          <a className="memory-btn" href={photo.src} download="sidequest-memory.jpg">Save photo</a>
          <a className="memory-btn social" href="https://www.instagram.com/" target="_blank" rel="noreferrer">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.3" cy="6.7" r="0.6" /></svg>
            Instagram
          </a>
          <a className="memory-btn social" href="https://www.facebook.com/" target="_blank" rel="noreferrer">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8z" /></svg>
            Facebook
          </a>
        </div>
      )}
      <p className="hint">Saved on this device. Save a photo, then post it from Instagram or Facebook; SideQuest never posts for you.</p>
    </section>
  );
}
