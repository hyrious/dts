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

rmSync('cli.js', { force: true })

await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  format: 'esm',
  outdir: '.',
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
        onResolve({ filter: /\.\/index\b/ }, () => {
          return { path: './index.js', external: true }
        })
      },
    },
  ],
}).catch(() => process.exit(1))

spawnSync('node', ['cli.js', 'src/index.ts', '-o', 'index.d.ts'], { stdio: 'inherit' })
