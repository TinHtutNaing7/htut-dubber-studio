import { useState, useEffect, useRef, useCallback } from 'react';
import Head from 'next/head';
import {
  audioBufferChunkToBase64, transcribeChunkWithGemini,
  generateRecapWithGemini, splitScriptToTimedSegments,
  requestGeminiTts, drawWaveform, buildSrt, renderOutputVideo,
  DEMO_SEGMENTS, DEMO_RECAP, VOICES, EMOTIONS, sleep
} from '../lib/audio';

// ─── Tiny icons ──────────────────────────────────────────────────────────────
const Icon = ({ d, cls='w-4 h-4' }) => (
  <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d}/>
  </svg>
);
const ICO_MIC   = 'M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z';
const ICO_DL    = 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4';
const ICO_PLAY  = 'M5 3l14 9-14 9V3z';
const ICO_FILM  = 'M7 4v16M17 4v16M3 8h4m10 0h4M3 16h4m10 0h4M4 4h16a1 1 0 011 1v14a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z';
const ICO_CHECK = 'M5 13l4 4L19 7';
const ICO_SYNC  = 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15';
const ICO_VIDEO = 'M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z';

function Spin({ c='violet' }) {
  return <span className={`inline-block w-3.5 h-3.5 rounded-full border-2 border-${c}-400 border-t-transparent animate-spin`}/>;
}

function Badge({ status }) {
  if (status === 'done')       return <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold badge-completed">✓ Done</span>;
  if (status === 'processing') return <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold badge-processing">⟳ Active</span>;
  return                              <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold badge-pending">◌ Queued</span>;
}

function ProgressBar({ value, color='violet' }) {
  return (
    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-300"
        style={{ width: `${Math.min(100, Math.max(0, value*100))}%`,
                 background: color==='violet' ? 'linear-gradient(90deg,#7c3aed,#c026d3)'
                           : color==='emerald' ? 'linear-gradient(90deg,#059669,#10b981)'
                           : 'linear-gradient(90deg,#0284c7,#06b6d4)' }} />
    </div>
  );
}

// ─── Step indicator ──────────────────────────────────────────────────────────
function Steps({ current }) {
  const steps = [
    { n:1, label:'Upload Video' },
    { n:2, label:'Transcribe + Translate' },
    { n:3, label:'Generate Recap Script' },
    { n:4, label:'Sync Subtitles' },
    { n:5, label:'Export / Output' },
  ];
  return (
    <div className="flex items-center gap-0 overflow-x-auto pb-1">
      {steps.map((s,i) => (
        <div key={s.n} className="flex items-center">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all whitespace-nowrap
            ${current===s.n ? 'bg-violet-600/30 text-violet-200 border border-violet-500/50' :
              current>s.n ? 'text-emerald-400' : 'text-slate-600'}`}>
            <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black
              ${current===s.n ? 'bg-violet-600 text-white' : current>s.n ? 'bg-emerald-600/30 text-emerald-400' : 'bg-slate-800 text-slate-600'}`}>
              {current>s.n ? '✓' : s.n}
            </span>
            {s.label}
          </div>
          {i<steps.length-1 && <span className={`mx-1 text-slate-700 text-xs`}>›</span>}
        </div>
      ))}
    </div>
  );
}

// ─── Subtitle row ─────────────────────────────────────────────────────────────
function SubRow({ seg, isActive, isSelected, currentTime, onClick, onChange, onTTS, onPlay }) {
  return (
    <div onClick={onClick}
      className={`p-3 rounded-xl border cursor-pointer transition-all text-left
        ${isActive   ? 'segment-active ring-1 ring-violet-500/40' :
          isSelected ? 'bg-slate-900 border-slate-600' :
                       'bg-slate-950/60 border-slate-800 hover:border-slate-700'}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[9px] font-mono text-slate-500 bg-slate-800/60 px-1.5 py-0.5 rounded">
          {seg.start.toFixed(2)}s → {seg.end.toFixed(2)}s &nbsp;({(seg.end-seg.start).toFixed(1)}s)
        </span>
        <div className="flex items-center gap-1.5">
          {seg.dubSpeed && seg.dubSpeed!==1 &&
            <span className="text-[9px] font-mono text-amber-400 bg-amber-950/30 px-1.5 rounded">{seg.dubSpeed}x</span>}
          <button onClick={e=>{e.stopPropagation();onTTS();}}
            className={`px-2 py-0.5 rounded-md text-[9px] font-bold border transition-all
              ${seg.audioUrl ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/30' : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'}`}>
            {seg.isGeneratingTTS ? <Spin/> : seg.audioUrl ? '♪ TTS' : 'TTS'}
          </button>
          {seg.audioUrl && !seg.audioUrl.startsWith('demo') &&
            <button onClick={e=>{e.stopPropagation();onPlay();}}
              className="p-1 bg-violet-600/20 text-violet-300 rounded-md border border-violet-500/30 hover:bg-violet-600/30">
              <Icon d={ICO_PLAY} cls="w-3 h-3"/>
            </button>}
        </div>
      </div>
      {isSelected ? (
        <textarea value={seg.myanmarText}
          onChange={e=>onChange(e.target.value)}
          onClick={e=>e.stopPropagation()}
          className="w-full bg-slate-900 border border-violet-500/30 rounded-lg p-2 text-xs text-yellow-200 font-myanmar focus:outline-none focus:border-violet-400 resize-none mt-1"
          rows={2}/>
      ) : (
        <p className="text-xs text-slate-100 font-myanmar leading-relaxed line-clamp-2 mt-0.5">{seg.myanmarText}</p>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  // ── Core state ──────────────────────────────────────────────────────────
  const [apiKey, setApiKey]         = useState('');
  const [demoMode, setDemoMode]     = useState(true);
  const [step, setStep]             = useState(1);
  const [toast, setToast]           = useState(null); // {type:'ok'|'err', msg}

  // ── Video ────────────────────────────────────────────────────────────────
  const [videoFile, setVideoFile]   = useState(null);
  const [videoUrl, setVideoUrl]     = useState(null);
  const [audioBuf, setAudioBuf]     = useState(null);
  const [duration, setDuration]     = useState(0);
  const [currentTime, setCT]        = useState(0);

  // ── Chunks & transcription ───────────────────────────────────────────────
  const [chunks, setChunks]         = useState([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [txProgress, setTxProgress] = useState(0); // 0-1
  const [txStatus, setTxStatus]     = useState('');

  // ── Segments (subtitle timeline) ────────────────────────────────────────
  const [segments, setSegments]     = useState([]);
  const [selectedSeg, setSelectedSeg] = useState(null);
  const [subtitleMode, setSubtitleMode] = useState('recap'); // 'transcription' | 'recap'

  // ── Recap script ────────────────────────────────────────────────────────
  const [recapScript, setRecapScript] = useState('');
  const [isGenRecap, setIsGenRecap] = useState(false);
  const [recapVoice, setRecapVoice] = useState('Kore');
  const [recapEmotion, setRecapEmotion] = useState('excitedly');

  // ── Output video ────────────────────────────────────────────────────────
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [outputUrl, setOutputUrl]   = useState(null);

  // ── Refs ─────────────────────────────────────────────────────────────────
  const videoRef    = useRef(null);
  const canvasRef   = useRef(null);
  const audioRefs   = useRef({});
  const fileInputRef = useRef(null);

  // ── Toast helper ─────────────────────────────────────────────────────────
  const ok  = msg => { setToast({type:'ok', msg}); setTimeout(()=>setToast(null), 4000); };
  const err = msg => { setToast({type:'err',msg}); setTimeout(()=>setToast(null), 6000); };

  // ── Playhead sync ─────────────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setCT(v.currentTime);
    v.addEventListener('timeupdate', onTime);
    return () => v.removeEventListener('timeupdate', onTime);
  }, [videoUrl]);

  // ── Waveform ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (audioBuf && canvasRef.current) drawWaveform(audioBuf, canvasRef.current);
  }, [audioBuf]);

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1: Upload video → decode audio → create chunks
  // ─────────────────────────────────────────────────────────────────────────
  const handleUpload = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 200*1024*1024) { err('File too large (max 200 MB). Compress it first.'); return; }
    setVideoFile(file);
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setOutputUrl(null);
    setSegments([]);
    setRecapScript('');
    setChunks([]);
    setTxProgress(0);
    setStep(2);
    setTxStatus('Decoding audio…');

    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const ab = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(ab);
      setAudioBuf(decoded);
      const dur = decoded.duration;
      setDuration(dur);
      const CHUNK = 30;
      const n = Math.ceil(dur / CHUNK);
      setChunks(Array.from({length:n},(_,i)=>({
        i, start:i*CHUNK, end:Math.min((i+1)*CHUNK, dur),
        status:'pending', progress:0
      })));
      setTxStatus(`Audio decoded (${dur.toFixed(0)}s). Ready to transcribe ${n} chunks.`);
      ok(`Video loaded — ${dur.toFixed(0)} seconds, ${n} chunks ready.`);
    } catch(ex) {
      err(`Audio decode failed: ${ex.message}`);
      setTxStatus('Audio decode failed — try a different file.');
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2: Transcribe + Translate (real Gemini or demo)
  // ─────────────────────────────────────────────────────────────────────────
  const runTranscription = async () => {
    if (!demoMode && !apiKey) { err('Enter your Gemini API key first.'); return; }
    if (!chunks.length) { err('Upload a video first.'); return; }
    setIsTranscribing(true);
    setTxProgress(0);
    const all = [];

    const updChunks = chunks.map(c=>({...c}));
    const setC = arr => setChunks([...arr]);

    try {
      for (let i=0; i<updChunks.length; i++) {
        updChunks[i].status = 'processing';
        setC(updChunks);
        setTxStatus(`Transcribing chunk ${i+1}/${updChunks.length} (${updChunks[i].start.toFixed(0)}s–${updChunks[i].end.toFixed(0)}s)…`);

        if (demoMode || !apiKey) {
          await sleep(600);
          // Demo: distribute demo segments into this chunk's time window
          const chunkDur = updChunks[i].end - updChunks[i].start;
          const segCount = Math.max(1, Math.round(chunkDur/8));
          for (let j=0; j<segCount; j++) {
            const s = updChunks[i].start + j*(chunkDur/segCount) + 0.5;
            const e = Math.min(s + chunkDur/segCount - 1, updChunks[i].end - 0.2);
            all.push({ id:`tx-${i}-${j}`, start:parseFloat(s.toFixed(2)), end:parseFloat(e.toFixed(2)),
              sourceText:`Dialogue segment ${i+1}.${j+1} from the video.`,
              myanmarText:`ဗီဒီယိုမှ ပြောဆိုချက် ${i+1} ၊ အပိုင်း ${j+1} ။`,
              audioUrl:null, dubSpeed:1.0, isGeneratingTTS:false });
          }
        } else {
          // Real: extract audio chunk → base64 WAV → Gemini
          const b64 = await audioBufferChunkToBase64(audioBuf, updChunks[i].start, updChunks[i].end);
          const segs = await transcribeChunkWithGemini(b64, updChunks[i].start, updChunks[i].end, apiKey);
          segs.forEach((s,j) => all.push({
            id:`tx-${i}-${j}`,
            start: parseFloat(s.start?.toFixed(2)||updChunks[i].start),
            end:   parseFloat(s.end?.toFixed(2)||updChunks[i].end),
            sourceText: s.en || '',
            myanmarText: s.my || '',
            audioUrl:null, dubSpeed:1.0, isGeneratingTTS:false
          }));
        }

        updChunks[i].status   = 'done';
        updChunks[i].progress = 1;
        setC(updChunks);
        setTxProgress((i+1)/updChunks.length);
      }

      // Sort by start time and dedupe overlaps
      all.sort((a,b)=>a.start-b.start);
      setSegments(all);
      setSubtitleMode('transcription');
      setStep(3);
      ok(`Transcription complete — ${all.length} segments extracted.`);
      setTxStatus(`Done. ${all.length} subtitle segments ready.`);
    } catch(ex) {
      err(`Transcription error: ${ex.message}`);
      setTxStatus(`Error: ${ex.message}`);
    } finally {
      setIsTranscribing(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 3: Generate Recap Script → split into timed segments
  // ─────────────────────────────────────────────────────────────────────────
  const runGenerateRecap = async () => {
    if (!demoMode && !apiKey) { err('Enter your Gemini API key first.'); return; }
    if (!duration) { err('Upload a video first.'); return; }
    setIsGenRecap(true);
    try {
      let script = '';
      if (demoMode || !apiKey) {
        await sleep(1000);
        script = DEMO_RECAP;
      } else {
        script = await generateRecapWithGemini(segments, duration, apiKey);
      }
      setRecapScript(script);
      // Auto-split and sync
      const recapSegs = splitScriptToTimedSegments(script, duration);
      setSegments(recapSegs);
      setSubtitleMode('recap');
      setStep(4);
      ok(`Recap script generated and synced into ${recapSegs.length} timed subtitles.`);
    } catch(ex) {
      err(`Recap generation failed: ${ex.message}`);
    } finally {
      setIsGenRecap(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Re-sync: manually re-distribute script into fresh timestamps
  // ─────────────────────────────────────────────────────────────────────────
  const resyncSegments = () => {
    if (!recapScript || !duration) { err('Generate a recap script first.'); return; }
    const segs = splitScriptToTimedSegments(recapScript, duration);
    setSegments(segs);
    ok(`Re-synced ${segs.length} subtitle segments across ${duration.toFixed(0)}s.`);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Per-segment TTS
  // ─────────────────────────────────────────────────────────────────────────
  const ttsSegment = async id => {
    const seg = segments.find(s=>s.id===id);
    if (!seg) return;
    setSegments(p=>p.map(s=>s.id===id?{...s,isGeneratingTTS:true}:s));
    try {
      if (demoMode || !apiKey) {
        await sleep(700);
        window.speechSynthesis?.speak(Object.assign(new SpeechSynthesisUtterance(seg.myanmarText),{lang:'my-MM'}));
        setSegments(p=>p.map(s=>s.id===id?{...s,audioUrl:'demo',isGeneratingTTS:false}:s));
      } else {
        const url = await requestGeminiTts(seg.myanmarText, recapVoice, recapEmotion, apiKey);
        const a = new Audio(url);
        a.onloadedmetadata = () => {
          const segDur = seg.end - seg.start;
          const spd = a.duration > segDur ? Math.min(1.5, a.duration/segDur) : 1.0;
          setSegments(p=>p.map(s=>s.id===id?{...s,audioUrl:url,dubSpeed:parseFloat(spd.toFixed(2)),isGeneratingTTS:false}:s));
        };
      }
    } catch(ex) {
      err(`TTS error: ${ex.message}`);
      setSegments(p=>p.map(s=>s.id===id?{...s,isGeneratingTTS:false}:s));
    }
  };

  const playSegAudio = seg => {
    if (!seg.audioUrl || seg.audioUrl==='demo') return;
    const a = new Audio(seg.audioUrl);
    a.playbackRate = seg.dubSpeed||1;
    a.play();
    audioRefs.current[seg.id] = a;
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Export SRT
  // ─────────────────────────────────────────────────────────────────────────
  const exportSrt = () => {
    if (!segments.length) { err('No segments to export.'); return; }
    const srt = buildSrt(segments);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([srt],{type:'text/srt;charset=utf-8'}));
    a.download = (videoFile?.name.replace(/\.[^.]+$/,'')||'subtitles')+'_Myanmar.srt';
    a.click();
    ok('SRT exported!');
  };

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 5: Render output video with burned-in subtitles
  // ─────────────────────────────────────────────────────────────────────────
  const renderVideo = async () => {
    if (!videoRef.current || !segments.length) { err('Need video + synced segments.'); return; }
    if (!videoRef.current.videoWidth) { err('Video not fully loaded yet.'); return; }
    setIsRendering(true);
    setRenderProgress(0);
    setStep(5);
    try {
      const url = await renderOutputVideo(videoRef.current, segments, p => setRenderProgress(p));
      setOutputUrl(url);
      ok('Output video rendered with burned-in Myanmar subtitles!');
    } catch(ex) {
      err(`Render failed: ${ex.message}`);
    } finally {
      setIsRendering(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Active subtitle for overlay preview
  // ─────────────────────────────────────────────────────────────────────────
  const activeSeg = segments.find(s => currentTime >= s.start && currentTime < s.end);

  // ─── RENDER ──────────────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>Htut Dubbing Studio — Myanmar Movie Recap Suite</title>
      </Head>

      <div className="min-h-screen bg-[#030712] text-slate-100 flex flex-col">
        <div className="fixed inset-0 bg-grid opacity-50 pointer-events-none"/>
        <div className="fixed top-0 left-1/3 w-[600px] h-[300px] bg-violet-700/5 rounded-full blur-3xl pointer-events-none"/>

        {/* ── HEADER ───────────────────────────────────────────────── */}
        <header className="sticky top-0 z-50 border-b border-violet-500/20 bg-slate-950/90 backdrop-blur-xl px-5 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-violet-500/50 to-transparent"/>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-tr from-violet-700 to-fuchsia-600 rounded-xl flex items-center justify-center shadow-lg shadow-violet-500/25">
              <Icon d={ICO_MIC} cls="w-5 h-5 text-white"/>
            </div>
            <div>
              <h1 className="text-sm font-black tracking-tight heading-gradient">Htut Production Suite</h1>
              <p className="text-[10px] text-slate-500 font-mono">Myanmar Movie Recap & Dubbing · Gemini 2.5 Flash</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Demo / Live toggle */}
            <div className="flex items-center gap-0.5 bg-slate-950 border border-slate-800 rounded-xl p-1">
              {['Demo','Live API'].map((m,i)=>(
                <button key={m} onClick={()=>setDemoMode(i===0)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all
                    ${(i===0)===demoMode ? 'tab-active' : 'text-slate-500 hover:text-slate-300'}`}>
                  {m}
                </button>
              ))}
            </div>
            {!demoMode && (
              <input type="password" placeholder="Gemini API Key…" value={apiKey} onChange={e=>setApiKey(e.target.value)}
                className="input-premium bg-slate-950 rounded-xl px-3 py-2 text-xs text-violet-300 placeholder:text-slate-700 w-48 font-mono"/>
            )}
            <button onClick={exportSrt}
              className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 px-3 py-2 rounded-xl text-xs font-bold text-slate-200 transition-all hover:border-violet-400/40">
              <Icon d={ICO_DL} cls="w-3.5 h-3.5"/> Export SRT
            </button>
          </div>
        </header>

        {/* ── STEP BAR ─────────────────────────────────────────────── */}
        <div className="px-5 pt-3 pb-0 border-b border-slate-800/60">
          <Steps current={step}/>
        </div>

        {/* ── TOAST ────────────────────────────────────────────────── */}
        {toast && (
          <div className={`mx-5 mt-3 animate-fade-in px-4 py-2.5 rounded-xl flex items-center justify-between text-xs font-medium backdrop-blur
            ${toast.type==='ok' ? 'bg-emerald-950/70 border border-emerald-500/40 text-emerald-200' : 'bg-red-950/70 border border-red-500/40 text-red-200'}`}>
            <span>{toast.type==='ok'?'✓':'⚠'} {toast.msg}</span>
            <button onClick={()=>setToast(null)} className="ml-3 opacity-60 hover:opacity-100 text-base leading-none">×</button>
          </div>
        )}

        {/* ── MAIN GRID ────────────────────────────────────────────── */}
        <main className="flex-1 px-5 py-4 grid grid-cols-1 xl:grid-cols-12 gap-4">

          {/* ══ LEFT: Video + Pipeline controls ══ */}
          <div className="xl:col-span-5 flex flex-col gap-4">

            {/* VIDEO PANEL */}
            <div className="studio-panel p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon d={ICO_FILM} cls="w-4 h-4 text-violet-400"/>
                  <span className="text-sm font-bold text-slate-100">Video Source</span>
                </div>
                {videoFile && <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-500/20 truncate max-w-[160px]">{videoFile.name}</span>}
              </div>

              {!videoUrl ? (
                <label className="flex flex-col items-center justify-center h-40 border-2 border-dashed border-violet-500/25 rounded-2xl cursor-pointer hover:border-violet-500/50 hover:bg-violet-950/10 transition-all group">
                  <span className="text-4xl mb-2 group-hover:scale-110 transition-transform">🎬</span>
                  <p className="text-xs font-bold text-slate-400 group-hover:text-violet-300 transition-colors">Upload Video</p>
                  <p className="text-[10px] text-slate-600 mt-0.5">MP4, MOV, AVI · Max 200MB</p>
                  <input ref={fileInputRef} type="file" accept="video/*" onChange={handleUpload} className="hidden"/>
                </label>
              ) : (
                <div className="relative rounded-xl overflow-hidden bg-black border border-slate-800">
                  <video ref={videoRef} src={videoUrl} className="w-full max-h-64 object-contain" controls
                    onLoadedMetadata={e=>setDuration(e.target.duration)}/>
                  {/* Subtitle overlay */}
                  {activeSeg && (
                    <div className="absolute bottom-8 left-0 right-0 flex justify-center pointer-events-none px-4">
                      <div className="bg-black/80 rounded-lg px-3 py-1.5 max-w-[90%]">
                        <p className="text-xs font-bold text-white font-myanmar text-center leading-relaxed">{activeSeg.myanmarText}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Waveform */}
              <div className="relative rounded-xl overflow-hidden bg-[#030712] border border-slate-800/60">
                <canvas ref={canvasRef} width={640} height={56} className="w-full h-12"/>
                {duration>0 && (
                  <div className="absolute top-0 bottom-0 w-0.5 bg-violet-400/80 shadow shadow-violet-400 transition-all"
                    style={{left:`${(currentTime/duration)*100}%`}}/>
                )}
                {/* Segment markers */}
                {segments.map(seg=>(
                  <div key={seg.id} className="absolute top-0 bottom-0 w-px bg-fuchsia-500/30"
                    style={{left:`${(seg.start/duration)*100}%`}}/>
                ))}
                {!audioBuf && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[9px] font-mono text-slate-700">Upload video to see waveform</span>
                  </div>
                )}
              </div>

              {/* Duration / segment stats */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  {l:'Duration', v: duration ? `${duration.toFixed(0)}s` : '—', c:'text-violet-400'},
                  {l:'Segments', v: segments.length || '—', c:'text-fuchsia-400'},
                  {l:'Coverage', v: duration && segments.length ? `${Math.round((segments.reduce((a,s)=>a+(s.end-s.start),0)/duration)*100)}%` : '—', c:'text-cyan-400'},
                  {l:'TTS Done', v: segments.filter(s=>s.audioUrl&&s.audioUrl!=='demo').length||'—', c:'text-emerald-400'},
                ].map(m=>(
                  <div key={m.l} className="bg-slate-950/80 border border-slate-800 rounded-xl p-2 text-center">
                    <div className={`metric-value text-sm font-black ${m.c}`}>{m.v}</div>
                    <div className="text-[9px] text-slate-600 uppercase tracking-wider mt-0.5">{m.l}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* PIPELINE PANEL */}
            <div className="studio-panel p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2 mb-1">
                <Icon d={ICO_SYNC} cls="w-4 h-4 text-violet-400"/>
                <span className="text-sm font-bold text-slate-100">Processing Pipeline</span>
              </div>

              {/* Chunk progress */}
              {chunks.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">30s Chunk Scheduler</span>
                    <span className="text-[10px] font-mono text-violet-300">{chunks.filter(c=>c.status==='done').length}/{chunks.length} chunks</span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 max-h-32 overflow-y-auto">
                    {chunks.map(c=>(
                      <div key={c.i} className={`p-2 rounded-lg border text-center transition-all
                        ${c.status==='done' ? 'bg-emerald-950/20 border-emerald-500/20' :
                          c.status==='processing' ? 'bg-yellow-950/20 border-yellow-500/30' :
                          'bg-slate-950 border-slate-800'}`}>
                        <div className="text-[9px] font-mono text-slate-400">{c.start.toFixed(0)}–{c.end.toFixed(0)}s</div>
                        <Badge status={c.status}/>
                      </div>
                    ))}
                  </div>
                  {isTranscribing && (
                    <div className="mt-2">
                      <ProgressBar value={txProgress}/>
                      <p className="text-[10px] text-violet-300 mt-1 font-mono">{txStatus}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Transcribe button */}
              <button onClick={runTranscription} disabled={isTranscribing || !chunks.length}
                className="btn-premium w-full py-3 rounded-xl text-xs font-black tracking-wide flex items-center justify-center gap-2">
                {isTranscribing
                  ? <><Spin/>Transcribing &amp; Translating…</>
                  : '① Transcribe + Translate Audio (Gemini)'}
              </button>

              {/* Recap generation */}
              <button onClick={runGenerateRecap} disabled={isGenRecap}
                className="w-full py-3 rounded-xl text-xs font-black tracking-wide flex items-center justify-center gap-2
                  bg-fuchsia-600/20 hover:bg-fuchsia-600/30 text-fuchsia-200 border border-fuchsia-500/30 transition-all disabled:opacity-50">
                {isGenRecap
                  ? <><Spin c='fuchsia'/>Drafting Myanmar Recap Script…</>
                  : '② Generate Myanmar Recap Script + Sync Subtitles'}
              </button>

              {/* Re-sync manual */}
              <button onClick={resyncSegments} disabled={!recapScript}
                className="w-full py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2
                  bg-cyan-600/15 hover:bg-cyan-600/25 text-cyan-300 border border-cyan-500/25 transition-all disabled:opacity-40">
                <Icon d={ICO_SYNC} cls="w-3.5 h-3.5"/> Re-sync Subtitles to Video Length
              </button>

              {/* Render output */}
              <button onClick={renderVideo} disabled={isRendering || !segments.length || !videoUrl}
                className="w-full py-3 rounded-xl text-xs font-black tracking-wide flex items-center justify-center gap-2
                  bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-200 border border-emerald-500/30 transition-all disabled:opacity-50">
                {isRendering
                  ? <><Spin c='emerald'/>Rendering video… {Math.round(renderProgress*100)}%</>
                  : <><Icon d={ICO_VIDEO} cls="w-3.5 h-3.5"/> ③ Render Output Video (Burned Subtitles)</>}
              </button>
              {isRendering && <ProgressBar value={renderProgress} color='emerald'/>}

              {/* Download output */}
              {outputUrl && (
                <a href={outputUrl} download="htut_myanmar_dubbed.webm"
                  className="w-full py-3 rounded-xl text-xs font-black tracking-wide flex items-center justify-center gap-2
                    bg-violet-600 hover:bg-violet-500 text-white transition-all shadow-lg shadow-violet-500/25 text-center">
                  <Icon d={ICO_DL} cls="w-3.5 h-3.5"/> Download Output Video (.webm)
                </a>
              )}
            </div>
          </div>

          {/* ══ RIGHT: Subtitle Timeline + Recap Script ══ */}
          <div className="xl:col-span-7 flex flex-col gap-4">

            {/* SUBTITLE TIMELINE */}
            <div className="studio-panel p-4 flex flex-col gap-3" style={{minHeight:'400px'}}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-violet-400">Subtitle Timeline</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${subtitleMode==='recap' ? 'badge-completed' : 'badge-processing'}`}>
                      {subtitleMode==='recap' ? 'Recap-synced' : 'Transcription'}
                    </span>
                  </div>
                  <h2 className="text-sm font-bold text-slate-100">
                    {segments.length} Myanmar Subtitle Segments
                    {duration>0 && <span className="text-slate-500 font-normal text-xs ml-2">/ {duration.toFixed(0)}s video</span>}
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <select value={recapVoice} onChange={e=>setRecapVoice(e.target.value)}
                    className="input-premium bg-slate-950 rounded-lg px-2 py-1.5 text-[10px] text-slate-300">
                    {[...VOICES.male,...VOICES.female].map(v=><option key={v.value} value={v.value}>{v.label}</option>)}
                  </select>
                  <select value={recapEmotion} onChange={e=>setRecapEmotion(e.target.value)}
                    className="input-premium bg-slate-950 rounded-lg px-2 py-1.5 text-[10px] text-slate-300">
                    {EMOTIONS.map(e=><option key={e.value} value={e.value}>{e.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Visual timeline ruler */}
              {duration>0 && segments.length>0 && (
                <div className="relative h-6 bg-slate-950 rounded-lg overflow-hidden border border-slate-800">
                  {segments.map((seg,i)=>(
                    <div key={seg.id}
                      onClick={()=>{ if(videoRef.current) videoRef.current.currentTime=seg.start; setSelectedSeg(seg.id); }}
                      className={`absolute top-0 bottom-0 rounded-sm cursor-pointer transition-opacity hover:opacity-90 border-r border-slate-900
                        ${i%2===0 ? 'bg-violet-600/50' : 'bg-fuchsia-600/40'}`}
                      style={{left:`${(seg.start/duration)*100}%`, width:`${Math.max(0.3,((seg.end-seg.start)/duration)*100)}%`}}
                      title={`${seg.start.toFixed(1)}s–${seg.end.toFixed(1)}s`}/>
                  ))}
                  {/* Playhead */}
                  <div className="absolute top-0 bottom-0 w-0.5 bg-white/80 pointer-events-none"
                    style={{left:`${(currentTime/duration)*100}%`}}/>
                </div>
              )}

              {/* Segment list */}
              <div className="flex-1 overflow-y-auto space-y-1.5 max-h-72 pr-1">
                {segments.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40 text-slate-700 gap-2">
                    <span className="text-3xl">📋</span>
                    <p className="text-xs">Run transcription or generate recap to populate timeline</p>
                  </div>
                ) : segments.map(seg => (
                  <SubRow key={seg.id} seg={seg}
                    isActive={currentTime>=seg.start && currentTime<seg.end}
                    isSelected={selectedSeg===seg.id}
                    currentTime={currentTime}
                    onClick={()=>{ setSelectedSeg(p=>p===seg.id?null:seg.id); if(videoRef.current) videoRef.current.currentTime=seg.start; }}
                    onChange={text=>setSegments(p=>p.map(s=>s.id===seg.id?{...s,myanmarText:text}:s))}
                    onTTS={()=>ttsSegment(seg.id)}
                    onPlay={()=>playSegAudio(seg)}/>
                ))}
              </div>

              <div className="flex gap-2 pt-1 border-t border-slate-800">
                <button onClick={exportSrt}
                  className="flex-1 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5
                    bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 transition-all hover:border-violet-400/40">
                  <Icon d={ICO_DL} cls="w-3.5 h-3.5"/> Export SRT
                </button>
                <button onClick={()=>setSegments(p=>p.map(s=>({...s,myanmarText:'',audioUrl:null})))}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 border border-slate-800 hover:text-red-400 hover:border-red-500/30 transition-all">
                  Clear
                </button>
              </div>
            </div>

            {/* RECAP SCRIPT EDITOR */}
            <div className="studio-panel p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-fuchsia-400">Hub 2 · Recap Script</span>
                  <h2 className="text-sm font-bold text-slate-100 mt-0.5">Myanmar Movie Recap Script</h2>
                  <p className="text-[10px] text-slate-500">ဇာတ်လမ်းပြောပြသူ · Edit here, then Re-sync subtitles</p>
                </div>
                <div className="flex items-center gap-2">
                  {recapScript && (
                    <button onClick={resyncSegments}
                      className="flex items-center gap-1.5 text-[10px] bg-cyan-600/15 hover:bg-cyan-600/25 text-cyan-300 border border-cyan-500/25 px-2.5 py-1.5 rounded-lg font-bold transition-all">
                      <Icon d={ICO_SYNC} cls="w-3 h-3"/> Re-sync
                    </button>
                  )}
                </div>
              </div>

              <textarea value={recapScript} onChange={e=>setRecapScript(e.target.value)}
                placeholder="Click '② Generate Myanmar Recap Script' above — script will appear here and auto-sync to video length.&#10;&#10;Or paste/type your Myanmar recap here and click Re-sync."
                className="input-premium w-full bg-slate-950 rounded-xl p-3 text-xs text-slate-200 font-myanmar focus:outline-none resize-none leading-relaxed"
                rows={8}/>

              <div className="flex items-center justify-between text-[10px] text-slate-600">
                <span>{recapScript.split('\n').filter(Boolean).length} lines · {recapScript.length} chars</span>
                {duration>0 && recapScript && (
                  <span className="text-violet-400">~{(recapScript.length/duration).toFixed(1)} chars/sec reading pace</span>
                )}
              </div>

              <button onClick={runGenerateRecap} disabled={isGenRecap}
                className="btn-premium w-full py-3 rounded-xl text-xs font-black tracking-wide flex items-center justify-center gap-2">
                {isGenRecap
                  ? <><Spin/>Generating Myanmar Recap…</>
                  : '🎭 Generate AI Recap Script + Auto-Sync to Video'}
              </button>
            </div>
          </div>
        </main>

        {/* ── FOOTER ───────────────────────────────────────────────── */}
        <footer className="border-t border-violet-500/10 bg-slate-950/60 px-5 py-2.5 flex flex-wrap items-center justify-between text-[9px] text-slate-600 gap-2">
          <span className="font-mono text-violet-600">Htut Production Suite v3 · End-to-End Myanmar Dubbing</span>
          <span className={`px-2 py-0.5 rounded-full font-bold font-mono ${demoMode ? 'text-amber-400 bg-amber-950/30 border border-amber-500/20' : 'text-emerald-400 bg-emerald-950/30 border border-emerald-500/20'}`}>
            {demoMode ? '◌ DEMO MODE' : '● LIVE API'}
          </span>
        </footer>
      </div>
    </>
  );
}
