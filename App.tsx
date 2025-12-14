import React, { useState, useRef, useEffect } from 'react';
import { Upload, Play, Loader2, Mic, Image as ImageIcon, Sparkles, Volume2, StopCircle, Download, Music, RefreshCw } from 'lucide-react';
import { generateScriptFromImage, synthesizeScriptAudio } from './services/geminiService';
import { decodeBase64, decodeAudioData, playAudioBuffer, createWavBlob, mixAudioBuffers, generateProceduralBgm } from './services/audioUtils';
import { ScriptData, AppState, Character } from './types';

const INITIAL_SITUATION = "ピザにパイナップルを乗せることについて激しく議論している。";

type BgmType = 'none' | 'relaxed' | 'suspense' | 'custom';

const VOICE_OPTIONS = [
  { id: 'Puck', label: 'Puck (Male, Energetic)', color: 'bg-blue-400' },
  { id: 'Charon', label: 'Charon (Male, Deep)', color: 'bg-purple-400' },
  { id: 'Kore', label: 'Kore (Female, Soothing)', color: 'bg-pink-400' },
  { id: 'Fenrir', label: 'Fenrir (Male, Strong)', color: 'bg-orange-400' },
  { id: 'Zephyr', label: 'Zephyr (Female, Calm)', color: 'bg-teal-400' },
] as const;

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>('IDLE');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [situation, setSituation] = useState(INITIAL_SITUATION);
  
  // BGM State
  const [bgmType, setBgmType] = useState<BgmType>('none');
  const [customBgmFile, setCustomBgmFile] = useState<File | null>(null);

  const [scriptData, setScriptData] = useState<ScriptData | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
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
    return audioContextRef.current;
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
      
      resetOutput();
    }
  };

  const handleCustomBgmUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setCustomBgmFile(e.target.files[0]);
    }
  };

  const resetOutput = () => {
    setScriptData(null);
    setAudioBuffer(null);
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(null);
    }
    setAppState('IDLE');
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data URL prefix
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = error => reject(error);
    });
  };

  const fileToAudioBuffer = async (file: File, ctx: AudioContext): Promise<AudioBuffer> => {
    const arrayBuffer = await file.arrayBuffer();
    return await ctx.decodeAudioData(arrayBuffer);
  };

  // Reusable function to generate audio from script
  const generateAudio = async (script: ScriptData) => {
    const ctx = initAudioContext();
    setAppState('SYNTHESIZING');
    
    try {
      // Step 2: Synthesize Voice Audio
      const audioBase64 = await synthesizeScriptAudio(script);
      const pcmBytes = decodeBase64(audioBase64);
      let finalBuffer = await decodeAudioData(pcmBytes, ctx);

      // Step 3: Mix BGM if selected
      if (bgmType !== 'none') {
        try {
          let bgmBuffer: AudioBuffer | null = null;
          
          if (bgmType === 'custom' && customBgmFile) {
            bgmBuffer = await fileToAudioBuffer(customBgmFile, ctx);
          } else if (bgmType === 'relaxed') {
            bgmBuffer = await generateProceduralBgm('relaxed', ctx.sampleRate);
          } else if (bgmType === 'suspense') {
            bgmBuffer = await generateProceduralBgm('suspense', ctx.sampleRate);
          }

          if (bgmBuffer) {
             // Mix voice with BGM (Volume 0.2 for BGM)
             finalBuffer = mixAudioBuffers(finalBuffer, bgmBuffer, 0.2, ctx);
          }
        } catch (e) {
          console.warn("Failed to apply BGM:", e);
        }
      }

      // Step 4: Finalize
      setAudioBuffer(finalBuffer);
      const wavBlob = createWavBlob(finalBuffer);
      const url = URL.createObjectURL(wavBlob);
      setDownloadUrl(url);

      setAppState('IDLE');
    } catch (error) {
       console.error("Error synthesizing:", error);
       setAppState('ERROR');
    }
  };

  const handleGenerate = async () => {
    if (!imageFile || !situation) return;
    
    try {
      setAppState('ANALYZING');
      const base64Image = await fileToBase64(imageFile);
      const mimeType = imageFile.type;

      // Step 1: Analyze & Write Script
      const script = await generateScriptFromImage(base64Image, mimeType, situation);
      setScriptData(script);

      // Immediately generate audio with initial assignments
      await generateAudio(script);

    } catch (error) {
      console.error("Error generating content:", error);
      setAppState('ERROR');
    }
  };

  const handleRegenerateAudio = () => {
    if (scriptData) {
      generateAudio(scriptData);
    }
  };

  const updateCharacterVoice = (charId: string, newVoice: string) => {
    setScriptData(prev => {
      if (!prev) return null;
      return {
        ...prev,
        characters: prev.characters.map(c => 
          c.id === charId ? { ...c, assignedVoice: newVoice as any } : c
        )
      };
    });
    // Invalidate current audio since voice changed
    setAudioBuffer(null);
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(null);
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

            {/* Background Music Selector */}
            <div className="space-y-3 pt-2">
              <label className="block text-sm font-medium text-slate-300 flex items-center gap-2">
                <Music className="w-4 h-4 text-indigo-400" />
                Background Music
              </label>
              
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(['none', 'relaxed', 'suspense', 'custom'] as BgmType[]).map((type) => (
                   <button
                     key={type}
                     onClick={() => setBgmType(type)}
                     className={`
                       px-3 py-2 rounded-lg text-sm font-medium capitalize border transition-all
                       ${bgmType === type 
                         ? 'bg-indigo-600 border-indigo-500 text-white' 
                         : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
                       }
                     `}
                   >
                     {type}
                   </button>
                ))}
              </div>

              {bgmType === 'custom' && (
                <div className="mt-2 animate-in fade-in slide-in-from-top-2">
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={handleCustomBgmUpload}
                    className="block w-full text-sm text-slate-400
                      file:mr-4 file:py-2 file:px-4
                      file:rounded-full file:border-0
                      file:text-sm file:font-semibold
                      file:bg-slate-800 file:text-indigo-400
                      hover:file:bg-slate-700"
                  />
                  {customBgmFile && (
                    <p className="text-xs text-indigo-300 mt-1 truncate">
                      Selected: {customBgmFile.name}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Action Button */}
            <button
              onClick={handleGenerate}
              disabled={!imageFile || !situation || appState === 'ANALYZING' || appState === 'SYNTHESIZING'}
              className={`
                w-full py-4 px-6 rounded-xl font-semibold text-lg flex items-center justify-center gap-3 transition-all mt-4
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
                  <div className="flex flex-col gap-2 mt-3">
                    <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">Cast & Voice Models</span>
                    <div className="flex flex-wrap gap-3">
                      {scriptData.characters.map(char => {
                        const currentVoice = VOICE_OPTIONS.find(v => v.id === char.assignedVoice);
                        return (
                          <div key={char.id} className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-800 rounded-lg border border-slate-700 shadow-sm">
                            <span className={`w-2.5 h-2.5 rounded-full ${currentVoice?.color || 'bg-gray-400'}`}></span>
                            <div className="flex flex-col">
                              <span className="text-xs font-semibold text-slate-200">{char.name}</span>
                              <select
                                value={char.assignedVoice}
                                onChange={(e) => updateCharacterVoice(char.id, e.target.value)}
                                className="bg-transparent border-none p-0 text-[10px] text-slate-400 focus:ring-0 cursor-pointer hover:text-indigo-400 transition-colors"
                              >
                                {VOICE_OPTIONS.map(opt => (
                                  <option key={opt.id} value={opt.id} className="bg-slate-900 text-slate-200">
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        );
                      })}
                    </div>
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
                   {!audioBuffer && scriptData && appState !== 'SYNTHESIZING' ? (
                     <button
                      onClick={handleRegenerateAudio}
                      className="w-full py-3 px-4 rounded-lg font-medium flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                     >
                       <RefreshCw className="w-5 h-5" /> Regenerate Audio
                     </button>
                   ) : audioBuffer ? (
                     <div className="flex gap-2 w-full">
                       <button
                        onClick={togglePlayback}
                        className={`
                          flex-1 py-3 px-4 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors
                          ${isPlaying 
                            ? 'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20' 
                            : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20'
                          }
                        `}
                       >
                         {isPlaying ? (
                           <>
                             <StopCircle className="w-5 h-5" /> Stop
                           </>
                         ) : (
                           <>
                             <Volume2 className="w-5 h-5" /> Play
                           </>
                         )}
                       </button>

                       {downloadUrl && (
                         <a
                           href={downloadUrl}
                           download="photo-voice-actor.wav"
                           className="px-4 rounded-lg font-medium flex items-center justify-center bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white transition-colors"
                           title="Download Audio"
                         >
                           <Download className="w-5 h-5" />
                         </a>
                       )}
                     </div>
                   ) : (
                     <div className="w-full py-3 text-center text-slate-500 text-sm italic">
                        {appState === 'SYNTHESIZING' ? (
                          <span className="flex items-center justify-center gap-2">
                             <Loader2 className="w-4 h-4 animate-spin" /> Synthesizing...
                          </span>
                        ) : 'Audio not available'}
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

export default App;