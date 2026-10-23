// Sentence embeddings for the standardised commands: a small multilingual
// model (ONNX, ~120 Mo), run on the CPU by onnxruntime-web (WebAssembly: no
// native module, nothing to rebuild for Electron). A phrase becomes a vector;
// two phrases with the same meaning have close vectors (cosine). ADR 0030.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Tokenizer } from '@huggingface/tokenizers';

export interface Embedder {
  /** Normalised vector of a phrase (length 1). */
  embed(text: string): Promise<Float32Array>;
}

/** Files of a model folder, as published on Hugging Face (Xenova/… ONNX exports). */
export const EMBEDDING_FILES = [
  'onnx/model_quantized.onnx',
  'tokenizer.json',
  'tokenizer_config.json',
  'config.json',
] as const;

/** Longer phrases are cut (commands are short; keeps the CPU time small). */
const MAX_TOKENS = 64;

export const embeddingsInstalled = (dir: string) =>
  EMBEDDING_FILES.every((file) => existsSync(path.join(dir, file)));

type Ort = typeof import('onnxruntime-web');
type Session = Awaited<ReturnType<Ort['InferenceSession']['create']>>;

export class OnnxEmbedder implements Embedder {
  private loading: Promise<{ ort: Ort; session: Session; tokenizer: Tokenizer }> | null = null;

  constructor(private readonly dir: string) {}

  /** Loads the model once (about a second), then each phrase takes a few ms. */
  private load() {
    this.loading ??= (async () => {
      const ort = await import('onnxruntime-web');
      // One thread: no worker to start, and the PC stays free for the rest.
      ort.env.wasm.numThreads = 1;
      const read = (file: string) => readFileSync(path.join(this.dir, file));
      const tokenizer = new Tokenizer(
        JSON.parse(read('tokenizer.json').toString('utf8')) as object,
        JSON.parse(read('tokenizer_config.json').toString('utf8')) as object,
      );
      const session = await ort.InferenceSession.create(read('onnx/model_quantized.onnx'));
      return { ort, session, tokenizer };
    })();
    this.loading.catch(() => (this.loading = null));
    return this.loading;
  }

  async embed(text: string): Promise<Float32Array> {
    const { ort, session, tokenizer } = await this.load();
    let ids = tokenizer.encode(text).ids;
    if (ids.length > MAX_TOKENS) ids = [...ids.slice(0, MAX_TOKENS - 1), ids.at(-1)!];
    const tensor = (values: number[]) =>
      new ort.Tensor(
        'int64',
        BigInt64Array.from(values, (v) => BigInt(v)),
        [1, values.length],
      );
    const feeds: Record<string, InstanceType<Ort['Tensor']>> = {
      input_ids: tensor(ids),
      attention_mask: tensor(ids.map(() => 1)),
    };
    if (session.inputNames.includes('token_type_ids'))
      feeds.token_type_ids = tensor(ids.map(() => 0));
    const output = await session.run(feeds);
    const hidden = output[session.outputNames[0]!]!;
    const [, length, dim] = hidden.dims as [number, number, number];
    const data = hidden.data as Float32Array;
    // Mean of the token vectors, then length 1 (what these models are trained for).
    const vector = new Float32Array(dim);
    for (let t = 0; t < length; t++)
      for (let d = 0; d < dim; d++) vector[d]! += data[t * dim + d]! / length;
    return normalise(vector);
  }
}

export function normalise(vector: Float32Array): Float32Array {
  let norm = 0;
  for (const x of vector) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return vector.map((x) => x / norm);
}

/** Cosine of two normalised vectors (-1 … 1). */
export function cosine(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}
