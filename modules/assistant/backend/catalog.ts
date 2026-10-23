// What the assistant downloads and recommends: speech recognition
// (whisper.cpp), voices (Piper) and language models (Ollama). Everything runs
// locally; only these first downloads use the Internet (ADR 0029).
// Sources checked on 2026-10-23: github.com/ggml-org/whisper.cpp releases
// (v1.9.2 assets), whisper.cpp models/README.md (sizes), github.com/rhasspy/piper
// releases (2023.11.14-2 assets; archived, development moved to
// OHF-Voice/piper1-gpl, Python only), rhasspy/piper-voices (fr_FR).

export const WHISPER_RELEASE = 'v1.9.2';
const WHISPER_BASE = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_RELEASE}`;
export const PIPER_RELEASE = '2023.11.14-2';
const PIPER_BASE = `https://github.com/rhasspy/piper/releases/download/${PIPER_RELEASE}`;
const WHISPER_MODELS_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';
const VOICES_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0';

export interface Download {
  url: string;
  /** Approximate size, for the progress and the disk check (bytes). */
  size: number;
  /** SHA-1 published by the project, when known. */
  sha1?: string;
}

/** Engines (executables) per platform: an archive to extract. */
export const ENGINES = {
  whisper: {
    label: 'Reconnaissance vocale (whisper.cpp)',
    // OpenBLAS build: faster on CPU than the plain one, no GPU needed.
    win32: { url: `${WHISPER_BASE}/whisper-blas-bin-x64.zip`, size: 20_000_000 },
    linux: { url: `${WHISPER_BASE}/whisper-bin-ubuntu-x64.tar.gz`, size: 9_060_000 },
    executable: 'whisper-server',
  },
  piper: {
    label: 'Synthèse vocale (Piper)',
    win32: { url: `${PIPER_BASE}/piper_windows_amd64.zip`, size: 21_400_000 },
    linux: { url: `${PIPER_BASE}/piper_linux_x86_64.tar.gz`, size: 25_200_000 },
    executable: 'piper',
  },
} as const;

export interface WhisperModel extends Download {
  id: string;
  label: string;
  /** Rough speed on a CPU, for the choice. */
  note: string;
}

export const WHISPER_MODELS: WhisperModel[] = [
  {
    id: 'tiny',
    label: 'Tiny (75 Mo)',
    note: 'très rapide, beaucoup d’erreurs en français',
    url: `${WHISPER_MODELS_BASE}/ggml-tiny.bin`,
    size: 77_700_000,
  },
  {
    id: 'base',
    label: 'Base (142 Mo)',
    note: 'rapide, correct pour des phrases courtes',
    url: `${WHISPER_MODELS_BASE}/ggml-base.bin`,
    size: 147_900_000,
  },
  {
    id: 'small',
    label: 'Small (466 Mo)',
    note: 'bon en français, 2 à 4 fois plus lent que Base',
    url: `${WHISPER_MODELS_BASE}/ggml-small.bin`,
    size: 487_600_000,
    sha1: '55356645c2b361a969dfd0ef2c5a50d530afd8d5',
  },
  {
    id: 'medium',
    label: 'Medium (1,5 Go)',
    note: 'très bon, lent sans carte graphique',
    url: `${WHISPER_MODELS_BASE}/ggml-medium.bin`,
    size: 1_533_800_000,
  },
  {
    id: 'large-v3-turbo-q5_0',
    label: 'Large v3 Turbo q5 (547 Mo)',
    note: 'le meilleur, lent sans carte graphique',
    url: `${WHISPER_MODELS_BASE}/ggml-large-v3-turbo-q5_0.bin`,
    size: 574_000_000,
    sha1: 'e050f7970618a659205450ad97eb95a18d69c9ee',
  },
];

export interface Voice {
  id: string;
  label: string;
  /** Multi-speaker voices: the speaker number to use. */
  speaker?: number;
  model: Download;
  config: Download;
}

const voice = (
  name: string,
  quality: string,
  label: string,
  size: number,
  speaker?: number,
): Voice => {
  const file = `fr_FR-${name}-${quality}`;
  const base = `${VOICES_BASE}/fr/fr_FR/${name}/${quality}/${file}`;
  return {
    id: speaker === undefined ? file : `${file}#${speaker}`,
    label,
    speaker,
    model: { url: `${base}.onnx`, size },
    config: { url: `${base}.onnx.json`, size: 6_000 },
  };
};

export const VOICES: Voice[] = [
  voice('siwis', 'medium', 'Siwis — femme, claire (recommandée)', 63_200_000),
  voice('tom', 'medium', 'Tom — homme', 63_500_000),
  voice('upmc', 'medium', 'UPMC Jessica — femme', 76_700_000, 0),
  voice('upmc', 'medium', 'UPMC Pierre — homme', 76_700_000, 1),
  voice('gilles', 'low', 'Gilles — homme, plus léger', 63_100_000),
];
export const DEFAULT_VOICE = VOICES[0]!.id;

/** Language models offered for Ollama (tags of ollama.com/library). */
export interface ModelChoice {
  tag: string;
  label: string;
  /** Approximate download size (GB) and memory needed to run it (GB). */
  sizeGb: number;
  memoryGb: number;
  note: string;
}

// Ministral 3 (Mistral AI, December 2025): native function calling, European
// languages: the first choice for French. Qwen 3.5: very reliable at tool
// calls, good French. Tags not tested on a real PC here: the app checks after
// the download that Ollama reports the « tools » capability (ADR 0029).
export const MODEL_CHOICES: ModelChoice[] = [
  {
    tag: 'ministral-3:3b',
    label: 'Ministral 3 — 3B',
    sizeGb: 3.0,
    memoryGb: 4,
    note: 'rapide, même sans carte graphique',
  },
  {
    tag: 'ministral-3:8b',
    label: 'Ministral 3 — 8B',
    sizeGb: 6.0,
    memoryGb: 8,
    note: 'plus juste ; carte graphique 8 Go conseillée',
  },
  {
    tag: 'ministral-3:14b',
    label: 'Ministral 3 — 14B',
    sizeGb: 9.1,
    memoryGb: 12,
    note: 'le meilleur ; carte graphique 12 Go et plus',
  },
  {
    tag: 'qwen3.5:4b',
    label: 'Qwen 3.5 — 4B',
    sizeGb: 3.4,
    memoryGb: 5,
    note: 'très fiable pour les actions',
  },
  {
    tag: 'qwen3.5:9b',
    label: 'Qwen 3.5 — 9B',
    sizeGb: 6.6,
    memoryGb: 9,
    note: 'très fiable ; carte graphique conseillée',
  },
  {
    tag: 'mistral-small3.2:24b',
    label: 'Mistral Small 3.2 — 24B',
    sizeGb: 14.4,
    memoryGb: 18,
    note: 'pour une grosse carte graphique (24 Go)',
  },
];

/**
 * Model of the standardised commands (sentence embeddings, 50+ languages
 * including French), ONNX export by Xenova, quantized: light and fast on a CPU.
 * Sizes approximate (not checked from here: Hugging Face is not reachable in
 * the development container); the download takes the real size from the server.
 */
export const EMBEDDING_MODEL = {
  id: 'paraphrase-multilingual-MiniLM-L12-v2',
  label: 'Modèle de commandes (MiniLM multilingue, ~120 Mo)',
  base: 'https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main',
  sizes: {
    'onnx/model_quantized.onnx': 118_000_000,
    'tokenizer.json': 17_100_000,
    'tokenizer_config.json': 1_000,
    'config.json': 1_000,
  } as Record<string, number>,
};
