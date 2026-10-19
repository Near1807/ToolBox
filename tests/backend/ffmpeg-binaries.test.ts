import { describe, expect, it } from 'vitest';
import { toUnpackedPath } from '../../backend/core/ffmpeg-binaries';

describe('toUnpackedPath', () => {
  it('rewrites Windows paths inside app.asar', () => {
    expect(
      toUnpackedPath('C:\\Program Files\\ToolBox\\resources\\app.asar\\node_modules\\ffmpeg.exe'),
    ).toBe('C:\\Program Files\\ToolBox\\resources\\app.asar.unpacked\\node_modules\\ffmpeg.exe');
  });

  it('rewrites POSIX paths inside app.asar', () => {
    expect(toUnpackedPath('/opt/ToolBox/resources/app.asar/node_modules/ffmpeg')).toBe(
      '/opt/ToolBox/resources/app.asar.unpacked/node_modules/ffmpeg',
    );
  });

  it('leaves dev paths untouched', () => {
    const devPath = '/home/me/toolbox/node_modules/ffmpeg-static/ffmpeg';
    expect(toUnpackedPath(devPath)).toBe(devPath);
  });
});
