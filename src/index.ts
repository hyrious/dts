import type ts from 'typescript'

import json from '@rollup/plugin-json'
import escalade from 'escalade/sync'
import { readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, relative } from 'path'
import { Plugin, RollupOutput, TransformHook, TransformResult, rollup } from 'rollup'
import dts, { Options } from 'rollup-plugin-dts'

export { version } from '../package.json'

// https://github.com/vitejs/vite/blob/-/packages/vite/src/node/constants.ts
const CSS_LANGS_RE = /\.(css|less|sass|scss|styl|stylus|pcss|postcss|sss)(?:$|\?)/

const KNOWN_ASSET_TYPES = [
  // images
  'apng',
  'png',
  'jpe?g',
  'jfif',
  'pjpeg',
  'pjp',
  'gif',
  'svg',
  'ico',
  'webp',
  'avif',

  // media
  'mp4',
  'webm',
  'ogg',
  'mp3',
  'wav',
  'flac',
  'aac',
  'opus',
  'mov',
  'm4a',
  'vtt',

  // fonts
  'woff2?',
  'eot',
  'ttf',
  'otf',

  // other
  'webmanifest',
  'pdf',
  'txt',
]

const DEFAULT_ASSETS_RE = new RegExp(`\\.(` + KNOWN_ASSET_TYPES.join('|') + `)(\\?.*)?$`)

const suppress_codes = new Set(['UNRESOLVED_IMPORT', 'CIRCULAR_DEPENDENCY', 'EMPTY_BUNDLE'])

const default_compiler_options: ts.CompilerOptions = {
  noEmit: false,
  declaration: true,
  emitDeclarationOnly: true,
  noEmitOnError: true,
  allowJs: true,
  checkJs: false,
  declarationMap: false,
  skipLibCheck: true,
  stripInternal: true,
}

export interface BuildOptions {
  /// See [`rollup-plugin-dts`](https://github.com/Swatinem/rollup-plugin-dts).
  dts?: Options
  /// Force include a module in the types bundle even if it should be externalized.
  include?: string[]
  /// Force exclude a module in the types bundle.
  exclude?: string[]
}

export interface BuildResult {
  output: RollupOutput['output']
  /// In miliseconds.
  elapsed: number
}

export async function build(
  entry: string,
  outfile: string,
  options: BuildOptions = {},
): Promise<BuildResult> {
  const compilerOptions = Object.assign({}, default_compiler_options, options.dts?.compilerOptions)
  const include = options.include || []
  const exclude = options.exclude || []

  const start = Date.now()

  const pwd = process.cwd()

  const json_plugin = json({
    preferConst: true,
  })

  const dts_plugin = dts({
    respectExternal: true,
    ...options.dts,
    compilerOptions,
  })

  const bundle = await rollup({
    input: entry,
    onwarn(warning, warn) {
      if (suppress_codes.has(warning.code!)) return
      return warn(warning)
    },
    plugins: [
      // import "./style.css" = nothing
      ignore(CSS_LANGS_RE),
      // import "./a.jpg" = nothing
      ignore(DEFAULT_ASSETS_RE),
      // import "./package.json" handled by the json plugin
      custom('json', dts_plugin, void 0, void 0, function (this: any, code, id, tmpfiles) {
        const result = (json_plugin.transform as TransformHook).call(this, code, id)
        if (!result || typeof result === 'string') return result
        const tmpfile = join(tmpdir(), relative(pwd, id).replace(/[\/\\]/g, '+') + '.ts')
        writeFileSync(tmpfile, result.code!)
        tmpfiles.push(tmpfile)
        return (dts_plugin.transform as TransformHook).call(this, result.code!, tmpfile)
      }),
      // import "./foo?inline" = export default string
      custom(
        'inline',
        dts_plugin,
        id => id.endsWith('?inline'),
        'declare const __inline: string; export default __inline',
      ),
      dts_plugin,
    ],
    external: [...get_external(entry, new Set(include)), ...exclude],
  })

  rmSync(outfile, { force: true })

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
    return Object.keys(deps)
      .filter(e => !reject.has(e))
      .map(dep => new RegExp(`^${dep}($|\\/|\\\\)`))
  } else {
    return []
  }
}

function ignore(re: RegExp): Plugin {
  return {
    name: 'ignore',
    resolveId(id) {
      if (re.test(id)) return id
    },
    load(id) {
      if (re.test(id)) return ''
    },
  }
}

function custom(
  name: string,
  dts: Plugin,
  test?: (id: string) => boolean,
  code?: string,
  transform?: (code: string, id: string, tmpfiles: string[]) => TransformResult,
): Plugin {
  const pwd = process.cwd()

  const tmpfiles: string[] = []
  const id2tmpfile = Object.create(null)

  return {
    name,
    resolveId(id) {
      if (test && test(id)) return id
    },
    load(id) {
      if (test && test(id) && code) {
        const tmpfile = join(tmpdir(), relative(pwd, id).replace(/[\/\\]/g, '+') + '.ts')
        writeFileSync(tmpfile, code)
        tmpfiles.push(tmpfile)
        id2tmpfile[id] = tmpfile
        return code
      }
    },
    transform(code, id) {
      if (!test && transform) {
        return transform.call(this, code, id, tmpfiles)
      } else if (test && test(id)) {
        return (dts.transform as TransformHook).call(this, code, id2tmpfile[id])
      }
    },
    generateBundle() {
      for (const file of tmpfiles) rmSync(file)
      tmpfiles.length = 0
    },
  }
}
