// Every `*.reader.tsx` of this folder registers itself (registerReader): a new
// reader is a new file, nothing else.
import.meta.glob('./*.reader.tsx', { eager: true });

export * from './registry';
