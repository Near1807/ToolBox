// Types shared by the backend and the pages of the assistant.

export type AssistantState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking';

export interface TurnActionDto {
  actionId: string;
  moduleName: string;
  description: string;
  risk: 'read' | 'change' | 'destructive' | 'sensitive';
  status: 'done' | 'confirm' | 'refused' | 'invalid' | 'error';
  message: string;
  undoId: string | null;
  open: string | null;
  undone: boolean;
}

export interface TurnDto {
  id: number;
  at: string;
  source: 'voice' | 'text';
  /** What was understood (transcript), or typed. */
  heard: string;
  reply: string;
  actions: TurnActionDto[];
  /** A pending question (« Je supprime la tâche … ? ») answered by Oui / Non. */
  pending: { kind: 'confirm' | 'open'; question: string } | null;
  error: string | null;
  latency: {
    /** Speech to text (ms). */
    transcribeMs: number | null;
    /** Text to the end of the answer (ms). */
    thinkMs: number | null;
    /** Text to the first sentence ready (ms). */
    firstSentenceMs: number | null;
    /** Synthesis of the first sentence (ms). */
    voiceMs: number | null;
    /** End of the speech (key released) to the first sound (ms). */
    firstAudioMs: number | null;
    rounds: number;
  };
}

export interface StateEvent {
  state: AssistantState;
  /** Transcript or short text to show in the indicator. */
  text: string | null;
  /** Recording in « tap to start, tap to stop » mode. */
  toggle: boolean;
}

export interface SpeechEvent {
  turnId: number;
  index: number;
  url: string;
}

export interface StatusDto {
  hardware: {
    ramGb: number;
    threads: number;
    cpu: string;
    gpus: { name: string; vramGb: number | null; nvidia: boolean }[];
  } | null;
  recommendation: { model: string; whisper: string; reason: string } | null;
  ollama: {
    url: string;
    version: string | null;
    installed: { name: string; size: number; parameterSize: string | null }[];
    model: string;
    modelInstalled: boolean;
    capabilities: string[] | null;
    canStart: boolean;
  };
  whisper: { engine: string | null; model: string; modelInstalled: boolean; running: boolean };
  piper: { engine: string | null; voice: string; voiceInstalled: boolean };
  hotkey: {
    available: boolean;
    reason: string | null;
    key: { code: number; label: string } | null;
  };
  settings: { speakReplies: boolean; speed: number; directReads: boolean };
  choices: {
    models: { tag: string; label: string; sizeGb: number; memoryGb: number; note: string }[];
    whisper: { id: string; label: string; note: string; size: number }[];
    voices: { id: string; label: string }[];
  };
  installing: { id: string; title: string; progress: number | null; message: string | null }[];
  ready: boolean;
}
