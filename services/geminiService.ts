import { GoogleGenAI, Type, Modality } from "@google/genai";
import { ScriptData } from "../types";

const API_KEY = process.env.API_KEY || '';

const ai = new GoogleGenAI({ apiKey: API_KEY });

// 1. Analyze image and generate script
export const generateScriptFromImage = async (
  base64Image: string,
  mimeType: string,
  situation: string
): Promise<ScriptData> => {
  
  const prompt = `
    Analyze this image. Identify the main people (characters) in the image.
    For each person, assign them one of the following voices based on their gender, age, and vibe:
    Voices: ['Puck' (Male, Energetic), 'Charon' (Male, Deep/Older), 'Kore' (Female, Soothing), 'Fenrir' (Male, Strong), 'Zephyr' (Female, Calm)].
    
    Then, write a short, engaging dialogue script (approx 4-6 lines total) in JAPANESE (日本語) between these characters based on this situation: "${situation}".
    The dialogue text MUST be in natural spoken Japanese.
    The character names should be descriptive in Japanese (e.g., "怒っている男性", "微笑む女性").
    If there is only one person, write a monologue.
    Give the script a creative title in Japanese.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: {
      parts: [
        { inlineData: { data: base64Image, mimeType: mimeType } },
        { text: prompt }
      ]
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          characters: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING, description: "Unique ID like 'char1'" },
                name: { type: Type.STRING, description: "Descriptive name e.g., 'Angry Man'" },
                description: { type: Type.STRING, description: "Brief visual description" },
                assignedVoice: { type: Type.STRING, enum: ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'] }
              },
              required: ['id', 'name', 'assignedVoice']
            }
          },
          lines: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                characterId: { type: Type.STRING },
                text: { type: Type.STRING }
              },
              required: ['characterId', 'text']
            }
          }
        },
        required: ['characters', 'lines', 'title']
      }
    }
  });

  const text = response.text;
  if (!text) throw new Error("No script generated");
  
  return JSON.parse(text) as ScriptData;
};

// 2. Synthesize Audio
export const synthesizeScriptAudio = async (scriptData: ScriptData): Promise<string> => {
  
  // Construct the conversation text formatted for the model
  // Usually, we just pass the text lines. The model distinguishes speakers via the config mapping.
  // However, for best results with multiSpeaker, we format it as: "SpeakerName: Text"
  const fullText = scriptData.lines.map(line => {
    const char = scriptData.characters.find(c => c.id === line.characterId);
    return `${char?.name || 'Unknown'}: ${line.text}`;
  }).join('\n');

  // Map our characters to the config
  const speakerVoiceConfigs = scriptData.characters.map(char => ({
    speaker: char.name,
    voiceConfig: {
      prebuiltVoiceConfig: { voiceName: char.assignedVoice }
    }
  }));

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-preview-tts',
    contents: [{ parts: [{ text: fullText }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: speakerVoiceConfigs
        }
      }
    }
  });

  const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!audioData) throw new Error("No audio generated");

  return audioData;
};