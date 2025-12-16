
const canvas = document.getElementById('visualiser');
const ctx = canvas.getContext('2d');

const WIDTH = canvas.width;
const HEIGHT = canvas.height;

let animationId = null;

const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const audioEl = document.querySelector('audio');
const effectButtons = document.querySelectorAll('.effect');

// Web Audio variables
let audioCtx = null;
let analyser = null;
let mediaStream = null;
let mediaStreamSource = null;
let mediaRecorder = null;
let recordedChunks = [];
let mediaElementSource = null;
let convolverNode = null;
let waveShaper = null;
let gainNode = null;
let pitchNode = null;

let effectsState = {
  reverb: false,
  pitch: false,
  distortion: false,
};

function createReverbIR(context, duration = 2.0, decay = 2.0) {
  const sampleRate = context.sampleRate;
  const length = sampleRate * duration;
  const impulse = context.createBuffer(2, length, sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const channelData = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      // exponential decay
      channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

function makeDistortionCurve(amount) {
  const k = typeof amount === 'number' ? amount : 50;
  const n_samples = 44100;
  const curve = new Float32Array(n_samples);
  const deg = Math.PI / 180;
  for (let i = 0; i < n_samples; ++i) {
    const x = (i * 2) / n_samples - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

function connectPlaybackChain() {
  if (!audioCtx || !mediaElementSource) return;

  // Disconnect everything first
  try { mediaElementSource.disconnect(); } catch (e) {}
  try { if (convolverNode) convolverNode.disconnect(); } catch (e) {}
  try { if (waveShaper) waveShaper.disconnect(); } catch (e) {}
  try { if (pitchNode) pitchNode.disconnect(); } catch (e) {}
  try { if (analyser) analyser.disconnect(); } catch (e) {}
  try { if (gainNode) gainNode.disconnect(); } catch (e) {}

  // Build chain: mediaElementSource -> gain -> (convolver) -> (waveShaper) -> analyser -> destination
  mediaElementSource.connect(gainNode);

  let lastNode = gainNode;

  if (effectsState.reverb) {
    lastNode.connect(convolverNode);
    lastNode = convolverNode;
  }

  if (effectsState.distortion) {
    lastNode.connect(waveShaper);
    lastNode = waveShaper;
  }

  // pitch node inserted before analyser if active
  if (effectsState.pitch && pitchNode) {
    lastNode.connect(pitchNode);
    pitchNode.connect(analyser);
  } else {
    lastNode.connect(analyser);
  }

  analyser.connect(audioCtx.destination);
}

function updateEffectButtonUI() {
  effectButtons.forEach((btn) => {
    const name = btn.textContent.trim().toLowerCase();
    if (name.includes('reverb')) btn.classList.toggle('active', effectsState.reverb);
    if (name.includes('pitch')) btn.classList.toggle('active', effectsState.pitch);
    if (name.includes('distortion')) btn.classList.toggle('active', effectsState.distortion);
  });
  updateCurrentEffectLabel();
}

function updateCurrentEffectLabel() {
  const el = document.getElementById('current-effect');
  if (!el) return;
  if (effectsState.reverb) el.textContent = 'Current effect: Reverb';
  else if (effectsState.pitch) el.textContent = 'Current effect: Pitch Shift';
  else if (effectsState.distortion) el.textContent = 'Current effect: Distortion';
  else el.textContent = 'Current effect: None';
}

async function ensurePitchNode() {
  if (!audioCtx) return;
  if (pitchNode) return;
  try {
    await audioCtx.audioWorklet.addModule('pitch-shifter-processor.js');
    pitchNode = new AudioWorkletNode(audioCtx, 'pitch-shifter', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      parameterData: { pitch: 1.0 }
    });
  } catch (err) {
    console.warn('Unable to load pitch shifter worklet', err);
    pitchNode = null;
  }
}

async function onRecordingStop() {
  const blob = new Blob(recordedChunks, { type: 'audio/webm' });
  const url = URL.createObjectURL(blob);
  audioEl.src = url;
  audioEl.playbackRate = 1.0;

  // Mute native audio element output — we'll route audio through AudioContext
  // so processed sound (via convolver/waveshaper) is heard instead of native playback.
  audioEl.muted = true;

  // Create or recreate media element source so we can apply WebAudio effects to playback
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await ensurePitchNode();
  if (mediaElementSource) {
    try { mediaElementSource.disconnect(); } catch (e) {}
  }
  mediaElementSource = audioCtx.createMediaElementSource(audioEl);

  // ensure nodes exist
  if (!gainNode) gainNode = audioCtx.createGain();
  if (!convolverNode) {
    convolverNode = audioCtx.createConvolver();
    convolverNode.buffer = createReverbIR(audioCtx, 2.5, 2.2);
  }
  if (!waveShaper) waveShaper = audioCtx.createWaveShaper();
  waveShaper.curve = makeDistortionCurve(400);
  if (!analyser) analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;

  connectPlaybackChain();
  updateEffectButtonUI();
}

function startVisualizer() {
  if (!analyser) {
    // create a lightweight analyser for the mic or playback fallback
    if (!audioCtx) return drawRandomVisualizerFrame();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
  }
  // show canvas when visualizer starts
  if (canvas) canvas.style.display = 'block';
  drawVisualizerFrame();
}

function connectLiveChain() {
  if (!audioCtx || !mediaStreamSource) return;

  try { mediaStreamSource.disconnect(); } catch (e) {}
  try { analyser.disconnect(); } catch (e) {}
  try { if (pitchNode) pitchNode.disconnect(); } catch (e) {}

  analyser = analyser || audioCtx.createAnalyser();
  analyser.fftSize = 2048;

  if (effectsState.pitch && pitchNode) {
    mediaStreamSource.connect(pitchNode);
    pitchNode.connect(analyser);
  } else {
    mediaStreamSource.connect(analyser);
  }

  analyser.connect(audioCtx.destination);
}

function drawRandomVisualizerFrame() {
  // fallback visualizer when no analyser available
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const barWidth = 10;
  const barGap = 5;
  const totalBarSpace = barWidth + barGap;
  const barCount = Math.floor(WIDTH / totalBarSpace);
  for (let i = 0; i < barCount; i++) {
    const barHeight = Math.random() * (HEIGHT - 40);
    const x = i * totalBarSpace;
    const y = HEIGHT - barHeight;
    ctx.fillStyle = '#ff4d4d';
    ctx.fillRect(x, y, barWidth, barHeight);
  }
  animationId = requestAnimationFrame(startVisualizer);
}

function drawVisualizerFrame() {
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteFrequencyData(dataArray);

  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const barWidth = (WIDTH / bufferLength) * 2.5;
  let x = 0;

  for (let i = 0; i < bufferLength; i++) {
    const v = dataArray[i] / 255.0;
    const barHeight = v * HEIGHT;

    const r = Math.floor(255 * v);
    const g = 50;
    const b = 50;

    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, HEIGHT - barHeight, barWidth, barHeight);
    x += barWidth + 1;
  }

  animationId = requestAnimationFrame(drawVisualizerFrame);
}

function stopVisualizer() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  // hide canvas when not active
  if (canvas) canvas.style.display = 'none';
}

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  stopBtn.disabled = false;

  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await audioCtx.resume();

  // load pitch worklet early so it's ready when needed
  await ensurePitchNode();

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    console.error('Microphone access denied or unavailable', err);
    startBtn.disabled = false;
    stopBtn.disabled = true;
    return;
  }

  // create nodes for live monitoring
  mediaStreamSource = audioCtx.createMediaStreamSource(mediaStream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  gainNode = audioCtx.createGain();
  convolverNode = audioCtx.createConvolver();
  convolverNode.buffer = createReverbIR(audioCtx, 2.5, 2.2);
  waveShaper = audioCtx.createWaveShaper();
  waveShaper.curve = makeDistortionCurve(400);

  // connect live mic using the chain helper (will include pitch node if active)
  connectLiveChain();

  // start visualizer
  startVisualizer();

  // Setup MediaRecorder
  recordedChunks = [];
  mediaRecorder = new MediaRecorder(mediaStream);
  mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = onRecordingStop;
  mediaRecorder.start();
});

stopBtn.addEventListener('click', () => {
  stopBtn.disabled = true;
  startBtn.disabled = false;

  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();

  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }

  if (mediaStreamSource) {
    try { mediaStreamSource.disconnect(); } catch (e) {}
    mediaStreamSource = null;
  }

  stopVisualizer();
});

// Effect button handlers
effectButtons.forEach((btn) => {
  btn.addEventListener('click', async () => {
    const name = btn.textContent.trim().toLowerCase();

    // Single-selection behavior: if clicked effect already active -> deactivate it.
    // Otherwise, deactivate all and activate clicked one.
    const wasActive = (name.includes('reverb') && effectsState.reverb) ||
      (name.includes('pitch') && effectsState.pitch) ||
      (name.includes('distortion') && effectsState.distortion);

    // reset all
    effectsState.reverb = false;
    effectsState.pitch = false;
    effectsState.distortion = false;

    if (!wasActive) {
      if (name.includes('reverb')) effectsState.reverb = true;
      else if (name.includes('pitch')) effectsState.pitch = true;
      else if (name.includes('distortion')) effectsState.distortion = true;
    }

    // Ensure pitch node exists and set its parameter when pitch is selected
    if (effectsState.pitch) {
      if (audioCtx) await ensurePitchNode();
      if (pitchNode && pitchNode.parameters) {
        const p = pitchNode.parameters.get('pitch');
        if (p) p.setValueAtTime(1.5, audioCtx.currentTime || 0);
      }
    } else {
      if (pitchNode && pitchNode.parameters) {
        const p = pitchNode.parameters.get('pitch');
        if (p) p.setValueAtTime(1.0, audioCtx.currentTime || 0);
      }
    }

    // Reconnect both playback and live chains so current effect selection is applied
    if (audioCtx && mediaElementSource) connectPlaybackChain();
    if (audioCtx && mediaStreamSource) connectLiveChain();
    updateEffectButtonUI();
  });
});

// When user plays the audio element while connected via mediaElementSource,
// ensure AudioContext is running (user gesture may be required)
audioEl.addEventListener('play', async () => {
  if (audioCtx && audioCtx.state === 'suspended') await audioCtx.resume();
});

// initialize UI state
stopBtn.disabled = true;