export const decodeBase64 = (base64: string): Uint8Array => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

export const decodeAudioData = async (
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1
): Promise<AudioBuffer> => {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
};

export const playAudioBuffer = (
  ctx: AudioContext,
  buffer: AudioBuffer,
  onEnded?: () => void
): AudioBufferSourceNode => {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  if (onEnded) {
    source.addEventListener('ended', onEnded);
  }
  source.start();
  return source;
};

export const createWavBlob = (audioBuffer: AudioBuffer): Blob => {
  const numOfChan = audioBuffer.numberOfChannels;
  const length = audioBuffer.length * numOfChan * 2 + 44;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  const channels = [];
  let i;
  let sample;
  let pos = 0;
  let offset = 0;

  // writeString helper
  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  // write WAVE header
  writeString(view, 0, 'RIFF'); offset += 4;
  view.setUint32(offset, length - 8, true); offset += 4;
  writeString(view, offset, 'WAVE'); offset += 4;

  writeString(view, offset, 'fmt '); offset += 4;
  view.setUint32(offset, 16, true); offset += 4; // length = 16
  view.setUint16(offset, 1, true); offset += 2; // PCM (uncompressed)
  view.setUint16(offset, numOfChan, true); offset += 2;
  view.setUint32(offset, audioBuffer.sampleRate, true); offset += 4;
  view.setUint32(offset, audioBuffer.sampleRate * 2 * numOfChan, true); offset += 4;
  view.setUint16(offset, numOfChan * 2, true); offset += 2; // block-align
  view.setUint16(offset, 16, true); offset += 2; // 16-bit

  writeString(view, offset, 'data'); offset += 4;
  view.setUint32(offset, length - offset - 4, true); offset += 4;

  // write interleaved data
  for (i = 0; i < audioBuffer.numberOfChannels; i++) {
    channels.push(audioBuffer.getChannelData(i));
  }

  while (pos < audioBuffer.length) {
    for (i = 0; i < numOfChan; i++) {
      // interleave channels
      sample = Math.max(-1, Math.min(1, channels[i][pos])); // clamp
      sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF) | 0; // scale to 16-bit signed int
      view.setInt16(offset, sample, true); // write 16-bit sample
      offset += 2;
    }
    pos++;
  }

  return new Blob([buffer], { type: "audio/wav" });
};

// Mix voice buffer with a background music buffer (looping the BGM)
export const mixAudioBuffers = (
  base: AudioBuffer,
  overlay: AudioBuffer,
  overlayVolume: number,
  ctx: AudioContext
): AudioBuffer => {
  const channels = base.numberOfChannels;
  const length = base.length;
  // Create output buffer with same properties as base (voice)
  const mixed = ctx.createBuffer(channels, length, base.sampleRate);

  for (let c = 0; c < channels; c++) {
    const baseData = base.getChannelData(c);
    // Handle mono overlay on stereo base if needed, or just cycle channels
    const overlayData = overlay.getChannelData(c % overlay.numberOfChannels);
    const mixedData = mixed.getChannelData(c);

    for (let i = 0; i < length; i++) {
      // Loop the overlay buffer
      const overlaySample = overlayData[i % overlayData.length];
      // Simple mix
      mixedData[i] = baseData[i] + (overlaySample * overlayVolume);
    }
  }
  return mixed;
};

// Generate simple procedural background audio
export const generateProceduralBgm = async (
  type: 'relaxed' | 'suspense',
  sampleRate: number
): Promise<AudioBuffer> => {
  const duration = 10; // 10 seconds loop is enough to not sound too repetitive immediately
  const length = sampleRate * duration;
  const offlineCtx = new OfflineAudioContext(2, length, sampleRate);

  if (type === 'relaxed') {
    // Pink noise + Lowpass = Ocean/Wind
    const bufferSize = length;
    const noiseBuffer = offlineCtx.createBuffer(1, bufferSize, sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      output[i] = (lastOut + (0.02 * white)) / 1.02;
      lastOut = output[i];
      output[i] *= 3.5; // Compensate for gain loss
    }
    
    const source = offlineCtx.createBufferSource();
    source.buffer = noiseBuffer;
    
    const filter = offlineCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    
    // Stereo spread
    const merger = offlineCtx.createChannelMerger(2);
    
    source.connect(filter);
    filter.connect(merger, 0, 0);
    filter.connect(merger, 0, 1);
    merger.connect(offlineCtx.destination);
    
    source.start();

  } else if (type === 'suspense') {
    // Dark drone: 2 Sawtooth waves slightly detuned + Lowpass
    const osc1 = offlineCtx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 50;
    
    const osc2 = offlineCtx.createOscillator();
    osc2.type = 'sawtooth';
    osc2.frequency.value = 51; // Detuned for beating effect
    
    const gain = offlineCtx.createGain();
    gain.gain.value = 0.15;
    
    const filter = offlineCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 150;

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(filter);
    filter.connect(offlineCtx.destination);
    
    osc1.start();
    osc2.start();
  }

  return await offlineCtx.startRendering();
};

let lastOut = 0;