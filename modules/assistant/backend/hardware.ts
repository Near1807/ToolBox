// What the PC can run: memory, processor threads, graphics card. The
// recommendation is a starting point; the user can choose another model.
import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import { MODEL_CHOICES, WHISPER_MODELS } from './catalog';

const run = promisify(execFile);

export interface Hardware {
  ramGb: number;
  threads: number;
  cpu: string;
  gpus: { name: string; vramGb: number | null; nvidia: boolean }[];
}

export interface Recommendation {
  model: string;
  whisper: string;
  /** French, one or two sentences: why. */
  reason: string;
}

async function nvidia(): Promise<Hardware['gpus']> {
  try {
    const { stdout } = await run(
      'nvidia-smi',
      ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
      {
        timeout: 5000,
        windowsHide: true,
      },
    );
    return stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [name, memory] = line.split(',').map((s) => s.trim());
        return {
          name: name ?? 'NVIDIA',
          vramGb: memory ? Math.round(Number(memory) / 1024) : null,
          nvidia: true,
        };
      });
  } catch {
    return [];
  }
}

/** Other cards (names only: Windows reports at most 4 GB of video memory there). */
async function windowsGpus(): Promise<Hardware['gpus']> {
  if (process.platform !== 'win32') return [];
  try {
    const { stdout } = await run(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }',
      ],
      { timeout: 8000, windowsHide: true },
    );
    return stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((name) => ({ name: name.trim(), vramGb: null, nvidia: /nvidia/i.test(name) }));
  } catch {
    return [];
  }
}

export async function detectHardware(): Promise<Hardware> {
  const [cards, others] = await Promise.all([nvidia(), windowsGpus()]);
  const gpus = [...cards, ...others.filter((o) => !cards.some((c) => c.name === o.name))];
  return {
    ramGb: Math.round(os.totalmem() / 1024 ** 3),
    threads: os.availableParallelism?.() ?? os.cpus().length,
    cpu: os.cpus()[0]?.model.trim() ?? 'processeur',
    gpus,
  };
}

export function recommend(hw: Hardware): Recommendation {
  const vram = Math.max(0, ...hw.gpus.filter((g) => g.nvidia).map((g) => g.vramGb ?? 0));
  let model: string;
  let reason: string;
  if (vram >= 12 && hw.ramGb >= 16) {
    model = 'ministral-3:14b';
    reason = `Carte graphique NVIDIA de ${vram} Go : le plus juste des modèles proposés tient dedans.`;
  } else if (vram >= 8) {
    model = 'ministral-3:8b';
    reason = `Carte graphique NVIDIA de ${vram} Go : un modèle moyen tient dedans et répond vite.`;
  } else {
    model = 'ministral-3:3b';
    reason =
      vram > 0
        ? `Carte graphique de ${vram} Go seulement : un petit modèle, pour que la réponse arrive en quelques secondes.`
        : 'Pas de carte graphique NVIDIA détectée : sans elle, un petit modèle est le seul à répondre en quelques secondes.';
  }
  if (hw.ramGb < (MODEL_CHOICES.find((m) => m.tag === model)?.memoryGb ?? 4) + 2) {
    reason += ` Attention : ${hw.ramGb} Go de mémoire, c'est juste.`;
  }
  // Small is clearly better in French; below 6 threads it is too slow for a reply in a few seconds.
  const whisper = hw.threads >= 6 ? 'small' : 'base';
  return {
    model,
    whisper: WHISPER_MODELS.some((w) => w.id === whisper) ? whisper : 'base',
    reason: `${reason} Reconnaissance vocale : « ${whisper} » (${hw.threads} fils de calcul).`,
  };
}
