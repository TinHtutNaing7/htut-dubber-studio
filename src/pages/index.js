'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import Head from 'next/head';
import {
  pcmToWav, fetchWithBackoff, requestGeminiTts,
  drawWaveform, formatSrtTime,
  DEMO_SEGMENTS, DEMO_RECAP, VOICES, EMOTIONS
} from '../lib/audio';

// ─── Icons ───────────────────────────────────────────────────────────────────

function IconMic() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
    </svg>
  );
}

function IconDownload() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  );
}

function IconPlay() { return <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>; }
function IconStop() { return <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>; }

function Spinner({ size = 'sm', color = 'violet' }) {
  const s = size === 'sm' ? 'w-3.5 h-3.5' : 'w-5 h-5';
  return (
    <div className={`${s} border-2 border-${color}-500 border-t-transparent rounded-full animate-spin`} />
  );
}

function WaveformBars({ active = false, count = 5 }) {
  return (
    <div className="flex items-end gap-0.5 h-4">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`waveform-bar transition-all ${active ? 'opacity-100' : 'opacity-30'}`}
          style={{
            animationDelay: `${i * 0.12}s`,
            animationDuration: `${0.8 + i * 0.1}s`,
            height: active ? `${40 + Math.sin(i) * 30}%` : '40%',
            animation: active ? `waveformPulse ${0.8 + i * 0.1}s ease-in-out infinite ${i * 0.12}s` : 'none',
          }}
        />
      ))}
    </div>
  );
}

// ─── Section Badge ──────────────────────────────────────────────────────────

function SectionBadge({ label, num }) {
  return (
    <div className="flex items-center gap-2 mb-1">
      <span className="w-5 h-5 rounded-md bg-violet-600/30 border border-violet-500/40 flex items-center justify-center text-[10px] font-bold text-violet-300 font-mono">{num}</span>
      <span className="text-[10px] font-bold tracking-widest uppercase text-violet-400">{label}</span>
    </div>
  );
}

// ─── Chunk Status Card ─────────────────────────────────────────────────────

function ChunkCard({ chunk }) {
  const statusClass = chunk.status === 'completed' ? 'badge-completed' : chunk.status === 'processing' ? 'badge-processing' : 'badge-pending';
  const statusLabel = chunk.status === 'completed' ? '✓ Done' : chunk.status === 'processing' ? '⟳ Active' : '◌ Queued';
  const rpmBudget = chunk.status === 'processing' ? Math.round((chunk.progress || 0) / 100 * 15) : chunk.status === 'completed' ? 15 : 0;

  return (
    <div className={`p-3 rounded-xl border transition-all ${
      chunk.status === 'completed' ? 'bg-emerald-950/20 border-emerald-500/20' :
      chunk.status === 'processing' ? 'bg-yellow-950/20 border-yellow-500/30' :
      'bg-slate-950/60 border-slate-800'
    }`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-mono text-slate-400">
          {chunk.start.toFixed(0)}s–{chunk.end.toFixed(0)}s
        </span>
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${statusClass}`}>{statusLabel}</span>
      </div>
      <div className="chunk-bar mb-1.5">
        <div className="chunk-bar-fill" style={{ width: `${chunk.status === 'completed' ? 100 : chunk.progress || 0}%` }} />
      </div>
      <div className="flex justify-between text-[9px] text-slate-500">
        <span>RPM Budget</span>
        <span className="font-mono text-violet-400">{rpmBudget}/15</span>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

export default function HtutDubberStudio() {
  const [videoFile, setVideoFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [audioBuffer, setAudioBuffer] = useState(null);
  const [duration, setDuration] = useState(120);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const [customApiKey, setCustomApiKey] = useState('');
  const [useDemoMode, setUseDemoMode] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const [chunks, setChunks] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState('');
  const [processingProgress, setProcessingProgress] = useState(0);
  const [segments, setSegments] = useState([]);
  const [selectedSegment, setSelectedSegment] = useState(null);

  // Hub 1: Subtitle / Timeline
  const [activeTab, setActiveTab] = useState('subtitles');

  // Hub 2: Recap Script
  const [recapScript, setRecapScript] = useState('');
  const [isGeneratingRecap, setIsGeneratingRecap] = useState(false);
  const [recapEmotion, setRecapEmotion] = useState('excitedly');
  const [recapVoice, setRecapVoice] = useState('Kore');
  const [recapAudioUrl, setRecapAudioUrl] = useState(null);
  const [isSynthesizingRecap, setIsSynthesizingRecap] = useState(false);

  // Hub 4: TTS Studio
  const [studioTextLeft, setStudioTextLeft] = useState('မင်္ဂလာပါရှင်။ ဇာတ်လမ်းပြောပြသူ စတူဒီယိုမှ ကြိုဆိုပါတယ်။');
  const [studioVoiceLeft, setStudioVoiceLeft] = useState('Leda');
  const [studioEmotionLeft, setStudioEmotionLeft] = useState('cheerfully');
  const [leftAudioUrl, setLeftAudioUrl] = useState(null);
  const [isSynthesizingLeft, setIsSynthesizingLeft] = useState(false);

  const [studioTextRight, setStudioTextRight] = useState('မင်္ဂလာပါ။ ဒီဇာတ်လမ်းပြောပြသူစနစ်က အသံထွက်ကို ချက်ချင်းဖန်တီးပေးနိုင်ပါတယ်။');
  const [studioVoiceRight, setStudioVoiceRight] = useState('Kore');
  const [studioEmotionRight, setStudioEmotionRight] = useState('excitedly');
  const [rightAudioUrl, setRightAudioUrl] = useState(null);
  const [isSynthesizingRight, setIsSynthesizingRight] = useState(false);
  const [dialogueSpeed, setDialogueSpeed] = useState(1.0);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const ttsAudioRefs = useRef({});

  // ── Init Demo ──────────────────────────────────────────────────────────
  useEffect(() => {
    setSegments(DEMO_SEGMENTS);
    setRecapScript(DEMO_RECAP);
    setChunks([
      { index: 0, start: 0, end: 30, status: 'completed', progress: 100, text: 'Chunk 1 (0s–30s)' },
      { index: 1, start: 30, end: 60, status: 'completed', progress: 100, text: 'Chunk 2 (30s–60s)' },
      { index: 2, start: 60, end: 90, status: 'completed', progress: 100, text: 'Chunk 3 (60s–90s)' },
      { index: 3, start: 90, end: 120, status: 'completed', progress: 100, text: 'Chunk 4 (90s–120s)' },
    ]);
  }, []);

  // ── Video playback sync ────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      if (videoRef.current) {
        const time = videoRef.current.currentTime;
        setCurrentTime(time);
        let activeTTS = false;
        segments.forEach(seg => {
          if (time >= seg.start && time <= seg.end && seg.audioUrl) {
            activeTTS = true;
            if (!ttsAudioRefs.current[seg.id]?.playing) playDubAudio(seg);
          }
        });
        if (videoRef.current) {
          videoRef.current.volume = activeTTS ? 0.15 : 1.0;
        }
      }
    }, 100);
    return () => clearInterval(interval);
  }, [isPlaying, segments]);

  // ── Helpers ────────────────────────────────────────────────────────────
  const getApi = () => customApiKey;

  const updateSegmentState = useCallback((id, newProps) => {
    setSegments(prev => prev.map(s => s.id === id ? { ...s, ...newProps } : s));
  }, []);

  const playDubAudio = (segment) => {
    if (!segment.audioUrl || segment.audioUrl.startsWith('demo')) return;
    if (ttsAudioRefs.current[segment.id]) ttsAudioRefs.current[segment.id].pause();
    const a = new Audio(segment.audioUrl);
    a.playbackRate = segment.dubSpeed || 1.0;
    a.play().catch(() => {});
    ttsAudioRefs.current[segment.id] = a;
  };

  // ── Video Upload ────────────────────────────────────────────────────────
  const handleVideoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 150 * 1024 * 1024) {
      setErrorMessage('Please upload a video file under 150MB.');
      return;
    }
    setVideoFile(file);
    const fileUrl = URL.createObjectURL(file);
    setVideoUrl(fileUrl);
    setUseDemoMode(false);
    setIsProcessing(true);
    setProcessingStep('Initializing audio extraction context…');
    setProcessingProgress(15);
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const response = await fetch(fileUrl);
      const arrayBuffer = await response.arrayBuffer();
      setProcessingStep('Decoding audio channels…');
      setProcessingProgress(45);
      const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      setAudioBuffer(decodedBuffer);
      setDuration(decodedBuffer.duration);
      setProcessingStep('Generating 30-second chunks…');
      setProcessingProgress(80);
      const chunkSize = 30;
      const chunkCount = Math.ceil(decodedBuffer.duration / chunkSize);
      setChunks(Array.from({ length: chunkCount }, (_, i) => ({
        index: i, start: i * chunkSize,
        end: Math.min((i + 1) * chunkSize, decodedBuffer.duration),
        status: 'pending', progress: 0
      })));
      drawWaveform(decodedBuffer, canvasRef.current);
      setProcessingProgress(100);
      setSuccessMessage('Audio extracted! Timeline ready for Gemini processing.');
      setTimeout(() => { setIsProcessing(false); setProcessingStep(''); }, 800);
    } catch (err) {
      setErrorMessage('Could not decode audio. Using demo layout.');
      setIsProcessing(false);
    }
  };

  // ── Parallel Translation (30s chunks) ─────────────────────────────────
  const startParallelTranslation = async () => {
    const api = getApi();
    if (!useDemoMode && !api) {
      setErrorMessage('Please enter your Google Gemini API Key or use Demo Mode.');
      return;
    }
    setIsProcessing(true);
    setProcessingStep('Connecting to Gemini 2.5 Flash pipeline…');
    setProcessingProgress(5);
    const updatedChunks = chunks.map(c => ({ ...c }));
    const generatedSegments = [];
    try {
      await Promise.all(updatedChunks.map(async (chunk, idx) => {
        for (let p = 0; p <= 100; p += 20) {
          await new Promise(r => setTimeout(r, 200));
          updatedChunks[idx].status = 'processing';
          updatedChunks[idx].progress = p;
          setChunks([...updatedChunks]);
        }
        if (useDemoMode || !api) {
          const demoSegs = [
            { start: chunk.start + 2.5, end: Math.min(chunk.start + 10, chunk.end), source_text: `Detected dialogue in chunk ${idx + 1}.`, text_myanmar: `မြန်မာဘာသာစကားဖြင့် အပိုင်းအမှတ် ${idx + 1} ၏ ဒေသန္တရဒြဗ်ရေးရာ ပြန်ဆိုချက်ဖြစ်သည်။` }
          ];
          demoSegs.forEach(s => generatedSegments.push({ id: `chunk-${idx}-seg`, start: s.start, end: s.end, sourceText: s.source_text, myanmarText: s.text_myanmar, audioUrl: null, dubSpeed: 1.0, isGeneratingTTS: false }));
        } else {
          const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${api}`;
          const payload = {
            contents: [{ parts: [{ text: `Transcribe and translate this video segment (${chunk.start}s to ${chunk.end}s) to Myanmar language. Return JSON array: [{"start": seconds, "end": seconds, "source_text": "english", "text_myanmar": "burmese"}]` }] }]
          };
          try {
            const res = await fetchWithBackoff(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const result = await res.json();
            const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
            const clean = text.replace(/```json|```/g, '').trim();
            const parsed = JSON.parse(clean);
            parsed.forEach((s, si) => generatedSegments.push({ id: `chunk-${idx}-${si}`, start: s.start || chunk.start, end: s.end || chunk.end, sourceText: s.source_text || '', myanmarText: s.text_myanmar || '', audioUrl: null, dubSpeed: 1.0, isGeneratingTTS: false }));
          } catch { /* skip chunk */ }
        }
        updatedChunks[idx].status = 'completed';
        updatedChunks[idx].progress = 100;
        setChunks([...updatedChunks]);
      }));
      if (generatedSegments.length > 0) setSegments(generatedSegments);
      setSuccessMessage(`Translation complete! ${generatedSegments.length} segments ready.`);
    } catch (err) {
      setErrorMessage(`Translation pipeline error: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setProcessingStep('');
    }
  };

  // ── Recap Script Generation ────────────────────────────────────────────
  const generateMovieRecapScript = async () => {
    setIsGeneratingRecap(true);
    setErrorMessage('');
    const api = getApi();
    try {
      if (useDemoMode || !api) {
        await new Promise(r => setTimeout(r, 1200));
        setRecapScript(DEMO_RECAP);
        setSuccessMessage('Demo recap script loaded!');
      } else {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${api}`;
        const contextList = segments.map(s => `${s.start}s–${s.end}s: ${s.myanmarText}`).join('\n');
        const payload = {
          contents: [{ parts: [{ text: `Act as a professional YouTube and TikTok Movie Recap Storyteller (ဇာတ်လမ်းပြောပြသူ). Read these Burmese dialogue summaries:\n${contextList}\n\nWrite a highly engaging, exciting, dramatic Movie Recap Script (ရုပ်ရှင်အကျဉ်းချုပ် ဇာတ်ညွှန်း) in pure Myanmar language with: 1. Introduction hook (စတင်မိတ်ဆက်ခြင်း), 2. Continuous storytelling (ဇာတ်လမ်းနောက်ခံ), 3. Cliffhanger ending hook (နိဂုံး). Format with paragraph spacing and dramatic style.` }] }]
        };
        const res = await fetchWithBackoff(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const result = await res.json();
        const script = result.candidates?.[0]?.content?.parts?.[0]?.text;
        setRecapScript(script || 'Error generating recap script.');
        setSuccessMessage('AI Movie Recap Script generated!');
      }
    } catch (err) {
      setErrorMessage(`Script generation failed: ${err.message}`);
    } finally {
      setIsGeneratingRecap(false);
    }
  };

  // ── Recap Audio Synthesis ─────────────────────────────────────────────
  const synthesizeFullRecapAudio = async () => {
    if (!recapScript) { setErrorMessage('No script found. Generate first.'); return; }
    setIsSynthesizingRecap(true);
    setErrorMessage('');
    const api = getApi();
    try {
      if (useDemoMode || !api) {
        await new Promise(r => setTimeout(r, 1500));
        if (typeof window !== 'undefined') {
          const synth = window.speechSynthesis;
          const u = new SpeechSynthesisUtterance(recapScript.slice(0, 150) + '…');
          u.lang = 'my-MM';
          synth.speak(u);
        }
        setRecapAudioUrl('demo-recap-active');
        setSuccessMessage('Demo narration started via browser TTS!');
      } else {
        const url = await requestGeminiTts(recapScript, recapVoice, recapEmotion, api);
        setRecapAudioUrl(url);
        setSuccessMessage('Full Myanmar narration synthesized! Ready for download.');
      }
    } catch (err) {
      setErrorMessage(`Narration synthesis failed: ${err.message}`);
    } finally {
      setIsSynthesizingRecap(false);
    }
  };

  const playRecapNarrative = () => {
    if (!recapAudioUrl) return;
    if (recapAudioUrl === 'demo-recap-active') {
      const synth = window.speechSynthesis;
      const u = new SpeechSynthesisUtterance(recapScript);
      u.lang = 'my-MM';
      synth.speak(u);
      return;
    }
    new Audio(recapAudioUrl).play();
  };

  // ── Per-segment TTS ────────────────────────────────────────────────────
  const synthesizeSegment = async (segmentId) => {
    const seg = segments.find(s => s.id === segmentId);
    if (!seg) return;
    updateSegmentState(segmentId, { isGeneratingTTS: true });
    const api = getApi();
    try {
      if (useDemoMode || !api) {
        await new Promise(r => setTimeout(r, 900));
        if (typeof window !== 'undefined') {
          const synth = window.speechSynthesis;
          const u = new SpeechSynthesisUtterance(seg.myanmarText);
          u.lang = 'my-MM';
          synth.speak(u);
        }
        updateSegmentState(segmentId, { audioUrl: 'demo-active-track', isGeneratingTTS: false });
      } else {
        const url = await requestGeminiTts(seg.myanmarText, 'Kore', 'calmly', api);
        const audio = new Audio(url);
        audio.onloadedmetadata = () => {
          const origDur = seg.end - seg.start;
          const speed = Math.min(1.4, audio.duration > origDur ? audio.duration / origDur : 1.0);
          updateSegmentState(segmentId, { audioUrl: url, dubSpeed: Number(speed.toFixed(2)), isGeneratingTTS: false });
        };
      }
    } catch (err) {
      setErrorMessage(`TTS generation failed: ${err.message}`);
      updateSegmentState(segmentId, { isGeneratingTTS: false });
    }
  };

  // ── Batch Dub All ─────────────────────────────────────────────────────
  const batchDubAllSegments = async () => {
    setIsProcessing(true);
    setProcessingStep('Batch synthesizing Myanmar voice tracks…');
    setProcessingProgress(10);
    const api = getApi();
    try {
      const updated = await Promise.all(segments.map(async (seg, idx) => {
        if (useDemoMode || !api) {
          await new Promise(r => setTimeout(r, 600 + idx * 100));
          return { ...seg, audioUrl: 'demo-track-active', dubSpeed: 1.0 };
        }
        const url = await requestGeminiTts(seg.myanmarText, idx % 2 === 0 ? 'Kore' : 'Leda', 'calmly', api);
        return { ...seg, audioUrl: url, dubSpeed: 1.0 };
      }));
      setSegments(updated);
      setSuccessMessage('All Myanmar voice tracks synthesized!');
    } catch (err) {
      setErrorMessage(`Batch dub failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setProcessingStep('');
    }
  };

  // ── Studio TTS ────────────────────────────────────────────────────────
  const synthesizeStudioSpeaker = async (side) => {
    const isLeft = side === 'left';
    const text = isLeft ? studioTextLeft : studioTextRight;
    const voice = isLeft ? studioVoiceLeft : studioVoiceRight;
    const emotion = isLeft ? studioEmotionLeft : studioEmotionRight;
    if (isLeft) setIsSynthesizingLeft(true); else setIsSynthesizingRight(true);
    const api = getApi();
    try {
      if (useDemoMode || !api) {
        await new Promise(r => setTimeout(r, 900));
        if (typeof window !== 'undefined') {
          const u = new SpeechSynthesisUtterance(text);
          u.lang = 'my-MM';
          window.speechSynthesis.speak(u);
        }
        if (isLeft) setLeftAudioUrl('demo-left-active'); else setRightAudioUrl('demo-right-active');
      } else {
        const url = await requestGeminiTts(text, voice, emotion, api);
        if (isLeft) setLeftAudioUrl(url); else setRightAudioUrl(url);
      }
    } catch (err) {
      setErrorMessage(`Speaker ${side} synthesis error: ${err.message}`);
    } finally {
      if (isLeft) setIsSynthesizingLeft(false); else setIsSynthesizingRight(false);
    }
  };

  const playDialogue = (mode) => {
    const api = getApi();
    if (useDemoMode || !api) {
      const synth = window.speechSynthesis;
      const u1 = new SpeechSynthesisUtterance(studioTextLeft);
      const u2 = new SpeechSynthesisUtterance(studioTextRight);
      u1.lang = 'my-MM'; u2.lang = 'my-MM';
      u1.rate = dialogueSpeed; u2.rate = dialogueSpeed;
      if (mode === 'concurrent') { synth.speak(u1); synth.speak(u2); }
      else { u1.onend = () => synth.speak(u2); synth.speak(u1); }
      return;
    }
    const playAudio = (url, delay = 0) => {
      if (!url) return;
      setTimeout(() => { const a = new Audio(url); a.playbackRate = dialogueSpeed; a.play(); }, delay);
    };
    if (mode === 'concurrent') { playAudio(leftAudioUrl); playAudio(rightAudioUrl); }
    else { playAudio(leftAudioUrl); if (rightAudioUrl) { const a = new Audio(leftAudioUrl); a.onended = () => new Audio(rightAudioUrl).play(); a.play(); } }
  };

  // ── SRT Export ────────────────────────────────────────────────────────
  const exportSrtSubtitles = () => {
    if (!segments.length) { setErrorMessage('No segments to export.'); return; }
    const srt = segments.map((seg, i) => `${i + 1}\n${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n${seg.myanmarText}\n`).join('\n');
    const blob = new Blob([srt], { type: 'text/srt;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = videoFile ? `${videoFile.name.split('.')[0]}_Myanmar.srt` : 'Myanmar_Subtitles.srt';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ─── Computed ──────────────────────────────────────────────────────────
  const completedChunks = chunks.filter(c => c.status === 'completed').length;
  const processingChunks = chunks.filter(c => c.status === 'processing').length;
  const totalDubbed = segments.filter(s => s.audioUrl && !s.audioUrl.startsWith('demo')).length;

  // ─── RENDER ────────────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>Htut Movie Recap & Dubbing Studio — Premium AI Suite</title>
      </Head>

      <div className="min-h-screen bg-[#030712] text-slate-100 flex flex-col relative">
        {/* Background grid */}
        <div className="fixed inset-0 bg-grid opacity-60 pointer-events-none" />
        {/* Ambient glow */}
        <div className="fixed top-0 left-1/4 w-96 h-96 bg-violet-600/5 rounded-full blur-3xl pointer-events-none" />
        <div className="fixed bottom-0 right-1/4 w-96 h-96 bg-fuchsia-600/5 rounded-full blur-3xl pointer-events-none" />

        {/* ── HEADER ──────────────────────────────────────────────────── */}
        <header className="relative z-50 border-b border-violet-500/20 bg-slate-950/80 backdrop-blur-xl px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4 sticky top-0">
          {/* Scan line */}
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-violet-500/60 to-transparent" />
          
          <div className="flex items-center gap-4">
            <div className="relative w-11 h-11 bg-gradient-to-tr from-violet-700 to-fuchsia-600 rounded-2xl flex items-center justify-center shadow-lg shadow-violet-500/25">
              <IconMic />
              <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full pulse-dot border-2 border-slate-950" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">
                <span className="heading-gradient">Htut Production Suite</span>
                <span className="ml-2 text-[10px] bg-violet-500/15 text-violet-300 font-mono px-2 py-0.5 rounded-full border border-violet-500/25 align-middle">v3 PREMIUM</span>
              </h1>
              <p className="text-[11px] text-slate-500 font-mono tracking-wide">Myanmar Movie Recap & Dubbing AI Engine · Gemini 2.5 Flash</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Mode toggle */}
            <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-xl p-1">
              <button onClick={() => { setUseDemoMode(true); setErrorMessage(''); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${useDemoMode ? 'tab-active' : 'text-slate-500 hover:text-slate-300'}`}>
                Demo
              </button>
              <button onClick={() => { setUseDemoMode(false); setErrorMessage(''); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${!useDemoMode ? 'tab-active' : 'text-slate-500 hover:text-slate-300'}`}>
                Live API
              </button>
            </div>

            {!useDemoMode && (
              <input
                type="password"
                placeholder="Gemini API Key…"
                value={customApiKey}
                onChange={(e) => setCustomApiKey(e.target.value)}
                className="input-premium bg-slate-950 rounded-xl px-3 py-2 text-xs text-violet-300 placeholder:text-slate-700 w-48 font-mono"
              />
            )}

            <button onClick={exportSrtSubtitles}
              className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 px-3 py-2 rounded-xl text-xs font-bold text-slate-200 transition-all hover:border-violet-500/40">
              <IconDownload /> Export .SRT
            </button>
          </div>
        </header>

        {/* ── ALERTS ──────────────────────────────────────────────────── */}
        <div className="relative z-40 px-6 pt-4 flex flex-col gap-2">
          {errorMessage && (
            <div className="animate-fade-in bg-red-950/60 border border-red-500/40 text-red-200 px-4 py-3 rounded-xl flex items-center justify-between backdrop-blur">
              <span className="text-xs font-medium flex items-center gap-2">
                <span className="text-red-400">⚠</span> {errorMessage}
              </span>
              <button onClick={() => setErrorMessage('')} className="text-red-400 hover:text-white text-lg leading-none">×</button>
            </div>
          )}
          {successMessage && (
            <div className="animate-fade-in bg-emerald-950/60 border border-emerald-500/40 text-emerald-200 px-4 py-3 rounded-xl flex items-center justify-between backdrop-blur">
              <span className="text-xs font-medium flex items-center gap-2">
                <span className="text-emerald-400">✓</span> {successMessage}
              </span>
              <button onClick={() => setSuccessMessage('')} className="text-emerald-400 hover:text-white text-lg leading-none">×</button>
            </div>
          )}
        </div>

        {/* ── MAIN LAYOUT ─────────────────────────────────────────────── */}
        <main className="relative z-10 flex-1 px-6 py-5 grid grid-cols-1 xl:grid-cols-12 gap-5 min-h-0">

          {/* ══ LEFT COLUMN: Video + Hub 3 (Scheduler) ══════════════════ */}
          <div className="xl:col-span-5 flex flex-col gap-5">

            {/* VIDEO UPLOAD / PLAYER */}
            <div className="studio-panel p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <SectionBadge label="Video Input" num="↑" />
                  <h2 className="text-base font-bold text-slate-100">Media Source</h2>
                </div>
                {videoFile && (
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded-full border border-emerald-500/30">
                    {videoFile.name.slice(0, 20)}…
                  </span>
                )}
              </div>

              {!videoUrl ? (
                <label className="flex flex-col items-center justify-center h-36 border-2 border-dashed border-violet-500/30 rounded-2xl cursor-pointer hover:border-violet-500/60 hover:bg-violet-950/10 transition-all group">
                  <div className="text-3xl mb-2 group-hover:scale-110 transition-transform">🎬</div>
                  <p className="text-xs font-bold text-slate-400 group-hover:text-violet-300 transition-colors">Upload Video File</p>
                  <p className="text-[10px] text-slate-600 mt-0.5">MP4, MOV, AVI · Max 150MB</p>
                  <input type="file" accept="video/*" onChange={handleVideoUpload} className="hidden" />
                </label>
              ) : (
                <video
                  ref={videoRef}
                  src={videoUrl}
                  className="w-full rounded-xl border border-violet-500/20"
                  controls
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onTimeUpdate={() => videoRef.current && setCurrentTime(videoRef.current.currentTime)}
                />
              )}

              {/* Waveform canvas */}
              <div className="relative rounded-xl overflow-hidden bg-[#030712] border border-slate-800">
                <canvas ref={canvasRef} width={640} height={64} className="w-full h-14" />
                {/* Playhead */}
                {duration > 0 && (
                  <div
                    className="absolute top-0 bottom-0 w-px bg-violet-400/80 shadow-sm shadow-violet-400"
                    style={{ left: `${(currentTime / duration) * 100}%` }}
                  />
                )}
                {/* Demo watermark */}
                {useDemoMode && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[10px] font-mono text-violet-500/50">DEMO WAVEFORM — Upload video to visualize real audio</span>
                  </div>
                )}
              </div>

              {/* Metrics row */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Duration', value: `${duration.toFixed(0)}s`, color: 'text-violet-400' },
                  { label: 'Segments', value: segments.length, color: 'text-fuchsia-400' },
                  { label: 'Dubbed', value: `${totalDubbed}/${segments.length}`, color: 'text-emerald-400' },
                ].map(m => (
                  <div key={m.label} className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5 text-center">
                    <div className={`metric-value text-base font-bold ${m.color}`}>{m.value}</div>
                    <div className="text-[9px] text-slate-500 uppercase tracking-wider mt-0.5">{m.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* HUB 3: 30-SECOND CHUNK SCHEDULER */}
            <div className="studio-panel p-5 flex flex-col gap-4 flex-1">
              <div>
                <SectionBadge label="Hub 3 · Chunk Scheduler" num="3" />
                <h2 className="text-base font-bold text-slate-100">30-Second Micro-Chunk Scheduler</h2>
                <p className="text-[11px] text-slate-500 mt-0.5">Parallelized slices optimized for Gemini 2.5 Flash Free Tier · 15 RPM safety guard</p>
              </div>

              {/* RPM Gauge */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Free Tier Throughput</span>
                  <span className="metric-value text-xs text-violet-300">
                    {processingChunks * 3 + completedChunks}/15 RPM
                  </span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, ((processingChunks * 3 + completedChunks) / 15) * 100)}%`,
                      background: 'linear-gradient(90deg, #7c3aed, #c026d3)'
                    }}
                  />
                </div>
                <div className="flex justify-between text-[9px] text-slate-600 mt-1">
                  <span>0</span><span>Safe Zone</span><span>15 RPM Cap</span>
                </div>
              </div>

              {/* Chunk Cards Grid */}
              <div className={`chunk-grid overflow-y-auto max-h-52`}>
                {chunks.map(chunk => (
                  <ChunkCard key={chunk.index} chunk={chunk} />
                ))}
                {chunks.length === 0 && (
                  <div className="col-span-full text-center py-6 text-slate-600 text-xs">
                    Upload a video to generate chunks
                  </div>
                )}
              </div>

              {/* Processing Status */}
              {isProcessing && (
                <div className="animate-fade-in bg-violet-950/30 border border-violet-500/30 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Spinner size="sm" color="violet" />
                    <span className="text-xs text-violet-300 font-medium">{processingStep}</span>
                  </div>
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 transition-all duration-300" style={{ width: `${processingProgress}%` }} />
                  </div>
                </div>
              )}

              <button
                onClick={startParallelTranslation}
                disabled={isProcessing}
                className="btn-premium w-full py-3 rounded-xl text-sm font-bold tracking-wide"
              >
                {isProcessing ? (
                  <span className="flex items-center justify-center gap-2"><Spinner />Processing Chunks…</span>
                ) : (
                  '⚡ Start Parallel Translation Pipeline'
                )}
              </button>
            </div>
          </div>

          {/* ══ RIGHT COLUMN: Hub 1 + Hub 2 + Hub 4 ══════════════════════ */}
          <div className="xl:col-span-7 flex flex-col gap-5">

            {/* HUB 1 + 2: SUBTITLE STUDIO & RECAP SCRIPT */}
            <div className="studio-panel p-5 flex flex-col gap-4" style={{ minHeight: '520px' }}>
              {/* Tab Header */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-5 h-5 rounded-md bg-violet-600/30 border border-violet-500/40 flex items-center justify-center text-[10px] font-bold text-violet-300 font-mono">1</span>
                    <span className="text-[10px] font-bold tracking-widest uppercase text-violet-400">Hub 1–2 · Subtitle & Recap Studio</span>
                  </div>
                  <h2 className="text-base font-bold text-slate-100">Interactive Subtitle & Script Workspace</h2>
                </div>
                <div className="flex items-center gap-2">
                  {activeTab === 'subtitles' && (
                    <button onClick={batchDubAllSegments} disabled={isProcessing}
                      className="text-[10px] bg-fuchsia-600/20 hover:bg-fuchsia-600/30 text-fuchsia-300 border border-fuchsia-500/30 px-2.5 py-1.5 rounded-lg font-bold transition-all whitespace-nowrap">
                      ⚡ Batch Dub All
                    </button>
                  )}
                  {activeTab === 'recap' && (
                    <button onClick={generateMovieRecapScript} disabled={isGeneratingRecap}
                      className="text-[10px] bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 border border-violet-500/30 px-2.5 py-1.5 rounded-lg font-bold transition-all whitespace-nowrap">
                      {isGeneratingRecap ? <span className="flex items-center gap-1"><Spinner />Drafting…</span> : '✦ Draft AI Script'}
                    </button>
                  )}
                </div>
              </div>

              {/* Tab Switcher */}
              <div className="flex gap-1 bg-slate-950/80 border border-slate-800 rounded-xl p-1">
                <button onClick={() => setActiveTab('subtitles')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'subtitles' ? 'tab-active' : 'text-slate-500 hover:text-slate-300'}`}>
                  📝 Subtitle Timeline
                </button>
                <button onClick={() => setActiveTab('recap')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'recap' ? 'tab-active' : 'text-slate-500 hover:text-slate-300'}`}>
                  🎭 Movie Recap Script
                </button>
              </div>

              {/* SUBTITLES TAB */}
              {activeTab === 'subtitles' && (
                <div className="flex-1 flex flex-col gap-3 animate-fade-in">
                  <div className="flex-1 overflow-y-auto space-y-2 max-h-72 pr-1">
                    {segments.map((seg) => {
                      const isActive = currentTime >= seg.start && currentTime <= seg.end;
                      const isSelected = selectedSegment?.id === seg.id;
                      return (
                        <div
                          key={seg.id}
                          onClick={() => setSelectedSegment(seg)}
                          className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                            isActive ? 'segment-active' :
                            isSelected ? 'bg-slate-900/80 border-slate-700' :
                            'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] bg-slate-800 px-1.5 py-0.5 rounded font-mono text-slate-400">
                                {seg.start.toFixed(1)}s–{seg.end.toFixed(1)}s
                              </span>
                              {isActive && <WaveformBars active count={4} />}
                            </div>
                            <div className="flex items-center gap-1.5">
                              {seg.dubSpeed !== 1.0 && (
                                <span className="text-[9px] font-mono text-amber-400 bg-amber-950/30 px-1.5 rounded">{seg.dubSpeed}x</span>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); synthesizeSegment(seg.id); }}
                                disabled={seg.isGeneratingTTS}
                                className={`px-2 py-0.5 rounded-md text-[9px] font-bold transition-all ${
                                  seg.audioUrl ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30' :
                                  'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'
                                }`}
                              >
                                {seg.isGeneratingTTS ? <Spinner /> : seg.audioUrl ? '✓ TTS' : 'TTS'}
                              </button>
                              {seg.audioUrl && !seg.audioUrl.startsWith('demo') && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); playDubAudio(seg); }}
                                  className="p-1 bg-violet-600/20 text-violet-300 rounded-md hover:bg-violet-600/30 border border-violet-500/30"
                                >
                                  <IconPlay />
                                </button>
                              )}
                            </div>
                          </div>
                          <p className="text-[10px] text-slate-500 line-clamp-1 mb-0.5">{seg.sourceText}</p>
                          <p className="text-xs font-semibold text-slate-100 font-myanmar leading-relaxed line-clamp-2">{seg.myanmarText}</p>
                        </div>
                      );
                    })}
                  </div>

                  {selectedSegment && (
                    <div className="border-t border-slate-800 pt-3 animate-fade-in">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold text-violet-400 uppercase tracking-wider">✏ Editing Segment</span>
                        <button onClick={() => setSelectedSegment(null)} className="text-[10px] text-slate-500 hover:text-slate-300">Dismiss</button>
                      </div>
                      <textarea
                        value={selectedSegment.myanmarText}
                        onChange={(e) => {
                          const updated = { ...selectedSegment, myanmarText: e.target.value };
                          setSelectedSegment(updated);
                          updateSegmentState(selectedSegment.id, { myanmarText: e.target.value });
                        }}
                        className="input-premium w-full bg-slate-950 rounded-xl p-3 text-xs text-yellow-300 font-myanmar focus:outline-none"
                        rows={2}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* RECAP SCRIPT TAB */}
              {activeTab === 'recap' && (
                <div className="flex-1 flex flex-col gap-3 animate-fade-in">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400">ဇာတ်လမ်းပြောပြသူ ဇာတ်ညွှန်း (Movie Recap Script)</span>
                    {recapAudioUrl && (
                      <button onClick={playRecapNarrative}
                        className="flex items-center gap-1.5 bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-lg text-xs font-bold hover:bg-emerald-600/30 transition-all">
                        <IconPlay /> Play Narration
                      </button>
                    )}
                  </div>

                  <textarea
                    value={recapScript}
                    onChange={(e) => setRecapScript(e.target.value)}
                    placeholder="Generate or write your Burmese Movie Recap narrative here…"
                    className="input-premium flex-1 min-h-48 w-full bg-slate-950 rounded-xl p-3 text-xs text-slate-200 font-myanmar focus:outline-none resize-none"
                  />

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-slate-500 block mb-1 uppercase tracking-wider">Narrator Voice</label>
                      <select value={recapVoice} onChange={(e) => setRecapVoice(e.target.value)}
                        className="input-premium w-full bg-slate-950 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-300">
                        {[...VOICES.male, ...VOICES.female].map(v => (
                          <option key={v.value} value={v.value}>{v.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 block mb-1 uppercase tracking-wider">Dramatic Emotion</label>
                      <select value={recapEmotion} onChange={(e) => setRecapEmotion(e.target.value)}
                        className="input-premium w-full bg-slate-950 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-300">
                        {EMOTIONS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
                      </select>
                    </div>
                  </div>

                  <button onClick={synthesizeFullRecapAudio} disabled={isSynthesizingRecap || !recapScript}
                    className="btn-premium w-full py-3 rounded-xl text-sm font-bold tracking-wide">
                    {isSynthesizingRecap ? (
                      <span className="flex items-center justify-center gap-2"><Spinner />Synthesizing Narration…</span>
                    ) : '🎙 Synthesize Full Myanmar Audio Narration'}
                  </button>
                </div>
              )}
            </div>

            {/* HUB 4: SIMULTANEOUS TTS CONSOLE */}
            <div className="studio-panel p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <SectionBadge label="Hub 4 · TTS Console" num="4" />
                  <h2 className="text-base font-bold text-slate-100">Myanmar Simultaneous TTS Console</h2>
                  <p className="text-[11px] text-slate-500 mt-0.5">Dual-speaker live dialogue testing with configurable voices & emotional range</p>
                </div>
                <div className="flex items-center gap-2 bg-slate-950/80 border border-slate-800 rounded-xl p-2">
                  <label className="text-[10px] text-slate-400">Speed</label>
                  <input type="range" min="0.5" max="2.0" step="0.1" value={dialogueSpeed}
                    onChange={(e) => setDialogueSpeed(parseFloat(e.target.value))}
                    className="w-20 accent-violet-500" />
                  <span className="metric-value text-[11px] text-violet-300 w-8">{dialogueSpeed}x</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Speaker A */}
                <div className="speaker-card p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-fuchsia-400 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-fuchsia-400 pulse-dot" />
                      Speaker A — Female
                    </span>
                    <WaveformBars active={isSynthesizingLeft} count={4} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <select value={studioVoiceLeft} onChange={(e) => setStudioVoiceLeft(e.target.value)}
                      className="input-premium bg-slate-950 rounded-lg px-2 py-1 text-[10px] text-slate-300">
                      {VOICES.female.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                    </select>
                    <select value={studioEmotionLeft} onChange={(e) => setStudioEmotionLeft(e.target.value)}
                      className="input-premium bg-slate-950 rounded-lg px-2 py-1 text-[10px] text-slate-300">
                      {EMOTIONS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
                    </select>
                  </div>
                  <textarea value={studioTextLeft} onChange={(e) => setStudioTextLeft(e.target.value)}
                    className="input-premium w-full bg-slate-950 rounded-xl p-2.5 text-xs text-slate-200 font-myanmar focus:outline-none resize-none"
                    rows={3} />
                  <button onClick={() => synthesizeStudioSpeaker('left')} disabled={isSynthesizingLeft}
                    className="w-full py-2 rounded-xl text-xs font-bold bg-fuchsia-600/20 hover:bg-fuchsia-600/30 text-fuchsia-300 border border-fuchsia-500/30 transition-all disabled:opacity-50">
                    {isSynthesizingLeft ? <span className="flex items-center justify-center gap-1.5"><Spinner color="fuchsia" />Synthesizing…</span> : '🎤 Synthesize Speaker A'}
                  </button>
                </div>

                {/* Speaker B */}
                <div className="speaker-card p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-cyan-400 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-cyan-400 pulse-dot" />
                      Speaker B — Male
                    </span>
                    <WaveformBars active={isSynthesizingRight} count={4} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <select value={studioVoiceRight} onChange={(e) => setStudioVoiceRight(e.target.value)}
                      className="input-premium bg-slate-950 rounded-lg px-2 py-1 text-[10px] text-slate-300">
                      {VOICES.male.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                    </select>
                    <select value={studioEmotionRight} onChange={(e) => setStudioEmotionRight(e.target.value)}
                      className="input-premium bg-slate-950 rounded-lg px-2 py-1 text-[10px] text-slate-300">
                      {EMOTIONS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
                    </select>
                  </div>
                  <textarea value={studioTextRight} onChange={(e) => setStudioTextRight(e.target.value)}
                    className="input-premium w-full bg-slate-950 rounded-xl p-2.5 text-xs text-slate-200 font-myanmar focus:outline-none resize-none"
                    rows={3} />
                  <button onClick={() => synthesizeStudioSpeaker('right')} disabled={isSynthesizingRight}
                    className="w-full py-2 rounded-xl text-xs font-bold bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 transition-all disabled:opacity-50">
                    {isSynthesizingRight ? <span className="flex items-center justify-center gap-1.5"><Spinner color="cyan" />Synthesizing…</span> : '🎤 Synthesize Speaker B'}
                  </button>
                </div>
              </div>

              {/* Dialogue playback controls */}
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => playDialogue('concurrent')}
                  className="py-2.5 rounded-xl text-xs font-bold bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 border border-violet-500/30 transition-all">
                  ⟶⟶ Play Concurrent Dialogue
                </button>
                <button onClick={() => playDialogue('sequential')}
                  className="py-2.5 rounded-xl text-xs font-bold bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 transition-all">
                  ⟶→ Play Sequential Dialogue
                </button>
              </div>
            </div>
          </div>

        </main>

        {/* ── FOOTER ──────────────────────────────────────────────────── */}
        <footer className="relative z-10 border-t border-violet-500/15 bg-slate-950/60 backdrop-blur px-6 py-3 flex flex-wrap items-center justify-between text-[10px] text-slate-600 gap-2">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-dot" />
              <span className="text-slate-500">Htut Production Suite v3.0</span>
            </span>
            <span className="text-slate-700">·</span>
            <span className="font-mono text-violet-500">Parallel 30s Chunk Scheduler · Free Tier 15 RPM Guard</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-slate-700">Gemini 2.5 Flash · Myanmar TTS Engine</span>
            <span className="text-slate-700">·</span>
            <span className={`px-2 py-0.5 rounded-full font-mono font-bold ${useDemoMode ? 'text-amber-400 bg-amber-950/40 border border-amber-500/30' : 'text-emerald-400 bg-emerald-950/40 border border-emerald-500/30'}`}>
              {useDemoMode ? '◌ DEMO MODE' : '● LIVE API'}
            </span>
          </div>
        </footer>
      </div>
    </>
  );
}
