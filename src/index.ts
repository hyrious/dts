import type ts from 'typescript'

import escalade from 'escalade/sync'
import { readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, relative } from 'path'
import { InputOption, Plugin, RollupOutput, TransformHook, TransformResult, rollup } from 'rollup'
import dts, { Options } from 'rollup-plugin-dts'
import { build as esbuild } from 'esbuild'

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
  // Note `isolatedDeclarations` conflicts with `allowJs`, but the
  // `forceEmitDts` hack (see https://github.com/Swatinem/rollup-plugin-dts/pull/320)
  // force skipping this.
  allowJs: true,
  checkJs: false,
  declarationMap: false,
  skipLibCheck: true,
  stripInternal: true,
}

export interface BuildOptions {
  /// Example: `["src/index.ts"]`, which is the same as `{ index: 'src/index.ts' }`.
  entryPoints: InputOption
  /// Output directory, defaults to `"dist"`.
  outdir?: string
  /// See [`rollup-plugin-dts`](https://github.com/Swatinem/rollup-plugin-dts).
  dts?: Options
  /// Force include a module in the types bundle even if it should be externalized.
  include?: string[]
  /// Force exclude a module in the types bundle.
  exclude?: string[]
  /// Force ignore a module (treat as empty) in the types bundle.
  empty?: string[]
  /// Rename external paths to something else.
  alias?: Record<string, string>
}

export interface BuildResult {
  output: RollupOutput['output']
  /// In miliseconds.
  elapsed: number
}

export async function build(options: BuildOptions = { entryPoints: 'src/index.ts' }): Promise<BuildResult> {
  const outdir = options.outdir || 'dist'
  const compilerOptions = Object.assign({}, default_compiler_options, options.dts?.compilerOptions)
  const include = options.include || []
  const exclude = options.exclude || []
  const empty = options.empty || []

  const start = Date.now()

  const dts_plugin = dts({
    respectExternal: true,
    ...options.dts,
    compilerOptions,
  })

  const bundle = await rollup({
    input: options.entryPoints,
    onwarn(warning, warn) {
      if (suppress_codes.has(warning.code!)) return
      return warn(warning)
    },
    plugins: [
      options.alias && alias(options.alias),
      // ignore some modules
      empty.length > 0 && ignore(new RegExp(`^(${empty.join('|')})(\\/|\\\\|$)`)),
      // import "./package.json" = externalize
      external(/\.json$/, outdir),
      // resolve tsconfig paths with esbuild
      resolve(),
      // import "./style.css" = nothing
      ignore(CSS_LANGS_RE),
      // import "./a.jpg" = nothing
      ignore(DEFAULT_ASSETS_RE),
      // import "./foo?inline" = export default string
      custom(
        'inline',
        dts_plugin,
        id => id.endsWith('?inline'),
        'declare const __inline: string; export default __inline',
      ),
      dts_plugin,
    ],
    external: [...get_external(options.entryPoints, new Set(include)), ...exclude],
  })

  const result = await bundle.write({
    dir: outdir,
    format: 'es',
    exports: 'named',
  })

  return { output: result.output, elapsed: Date.now() - start }
}

function sample_file(file: InputOption): string {
  if (typeof file === 'string') return file
  if (Array.isArray(file)) return file[0]
  for (const key in file) return file[key]
  throw new Error('No entrypoints found')
}

function get_external(files: InputOption, reject: Set<string>) {
  const pkg = escalade(sample_file(files), (_, names) => {
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

// The dts plugin doesn't handle tsconfig "paths" aliases (where I guess it
// should, because it already depends on `typescript`, thus it has (?) enough
// tools to implement the resolver). So I resolve them using esbuild here.
// Ideally I should just use TypeScript itself to resolve modules, but it seems
// too hard.
function resolve(): Plugin {
  return {
    name: 'resolve',
    async resolveId(id, importer, options) {
      // Ignore the entrypoints and any virtual files which are likely to not using path aliases.
      if (options.isEntry || id[0] === '\0' || id.includes('virtual:')) return

      let result: string | undefined
      await esbuild({
        stdin: {
          contents: `import ${JSON.stringify(id)}`,
          resolveDir: importer ? join(importer, '..') : process.cwd(),
        },
        write: false,
        bundle: true,
        platform: 'node',
        logLevel: 'silent',
        plugins: [
          {
            name: 'resolve',
            setup({ onLoad }) {
              onLoad({ filter: /()/ }, args => {
                result = args.path
                return { contents: '' }
              })
            },
          },
        ],
      }).catch(() => void 0)

      // Aliases are likely pointing to TS files.
      if (result && /\.[cm]?js$/.test(result)) {
        return
      }

      return result
    },
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

function alias(dict: Record<string, string>): Plugin {
  return {
    name: 'alias',
    resolveId(id) {
      if (id in dict) {
        return { id: dict[id], external: true }
      }
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

function external(test: RegExp, outdir: string): Plugin {
  return {
    name: 'external',
    resolveId(id, importer, options) {
      // Ignore the entrypoints and any virtual files which are likely to not handled by this plugin.
      if (options.isEntry || id[0] === '\0' || id.includes('virtual:')) return

      if (test.test(id) && importer) {
        // Change relative id to relative to the outfile.
        if (id.startsWith('.')) {
          id = relative(outdir, join(dirname(importer), id)).replace(/\\/g, '/')
          if (id[0] !== '.') id = './' + id
        }
        return { id, external: true }
      }
    },
  }
}
