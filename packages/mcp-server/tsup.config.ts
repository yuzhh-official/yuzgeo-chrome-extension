import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  // Bundle the workspace-only core package; keep published deps external.
  noExternal: ['@yuzgeo/core'],
  banner: { js: '#!/usr/bin/env node' },
});
