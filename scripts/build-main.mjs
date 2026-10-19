import { build } from 'esbuild';
import { mainBuildOptions } from './esbuild-config.mjs';

await build(mainBuildOptions);
