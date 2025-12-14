export interface Character {
  id: string;
  description: string;
  assignedVoice: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';
  name: string; // Generated name like "Angry Man" or "Smiling Girl"
}

export interface ScriptLine {
  characterId: string;
  text: string;
}

export interface ScriptData {
  characters: Character[];
  lines: ScriptLine[];
  title: string;
}

export type AppState = 'IDLE' | 'ANALYZING' | 'SYNTHESIZING' | 'PLAYING' | 'ERROR';