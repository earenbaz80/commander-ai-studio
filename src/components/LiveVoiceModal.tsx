import { getCachedApiKey } from '../lib/apiKeys';
import React, { useState, useEffect, useRef } from 'react';
import { X, Mic, MicOff, Volume2, VolumeX, Sparkles, Radio, RefreshCw, Check } from 'lucide-react';
import { ParameterConfig } from '../types/studio';

import { Language } from '../i18n/translations';

interface LiveVoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedModel: string;
  parameters: ParameterConfig;
  lang?: Language;
}

export const LiveVoiceModal: React.FC<LiveVoiceModalProps> = ({
  isOpen,
  onClose,
  selectedModel,
  parameters,
  lang = 'es',
}) => {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [lastResponse, setLastResponse] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!isOpen) {
      stopVoice();
    }
  }, [isOpen]);

  const startVoice = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert(lang === 'es' 
        ? 'El acceso al micrófono no está disponible en este dispositivo.' 
        : lang === 'de' ? 'Auf diesem Gerät ist kein Mikrofonzugriff verfügbar.' : 'Microphone access is not available on this device.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // Audio Visualizer
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const analyser = audioCtx.createAnalyser();
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        analyser.fftSize = 64;
        audioContextRef.current = audioCtx;
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const updateVisualizer = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);
          const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
          setAudioLevel(avg);
          animFrameRef.current = requestAnimationFrame(updateVisualizer);
        };
        updateVisualizer();
      } catch (visErr) {
        console.warn('Visualizer initialization warning:', visErr);
      }

      let chosenMime = 'audio/webm';
      if (typeof MediaRecorder !== 'undefined') {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          chosenMime = 'audio/webm;codecs=opus';
        } else if (MediaRecorder.isTypeSupported('audio/webm')) {
          chosenMime = 'audio/webm';
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          chosenMime = 'audio/mp4';
        } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
          chosenMime = 'audio/ogg';
        }
      }

      const recorder = new MediaRecorder(stream, chosenMime ? { mimeType: chosenMime } : undefined);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        setIsListening(false);
        const rawMime = recorder.mimeType || chosenMime || 'audio/webm';
        const cleanMime = rawMime.split(';')[0];
        const audioBlob = new Blob(audioChunksRef.current, { type: cleanMime });

        if (audioBlob.size < 200) {
          setIsProcessing(false);
          return;
        }

        setIsProcessing(true);
        try {
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
            try {
              const base64Url = reader.result as string;
              const base64Data = base64Url.split(',')[1] || '';
              const geminiApiKey = getCachedApiKey('GEMINI_API_KEY') || undefined;

              const response = await fetch('/api/transcribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  audioData: base64Data,
                  mimeType: cleanMime,
                  apiKey: geminiApiKey,
                  lang,
                }),
              });

              const data = await response.json();
              if (data.success && data.text) {
                setTranscript(data.text);
                await processVoiceInput(data.text);
              } else {
                setLastResponse(
                  data.error || (lang === 'es' ? 'No se pudo transcribir el audio.' : lang === 'de' ? 'Die Sprache konnte nicht transkribiert werden.' : 'Could not transcribe voice.')
                );
                setIsProcessing(false);
              }
            } catch (transcribeErr: any) {
              setLastResponse(transcribeErr.message);
              setIsProcessing(false);
            }
          };
        } catch (readErr) {
          setIsProcessing(false);
        }
      };

      recorder.start(250);
      setIsListening(true);
    } catch (e: any) {
      console.error('Voice setup error:', e);
      alert(lang === 'es' ? 'No se pudo acceder al micrófono: ' + e.message : lang === 'de' ? 'Zugriff auf das Mikrofon nicht möglich: ' + e.message : 'Could not access microphone: ' + e.message);
      setIsListening(false);
    }
  };

  const handleFinishSpeaking = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const stopVoice = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch (e) {}
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    // No todos los navegadores ni jsdom exponen speechSynthesis
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsListening(false);
    setIsSpeaking(false);
    setIsProcessing(false);
  };

  const processVoiceInput = async (inputText: string) => {
    setIsProcessing(true);
    try {
      const apiKey = getCachedApiKey('GEMINI_API_KEY') || undefined;
      const isAnthropic = selectedModel.startsWith('claude-');
      const anthropicApiKey = getCachedApiKey('ANTHROPIC_API_KEY') || undefined;
      const endpoint = isAnthropic ? '/api/anthropic/generate' : '/api/gemini/generate';
      const promptInstruction = `${parameters.systemInstruction}\n${lang === 'es' ? 'Responde de forma hablada, directa y concisa sin formato markdown complejo.' : lang === 'de' ? 'Antworte gesprochen, direkt und knapp, ohne komplexes Markdown.' : 'Respond in a spoken, direct and concise manner without complex markdown.'}`;
      
      const body = isAnthropic
        ? {
            prompt: inputText,
            systemInstruction: promptInstruction,
            model: selectedModel,
            temperature: parameters.temperature,
            maxTokens: 300,
            anthropicApiKey,
          }
        : {
            contents: inputText,
            systemInstruction: promptInstruction,
            model: selectedModel,
            temperature: parameters.temperature,
            topP: parameters.topP,
            apiKey,
          };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      setIsProcessing(false);

      if (data.success && data.text) {
        setLastResponse(data.text);
        speakResponse(data.text);
      } else if (data.text) {
        setLastResponse(data.text);
        speakResponse(data.text);
      } else {
        const errorMsg = data.error || (lang === 'es' ? 'Error al procesar la respuesta de voz.' : lang === 'de' ? 'Fehler beim Verarbeiten der Sprachantwort.' : 'Error processing voice response.');
        setLastResponse(errorMsg);
      }
    } catch (error) {
      setIsProcessing(false);
      console.error('Voice process error:', error);
      setLastResponse(lang === 'es' ? 'Error de conexión con el modelo.' : lang === 'de' ? 'Verbindungsfehler mit dem Modell.' : 'Connection error with model.');
    }
  };

  const speakResponse = (text: string) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === 'en' ? 'en-US' : 'es-ES';
    utterance.rate = 1.0;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => {
      setIsSpeaking(false);
      // Auto-restart listening for continuous voice conversation loop!
      startVoice();
    };

    window.speechSynthesis.speak(utterance);
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4 cursor-pointer"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div 
        className="bg-[#0000aa] border-4 border-[#00ffff] w-full max-w-lg font-mono text-xs text-[#00ffff] shadow-2xl overflow-hidden flex flex-col cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="bg-[#00aaaa] text-black font-bold px-3 py-2 flex items-center justify-between border-b-2 border-black">
          <div className="flex items-center gap-2">
            <Radio className="w-5 h-5 text-black animate-pulse" />
            <span className="text-sm">
              {lang === 'es' ? 'INTERACCIÓN DE VOZ EN TIEMPO REAL (LIVE VOICE)' : lang === 'de' ? 'ECHTZEIT-SPRACHINTERAKTION (LIVE-SPRACHE)' : 'REAL-TIME VOICE INTERACTION (LIVE VOICE)'}
            </span>
          </div>
          <button onClick={onClose} className="nc-button bg-red-600 text-white hover:bg-red-500">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 flex flex-col items-center justify-center space-y-6 bg-[#000080]">
          {/* Animated Waveform Orb */}
          <div className="relative flex items-center justify-center">
            <div
              className="w-32 h-32 rounded-full border-4 border-[#00ffff] flex items-center justify-center transition-all duration-75 shadow-[0_0_30px_#00ffff]"
              style={{
                transform: `scale(${1 + Math.min(audioLevel / 100, 0.4)})`,
                backgroundColor: isSpeaking ? '#ffff55' : isListening ? '#00aaaa' : '#0000aa',
              }}
            >
              {isSpeaking ? (
                <Volume2 className="w-12 h-12 text-black animate-bounce" />
              ) : isListening ? (
                <Mic className="w-12 h-12 text-black animate-pulse" />
              ) : isProcessing ? (
                <Sparkles className="w-12 h-12 text-black animate-spin" />
              ) : (
                <MicOff className="w-12 h-12 text-[#00ffff]" />
              )}
            </div>
          </div>

          {/* Status Label */}
          <div className="text-center space-y-1">
            <div className="text-base font-bold text-[#ffff55]">
              {isSpeaking
                ? (lang === 'es' ? '🔊 HABLANDO...' : lang === 'de' ? '🔊 SPRICHT...' : '🔊 SPEAKING...')
                : isProcessing
                ? (lang === 'es' ? '⚡ PENSANDO RESPUESTA...' : lang === 'de' ? '⚡ ANTWORT WIRD ERDACHT...' : '⚡ THINKING RESPONSE...')
                : isListening
                ? (lang === 'es' ? '🎙️ ESCUCHANDO TU VOZ...' : lang === 'de' ? '🎙️ HÖRE DEINER STIMME ZU...' : '🎙️ LISTENING TO YOUR VOICE...')
                : (lang === 'es' ? 'PRESIONA INICIAR PARA HABLAR' : lang === 'de' ? 'START DRÜCKEN ZUM SPRECHEN' : 'PRESS START TO SPEAK')}
            </div>
            <p className="text-[10px] text-white">
              {lang === 'es' ? 'Modelo activo: ' : lang === 'de' ? 'Aktives Modell: ' : 'Active model: '}<span className="text-[#00ffff] font-bold">{selectedModel}</span>
            </p>
          </div>

          {/* Transcript Box */}
          <div className="w-full bg-[#0000aa] border-2 border-[#00ffff] p-3 space-y-2 min-h-[100px] max-h-[160px] overflow-y-auto">
            {transcript && (
              <div className="text-white">
                <span className="text-[#00ffff] font-bold">{lang === 'es' ? 'TÚ:' : lang === 'de' ? 'DU:' : 'YOU:'}</span> {transcript}
              </div>
            )}
            {lastResponse && (
              <div className="text-[#ffff55]">
                <span className="text-[#ffff55] font-bold">{lang === 'es' ? 'MODELO:' : lang === 'de' ? 'MODELL:' : 'MODEL:'}</span> {lastResponse}
              </div>
            )}
            {!transcript && !lastResponse && (
              <div className="text-gray-300 text-center text-[10px]">
                {lang === 'es' ? 'Habla al micrófono para iniciar la conversación en tiempo real.' : lang === 'de' ? 'Sprich ins Mikrofon, um die Echtzeit-Unterhaltung zu starten.' : 'Speak into microphone to start real-time conversation.'}
              </div>
            )}
          </div>

          {/* Voice Controls */}
          <div className="flex gap-3 w-full">
            {!isListening && !isSpeaking && !isProcessing ? (
              <button
                type="button"
                onClick={startVoice}
                className="flex-1 bg-[#ffff55] text-black font-bold py-2.5 border-2 border-black hover:bg-white text-xs uppercase flex items-center justify-center gap-2"
              >
                <Mic className="w-4 h-4" />
                <span>{lang === 'es' ? 'INICIAR GRABACIÓN DE VOZ' : lang === 'de' ? 'SPRACHAUFNAHME STARTEN' : 'START VOICE RECORDING'}</span>
              </button>
            ) : isListening ? (
              <>
                <button
                  type="button"
                  onClick={handleFinishSpeaking}
                  className="flex-1 bg-[#00ffff] text-black font-bold py-2.5 border-2 border-black hover:bg-white text-xs uppercase flex items-center justify-center gap-2 animate-pulse"
                >
                  <Check className="w-4 h-4" />
                  <span>{lang === 'es' ? 'ENVIAR VOZ Y RESPONDER ↵' : lang === 'de' ? 'SPRACHE SENDEN & ANTWORTEN ↵' : 'SEND VOICE & RESPOND ↵'}</span>
                </button>
                <button
                  type="button"
                  onClick={stopVoice}
                  className="px-4 bg-red-600 text-white font-bold py-2.5 border-2 border-black hover:bg-red-500 text-xs uppercase flex items-center justify-center gap-2"
                >
                  <MicOff className="w-4 h-4" />
                  <span>{lang === 'es' ? 'CANCELAR' : lang === 'de' ? 'ABBRECHEN' : 'CANCEL'}</span>
                </button>
              </>
            ) : isProcessing ? (
              <button
                type="button"
                disabled
                className="flex-1 bg-[#000055] text-[#ffff55] border-2 border-[#00ffff] py-2.5 text-xs uppercase flex items-center justify-center gap-2 cursor-wait"
              >
                <RefreshCw className="w-4 h-4 animate-spin text-[#ffff55]" />
                <span>{lang === 'es' ? 'TRANSCRIBIENDO Y GENERANDO...' : lang === 'de' ? 'TRANSKRIBIERE & ERZEUGE...' : 'TRANSCRIBING & GENERATING...'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={stopVoice}
                className="flex-1 bg-red-600 text-white font-bold py-2.5 border-2 border-black hover:bg-red-500 text-xs uppercase flex items-center justify-center gap-2"
              >
                <VolumeX className="w-4 h-4" />
                <span>{lang === 'es' ? 'DETENER LECTURA' : lang === 'de' ? 'AUDIO STOPPEN' : 'STOP AUDIO'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
