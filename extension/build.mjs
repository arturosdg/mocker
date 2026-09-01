import { build } from 'esbuild'
import { cpSync, mkdirSync } from 'node:fs'

mkdirSync('dist', { recursive: true })

await build({
  entryPoints: [
    'src/background.ts',
    'src/content.ts',
    'src/interceptor.ts',
    'src/popup/popup.ts',
  ],
  bundle: true,
  format: 'iife',
  entryNames: '[name]',
  outdir: 'dist',
  target: 'chrome120',
})

cpSync('manifest.json', 'dist/manifest.json')
cpSync('src/popup/popup.html', 'dist/popup.html')
cpSync('src/popup/popup.css', 'dist/popup.css')
