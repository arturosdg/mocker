import { build } from 'esbuild'
import { cpSync, mkdirSync } from 'node:fs'

mkdirSync('dist', { recursive: true })

await build({
  entryPoints: [
    'src/background.ts',
    'src/content.ts',
    'src/interceptor.ts',
    'src/popup/popup.ts',
    'src/options/options.ts',
  ],
  bundle: true,
  format: 'iife',
  entryNames: '[name]',
  outdir: 'dist',
  target: 'chrome120',
})

cpSync('manifest.json', 'dist/manifest.json')
cpSync('icons', 'dist/icons', { recursive: true })
cpSync('src/popup/popup.html', 'dist/popup.html')
cpSync('src/popup/popup.css', 'dist/popup.css')
cpSync('src/options/options.html', 'dist/options.html')
cpSync('src/options/options.css', 'dist/options.css')
