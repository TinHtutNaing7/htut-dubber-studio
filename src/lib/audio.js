// ─── PCM → WAV ──────────────────────────────────────────────────────────────
export function pcmToWav(pcmData, sampleRate = 24000) {
  const buffer = new ArrayBuffer(44 + pcmData.length * 2);
  const view = new DataView(buffer);
  const ws = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
  ws(0,'RIFF'); view.setUint32(4,36+pcmData.length*2,true); ws(8,'WAVE');
  ws(12,'fmt '); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
  view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*2,true);
  view.setUint16(32,2,true); view.setUint16(34,16,true); ws(36,'data');
  view.setUint32(40,pcmData.length*2,true);
  let o=44; for(let i=0;i<pcmData.length;i++,o+=2) view.setInt16(o,pcmData[i],true);
  return new Blob([view],{type:'audio/wav'});
}

// ─── Exponential-backoff fetch ───────────────────────────────────────────────
export async function fetchWithBackoff(url, options, retries=5, delay=1200) {
  try {
    const r = await fetch(url, options);
    if (!r.ok) {
      if (retries>0 && (r.status===429||r.status>=500)) {
        await sleep(delay); return fetchWithBackoff(url,options,retries-1,delay*2);
      }
      const body = await r.text().catch(()=>'');
      throw new Error(`HTTP ${r.status}: ${body.slice(0,120)}`);
    }
    return r;
  } catch(e) {
    if(retries>0){ await sleep(delay); return fetchWithBackoff(url,options,retries-1,delay*2); }
    throw e;
  }
}
export const sleep = ms => new Promise(r=>setTimeout(r,ms));

// ─── AudioBuffer chunk → base64 WAV ─────────────────────────────────────────
export async function audioBufferChunkToBase64(audioBuffer, startSec, endSec) {
  const sr = audioBuffer.sampleRate;
  const s0 = Math.floor(startSec*sr), s1 = Math.floor(endSec*sr);
  const len = s1-s0;
  const ch = audioBuffer.getChannelData(0).subarray(s0,s1);
  const ab = new ArrayBuffer(44+len*2); const view = new DataView(ab);
  const ws = (off,str)=>{ for(let i=0;i<str.length;i++) view.setUint8(off+i,str.charCodeAt(i)); };
  ws(0,'RIFF'); view.setUint32(4,36+len*2,true); ws(8,'WAVE');
  ws(12,'fmt '); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
  view.setUint32(24,sr,true); view.setUint32(28,sr*2,true);
  view.setUint16(32,2,true); view.setUint16(34,16,true); ws(36,'data');
  view.setUint32(40,len*2,true);
  let o=44;
  for(let i=0;i<len;i++){ const s=Math.max(-1,Math.min(1,ch[i])); view.setInt16(o,s<0?s*0x8000:s*0x7FFF,true); o+=2; }
  const blob = new Blob([ab],{type:'audio/wav'});
  return new Promise(res=>{ const fr=new FileReader(); fr.onloadend=()=>res(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
}

// ─── Gemini transcribe+translate one audio chunk ────────────────────────────
export async function transcribeChunkWithGemini(base64Wav, chunkStart, chunkEnd, apiKey) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const prompt = `You are a professional Myanmar (Burmese) film subtitler.
This audio clip covers video timestamp ${chunkStart.toFixed(1)}s to ${chunkEnd.toFixed(1)}s.
1. Transcribe every spoken sentence with its START and END time (relative to the full video, i.e. add ${chunkStart.toFixed(1)} as offset).
2. Translate each sentence into natural Myanmar (Burmese) script.
Return ONLY a JSON array — no markdown, no explanation:
[{"start":2.1,"end":5.4,"en":"English text","my":"မြန်မာဘာသာ"}]
If no speech detected return [].`;
  const payload = {
    contents:[{parts:[
      {inline_data:{mime_type:'audio/wav',data:base64Wav}},
      {text:prompt}
    ]}]
  };
  const res = await fetchWithBackoff(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const json = await res.json();
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
  try { return JSON.parse(raw.replace(/```json|```/g,'').trim()); }
  catch { return []; }
}

// ─── Gemini Recap Script generation ─────────────────────────────────────────
export async function generateRecapWithGemini(segments, videoDuration, apiKey) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const lines = segments.map(s=>`[${s.start.toFixed(1)}s-${s.end.toFixed(1)}s] ${s.en||s.sourceText} → ${s.my||s.myanmarText}`).join('\n');
  const prompt = `You are a professional Myanmar YouTube/TikTok Movie Recap host (ဇာတ်လမ်းပြောပြသူ).

The video is ${videoDuration.toFixed(0)} seconds long.
Here are the timestamped dialogue lines:
${lines}

Write a compelling Myanmar-language Movie Recap script that:
- Covers the FULL ${videoDuration.toFixed(0)}-second video
- Has exactly these 3 sections clearly labeled: " မိတ်ဆက်", "ဇာတ်ကြောင်း", "နိဂုံး"
- Is engaging, dramatic, social-media style
- Is written entirely in Myanmar/Burmese script
- Total length should match reading pace for ${videoDuration.toFixed(0)} seconds of narration (approx ${Math.round(videoDuration/3)} words)

Return ONLY the script text, no JSON, no markdown.`;
  const payload = {contents:[{parts:[{text:prompt}]}]};
  const res = await fetchWithBackoff(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ─── Split recap script into timed subtitle segments ────────────────────────
export function splitScriptToTimedSegments(scriptText, videoDuration) {
  // Split on sentence boundaries (Myanmar full stops, newlines, etc.)
  const raw = scriptText
    .split(/([။\n]+)/)
    .map(s=>s.trim())
    .filter(s=>s.length>2 && !/^[။\n]+$/.test(s));

  if (raw.length === 0) return [];

  // Distribute proportionally by character length → time
  const totalChars = raw.reduce((acc,s)=>acc+s.length,0);
  const segments = [];
  let cursor = 0;

  raw.forEach((text, i) => {
    const proportion = text.length / totalChars;
    const segDuration = proportion * videoDuration;
    const start = cursor;
    const end = Math.min(cursor + segDuration, videoDuration);
    segments.push({
      id: `recap-${i}`,
      start: parseFloat(start.toFixed(2)),
      end: parseFloat(end.toFixed(2)),
      sourceText: text, // same as myanmarText for recap
      myanmarText: text,
      audioUrl: null,
      dubSpeed: 1.0,
      isGeneratingTTS: false,
    });
    cursor = end;
  });

  return segments;
}

// ─── Split recap into N equal-time segments spanning full duration ──────────
// Splits the script text into N pieces by character length, but assigns each
// piece an EQUAL slice of the video duration (videoDuration / N).
export function splitScriptToEqualTimeSegments(scriptText, videoDuration, N) {
  const clean = (scriptText || '').replace(/\s+/g, ' ').trim();
  if (!clean || !videoDuration || N < 1) return [];
  N = Math.max(1, Math.floor(N));

  // Prefer splitting at Myanmar sentence boundaries (။) then spaces.
  const sentences = clean.split(/(?<=။)\s*/).filter(Boolean);

  // Greedy-pack sentences into N buckets of roughly equal char length.
  const target = clean.length / N;
  const buckets = Array.from({ length: N }, () => '');
  let bi = 0;
  for (const s of sentences) {
    if (bi < N - 1 && buckets[bi].length + s.length > target * 1.15 && buckets[bi].length > 0) bi++;
    buckets[bi] += (buckets[bi] ? ' ' : '') + s;
  }
  // If buckets at the tail are empty (few sentences), redistribute by char slicing.
  const empty = buckets.filter(b => !b).length;
  if (empty > 0) {
    const sliceLen = Math.ceil(clean.length / N);
    for (let i = 0; i < N; i++) {
      buckets[i] = clean.slice(i * sliceLen, (i + 1) * sliceLen).trim();
    }
  }

  const slice = videoDuration / N;
  return buckets.map((text, i) => ({
    id: `recap-eq-${i}`,
    start: parseFloat((i * slice).toFixed(2)),
    end:   parseFloat(((i + 1) * slice).toFixed(2)),
    sourceText: text,
    myanmarText: text,
    audioUrl: null,
    dubSpeed: 1.0,
    isGeneratingTTS: false,
  }));
}

// ─── Gemini TTS ──────────────────────────────────────────────────────────────
export async function requestGeminiTts(text, voice, emotion, apiKey) {
  if (!apiKey) throw new Error('API Key missing.');
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;
  const payload = {
    contents:[{parts:[{text:`Say ${emotion}: ${text}`}]}],
    generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:voice}}}}
  };
  const res = await fetchWithBackoff(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const json = await res.json();
  const id = json.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  if (!id?.data) throw new Error('No audio from TTS.');
  const raw = atob(id.data);
  const pcm = new Int16Array(raw.length/2);
  for(let i=0;i<pcm.length;i++) pcm[i]=(raw.charCodeAt(i*2)&0xff)|((raw.charCodeAt(i*2+1)&0xff)<<8);
  return URL.createObjectURL(pcmToWav(pcm,24000));
}

// ─── Draw waveform ──────────────────────────────────────────────────────────
export function drawWaveform(buffer, canvas) {
  if(!canvas||!buffer) return;
  const ctx=canvas.getContext('2d'); const {width,height}=canvas;
  ctx.clearRect(0,0,width,height); ctx.fillStyle='#030712'; ctx.fillRect(0,0,width,height);
  const ch=buffer.getChannelData(0); const step=Math.ceil(ch.length/width); const amp=height/2;
  const g=ctx.createLinearGradient(0,0,width,0);
  g.addColorStop(0,'rgba(124,58,237,0.9)'); g.addColorStop(0.5,'rgba(192,38,211,0.9)'); g.addColorStop(1,'rgba(99,102,241,0.9)');
  ctx.lineWidth=1.5; ctx.strokeStyle=g; ctx.beginPath(); ctx.moveTo(0,amp);
  for(let i=0;i<width;i++){
    let mn=1,mx=-1;
    for(let j=0;j<step;j++){const d=ch[i*step+j];if(d<mn)mn=d;if(d>mx)mx=d;}
    ctx.lineTo(i,(1+mn)*amp); ctx.lineTo(i,(1+mx)*amp);
  }
  ctx.stroke();
}

// ─── SRT helpers ────────────────────────────────────────────────────────────
export function formatSrtTime(sec) {
  const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60), s=Math.floor(sec%60), ms=Math.floor((sec%1)*1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
}

export function buildSrt(segments) {
  return segments.map((seg,i)=>`${i+1}\n${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n${seg.myanmarText}\n`).join('\n');
}

// ─── Render output video with burned subtitles via Canvas + MediaRecorder ───
export async function renderOutputVideo(videoEl, segments, onProgress) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width  = videoEl.videoWidth  || 1280;
    canvas.height = videoEl.videoHeight || 720;
    const ctx = canvas.getContext('2d');

    // Capture stream from canvas
    const videoStream   = canvas.captureStream(30);
    // Try to capture audio from the video element
    let audioStream = null;
    try {
      if (videoEl.captureStream) audioStream = videoEl.captureStream();
      else if (videoEl.mozCaptureStream) audioStream = videoEl.mozCaptureStream();
    } catch(e) { /* no audio track */ }

    const tracks = [...videoStream.getTracks()];
    if (audioStream) audioStream.getAudioTracks().forEach(t=>tracks.push(t));
    const combinedStream = new MediaStream(tracks);

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : MediaRecorder.isTypeSupported('video/webm')
      ? 'video/webm'
      : 'video/mp4';

    const recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 4_000_000 });
    const chunks = [];
    recorder.ondataavailable = e => { if(e.data.size>0) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      resolve(URL.createObjectURL(blob));
    };
    recorder.onerror = reject;

    // Font setup
    const FONT_SIZE    = Math.round(canvas.height * 0.048);
    const PADDING      = 16;
    const SHADOW_BLUR  = 8;
    const LINE_H       = FONT_SIZE * 1.45;
    const BOX_RADIUS   = 10;

    function drawSubtitle(text) {
      if (!text) return;
      ctx.save();
      ctx.font = `700 ${FONT_SIZE}px "Noto Sans Myanmar", "Padauk", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';

      // word-wrap to ~80% width
      const maxW = canvas.width * 0.82;
      const words = text.split(' ');
      const lines = [];
      let cur = '';
      for (const w of words) {
        const test = cur ? cur+' '+w : w;
        if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur=w; }
        else cur = test;
      }
      if (cur) lines.push(cur);

      const totalH = lines.length * LINE_H + PADDING * 2;
      const boxY   = canvas.height - totalH - FONT_SIZE * 0.6;
      const boxW   = Math.min(maxW + PADDING*3, canvas.width - 40);
      const boxX   = (canvas.width - boxW) / 2;

      // Semi-transparent box
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      roundRect(ctx, boxX, boxY, boxW, totalH, BOX_RADIUS);
      ctx.fill();

      // Text
      ctx.shadowColor = 'rgba(0,0,0,0.95)';
      ctx.shadowBlur  = SHADOW_BLUR;
      ctx.fillStyle   = '#ffffff';
      lines.forEach((line, li) => {
        ctx.fillText(line, canvas.width/2, boxY + PADDING + (li+1)*LINE_H);
      });
      ctx.restore();
    }

    function roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
      ctx.quadraticCurveTo(x+w,y,x+w,y+r);
      ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
      ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
      ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
      ctx.closePath();
    }

    const duration = videoEl.duration;
    let rafId;
    recorder.start(100);

    function renderFrame() {
      const t = videoEl.currentTime;
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

      // Find active subtitle
      const active = segments.find(s => t >= s.start && t < s.end);
      if (active) drawSubtitle(active.myanmarText);

      if (onProgress) onProgress(t / duration);

      if (t < duration && !videoEl.paused) {
        rafId = requestAnimationFrame(renderFrame);
      } else {
        cancelAnimationFrame(rafId);
        recorder.stop();
        videoEl.pause();
      }
    }

    videoEl.currentTime = 0;
    videoEl.playbackRate = 1;
    videoEl.muted = false;
    videoEl.play().then(() => { rafId = requestAnimationFrame(renderFrame); }).catch(reject);
  });
}

// ─── Render output with TTS audio track instead of original audio ───────────
// Mixes one long-form Burmese TTS audio (recapAudioUrl) over the silent video,
// burns in the subtitle segments, and exports a webm via MediaRecorder.
export async function renderOutputVideoWithTts(videoEl, segments, recapAudioUrl, onProgress) {
  return new Promise(async (resolve, reject) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width  = videoEl.videoWidth  || 1280;
      canvas.height = videoEl.videoHeight || 720;
      const ctx = canvas.getContext('2d');

      // Video stream from canvas
      const videoStream = canvas.captureStream(30);

      // Audio: TTS via Web Audio API → MediaStreamDestination
      const AC = window.AudioContext || window.webkitAudioContext;
      const ac = new AC();
      const dest = ac.createMediaStreamDestination();
      const ttsAudio = new Audio();
      ttsAudio.crossOrigin = 'anonymous';
      ttsAudio.src = recapAudioUrl;
      await new Promise((r, j) => { ttsAudio.onloadedmetadata = r; ttsAudio.onerror = j; });
      const ttsSrc = ac.createMediaElementSource(ttsAudio);
      ttsSrc.connect(dest);
      ttsSrc.connect(ac.destination); // also audible while rendering (optional)

      const tracks = [...videoStream.getTracks(), ...dest.stream.getAudioTracks()];
      const combined = new MediaStream(tracks);

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus'
        : 'video/webm';
      const recorder = new MediaRecorder(combined, { mimeType, videoBitsPerSecond: 4_000_000 });
      const chunks = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => resolve(URL.createObjectURL(new Blob(chunks, { type: mimeType })));
      recorder.onerror = reject;

      const FONT_SIZE = Math.round(canvas.height * 0.048);
      const PAD = 16, LINE_H = FONT_SIZE * 1.45, BOX_R = 10;
      function rr(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
        ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
        ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
        ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
      }
      function drawSub(text) {
        if (!text) return;
        ctx.save();
        ctx.font = `700 ${FONT_SIZE}px "Noto Sans Myanmar","Padauk",sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        const maxW = canvas.width * 0.82;
        const words = text.split(' '); const lines = []; let cur = '';
        for (const w of words) {
          const test = cur ? cur+' '+w : w;
          if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; }
          else cur = test;
        }
        if (cur) lines.push(cur);
        const totalH = lines.length * LINE_H + PAD * 2;
        const boxY = canvas.height - totalH - FONT_SIZE * 0.6;
        const boxW = Math.min(maxW + PAD * 3, canvas.width - 40);
        const boxX = (canvas.width - boxW) / 2;
        ctx.fillStyle = 'rgba(0,0,0,0.72)'; rr(boxX, boxY, boxW, totalH, BOX_R); ctx.fill();
        ctx.shadowColor = 'rgba(0,0,0,0.95)'; ctx.shadowBlur = 8; ctx.fillStyle = '#fff';
        lines.forEach((ln, li) => ctx.fillText(ln, canvas.width/2, boxY + PAD + (li+1)*LINE_H));
        ctx.restore();
      }

      const duration = videoEl.duration;
      videoEl.muted = true; // mute original audio — TTS replaces it
      videoEl.currentTime = 0; videoEl.playbackRate = 1;
      ttsAudio.currentTime = 0;
      let rafId;
      recorder.start(100);
      const tick = () => {
        const t = videoEl.currentTime;
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        const active = segments.find(s => t >= s.start && t < s.end);
        if (active) drawSub(active.myanmarText);
        if (onProgress) onProgress(Math.min(1, t / duration));
        if (t < duration && !videoEl.paused) rafId = requestAnimationFrame(tick);
        else { cancelAnimationFrame(rafId); try{ ttsAudio.pause(); }catch{} recorder.stop(); videoEl.pause(); }
      };
      await Promise.all([videoEl.play(), ttsAudio.play()]);
      rafId = requestAnimationFrame(tick);
    } catch (e) { reject(e); }
  });
}


// ─── Constants ───────────────────────────────────────────────────────────────
export const DEMO_SEGMENTS = [
  {id:'seg-1',start:2.5,end:8.0,sourceText:'Deep inside the dark forest, a mysterious glowing door appeared before him.',myanmarText:'မှောင်မိုက်လှတဲ့ သစ်တောနက်ကြီးထဲမှာ၊ ဆန်းကြယ်တဲ့ အလင်းတံခါးတစ်ခုက သူ့ရှေ့မှာ ပေါ်လာခဲ့ပါတယ်။',audioUrl:null,dubSpeed:1.0,isGeneratingTTS:false},
  {id:'seg-2',start:9.2,end:15.5,sourceText:'He knew entering would change his destiny forever, but curiosity took over.',myanmarText:'ဒီတံခါးကို ဖြတ်ကျော်ဝင်ရောက်ခြင်းက သူ့ကံကြမ္မာကို ထာဝရပြောင်းလဲပစ်မယ်ဆိုတာ သူသိပေမယ့် စူးစမ်းလိုစိတ်က ပိုကြီးစိုးသွားခဲ့ပါတယ်။',audioUrl:null,dubSpeed:1.0,isGeneratingTTS:false},
  {id:'seg-3',start:17.0,end:24.1,sourceText:'Instantly he was transported into a world of high-tech machines and cybernetic energy.',myanmarText:'ချက်ချင်းဆိုသလိုပဲ သူဟာ စက်ရုပ်တွေနဲ့ ဆိုက်ဘာနက်တစ် စွမ်းအင်တွေ ပြည့်နှက်နေတဲ့ ကမ္ဘာသစ်တစ်ခုဆီ ရောက်ရှိသွားခဲ့ပါတယ်။',audioUrl:null,dubSpeed:1.0,isGeneratingTTS:false},
  {id:'seg-4',start:25.5,end:29.8,sourceText:'This is where our legendary journey truly begins.',myanmarText:'ဒီနေရာကတော့ ကျွန်တော်တို့ရဲ့ ဒဏ္ဍာရီဆန်ဆန် ခရီးစဉ်အစပြုရာ နေရာပဲ ဖြစ်ပါတယ်။',audioUrl:null,dubSpeed:1.0,isGeneratingTTS:false}
];

export const DEMO_RECAP = `မိတ်ဆက် — မင်္ဂလာပါ ပရိသတ်ကြီးရေ။ ဒီနေ့ ကျွန်တော်တို့ တင်ဆက်ပေးမယ့် ဇာတ်လမ်းက မှောင်မိုက်တဲ့ သစ်တောကြီးထဲက ဆန်းကြယ်တဲ့ ခရီးစဉ်တစ်ခုပဲ ဖြစ်ပါတယ်။

ဇာတ်ကြောင်း — ဇာတ်လိုက်ဖြစ်သူဟာ တားမြစ်ထားတဲ့ သစ်တောကြီးထဲ ဝင်ရောက်ခဲ့ပြီး အလင်းရောင် တောက်နေတဲ့ ဆန်းကြယ်တဲ့ တံခါးတစ်ခုကို တွေ့ရှိခဲ့တယ်။ သူဟာ ကိုယ့်ကံကြမ္မာ ပြောင်းသွားနိုင်တယ်ဆိုတာ သိပေမယ့် စူးစမ်းလိုစိတ်ကြောင့် တံခါးထဲ ဝင်လိုက်တဲ့အခါ စက်ရုပ်ကမ္ဘာကြီးထဲ ရောက်ရှိသွားခဲ့ပါတယ်။

နိဂုံး — သူဟာ ဒီ အနာဂတ်ကမ္ဘာကနေ ပြန်လွတ်မြောက်နိုင်ပါ့မလား? နောက်အပိုင်းမှာ ဆက်လက် ကြည့်ရှုပေးကြပါဦးနော်။`;

// Voices grouped flat with gender + descriptor (matches Voice picker UI).
export const VOICES = [
  { value:'Kore',   gender:'Female', descriptor:'Warm' },
  { value:'Aoede',  gender:'Female', descriptor:'Bright' },
  { value:'Leda',   gender:'Female', descriptor:'Smooth' },
  { value:'Charon', gender:'Male',   descriptor:'Deep' },
  { value:'Fenrir', gender:'Male',   descriptor:'Grounded' },
  { value:'Orus',   gender:'Male',   descriptor:'Rich' },
  { value:'Puck',   gender:'Male',   descriptor:'Expressive' },
];

// Audio styles, mapped to a Gemini-TTS prompt directive.
export const EMOTIONS = [
  { value:'in a normal, clear, natural tone',           label:'Normal',      hint:'Clear, natural delivery' },
  { value:'excitedly with high energy and enthusiasm',  label:'Excited',     hint:'High energy, enthusiastic' },
  { value:'in a quiet, intimate whisper',               label:'Whisper',     hint:'Quiet, intimate tone' },
  { value:'as a formal, authoritative news anchor',     label:'News Anchor', hint:'Formal, authoritative' },
  { value:'in a soft, peaceful, gentle tone',           label:'Calm',        hint:'Soft, peaceful, gentle' },
  { value:'cheerfully, warm and bright and positive',   label:'Cheerful',    hint:'Warm, bright, positive' },
  { value:'in a melancholic, somber, emotional tone',   label:'Somber',      hint:'Melancholic, emotional' },
];

