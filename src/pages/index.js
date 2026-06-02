import { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import {
  audioBufferChunkToBase64, transcribeChunkWithGemini,
  generateRecapWithGemini, splitScriptToTimedSegments,
  requestGeminiTts, resyncSegmentsToTts,
  drawWaveform, buildSrt, renderOutputVideo,
  VOICES, EMOTIONS, DEMO_RECAP, sleep
} from '../lib/audio';

// ─── Icons ───────────────────────────────────────────────────────────────────
const Ico = ({ d, cls = 'w-4 h-4' }) => (
  <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const I = {
  upload: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12',
  mic:    'M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z',
  script: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  tts:    'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z',
  sync:   'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  video:  'M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z',
  dl:     'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4',
  play:   'M5 3l14 9-14 9V3z',
  check:  'M5 13l4 4L19 7',
  close:  'M6 18L18 6M6 6l12 12',
};

// ─── Small components ─────────────────────────────────────────────────────────
function Spinner({ color = 'violet' }) {
  return <span className={`inline-block w-3.5 h-3.5 rounded-full border-2 border-${color}-400 border-t-transparent animate-spin flex-shrink-0`} />;
}

function PBar({ v, color = 'violet' }) {
  const bg = color === 'emerald' ? '#059669,#10b981'
           : color === 'cyan'    ? '#0284c7,#06b6d4'
           : color === 'fuchsia' ? '#a21caf,#e879f9'
           :                       '#7c3aed,#c026d3';
  return (
    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.min(100, Math.max(0, v * 100))}%`, background: `linear-gradient(90deg,${bg})` }} />
    </div>
  );
}

// ─── Step pill ────────────────────────────────────────────────────────────────
const STEPS = [
  { n:1, label:'Upload',     ico: I.upload },
  { n:2, label:'Transcribe', ico: I.mic    },
  { n:3, label:'Recap',      ico: I.script },
  { n:4, label:'TTS',        ico: I.tts    },
  { n:5, label:'TTS Sync',   ico: I.sync   },
  { n:6, label:'Export',     ico: I.video  },
];
function StepBar({ current }) {
  return (
    <div className="flex items-center overflow-x-auto gap-0 px-5 py-2.5 border-b border-slate-800/80">
      {STEPS.map((s, i) => (
        <div key={s.n} className="flex items-center flex-shrink-0">
          <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all
            ${current === s.n ? 'bg-violet-600/30 text-violet-200 border border-violet-500/50'
            : current  > s.n  ? 'text-emerald-400'
            :                   'text-slate-600'}`}>
            <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black flex-shrink-0
              ${current === s.n ? 'bg-violet-600 text-white'
              : current  > s.n  ? 'bg-emerald-600/30 text-emerald-400'
              :                   'bg-slate-800 text-slate-600'}`}>
              {current > s.n ? '✓' : s.n}
            </span>
            {s.label}
          </div>
          {i < STEPS.length - 1 && <span className="mx-0.5 text-slate-800 font-bold">›</span>}
        </div>
      ))}
    </div>
  );
}

// ─── Segment row ──────────────────────────────────────────────────────────────
function SegRow({ seg, isActive, isSelected, onSelect, onChange, onTTS, onPlay }) {
  const ttsOk = seg.ttsUrl && !seg.ttsUrl.startsWith('demo');
  return (
    <div onClick={onSelect}
      className={`p-3 rounded-xl border cursor-pointer transition-all
        ${isActive   ? 'border-violet-500/60 bg-violet-950/20 ring-1 ring-violet-500/30'
        : isSelected ? 'border-slate-600 bg-slate-900/80'
        :              'border-slate-800 bg-slate-950/60 hover:border-slate-700'}`}>
      <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
        {/* timestamps */}
        <span className="text-[9px] font-mono text-slate-500 bg-slate-800/60 px-1.5 py-0.5 rounded whitespace-nowrap">
          {seg.start.toFixed(2)}s → {seg.end.toFixed(2)}s ({(seg.end - seg.start).toFixed(1)}s)
          {seg.ttsDuration && <span className="text-fuchsia-500 ml-1">· TTS {seg.ttsDuration.toFixed(1)}s</span>}
        </span>
        <div className="flex items-center gap-1">
          {/* TTS status badge */}
          <button onClick={e => { e.stopPropagation(); onTTS(); }} disabled={seg.isGeneratingTTS}
            className={`px-2 py-0.5 rounded text-[9px] font-bold border transition-all flex items-center gap-1
              ${ttsOk   ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/30'
              : seg.isGeneratingTTS ? 'bg-violet-600/20 text-violet-300 border-violet-500/30'
              :                        'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'}`}>
            {seg.isGeneratingTTS ? <><Spinner color="violet" /> Synth…</> : ttsOk ? '♪ TTS ✓' : '♪ TTS'}
          </button>
          {ttsOk &&
            <button onClick={e => { e.stopPropagation(); onPlay(); }}
              className="p-1 rounded border border-violet-500/30 bg-violet-600/15 text-violet-300 hover:bg-violet-600/25">
              <Ico d={I.play} cls="w-3 h-3" />
            </button>}
        </div>
      </div>
      {isSelected
        ? <textarea value={seg.myanmarText} onChange={e => onChange(e.target.value)} onClick={e => e.stopPropagation()}
            className="w-full bg-slate-900 border border-violet-500/30 rounded-lg p-2 text-xs text-yellow-200 font-myanmar focus:outline-none resize-none mt-1"
            rows={2} />
        : <p className="text-xs text-slate-100 font-myanmar leading-relaxed line-clamp-2">{seg.myanmarText}</p>}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  // ── settings ────────────────────────────────────────────────────────────
  const [apiKey,   setApiKey]   = useState('');
  const [demoMode, setDemoMode] = useState(true);

  // ── pipeline step ────────────────────────────────────────────────────────
  const [step, setStep] = useState(1);

  // ── toast ────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState(null);
  const showOk  = msg => { setToast({ type:'ok',  msg }); setTimeout(() => setToast(null), 4500); };
  const showErr = msg => { setToast({ type:'err', msg }); setTimeout(() => setToast(null), 7000); };

  // ── video ────────────────────────────────────────────────────────────────
  const [videoFile, setVideoFile] = useState(null);
  const [videoUrl,  setVideoUrl]  = useState(null);
  const [audioBuf,  setAudioBuf]  = useState(null);
  const [duration,  setDuration]  = useState(0);
  const [curTime,   setCurTime]   = useState(0);

  // ── step 2: transcription ────────────────────────────────────────────────
  const [chunks,        setChunks]        = useState([]);
  const [txSegs,        setTxSegs]        = useState([]);   // raw transcription output
  const [isTx,          setIsTx]          = useState(false);
  const [txProg,        setTxProg]        = useState(0);
  const [txMsg,         setTxMsg]         = useState('');

  // ── step 3: recap script ─────────────────────────────────────────────────
  const [recapScript,   setRecapScript]   = useState('');
  const [isGenRecap,    setIsGenRecap]    = useState(false);

  // ── step 4: segments (from recap) + TTS ──────────────────────────────────
  const [segments,      setSegments]      = useState([]);
  const [selectedSeg,   setSelectedSeg]   = useState(null);
  const [isBatchTts,    setIsBatchTts]    = useState(false);
  const [batchTtsProg,  setBatchTtsProg]  = useState(0);
  const [ttsVoice,      setTtsVoice]      = useState('Kore');
  const [ttsEmotion,    setTtsEmotion]    = useState('excitedly');

  // ── step 5: tts sync ─────────────────────────────────────────────────────
  const [isSynced,      setIsSynced]      = useState(false);

  // ── step 6: render ───────────────────────────────────────────────────────
  const [isRendering,   setIsRendering]   = useState(false);
  const [renderProg,    setRenderProg]    = useState(0);
  const [outputUrl,     setOutputUrl]     = useState(null);
  const [outputMime,    setOutputMime]    = useState('video/webm');

  // ── refs ─────────────────────────────────────────────────────────────────
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const ttsRefs   = useRef({});

  // ── playhead ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current; if (!v) return;
    const fn = () => setCurTime(v.currentTime);
    v.addEventListener('timeupdate', fn);
    return () => v.removeEventListener('timeupdate', fn);
  }, [videoUrl]);

  // ── waveform ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (audioBuf && canvasRef.current) drawWaveform(audioBuf, canvasRef.current);
  }, [audioBuf]);

  // ── active subtitle ───────────────────────────────────────────────────────
  const activeSeg = segments.find(s => curTime >= s.start && curTime < s.end);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1 — Upload
  // ═══════════════════════════════════════════════════════════════════════════
  const handleUpload = async e => {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 250 * 1024 * 1024) { showErr('Max 250MB. Please compress first.'); return; }
    setVideoFile(file);
    const url = URL.createObjectURL(file);
    setVideoUrl(url); setOutputUrl(null); setSegments([]); setTxSegs([]);
    setRecapScript(''); setChunks([]); setIsSynced(false); setStep(2);
    try {
      const actx = new (window.AudioContext || window.webkitAudioContext)();
      const decoded = await actx.decodeAudioData(await file.arrayBuffer());
      setAudioBuf(decoded);
      const dur = decoded.duration; setDuration(dur);
      const N = Math.ceil(dur / 30);
      setChunks(Array.from({ length: N }, (_, i) => ({
        i, start: i*30, end: Math.min((i+1)*30, dur), status: 'pending'
      })));
      showOk(`✓ Video loaded — ${dur.toFixed(0)}s, ${N} chunks ready for transcription.`);
    } catch (ex) { showErr(`Audio decode failed: ${ex.message}`); }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2 — Transcribe + Translate
  // ═══════════════════════════════════════════════════════════════════════════
  const runTranscription = async () => {
    if (!demoMode && !apiKey) { showErr('Enter your Gemini API key.'); return; }
    if (!chunks.length) { showErr('Upload a video first.'); return; }
    setIsTx(true); setTxProg(0); setTxSegs([]);
    const all = []; const cks = chunks.map(c => ({ ...c }));
    try {
      for (let i = 0; i < cks.length; i++) {
        cks[i].status = 'processing'; setChunks([...cks]);
        setTxMsg(`Chunk ${i+1}/${cks.length}: ${cks[i].start.toFixed(0)}s–${cks[i].end.toFixed(0)}s…`);
        if (demoMode || !apiKey) {
          await sleep(500);
          const d = cks[i].end - cks[i].start, n = Math.max(1, Math.round(d / 8));
          for (let j = 0; j < n; j++) {
            const s = cks[i].start + j*(d/n)+0.5, e = Math.min(s+d/n-1, cks[i].end-0.2);
            all.push({ id:`tx-${i}-${j}`, start:+s.toFixed(2), end:+e.toFixed(2),
              sourceText:`Spoken dialogue ${i+1}.${j+1}.`,
              myanmarText:`ဗီဒီယိုမှ ဒေါ်ကိုင်းပြောဆိုချက် ${i+1} ၊ ${j+1} ။`,
              ttsUrl:null, ttsDuration:null, isGeneratingTTS:false });
          }
        } else {
          const b64 = await audioBufferChunkToBase64(audioBuf, cks[i].start, cks[i].end);
          const segs = await transcribeChunkWithGemini(b64, cks[i].start, cks[i].end, apiKey);
          segs.forEach((s, j) => all.push({
            id:`tx-${i}-${j}`, start:+(s.start||cks[i].start).toFixed(2), end:+(s.end||cks[i].end).toFixed(2),
            sourceText:s.en||'', myanmarText:s.my||'', ttsUrl:null, ttsDuration:null, isGeneratingTTS:false
          }));
        }
        cks[i].status = 'done'; setChunks([...cks]); setTxProg((i+1)/cks.length);
      }
      all.sort((a,b)=>a.start-b.start);
      setTxSegs(all); setStep(3);
      setTxMsg(`Done — ${all.length} segments extracted.`);
      showOk(`✓ Transcription complete — ${all.length} dialogue segments.`);
    } catch (ex) { showErr(`Transcription error: ${ex.message}`); setTxMsg(''); }
    finally { setIsTx(false); }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3 — Generate Recap Script
  // ═══════════════════════════════════════════════════════════════════════════
  const runGenerateRecap = async () => {
    if (!demoMode && !apiKey) { showErr('Enter your Gemini API key.'); return; }
    if (!duration) { showErr('Upload a video first.'); return; }
    setIsGenRecap(true);
    try {
      let script = '';
      if (demoMode || !apiKey) { await sleep(1200); script = DEMO_RECAP; }
      else script = await generateRecapWithGemini(txSegs, duration, apiKey);
      setRecapScript(script);
      // Auto-split into segments and populate timeline
      const segs = splitScriptToTimedSegments(script, duration);
      setSegments(segs); setIsSynced(false); setStep(4);
      showOk(`✓ Recap script generated — ${segs.length} subtitle segments synced to ${duration.toFixed(0)}s.`);
    } catch (ex) { showErr(`Recap generation failed: ${ex.message}`); }
    finally { setIsGenRecap(false); }
  };

  const resyncManual = () => {
    if (!recapScript || !duration) { showErr('Need recap script and video.'); return; }
    const segs = splitScriptToTimedSegments(recapScript, duration);
    setSegments(segs); setIsSynced(false);
    showOk(`✓ Re-synced ${segs.length} segments across ${duration.toFixed(0)}s.`);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4 — TTS (per segment or batch all)
  // ═══════════════════════════════════════════════════════════════════════════
  const ttsSingleSeg = async id => {
    const seg = segments.find(s => s.id === id); if (!seg) return;
    setSegments(p => p.map(s => s.id===id ? {...s, isGeneratingTTS:true} : s));
    try {
      if (demoMode || !apiKey) {
        await sleep(700);
        window.speechSynthesis?.speak(Object.assign(new SpeechSynthesisUtterance(seg.myanmarText), { lang:'my-MM' }));
        setSegments(p => p.map(s => s.id===id ? {...s, ttsUrl:'demo', ttsDuration:s.end-s.start, isGeneratingTTS:false} : s));
      } else {
        const { url, duration: d } = await requestGeminiTts(seg.myanmarText, ttsVoice, ttsEmotion, apiKey);
        setSegments(p => p.map(s => s.id===id ? {...s, ttsUrl:url, ttsDuration:d, isGeneratingTTS:false} : s));
      }
    } catch (ex) {
      showErr(`TTS error: ${ex.message}`);
      setSegments(p => p.map(s => s.id===id ? {...s, isGeneratingTTS:false} : s));
    }
  };

  const playSegTts = seg => {
    if (!seg.ttsUrl || seg.ttsUrl==='demo') return;
    ttsRefs.current[seg.id]?.pause();
    const a = new Audio(seg.ttsUrl); a.play(); ttsRefs.current[seg.id] = a;
  };

  const runBatchTts = async () => {
    if (!demoMode && !apiKey) { showErr('Enter your Gemini API key.'); return; }
    if (!segments.length) { showErr('Generate recap script first.'); return; }
    setIsBatchTts(true); setBatchTtsProg(0);
    try {
      // Sequential to respect rate limits
      const updated = [...segments];
      for (let i = 0; i < updated.length; i++) {
        setSegments(p => p.map(s => s.id===updated[i].id ? {...s, isGeneratingTTS:true} : s));
        setBatchTtsProg(i / updated.length);
        if (demoMode || !apiKey) {
          await sleep(300);
          updated[i] = { ...updated[i], ttsUrl:'demo', ttsDuration:updated[i].end-updated[i].start, isGeneratingTTS:false };
        } else {
          try {
            const { url, duration:d } = await requestGeminiTts(updated[i].myanmarText, ttsVoice, ttsEmotion, apiKey);
            updated[i] = { ...updated[i], ttsUrl:url, ttsDuration:d, isGeneratingTTS:false };
            await sleep(200); // gentle rate limiting
          } catch { updated[i] = { ...updated[i], isGeneratingTTS:false }; }
        }
        setSegments([...updated]);
      }
      setBatchTtsProg(1);
      const doneCount = updated.filter(s => s.ttsUrl).length;
      showOk(`✓ TTS complete — ${doneCount}/${updated.length} segments synthesized.`);
      if (step < 5) setStep(5);
    } catch (ex) { showErr(`Batch TTS failed: ${ex.message}`); }
    finally { setIsBatchTts(false); }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5 — TTS Subtitle Sync
  // Re-distribute subtitle timestamps to match real TTS audio durations
  // ═══════════════════════════════════════════════════════════════════════════
  const runTtsSync = () => {
    const hasTts = segments.some(s => s.ttsUrl);
    if (!hasTts) { showErr('Run TTS first (Step 4).'); return; }
    const synced = resyncSegmentsToTts(segments, duration);
    setSegments(synced); setIsSynced(true); setStep(6);
    showOk(`✓ Subtitle timings synced to TTS audio durations — ${synced.length} segments.`);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 6 — Export SRT + Render Output Video
  // ═══════════════════════════════════════════════════════════════════════════
  const exportSrt = () => {
    if (!segments.length) { showErr('No segments to export.'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buildSrt(segments)], { type:'text/srt;charset=utf-8' }));
    a.download = (videoFile?.name.replace(/\.[^.]+$/, '') || 'subtitles') + '_Myanmar.srt';
    a.click(); showOk('✓ SRT exported!');
  };

  const runRenderVideo = async () => {
    if (!videoRef.current || !segments.length) { showErr('Need video + synced segments.'); return; }
    if (!videoRef.current.videoWidth) { showErr('Video not ready. Wait for it to load fully.'); return; }
    setIsRendering(true); setRenderProg(0); setOutputUrl(null);
    try {
      const url = await renderOutputVideo(videoRef.current, segments, p => setRenderProg(p));
      setOutputUrl(url);
      const mime = ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';
      setOutputMime(mime);
      showOk('✓ Output video rendered with Myanmar TTS audio + burned subtitles!');
    } catch (ex) { showErr(`Render failed: ${ex.message}`); }
    finally { setIsRendering(false); }
  };

  // ── stats ────────────────────────────────────────────────────────────────
  const ttsCount  = segments.filter(s => s.ttsUrl).length;
  const syncedPct = duration && segments.length ? Math.round((segments.reduce((a,s)=>a+(s.end-s.start),0)/duration)*100) : 0;

  // ─── RENDER ──────────────────────────────────────────────────────────────
  return (
    <>
      <Head><title>Htut Movie Recap Studio — Myanmar Dubbing Suite</title></Head>

      <div className="min-h-screen bg-[#030712] text-slate-100 flex flex-col">
        <div className="fixed inset-0 bg-grid opacity-40 pointer-events-none" />
        <div className="fixed top-0 left-1/4 w-[500px] h-[300px] bg-violet-700/5 rounded-full blur-3xl pointer-events-none" />

        {/* ── HEADER ─────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-50 border-b border-violet-500/20 bg-slate-950/90 backdrop-blur-xl px-5 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-violet-500/40 to-transparent" />
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-tr from-violet-700 to-fuchsia-600 rounded-xl flex items-center justify-center">
              <Ico d={I.mic} cls="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-black heading-gradient">Htut Movie Recap Studio</h1>
              <p className="text-[10px] text-slate-500 font-mono">Myanmar Dubbing Suite · Gemini 2.5 Flash TTS</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-0.5 bg-slate-950 border border-slate-800 rounded-xl p-1">
              {['Demo','Live API'].map((m,i) => (
                <button key={m} onClick={() => setDemoMode(i===0)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${(i===0)===demoMode ? 'tab-active' : 'text-slate-500 hover:text-slate-300'}`}>
                  {m}
                </button>
              ))}
            </div>
            {!demoMode && (
              <input type="password" placeholder="Gemini API Key…" value={apiKey} onChange={e=>setApiKey(e.target.value)}
                className="input-premium bg-slate-950 rounded-xl px-3 py-2 text-xs text-violet-300 placeholder:text-slate-700 w-44 font-mono" />
            )}
            <button onClick={exportSrt} className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 px-3 py-2 rounded-xl text-xs font-bold text-slate-200 transition-all hover:border-violet-400/30">
              <Ico d={I.dl} cls="w-3.5 h-3.5" /> SRT
            </button>
          </div>
        </header>

        {/* ── STEP BAR ───────────────────────────────────────────────── */}
        <StepBar current={step} />

        {/* ── TOAST ──────────────────────────────────────────────────── */}
        {toast && (
          <div className={`mx-5 mt-3 animate-fade-in px-4 py-2.5 rounded-xl flex items-center justify-between text-xs font-medium backdrop-blur
            ${toast.type==='ok' ? 'bg-emerald-950/70 border border-emerald-500/40 text-emerald-200' : 'bg-red-950/70 border border-red-500/40 text-red-200'}`}>
            <span>{toast.msg}</span>
            <button onClick={()=>setToast(null)} className="ml-3 opacity-60 hover:opacity-100"><Ico d={I.close} cls="w-3.5 h-3.5" /></button>
          </div>
        )}

        {/* ── MAIN ───────────────────────────────────────────────────── */}
        <main className="flex-1 px-5 py-4 grid grid-cols-1 xl:grid-cols-12 gap-4 min-h-0">

          {/* ══ LEFT COLUMN ══ */}
          <div className="xl:col-span-5 flex flex-col gap-4">

            {/* VIDEO */}
            <div className="studio-panel p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-100 flex items-center gap-2"><Ico d={I.video} cls="w-4 h-4 text-violet-400"/>Video Source</span>
                {videoFile && <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/30 px-2 py-0.5 rounded-full border border-emerald-500/20 truncate max-w-[150px]">{videoFile.name}</span>}
              </div>

              {!videoUrl ? (
                <label className="flex flex-col items-center justify-center h-44 border-2 border-dashed border-violet-500/25 rounded-2xl cursor-pointer hover:border-violet-500/50 hover:bg-violet-950/10 transition-all group">
                  <span className="text-4xl mb-2 group-hover:scale-110 transition-transform">🎬</span>
                  <p className="text-xs font-bold text-slate-400 group-hover:text-violet-300">Upload Video File</p>
                  <p className="text-[10px] text-slate-600 mt-0.5">MP4, MOV, AVI · Max 250MB</p>
                  <input type="file" accept="video/*" onChange={handleUpload} className="hidden" />
                </label>
              ) : (
                <div className="relative rounded-xl overflow-hidden bg-black border border-slate-800">
                  <video ref={videoRef} src={videoUrl} className="w-full max-h-56 object-contain" controls
                    onLoadedMetadata={e => setDuration(e.target.duration)} />
                  {activeSeg && (
                    <div className="absolute bottom-8 left-0 right-0 flex justify-center pointer-events-none px-3">
                      <div className="bg-black/85 rounded-lg px-3 py-1.5 max-w-[92%]">
                        <p className="text-xs font-bold text-white font-myanmar text-center leading-relaxed">{activeSeg.myanmarText}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Waveform */}
              <div className="relative rounded-xl overflow-hidden bg-[#030712] border border-slate-800/60">
                <canvas ref={canvasRef} width={640} height={52} className="w-full h-11" />
                {duration > 0 && segments.map(s => (
                  <div key={s.id} className="absolute top-0 bottom-0 pointer-events-none"
                    style={{ left:`${(s.start/duration)*100}%`, width:`${Math.max(0.2,((s.end-s.start)/duration)*100)}%`,
                             background: s.ttsUrl ? 'rgba(16,185,129,0.2)' : 'rgba(124,58,237,0.15)' }} />
                ))}
                {duration > 0 && (
                  <div className="absolute top-0 bottom-0 w-0.5 bg-white/70 pointer-events-none"
                    style={{ left:`${(curTime/duration)*100}%` }} />
                )}
                {!audioBuf && <div className="absolute inset-0 flex items-center justify-center"><span className="text-[9px] font-mono text-slate-700">Upload video to visualize audio</span></div>}
              </div>

              {/* Stats */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { l:'Duration', v: duration ? `${duration.toFixed(0)}s` : '—', c:'text-violet-400' },
                  { l:'Segments', v: segments.length || '—', c:'text-fuchsia-400' },
                  { l:'Coverage', v: segments.length ? `${syncedPct}%` : '—', c:'text-cyan-400' },
                  { l:'TTS Done', v: segments.length ? `${ttsCount}/${segments.length}` : '—', c:'text-emerald-400' },
                ].map(m => (
                  <div key={m.l} className="bg-slate-950/80 border border-slate-800 rounded-xl p-2 text-center">
                    <div className={`metric-value text-sm font-black ${m.c}`}>{m.v}</div>
                    <div className="text-[9px] text-slate-600 uppercase tracking-wider mt-0.5">{m.l}</div>
                  </div>
                ))}
              </div>

              {/* Change video */}
              {videoUrl && (
                <label className="flex items-center justify-center gap-2 py-2 rounded-xl border border-slate-800 text-xs text-slate-500 hover:text-slate-300 hover:border-slate-700 cursor-pointer transition-all">
                  <Ico d={I.upload} cls="w-3.5 h-3.5" /> Change Video
                  <input type="file" accept="video/*" onChange={handleUpload} className="hidden" />
                </label>
              )}
            </div>

            {/* PIPELINE */}
            <div className="studio-panel p-4 flex flex-col gap-3">
              <span className="text-sm font-bold text-slate-100 flex items-center gap-2"><Ico d={I.sync} cls="w-4 h-4 text-violet-400"/>Pipeline Controls</span>

              {/* Chunk grid */}
              {chunks.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">30s Chunks</span>
                    <span className="text-[10px] font-mono text-violet-300">{chunks.filter(c=>c.status==='done').length}/{chunks.length}</span>
                  </div>
                  <div className="grid grid-cols-5 gap-1 max-h-24 overflow-y-auto">
                    {chunks.map(c => (
                      <div key={c.i} className={`p-1.5 rounded-lg border text-center text-[8px] font-mono transition-all
                        ${c.status==='done' ? 'bg-emerald-950/20 border-emerald-500/20 text-emerald-500'
                        : c.status==='processing' ? 'bg-yellow-950/20 border-yellow-500/30 text-yellow-400'
                        : 'bg-slate-950 border-slate-800 text-slate-600'}`}>
                        {c.start.toFixed(0)}–{c.end.toFixed(0)}s
                        <div>{c.status==='done'?'✓':c.status==='processing'?'…':'○'}</div>
                      </div>
                    ))}
                  </div>
                  {isTx && <div className="mt-1.5"><PBar v={txProg}/><p className="text-[10px] font-mono text-violet-300 mt-1">{txMsg}</p></div>}
                </div>
              )}

              {/* ① Transcribe */}
              <button onClick={runTranscription} disabled={isTx || !chunks.length}
                className="btn-premium w-full py-3 rounded-xl text-xs font-black flex items-center justify-center gap-2 disabled:opacity-40">
                {isTx ? <><Spinner />Transcribing + Translating…</> : <><Ico d={I.mic} cls="w-3.5 h-3.5"/>① Transcribe + Translate Audio</>}
              </button>

              {/* ② Recap Script */}
              <button onClick={runGenerateRecap} disabled={isGenRecap}
                className="w-full py-3 rounded-xl text-xs font-black flex items-center justify-center gap-2
                  bg-fuchsia-600/20 hover:bg-fuchsia-600/30 text-fuchsia-200 border border-fuchsia-500/30 transition-all disabled:opacity-40">
                {isGenRecap ? <><Spinner color="fuchsia"/>Generating Recap Script…</> : <><Ico d={I.script} cls="w-3.5 h-3.5"/>② Generate Myanmar Recap Script</>}
              </button>

              {/* ③ Batch TTS */}
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1 uppercase tracking-wider">Voice</label>
                    <select value={ttsVoice} onChange={e=>setTtsVoice(e.target.value)}
                      className="input-premium w-full bg-slate-950 rounded-lg px-2 py-1.5 text-[10px] text-slate-300">
                      {[...VOICES.male,...VOICES.female].map(v=><option key={v.value} value={v.value}>{v.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1 uppercase tracking-wider">Emotion</label>
                    <select value={ttsEmotion} onChange={e=>setTtsEmotion(e.target.value)}
                      className="input-premium w-full bg-slate-950 rounded-lg px-2 py-1.5 text-[10px] text-slate-300">
                      {EMOTIONS.map(e=><option key={e.value} value={e.value}>{e.label}</option>)}
                    </select>
                  </div>
                </div>
                <button onClick={runBatchTts} disabled={isBatchTts || !segments.length}
                  className="w-full py-3 rounded-xl text-xs font-black flex items-center justify-center gap-2
                    bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-200 border border-cyan-500/30 transition-all disabled:opacity-40">
                  {isBatchTts ? <><Spinner color="cyan"/>TTS Synthesizing {Math.round(batchTtsProg*100)}%…</> : <><Ico d={I.tts} cls="w-3.5 h-3.5"/>③ Batch TTS — Synthesize All Segments</>}
                </button>
                {isBatchTts && <PBar v={batchTtsProg} color="cyan"/>}
              </div>

              {/* ④ TTS Sync */}
              <button onClick={runTtsSync} disabled={!ttsCount}
                className="w-full py-3 rounded-xl text-xs font-black flex items-center justify-center gap-2
                  bg-amber-600/20 hover:bg-amber-600/30 text-amber-200 border border-amber-500/30 transition-all disabled:opacity-40">
                <Ico d={I.sync} cls="w-3.5 h-3.5"/>④ Sync Subtitle Timings to TTS Durations
                {isSynced && <span className="ml-1 text-emerald-400">✓</span>}
              </button>

              {/* ⑤ Render video */}
              <button onClick={runRenderVideo} disabled={isRendering || !segments.length || !videoUrl}
                className="w-full py-3 rounded-xl text-xs font-black flex items-center justify-center gap-2
                  bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-200 border border-emerald-500/30 transition-all disabled:opacity-40">
                {isRendering
                  ? <><Spinner color="emerald"/>Rendering… {Math.round(renderProg*100)}%</>
                  : <><Ico d={I.video} cls="w-3.5 h-3.5"/>⑤ Render Output Video (TTS + Subtitles)</>}
              </button>
              {isRendering && <PBar v={renderProg} color="emerald"/>}

              {/* Download */}
              {outputUrl && (
                <a href={outputUrl} download="htut_myanmar_recap.webm"
                  className="w-full py-3 rounded-xl text-xs font-black flex items-center justify-center gap-2
                    bg-violet-600 hover:bg-violet-500 text-white transition-all shadow-lg shadow-violet-500/20">
                  <Ico d={I.dl} cls="w-3.5 h-3.5"/>Download Output Video (.webm)
                </a>
              )}
            </div>
          </div>

          {/* ══ RIGHT COLUMN ══ */}
          <div className="xl:col-span-7 flex flex-col gap-4">

            {/* SUBTITLE TIMELINE */}
            <div className="studio-panel p-4 flex flex-col gap-3 flex-1" style={{minHeight:'420px'}}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-violet-400">Subtitle Timeline</span>
                    {isSynced && <span className="badge-completed text-[9px] px-1.5 py-0.5 rounded-full font-bold">TTS-synced ✓</span>}
                  </div>
                  <h2 className="text-sm font-bold text-slate-100">
                    {segments.length} Segments
                    {duration>0 && <span className="text-slate-500 font-normal text-xs ml-2">· {duration.toFixed(0)}s video · {syncedPct}% coverage</span>}
                  </h2>
                </div>
                <div className="flex gap-2">
                  <button onClick={resyncManual} disabled={!recapScript}
                    className="text-[10px] flex items-center gap-1 bg-cyan-600/15 hover:bg-cyan-600/25 text-cyan-300 border border-cyan-500/25 px-2.5 py-1.5 rounded-lg font-bold transition-all disabled:opacity-40">
                    <Ico d={I.sync} cls="w-3 h-3"/>Re-sync
                  </button>
                  <button onClick={exportSrt}
                    className="text-[10px] flex items-center gap-1 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 px-2.5 py-1.5 rounded-lg font-bold transition-all">
                    <Ico d={I.dl} cls="w-3 h-3"/>SRT
                  </button>
                </div>
              </div>

              {/* Timeline ruler */}
              {duration>0 && segments.length>0 && (
                <div className="relative h-7 bg-slate-950 rounded-lg overflow-hidden border border-slate-800 flex-shrink-0">
                  {segments.map((s,i) => (
                    <div key={s.id} onClick={()=>{setSelectedSeg(s.id); if(videoRef.current) videoRef.current.currentTime=s.start;}}
                      className="absolute top-1 bottom-1 rounded cursor-pointer hover:brightness-125 transition-all"
                      style={{ left:`${(s.start/duration)*100}%`,
                               width:`${Math.max(0.3,((s.end-s.start)/duration)*100)}%`,
                               background: s.ttsUrl ? `hsl(${150+i*7},60%,35%,.7)` : `hsl(${260+i*5},60%,45%,.5)` }}
                      title={`${s.start.toFixed(1)}–${s.end.toFixed(1)}s`}/>
                  ))}
                  <div className="absolute top-0 bottom-0 w-0.5 bg-white/80 pointer-events-none"
                    style={{ left:`${(curTime/duration)*100}%` }}/>
                </div>
              )}

              {/* Segment list */}
              <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                {segments.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-slate-700 gap-3">
                    <span className="text-4xl">📋</span>
                    <p className="text-xs text-center">Complete Steps ①② to populate subtitle timeline</p>
                  </div>
                ) : segments.map(seg => (
                  <SegRow key={seg.id} seg={seg}
                    isActive={curTime>=seg.start && curTime<seg.end}
                    isSelected={selectedSeg===seg.id}
                    onSelect={()=>{setSelectedSeg(p=>p===seg.id?null:seg.id); if(videoRef.current) videoRef.current.currentTime=seg.start;}}
                    onChange={text=>setSegments(p=>p.map(s=>s.id===seg.id?{...s,myanmarText:text}:s))}
                    onTTS={()=>ttsSingleSeg(seg.id)}
                    onPlay={()=>playSegTts(seg)}/>
                ))}
              </div>
            </div>

            {/* RECAP SCRIPT EDITOR */}
            <div className="studio-panel p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-fuchsia-400">Step 3 · Recap Script</span>
                  <h2 className="text-sm font-bold text-slate-100 mt-0.5">Myanmar Movie Recap Script</h2>
                  <p className="text-[10px] text-slate-500">Edit script below — click Re-sync to redistribute subtitle timings</p>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-slate-500">
                  <span>{recapScript.length} chars</span>
                  {duration>0 && recapScript && <span className="text-violet-400">~{(recapScript.length/duration).toFixed(1)}/s</span>}
                </div>
              </div>

              <textarea value={recapScript} onChange={e=>setRecapScript(e.target.value)}
                placeholder={"Press ② to generate the Myanmar recap script.\n\nOr paste your script here, then click Re-sync."}
                className="input-premium w-full bg-slate-950 rounded-xl p-3 text-xs text-slate-200 font-myanmar focus:outline-none resize-none leading-relaxed"
                rows={7}/>

              <div className="grid grid-cols-2 gap-2">
                <button onClick={runGenerateRecap} disabled={isGenRecap}
                  className="btn-premium py-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-2">
                  {isGenRecap ? <><Spinner/>Generating…</> : '🎭 Generate Recap + Auto-Sync'}
                </button>
                <button onClick={resyncManual} disabled={!recapScript}
                  className="py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2
                    bg-cyan-600/15 hover:bg-cyan-600/25 text-cyan-300 border border-cyan-500/25 transition-all disabled:opacity-40">
                  <Ico d={I.sync} cls="w-3.5 h-3.5"/>Re-sync to Video Length
                </button>
              </div>
            </div>

          </div>
        </main>

        {/* ── FOOTER ─────────────────────────────────────────────────── */}
        <footer className="border-t border-violet-500/10 bg-slate-950/60 px-5 py-2.5 flex flex-wrap items-center justify-between text-[9px] text-slate-600 gap-2">
          <span className="font-mono text-violet-700">Htut Production Suite · Upload→Transcribe→Recap→TTS→Sync→Output</span>
          <span className={`px-2 py-0.5 rounded-full font-bold font-mono ${demoMode ? 'text-amber-400 bg-amber-950/30 border border-amber-500/20' : 'text-emerald-400 bg-emerald-950/30 border border-emerald-500/20'}`}>
            {demoMode ? '◌ DEMO' : '● LIVE API'}
          </span>
        </footer>
      </div>
    </>
  );
}
