import { build } from 'esbuild'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const target = process.argv[2] === 'firefox' ? 'firefox' : 'chrome'
const outdir = target === 'firefox' ? 'dist-firefox' : 'dist'

mkdirSync(outdir, { recursive: true })

await build({
  entryPoints: [
    'src/background.ts',
    'src/content.ts',
    'src/interceptor.ts',
    'src/popup/popup.ts',
    'src/options/options.ts',
    'src/devtools.ts',
    'src/panel.ts',
  ],
  bundle: true,
  format: 'iife',
  entryNames: '[name]',
  outdir,
  target: target === 'firefox' ? 'firefox128' : 'chrome120',
})

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'))
if (target === 'firefox') {
  // Firefox MV3 runs the background as an event page, not a service worker,
  // and signed/unlisted builds need a gecko id. world: MAIN needs FF 128+.
  manifest.background = { scripts: ['background.js'] }
  manifest.browser_specific_settings = {
    gecko: { id: 'mocker@arturosdg.github.io', strict_min_version: '128.0' },
  }
}
writeFileSync(`${outdir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`)

cpSync('icons', `${outdir}/icons`, { recursive: true })
cpSync('src/popup/popup.html', `${outdir}/popup.html`)
cpSync('src/popup/popup.css', `${outdir}/popup.css`)
cpSync('src/options/options.html', `${outdir}/options.html`)
cpSync('src/options/options.css', `${outdir}/options.css`)
cpSync('devtools.html', `${outdir}/devtools.html`)
cpSync('panel.html', `${outdir}/panel.html`)
