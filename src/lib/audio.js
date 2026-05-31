// PCM to WAV conversion
export function pcmToWav(pcmData, sampleRate = 24000) {
  const buffer = new ArrayBuffer(44 + pcmData.length * 2);
  const view = new DataView(buffer);
  const writeString = (v, offset, str) => {
    for (let i = 0; i < str.length; i++) v.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcmData.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, pcmData.length * 2, true);
  let offset = 44;
  for (let i = 0; i < pcmData.length; i++, offset += 2) {
    view.setInt16(offset, pcmData[i], true);
  }
  return new Blob([view], { type: 'audio/wav' });
}

// Exponential backoff fetch
export async function fetchWithBackoff(url, options, retries = 5, delay = 1000) {
  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      if (retries > 0 && (response.status === 429 || response.status >= 500)) {
        await new Promise(r => setTimeout(r, delay));
        return fetchWithBackoff(url, options, retries - 1, delay * 2);
      }
      throw new Error(`HTTP Error: ${response.status}`);
    }
    return response;
  } catch (error) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, delay));
      return fetchWithBackoff(url, options, retries - 1, delay * 2);
    }
    throw error;
  }
}

// Extract WAV base64 from AudioBuffer chunk
export async function getWavBase64ForChunk(audioBuffer, startSec, endSec) {
  if (!audioBuffer) return '';
  const sampleRate = audioBuffer.sampleRate;
  const startSample = Math.floor(startSec * sampleRate);
  const endSample = Math.floor(endSec * sampleRate);
  const length = endSample - startSample;
  const channelData = audioBuffer.getChannelData(0).subarray(startSample, endSample);
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, length * 2, true);
  let offset = 44;
  for (let i = 0; i < length; i++) {
    const sample = Math.max(-1, Math.min(1, channelData[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
    offset += 2;
  }
  const blob = new Blob([view], { type: 'audio/wav' });
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(blob);
  });
}

// Request Gemini TTS
export async function requestGeminiTts(text, voice, emotion, apiKey) {
  if (!apiKey) throw new Error('API Key missing. Provide your Google Gemini API key.');
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{ parts: [{ text: `Say ${emotion}: ${text}` }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
    }
  };
  const response = await fetchWithBackoff(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  const inlineData = result.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  if (!inlineData?.data) throw new Error('No audio payload returned from Gemini TTS.');
  const rawBinary = atob(inlineData.data);
  const pcmData = new Int16Array(rawBinary.length / 2);
  for (let i = 0; i < pcmData.length; i++) {
    pcmData[i] = (rawBinary.charCodeAt(i * 2) & 0xff) | ((rawBinary.charCodeAt(i * 2 + 1) & 0xff) << 8);
  }
  return URL.createObjectURL(pcmToWav(pcmData, 24000));
}

// Draw waveform on canvas
export function drawWaveform(buffer, canvas) {
  if (!canvas || !buffer) return;
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#030712';
  ctx.fillRect(0, 0, width, height);
  const leftChannel = buffer.getChannelData(0);
  const step = Math.ceil(leftChannel.length / width);
  const amp = height / 2;
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, 'rgba(124, 58, 237, 0.9)');
  gradient.addColorStop(0.5, 'rgba(192, 38, 211, 0.9)');
  gradient.addColorStop(1, 'rgba(99, 102, 241, 0.9)');
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(0, amp);
  for (let i = 0; i < width; i++) {
    let min = 1.0, max = -1.0;
    for (let j = 0; j < step; j++) {
      const datum = leftChannel[i * step + j];
      if (datum < min) min = datum;
      if (datum > max) max = datum;
    }
    ctx.lineTo(i, (1 + min) * amp);
    ctx.lineTo(i, (1 + max) * amp);
  }
  ctx.stroke();
}

// Format seconds to SRT time
export function formatSrtTime(seconds) {
  const d = new Date(null);
  d.setSeconds(seconds);
  const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
  const formatted = d.toISOString().substr(11, 8);
  return `${formatted},${ms}`;
}

// Demo data
export const DEMO_SEGMENTS = [
  { id: 'seg-1', start: 2.5, end: 8.0, sourceText: 'Deep inside the dark forest, a mysterious glowing door appeared before him.', myanmarText: 'မှောင်မိုက်လှတဲ့ သစ်တောနက်ကြီးထဲမှာ၊ ဆန်းကြယ်တဲ့ အလင်းတံခါးတစ်ခုက သူ့ရှေ့မှာ ပေါ်လာခဲ့ပါတယ်။', audioUrl: null, dubSpeed: 1.0, isGeneratingTTS: false },
  { id: 'seg-2', start: 9.2, end: 15.5, sourceText: 'He knew entering this doorway would change his destiny forever, but curiosity took over.', myanmarText: 'ဒီတံခါးကို ဖြတ်ကျော်ဝင်ရောက်ခြင်းက သူ့ကံကြမ္မာကို ထာဝရပြောင်းလဲပစ်တော့မယ်ဆိုတာ သူသိပေမယ့်လည်း စူးစမ်းလိုစိတ်က ပိုကြီးစိုးသွားခဲ့ပါတယ်။', audioUrl: null, dubSpeed: 1.0, isGeneratingTTS: false },
  { id: 'seg-3', start: 17.0, end: 24.1, sourceText: 'Instantly, he was transported into a world filled with high-tech machines and cybernetic energy.', myanmarText: 'ချက်ချင်းဆိုသလိုပဲ၊ သူဟာ အဆင့်မြင့်စက်ရုပ်တွေနဲ့ ဆိုက်ဘာနက်တစ် စွမ်းအင်တွေပြည့်နှက်နေတဲ့ ကမ္ဘာသစ်တစ်ခုဆီကို ရောက်ရှိသွားခဲ့ပါတယ်။', audioUrl: null, dubSpeed: 1.0, isGeneratingTTS: false },
  { id: 'seg-4', start: 25.5, end: 29.8, sourceText: 'This is where our legendary journey truly begins. What happens next?', myanmarText: 'ဒီနေရာကတော့ ကျွန်တော်တို့ရဲ့ ဒဏ္ဍာရီဆန်ဆန် ခရီးစဉ်အစပြုရာ နေရာပဲ ဖြစ်ပါတယ်။ နောက်ထပ် ဘာဆက်ဖြစ်မလဲ။', audioUrl: null, dubSpeed: 1.0, isGeneratingTTS: false }
];

export const DEMO_RECAP = `စတင်မိတ်ဆက်ခြင်း — အားလုံးပဲ မင်္ဂလာပါ။ ဒီနေ့မှာတော့ သစ်တောနက်ကြီးထဲက ဆန်းကြယ်တဲ့ အလင်းတံခါးရဲ့ ဇာတ်လမ်းကို တင်ဆက်ပေးသွားမှာပါ။

ဇာတ်လမ်းနောက်ခံ — ဇာတ်လိုက်ဖြစ်သူဟာ အစောပိုင်းမှာ တားမြစ်ထားတဲ့ သစ်တောကြီးထဲကို စူးစမ်းရင်း အလင်းတံခါးတစ်ခုကို မမျှော်လင့်ဘဲ ရှာတွေ့ခဲ့တယ်။ သူသိချင်စိတ်ကြောင့် တံခါးထဲကို ဝင်လိုက်တဲ့အခါ စက်ရုပ်တွေနဲ့ နည်းပညာတွေ ပြည့်နှက်နေတဲ့ အနာဂတ်ကမ္ဘာဆီကို ရောက်သွားခဲ့ပါတယ်။

နိဂုံး — သူဟာ ဒီကမ္ဘာကြီးကနေ ပြန်လည်လွတ်မြောက်နိုင်ပါ့မလား ဆိုတာကိုတော့ နောက်အပိုင်းမှာ ဆက်လက် စောင့်မျှော်ကြည့်ရှုပေးကြပါဦးခင်ဗျာ။`;

export const VOICES = {
  male: [
    { value: 'Kore', label: 'Kore — Male Recap Host' },
    { value: 'Fenrir', label: 'Fenrir — Dramatic Male' },
    { value: 'Puck', label: 'Puck — Versatile Male' },
  ],
  female: [
    { value: 'Leda', label: 'Leda — Female Storyteller' },
    { value: 'Zephyr', label: 'Zephyr — Soft Female' },
    { value: 'Aoede', label: 'Aoede — Melodic Female' },
  ]
};

export const EMOTIONS = [
  { value: 'excitedly', label: 'Excited Storytelling' },
  { value: 'calmly', label: 'Serious Narrative' },
  { value: 'cheerfully', label: 'Upbeat Commentary' },
  { value: 'in a whisper', label: 'Mysterious Whisper' },
  { value: 'dramatically', label: 'Dramatic Intensity' },
];
