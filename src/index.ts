import type ts from 'typescript'

import escalade from 'escalade/sync'
import { FixDtsDefaultCjsExportsPlugin } from 'fix-dts-default-cjs-exports/rollup'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, relative } from 'path'
import { InputOption, Plugin, RollupOutput, TransformHook, TransformResult, rollup } from 'rollup'
import dts, { Options } from 'rollup-plugin-dts'
import { build as esbuild } from 'esbuild'
import { createHash } from 'crypto'

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
  /// Assume the output is in CommonJS, use `fix-dts-default-cjs-exports` to transform some types.
  /// For example, `export { foo as default }` will become `export = foo`.
  cjs?: boolean
  /// Reuse last build output, if available.
  /// Note that this does not validate if any input files have changed.
  /// Use it only if you know what you are doing.
  /// This is useful for repeated builds where the output files may be erased by other build tools.
  reuseLastOutput?: boolean
}

export interface BuildResult {
  output: RollupOutput['output']
  /// In miliseconds.
  elapsed: number
  /// Is from the last build output.
  reused?: boolean
}

export async function build(options: BuildOptions = { entryPoints: 'src/index.ts' }): Promise<BuildResult> {
  const outdir = options.outdir || 'dist'
  if (options.reuseLastOutput) {
    const start = Date.now()
    const output = restore_outputs(outdir)
    if (output) {
      return { output, elapsed: Date.now() - start, reused: true }
    }
  }

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
    // Improves performance as the cache is not generated.
    // https://github.com/rollup/rollup/blob/fa4b28/cli/run/index.ts#L67
    cache: false,
  })

  const result = await bundle.write({
    dir: outdir,
    format: 'es',
    exports: 'named',
    plugins: [options.cjs && FixDtsDefaultCjsExportsPlugin()],
  })

  if (options.reuseLastOutput) {
    save_outputs(outdir, result)
  }

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

function hash(str: string): string {
  return createHash('sha1').update(str).digest('hex')
}

function find_cache_dir(dir: string, rm = false): string {
  let cache_dir = escalade(dir, (_, names) => {
    if (names.includes('package.json')) {
      return 'node_modules/.cache/hyrious-dts--' + hash(dir)
    }
  })
  cache_dir ||= join(tmpdir(), 'hyrious-dts--' + hash(dir))
  if (rm) {
    rmSync(cache_dir, { recursive: true, force: true })
  }
  mkdirSync(cache_dir, { recursive: true })
  return cache_dir
}

function save_outputs(outdir: string, result: RollupOutput) {
  const cache_dir = find_cache_dir(outdir, true)
  result.output.forEach(chunk => {
    const src = join(outdir, chunk.fileName)
    const dist = join(cache_dir, chunk.fileName)
    if (existsSync(src)) {
      cpSync(src, dist, { recursive: true })
    }
  })
  writeFileSync(join(cache_dir, '.output.json'), JSON.stringify(result))
}

function restore_outputs(outdir: string): RollupOutput['output'] | undefined {
  const cache_dir = find_cache_dir(outdir)
  if (!existsSync(cache_dir)) return
  const output_file = join(cache_dir, '.output.json')
  if (!existsSync(output_file)) return
  try {
    const { output } = JSON.parse(readFileSync(output_file, 'utf8')) as RollupOutput
    for (const chunk of output) {
      const src = join(cache_dir, chunk.fileName)
      const dist = join(outdir, chunk.fileName)
      if (existsSync(src)) {
        cpSync(src, dist, { recursive: true })
      }
    }
    return output
  } catch (err) {
    console.error(err)
  }
}
