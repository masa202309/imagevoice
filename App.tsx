import React, { useState, useRef, useEffect } from 'react';
import { Upload, Play, Loader2, Mic, Image as ImageIcon, Sparkles, Volume2, StopCircle } from 'lucide-react';
import { generateScriptFromImage, synthesizeScriptAudio } from './services/geminiService';
import { decodeBase64, decodeAudioData, playAudioBuffer } from './services/audioUtils';
import { ScriptData, AppState } from './types';

const INITIAL_SITUATION = "ピザにパイナップルを乗せることについて激しく議論している。";

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>('IDLE');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [situation, setSituation] = useState(INITIAL_SITUATION);
  const [scriptData, setScriptData] = useState<ScriptData | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Initialize Audio Context on user interaction to avoid autoplay policies
  const initAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setImageFile(file);
      
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
      
      // Reset state on new image
      setScriptData(null);
      setAudioBuffer(null);
      setAppState('IDLE');
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data URL prefix (e.g., "data:image/jpeg;base64,")
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = error => reject(error);
    });
  };

  const handleGenerate = async () => {
    if (!imageFile || !situation) return;
    initAudioContext();
    
    try {
      setAppState('ANALYZING');
      const base64Image = await fileToBase64(imageFile);
      const mimeType = imageFile.type;

      // Step 1: Analyze & Write Script
      const script = await generateScriptFromImage(base64Image, mimeType, situation);
      setScriptData(script);

      // Step 2: Synthesize Audio
      setAppState('SYNTHESIZING');
      const audioBase64 = await synthesizeScriptAudio(script);
      
      // Step 3: Decode Audio
      const pcmBytes = decodeBase64(audioBase64);
      if (audioContextRef.current) {
        const buffer = await decodeAudioData(pcmBytes, audioContextRef.current);
        setAudioBuffer(buffer);
        setAppState('IDLE');
      }

    } catch (error) {
      console.error("Error generating content:", error);
      setAppState('ERROR');
    }
  };

  const togglePlayback = () => {
    initAudioContext();
    if (!audioContextRef.current || !audioBuffer) return;

    if (isPlaying) {
      audioSourceRef.current?.stop();
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      audioSourceRef.current = playAudioBuffer(audioContextRef.current, audioBuffer, () => {
        setIsPlaying(false);
      });
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col items-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-5xl space-y-8">
        
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center p-3 bg-indigo-500/10 rounded-full mb-4">
            <Mic className="w-8 h-8 text-indigo-400" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Photo Voice Actor
          </h1>
          <p className="text-lg text-slate-400 max-w-2xl mx-auto">
            Bring your photos to life. Upload an image, describe a situation, and let AI generate a voiced dialogue matching the people in the picture.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-12">
          
          {/* Left Column: Input */}
          <div className="space-y-6 bg-slate-900/50 p-6 rounded-2xl border border-slate-800 backdrop-blur-sm">
            
            {/* Image Upload */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-300">Target Photo</label>
              <div className="relative group">
                <input 
                  type="file" 
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className={`
                  border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center transition-all duration-200
                  ${imagePreview ? 'border-indigo-500/50 bg-slate-900/80' : 'border-slate-700 hover:border-indigo-500/50 hover:bg-slate-800/50'}
                `}>
                  {imagePreview ? (
                    <img src={imagePreview} alt="Preview" className="max-h-64 rounded-lg shadow-lg object-contain" />
                  ) : (
                    <div className="py-8">
                      <ImageIcon className="w-12 h-12 text-slate-500 mx-auto mb-3" />
                      <p className="text-slate-400 font-medium">Click or drag photo here</p>
                      <p className="text-slate-600 text-sm mt-1">Supports JPG, PNG</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Situation Input */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-300">The Situation</label>
              <textarea
                value={situation}
                onChange={(e) => setSituation(e.target.value)}
                placeholder="Describe what is happening or what they are talking about..."
                className="w-full bg-slate-800 border-slate-700 rounded-lg p-3 text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent min-h-[100px] resize-none"
              />
            </div>

            {/* Action Button */}
            <button
              onClick={handleGenerate}
              disabled={!imageFile || !situation || appState === 'ANALYZING' || appState === 'SYNTHESIZING'}
              className={`
                w-full py-4 px-6 rounded-xl font-semibold text-lg flex items-center justify-center gap-3 transition-all
                ${!imageFile || !situation 
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 active:scale-[0.98]'
                }
              `}
            >
              {appState === 'ANALYZING' ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Analyzing Scene...
                </>
              ) : appState === 'SYNTHESIZING' ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Generating Audio...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  Generate Performance
                </>
              )}
            </button>
            
            {appState === 'ERROR' && (
              <div className="p-4 bg-red-900/20 border border-red-800/50 rounded-lg text-red-300 text-sm">
                Something went wrong. Please check your API key and try again.
              </div>
            )}
          </div>

          {/* Right Column: Output */}
          <div className="flex flex-col h-full bg-slate-900/50 p-6 rounded-2xl border border-slate-800 backdrop-blur-sm min-h-[500px]">
            {scriptData ? (
              <div className="flex flex-col h-full">
                
                {/* Title & Cast */}
                <div className="mb-6 border-b border-slate-800 pb-4">
                  <h2 className="text-2xl font-bold text-white mb-2">{scriptData.title}</h2>
                  <div className="flex flex-wrap gap-2">
                    {scriptData.characters.map(char => (
                      <span key={char.id} className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-800 rounded-full text-xs font-medium text-slate-300 border border-slate-700">
                        <span className={`w-2 h-2 rounded-full ${getVoiceColor(char.assignedVoice)}`}></span>
                        {char.name} ({char.assignedVoice})
                      </span>
                    ))}
                  </div>
                </div>

                {/* Script Display */}
                <div className="flex-1 overflow-y-auto space-y-4 pr-2 mb-6">
                  {scriptData.lines.map((line, idx) => {
                    const char = scriptData.characters.find(c => c.characterId === line.characterId);
                    return (
                      <div key={idx} className="flex flex-col gap-1">
                        <span className="text-xs font-bold text-indigo-400 uppercase tracking-wide ml-1">
                          {char?.name}
                        </span>
                        <div className="p-3 bg-slate-800/50 rounded-lg rounded-tl-none border border-slate-800 text-slate-200 leading-relaxed">
                          "{line.text}"
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Audio Controls */}
                <div className="pt-4 border-t border-slate-800 mt-auto">
                   {audioBuffer ? (
                     <button
                      onClick={togglePlayback}
                      className={`
                        w-full py-3 px-4 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors
                        ${isPlaying 
                          ? 'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20' 
                          : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20'
                        }
                      `}
                     >
                       {isPlaying ? (
                         <>
                           <StopCircle className="w-5 h-5" /> Stop Playback
                         </>
                       ) : (
                         <>
                           <Volume2 className="w-5 h-5" /> Play Audio
                         </>
                       )}
                     </button>
                   ) : (
                     <div className="w-full py-3 text-center text-slate-500 text-sm italic">
                        Audio not available
                     </div>
                   )}
                </div>

              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-4">
                <div className="w-16 h-16 rounded-full bg-slate-800/50 flex items-center justify-center">
                  <Play className="w-8 h-8 opacity-20" />
                </div>
                <p>Upload an image and generate a script to see the result here.</p>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
};

// Helper to color code voices
function getVoiceColor(voice: string) {
  switch (voice) {
    case 'Puck': return 'bg-blue-400';
    case 'Charon': return 'bg-purple-400';
    case 'Kore': return 'bg-pink-400';
    case 'Fenrir': return 'bg-orange-400';
    case 'Zephyr': return 'bg-teal-400';
    default: return 'bg-gray-400';
  }
}

export default App;