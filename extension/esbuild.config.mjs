import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const watch = process.argv.includes('--watch');

const buildOptions = {
  entryPoints: {
    background: 'src/background/index.ts',
    content: 'src/content/index.ts',
    popup: 'src/popup/popup.ts',
  },
  bundle: true,
  outdir: 'dist',
  format: 'iife',
  target: 'chrome120',
  minify: !watch,
  sourcemap: watch,
};

async function build() {
  // Build JS
  if (watch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await esbuild.build(buildOptions);
  }

  // Copy static files to dist
  mkdirSync('dist/icons', { recursive: true });

  copyFileSync('manifest.json', 'dist/manifest.json');
  copyFileSync('src/popup/popup.html', 'dist/popup.html');
  copyFileSync('src/popup/popup.css', 'dist/popup.css');

  if (existsSync('icons')) {
    for (const file of readdirSync('icons')) {
      copyFileSync(join('icons', file), join('dist/icons', file));
    }
  }

  console.log('Build complete → dist/');
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
