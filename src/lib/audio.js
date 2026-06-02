// ─── Utilities ───────────────────────────────────────────────────────────────
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function pcmToWav(pcmData, sampleRate = 24000) {
  const buf = new ArrayBuffer(44 + pcmData.length * 2);
  const v = new DataView(buf);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0,'RIFF'); v.setUint32(4,36+pcmData.length*2,true); ws(8,'WAVE');
  ws(12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true);
  v.setUint32(24,sampleRate,true); v.setUint32(28,sampleRate*2,true);
  v.setUint16(32,2,true); v.setUint16(34,16,true); ws(36,'data');
  v.setUint32(40,pcmData.length*2,true);
  let o = 44;
  for (let i = 0; i < pcmData.length; i++, o += 2) v.setInt16(o, pcmData[i], true);
  return new Blob([v], { type: 'audio/wav' });
}

export async function fetchWithBackoff(url, opts, retries = 5, delay = 1200) {
  try {
    const r = await fetch(url, opts);
    if (!r.ok) {
      if (retries > 0 && (r.status === 429 || r.status >= 500)) {
        await sleep(delay); return fetchWithBackoff(url, opts, retries - 1, delay * 2);
      }
      throw new Error(`HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 120)}`);
    }
    return r;
  } catch (e) {
    if (retries > 0) { await sleep(delay); return fetchWithBackoff(url, opts, retries - 1, delay * 2); }
    throw e;
  }
}

// ─── Audio chunk → base64 WAV ────────────────────────────────────────────────
export async function audioBufferChunkToBase64(audioBuf, startSec, endSec) {
  const sr = audioBuf.sampleRate;
  const s0 = Math.floor(startSec * sr), s1 = Math.floor(endSec * sr);
  const len = s1 - s0;
  const ch = audioBuf.getChannelData(0).subarray(s0, s1);
  const ab = new ArrayBuffer(44 + len * 2); const v = new DataView(ab);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0,'RIFF'); v.setUint32(4,36+len*2,true); ws(8,'WAVE');
  ws(12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true);
  v.setUint32(24,sr,true); v.setUint32(28,sr*2,true);
  v.setUint16(32,2,true); v.setUint16(34,16,true); ws(36,'data');
  v.setUint32(40,len*2,true);
  let o = 44;
  for (let i = 0; i < len; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, ch[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  const blob = new Blob([ab], { type: 'audio/wav' });
  return new Promise(res => { const fr = new FileReader(); fr.onloadend = () => res(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
}

// ─── Gemini transcribe chunk ──────────────────────────────────────────────────
export async function transcribeChunkWithGemini(b64wav, chunkStart, chunkEnd, apiKey) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const prompt = `You are a Myanmar film subtitler. This audio covers video time ${chunkStart.toFixed(1)}s–${chunkEnd.toFixed(1)}s.
Transcribe all speech with absolute timestamps (add ${chunkStart.toFixed(1)}s offset). Translate to Myanmar script.
Return ONLY a JSON array, no markdown:
[{"start":2.1,"end":5.4,"en":"English text","my":"မြန်မာစာ"}]
If no speech, return [].`;
  const payload = { contents: [{ parts: [{ inline_data: { mime_type: 'audio/wav', data: b64wav } }, { text: prompt }] }] };
  const res = await fetchWithBackoff(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const json = await res.json();
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
  try { return JSON.parse(raw.replace(/```json|```/g, '').trim()); } catch { return []; }
}

// ─── Gemini Recap Script ──────────────────────────────────────────────────────
export async function generateRecapWithGemini(segments, videoDuration, apiKey) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const lines = segments.map(s => `[${s.start.toFixed(1)}s] ${s.sourceText}`).join('\n');
  const wordTarget = Math.round(videoDuration * 2.2); // ~2.2 words/sec narration pace
  const prompt = `You are a Myanmar YouTube/TikTok Movie Recap host (ဇာတ်လမ်းပြောပြသူ).
Video duration: ${videoDuration.toFixed(0)} seconds. Target narration: ~${wordTarget} Myanmar words.

Dialogue from the video:
${lines}

Write a dramatic, engaging Myanmar movie recap script with exactly these labeled sections:
မိတ်ဆက် — (intro hook, ~15% of script)
ဇာတ်ကြောင်း — (story, ~70% of script)  
နိဂုံး — (cliffhanger ending, ~15% of script)

Rules:
- Pure Myanmar/Burmese script only
- Each sentence ends with ။
- No markdown, no English
- Total ~${wordTarget} words to match ${videoDuration.toFixed(0)}s narration pace`;
  const payload = { contents: [{ parts: [{ text: prompt }] }] };
  const res = await fetchWithBackoff(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ─── Split recap script into timed subtitle segments ─────────────────────────
export function splitScriptToTimedSegments(scriptText, videoDuration) {
  const sentences = scriptText
    .replace(/([။])/g, '$1\n')
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 3 && !/^(မိတ်ဆက်|ဇာတ်ကြောင်း|နိဂုံး)\s*[—–]/.test(s));

  if (!sentences.length) return [];
  const totalChars = sentences.reduce((a, s) => a + s.length, 0);
  let cursor = 0;
  return sentences.map((text, i) => {
    const dur = (text.length / totalChars) * videoDuration;
    const start = parseFloat(cursor.toFixed(2));
    const end   = parseFloat(Math.min(cursor + dur, videoDuration).toFixed(2));
    cursor = end;
    return { id: `seg-${i}`, start, end, sourceText: text, myanmarText: text, ttsUrl: null, ttsDuration: null, isGeneratingTTS: false };
  });
}

// ─── Gemini TTS → returns { objectUrl, duration } ────────────────────────────
export async function requestGeminiTts(text, voice, emotion, apiKey) {
  if (!apiKey) throw new Error('No API key.');
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{ parts: [{ text: `Say ${emotion}: ${text}` }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } }
  };
  const res = await fetchWithBackoff(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const json = await res.json();
  const id = json.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  if (!id?.data) throw new Error('No TTS audio returned.');
  const raw = atob(id.data);
  const pcm = new Int16Array(raw.length / 2);
  for (let i = 0; i < pcm.length; i++) pcm[i] = (raw.charCodeAt(i*2) & 0xff) | ((raw.charCodeAt(i*2+1) & 0xff) << 8);
  const blob = pcmToWav(pcm, 24000);
  const url = URL.createObjectURL(blob);
  // Measure duration
  const duration = await new Promise(res => {
    const a = new Audio(url); a.onloadedmetadata = () => res(a.duration); a.onerror = () => res(null);
  });
  return { url, duration };
}

// ─── Re-sync segments: after TTS, adjust subtitle timings to match TTS durations
// Each subtitle starts when the TTS for the previous one ends (no gap/overlap).
export function resyncSegmentsToTts(segments, videoDuration) {
  const synced = [];
  let cursor = 0;
  for (const seg of segments) {
    const ttsDur = seg.ttsDuration || (seg.end - seg.start); // fallback to original
    const start  = parseFloat(cursor.toFixed(3));
    const end    = parseFloat(Math.min(cursor + ttsDur, videoDuration).toFixed(3));
    synced.push({ ...seg, start, end });
    cursor = end;
  }
  return synced;
}

// ─── Draw waveform ────────────────────────────────────────────────────────────
export function drawWaveform(buf, canvas) {
  if (!canvas || !buf) return;
  const ctx = canvas.getContext('2d'); const { width, height } = canvas;
  ctx.clearRect(0,0,width,height); ctx.fillStyle = '#030712'; ctx.fillRect(0,0,width,height);
  const ch = buf.getChannelData(0); const step = Math.ceil(ch.length / width); const amp = height / 2;
  const g = ctx.createLinearGradient(0,0,width,0);
  g.addColorStop(0,'rgba(124,58,237,.9)'); g.addColorStop(.5,'rgba(192,38,211,.9)'); g.addColorStop(1,'rgba(99,102,241,.9)');
  ctx.lineWidth = 1.5; ctx.strokeStyle = g; ctx.beginPath(); ctx.moveTo(0, amp);
  for (let i = 0; i < width; i++) {
    let mn = 1, mx = -1;
    for (let j = 0; j < step; j++) { const d = ch[i*step+j]; if (d<mn) mn=d; if (d>mx) mx=d; }
    ctx.lineTo(i,(1+mn)*amp); ctx.lineTo(i,(1+mx)*amp);
  }
  ctx.stroke();
}

// ─── SRT ─────────────────────────────────────────────────────────────────────
export function formatSrtTime(sec) {
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = Math.floor(sec%60), ms = Math.floor((sec%1)*1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
}
export const buildSrt = segs => segs.map((s,i) => `${i+1}\n${formatSrtTime(s.start)} --> ${formatSrtTime(s.end)}\n${s.myanmarText}\n`).join('\n');

// ─── Render output video (canvas + MediaRecorder) with TTS audio + subtitles ─
// Strategy: play original video muted, overlay subtitles via canvas,
// schedule each TTS AudioBufferSource at the correct video timestamp.
export async function renderOutputVideo(videoEl, segments, onProgress) {
  return new Promise(async (resolve, reject) => {
    const W = videoEl.videoWidth  || 1280;
    const H = videoEl.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // AudioContext for mixing TTS clips
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const dest = audioCtx.createMediaStreamDestination();

    // Pre-decode all TTS clips
    const ttsBuffers = {};
    for (const seg of segments) {
      if (seg.ttsUrl && !seg.ttsUrl.startsWith('demo')) {
        try {
          const resp = await fetch(seg.ttsUrl);
          const ab = await resp.arrayBuffer();
          ttsBuffers[seg.id] = await audioCtx.decodeAudioData(ab);
        } catch { /* skip */ }
      }
    }

    // Canvas stream (30fps)
    const canvasStream = canvas.captureStream(30);
    // Combine canvas video + TTS audio destination
    const combined = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...dest.stream.getAudioTracks()
    ]);

    const mimeType = ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';
    const recorder = new MediaRecorder(combined, { mimeType, videoBitsPerSecond: 5_000_000 });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => resolve(URL.createObjectURL(new Blob(chunks, { type: mimeType })));
    recorder.onerror = reject;

    const FONT_SIZE = Math.round(H * 0.048);
    const LINE_H = FONT_SIZE * 1.5;
    const PAD = 14;

    function drawSub(text) {
      if (!text) return;
      ctx.save();
      ctx.font = `700 ${FONT_SIZE}px "Noto Sans Myanmar", "Padauk", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      const maxW = W * 0.84;
      // word-wrap
      const words = text.split(/\s+/);
      const lines = []; let cur = '';
      for (const w of words) {
        const t = cur ? cur + ' ' + w : w;
        if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
      }
      if (cur) lines.push(cur);
      const boxH = lines.length * LINE_H + PAD * 2;
      const boxY = H - boxH - FONT_SIZE * 0.8;
      const boxW = Math.min(maxW + PAD * 4, W - 32);
      const boxX = (W - boxW) / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.78)';
      ctx.beginPath(); ctx.roundRect(boxX, boxY, boxW, boxH, 10); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.shadowColor = 'rgba(0,0,0,.9)'; ctx.shadowBlur = 6;
      lines.forEach((ln, li) => ctx.fillText(ln, W/2, boxY + PAD + (li+1)*LINE_H));
      ctx.restore();
    }

    const duration = videoEl.duration;
    const scheduledTts = new Set();
    let raf;

    recorder.start(100);

    // Schedule a TTS buffer at the right AudioContext time
    function scheduleTts(seg) {
      if (scheduledTts.has(seg.id)) return;
      const buf = ttsBuffers[seg.id];
      if (!buf) return;
      scheduledTts.add(seg.id);
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      src.connect(dest);
      src.start(audioCtx.currentTime);
    }

    function renderFrame() {
      const t = videoEl.currentTime;
      ctx.drawImage(videoEl, 0, 0, W, H);
      const active = segments.find(s => t >= s.start && t < s.end);
      if (active) { drawSub(active.myanmarText); scheduleTts(active); }
      if (onProgress) onProgress(t / duration);
      if (t < duration - 0.05 && !videoEl.ended) {
        raf = requestAnimationFrame(renderFrame);
      } else {
        cancelAnimationFrame(raf);
        setTimeout(() => { recorder.stop(); audioCtx.close(); }, 500);
      }
    }

    videoEl.muted = true; // we handle audio via TTS only
    videoEl.currentTime = 0;
    videoEl.playbackRate = 1;
    videoEl.play().then(() => { raf = requestAnimationFrame(renderFrame); }).catch(reject);
  });
}

// ─── Constants ────────────────────────────────────────────────────────────────
export const VOICES = {
  male:   [{ value:'Kore',   label:'Kore — Recap Host'    },
           { value:'Fenrir', label:'Fenrir — Dramatic'     },
           { value:'Puck',   label:'Puck — Versatile'      }],
  female: [{ value:'Leda',   label:'Leda — Storyteller'   },
           { value:'Zephyr', label:'Zephyr — Soft'         },
           { value:'Aoede',  label:'Aoede — Melodic'       }]
};
export const EMOTIONS = [
  { value:'excitedly',    label:'Excited'      },
  { value:'calmly',       label:'Calm/Serious' },
  { value:'cheerfully',   label:'Upbeat'       },
  { value:'in a whisper', label:'Whisper'      },
  { value:'dramatically', label:'Dramatic'     },
];
export const DEMO_RECAP = `မိတ်ဆက် — မင်္ဂလာပါ ပရိသတ်ကြီးရေ။ ဒီနေ့ ကျွန်တော်တို့ တင်ဆက်မှာကတော့ မမျှော်လင့်တဲ့ ခရီးစဉ်တစ်ခုရဲ့ ဇာတ်လမ်းပဲ ဖြစ်ပါတယ်။
ဇာတ်ကြောင်း — ဇာတ်လိုက်ဖြစ်သူဟာ မှောင်မိုက်တဲ့ သစ်တောကြီးထဲ ဝင်ရောက်ရင်း ဆန်းကြယ်တဲ့ အလင်းတံခါးတစ်ခုကို တွေ့ရှိခဲ့ပါတယ်။ သူဟာ ကိုယ့်ကံကြမ္မာ ပြောင်းသွားနိုင်တယ်ဆိုတာ သိပေမယ့် စူးစမ်းလိုစိတ်ကြောင့် တံခါးထဲ ဝင်ခဲ့ပါတယ်။ ချက်ချင်းဆိုသလိုပဲ သူဟာ အနာဂတ်ကမ္ဘာကြီးထဲ ရောက်ရှိသွားကာ ဆန်းကြယ်တဲ့ စက်ရုပ်တွေနဲ့ ကြုံတွေ့ရပါတယ်။
နိဂုံး — သူဟာ ဒီကမ္ဘာကြီးကနေ ပြန်လွတ်မြောက်နိုင်ပါ့မလား။ နောက်အပိုင်းမှာ ဆက်လက် ကြည့်ရှုပေးကြပါဦးနော်။`;
