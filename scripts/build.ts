import { build } from 'esbuild'
import { rmSync, readFileSync } from 'fs'
import { spawnSync } from 'child_process'
import pkg from '../package.json'

rmSync('index.js', { force: true })

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  outdir: '.',
  platform: 'node',
  external: Object.keys(pkg.dependencies),
}).catch(() => process.exit(1))

rmSync('patch.js', { force: true })

await build({
  entryPoints: ['src/patch.ts'],
  bundle: true,
  format: 'esm',
  outdir: '.',
  platform: 'node',
  external: Object.keys(pkg.dependencies),
}).catch(() => process.exit(1))

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  outdir: '.',
  platform: 'node',
  external: Object.keys(pkg.dependencies),
}).catch(() => process.exit(1))

rmSync('cli.js', { force: true })

await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  format: 'esm',
  outdir: '.',
  treeShaking: true,
  platform: 'node',
  external: Object.keys(pkg.dependencies),
  plugins: [
    {
      name: 'shebang',
      setup({ onLoad }) {
        onLoad({ filter: /\bcli\b/ }, args => ({
          contents: '#!/usr/bin/env node\n' + readFileSync(args.path, 'utf8'),
          loader: 'default',
        }))
      },
    },
    {
      name: 'external-index',
      setup({ onResolve }) {
        onResolve({ filter: /\.\/index\b/ }, () => ({ path: './index.js', external: true }))
      },
    },
    {
      name: 'purify-yoctocolors',
      setup({ onLoad }) {
        onLoad({ filter: /\byoctocolors\b/ }, args => {
          let text = readFileSync(args.path, 'utf8')
          text = text.replaceAll(/= format/g, '= /* @__PURE__ */ format')
          return { contents: text }
        })
      },
    },
  ],
}).catch(() => process.exit(1))

spawnSync('node', ['cli.js', 'src/index.ts', '-o', 'index.d.ts', '-p'], { stdio: 'inherit' })
