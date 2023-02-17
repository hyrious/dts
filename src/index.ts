import type ts from 'typescript'

import json from '@rollup/plugin-json'
import escalade from 'escalade/sync'
import { readFileSync, rmSync } from 'fs'
import { dirname } from 'path'
import { rollup, RollupOutput } from 'rollup'
import dts, { Options } from 'rollup-plugin-dts'

const CommonExts =
  /\.(css|less|sass|scss|styl|stylus|pcss|postcss|json|png|jpe?g|gif|svg|ico|webp|avif|mp4|webm|ogg|mp3|wav|flac|aac|woff2?|eot|ttf|otf|wasm)$/

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

  const start = Date.now()

  rmSync(outfile, { force: true })

  const bundle = await rollup({
    input: entry,
    output: { file: outfile },
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
      json(),
      dts({
        ...options.dts,
        compilerOptions,
      }),
    ],
    external: [CommonExts, ...get_external(entry)],
  })

  const result = await bundle.write({
    dir: dirname(outfile),
    format: 'es',
    exports: 'named',
  })

  return { output: result.output, elapsed: Date.now() - start }
}

function get_external(file: string) {
  const pkg = escalade(file, (_, names) => {
    if (names.includes('package.json')) {
      return 'package.json'
    }
  })
  if (pkg) {
    const json = JSON.parse(readFileSync(pkg, 'utf8'))
    return Object.keys(Object.assign({}, json.dependencies, json.peerDependencies))
  } else {
    return []
  }
}
