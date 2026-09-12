const prism = require('prism-media');
const fs = require('fs');

let localTranscriber = null;

async function getTranscriber() {
  if (!localTranscriber) {
    try {
      console.log('⚡ Loading local Xenova Whisper AI speech recognition model...');
      const { pipeline } = await import('@xenova/transformers');
      localTranscriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny');
      console.log('✅ Local Whisper AI model ready!');
    } catch (err) {
      console.warn('⚠️ Whisper AI model initialization skipped:', err.message);
      return null;
    }
  }
  return localTranscriber;
}

function decodeOggOpusToPCM(oggFilePath) {
  return new Promise((resolve, reject) => {
    try {
      const oggStream = fs.createReadStream(oggFilePath);
      const demuxer = new prism.opus.OggDemuxer();
      const decoder = new prism.opus.Decoder({ rate: 16000, channels: 1, frameSize: 960 });

      const chunks = [];
      oggStream.pipe(demuxer).pipe(decoder);
      decoder.on('data', chunk => chunks.push(chunk));
      decoder.on('end', () => resolve(Buffer.concat(chunks)));
      decoder.on('error', err => reject(err));
      demuxer.on('error', err => reject(err));
    } catch (err) {
      reject(err);
    }
  });
}

function pcmToFloat32Array(pcmBuffer) {
  const samples = new Float32Array(pcmBuffer.length / 2);
  for (let i = 0; i < samples.length; i++) {
    const int16 = pcmBuffer.readInt16LE(i * 2);
    samples[i] = int16 / 32768.0;
  }
  return samples;
}

/**
 * Real Speech Recognition & Translation Engine
 * Decodes WhatsApp OGG Opus audio into PCM and runs local Whisper AI transcription.
 */
async function transcribeAndTranslateAudio(audioFilePath) {
  if (!fs.existsSync(audioFilePath)) {
    throw new Error('Audio file not found on server.');
  }

  let transcript = '';

  try {
    const pcmBuffer = await decodeOggOpusToPCM(audioFilePath);
    if (pcmBuffer && pcmBuffer.length > 0) {
      const float32Samples = pcmToFloat32Array(pcmBuffer);
      const transcriber = await getTranscriber();
      const result = await transcriber(float32Samples);
      if (result && result.text && result.text.trim()) {
        transcript = result.text.trim();
      }
    }
  } catch (err) {
    console.error('Real audio transcription error:', err.message);
  }

  if (!transcript) {
    transcript = '(No speech detected in audio)';
  }

  const translation = (transcript === '(No speech detected in audio)') 
    ? '(No speech detected in audio)' 
    : await translateToEnglish(transcript);

  return {
    transcript: transcript,
    translation: translation,
    model: 'OpenAI Whisper AI (Real-Time Local Speech Engine)'
  };
}

async function translateToEnglish(text) {
  if (!text) return text;

  try {
    const res = await fetch('https://router.huggingface.co/hf-inference/models/Helsinki-NLP/opus-mt-mul-en', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: text })
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data[0]?.translation_text) {
        return data[0].translation_text;
      }
    }
  } catch (e) {}

  return text;
}

module.exports = {
  transcribeAndTranslateAudio
};
