import type ts from 'typescript'

import json from '@rollup/plugin-json'
import escalade from 'escalade/sync'
import { readFileSync, rmSync } from 'fs'
import { Plugin, rollup, RollupOutput } from 'rollup'
import dts, { Options } from 'rollup-plugin-dts'

const CommonExts =
  /\.(css|less|sass|scss|styl|stylus|pcss|postcss|png|jpe?g|gif|svg|ico|webp|avif|mp4|webm|ogg|mp3|wav|flac|aac|woff2?|eot|ttf|otf|wasm)$/

const _options: ts.CompilerOptions = {
  noEmit: false,
  declaration: true,
  emitDeclarationOnly: true,
  noEmitOnError: true,
  checkJs: false,
  declarationMap: false,
  skipLibCheck: true,
  stripInternal: true,
  preserveSymlinks: false,
}

export interface BuildOptions {
  dts?: Options
  include?: string[]
  exclude?: string[]
}

export interface BuildResult {
  output: RollupOutput['output']
  elapsed: number
}

export async function build(
  entry: string,
  outfile: string,
  options: BuildOptions = {},
): Promise<BuildResult> {
  const compilerOptions = Object.assign({}, (options.dts || {}).compilerOptions, _options)
  const include = options.include || []
  const exclude = options.exclude || []

  const start = Date.now()

  rmSync(outfile, { force: true })

  const bundle = await rollup({
    input: entry,
    onwarn(warning, warn) {
      if (
        warning.code === 'UNRESOLVED_IMPORT' ||
        warning.code === 'CIRCULAR_DEPENDENCY' ||
        warning.code === 'EMPTY_BUNDLE'
      ) {
        return
      }
      return warn(warning)
    },
    plugins: [
      json({
        preferConst: true,
      }),
      dts({
        respectExternal: true,
        ...options.dts,
        compilerOptions,
      }),
      fix_trivia(),
    ],
    external: [CommonExts, ...get_external(entry, new Set(include)), ...exclude],
  })

  const result = await bundle.write({
    file: outfile,
    format: 'es',
    exports: 'named',
  })

  return { output: result.output, elapsed: Date.now() - start }
}

function get_external(file: string, reject: Set<string>) {
  const pkg = escalade(file, (_, names) => {
    if (names.includes('package.json')) {
      return 'package.json'
    }
  })
  if (pkg) {
    const json = JSON.parse(readFileSync(pkg, 'utf8'))
    const deps = Object.assign({}, json.dependencies, json.peerDependencies)
    return Object.keys(deps).filter(e => !reject.has(e))
  } else {
    return []
  }
}

function fix_trivia(): Plugin {
  return {
    name: 'fix-trivia',
    renderChunk(code) {
      return code.replace(/^(\s*)(const|enum)\s/gm, '$1declare $2 ')
    },
  }
}
