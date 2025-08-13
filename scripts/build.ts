import { build } from 'esbuild'
import { rmSync, readFileSync } from 'fs'
import { spawnSync } from 'child_process'
import { external } from '@hyrious/esbuild-plugin-external'

rmSync('index.js', { force: true })
rmSync('patch.js', { force: true })
rmSync('cli.js', { force: true })

await build({
  entryPoints: ['src/index.ts', 'src/patch.ts', 'src/cli.ts'],
  bundle: true,
  format: 'esm',
  outdir: '.',
  platform: 'node',
  logLevel: 'info',
  mainFields: ['module', 'main'],
  alias: {
    yoctocolors: './node_modules/yoctocolors/base.js',
  },
  plugins: [
    external({
      auto: [{ filter: /\.js$/ }],
    }),
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
      name: 'purify-yoctocolors',
      setup({ onResolve, onLoad, resolve }) {
        onResolve({ filter: /^yoctocolors$/ }, async args => {
          if (!args.pluginData) {
            const result = await resolve(args.path, {
              kind: 'import-statement',
              resolveDir: args.resolveDir,
              pluginData: 1,
            })
            // esbuild seems cannot tree shake 'export * as default' properly.
            result.path = result.path.replace('/index.js', '/base.js')
            return result
          }
        })
        onLoad({ filter: /\byoctocolors\b/ }, args => {
          let text = readFileSync(args.path, 'utf8')
          text = text.replaceAll(/= format/g, '= /* @__PURE__ */ format')
          return { contents: text }
        })
      },
    },
  ],
}).catch(() => process.exit(1))

spawnSync('node', ['cli.js', '-o', 'index.d.ts', '-p', '--oxc'], { stdio: 'inherit' })
