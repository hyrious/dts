import type ts from 'typescript'

import json, { RollupJsonOptions } from '@rollup/plugin-json'
import escalade from 'escalade/sync'
import { readFileSync, rmSync, writeFileSync } from 'fs'
import { Plugin, rollup, RollupOutput, TransformHook } from 'rollup'
import dts, { Options } from 'rollup-plugin-dts'
import { tmpdir } from 'os'
import { join, relative } from 'path'

export { version } from '../package.json'

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
  experimental?: {
    /** Post process the result and replace all `* as` to `{...names}` */
    expandStar?: boolean
  }
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
  const expandStar = options.experimental?.expandStar

  const start = Date.now()

  const dts_ = dts({
    respectExternal: true,
    ...options.dts,
    compilerOptions,
  })
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
    plugins: [ignore(CommonExts), wrap(json, dts_), dts_, expandStar && expand_star()],
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

function wrap(json: (options?: RollupJsonOptions) => Plugin, dts: Plugin): Plugin {
  const pwd = process.cwd()

  const jsonPlugin = json({
    preferConst: true,
  })

  const tempfiles: string[] = []

  return {
    name: 'wrap(json)',
    transform(code, id) {
      const result = (jsonPlugin.transform as TransformHook).call(this, code, id)
      if (!result || typeof result === 'string') return result
      const tempfile = join(tmpdir(), relative(pwd, id).replace(/[\/\\]/g, '+') + '.ts')
      // rollup-plugin-dts uses `ts.sys.readFile` to create a new program for this file
      // so we have to write this virtual file to disk
      writeFileSync(tempfile, result.code!)
      tempfiles.push(tempfile)
      return (dts.transform as TransformHook).call(this, result.code!, tempfile)
    },
    generateBundle() {
      for (const file of tempfiles) rmSync(file)
      tempfiles.length = 0
    },
  }
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

function ignore(re: RegExp): Plugin {
  return {
    name: 'ignore',
    load(id) {
      if (re.test(id)) {
        return ''
      }
    },
  }
}

function expand_star(): Plugin {
  return {
    name: 'expand-star',
    renderChunk(code) {
      const namespaces: [variable: string, module: string][] = []
      code.replace(/^import \* as (\S+) from ['"]([-@\w]+)/gm, (_, ns, external) => {
        namespaces.push([ns, external])
        return ''
      })
      if (namespaces.length) {
        const names: Record<string, Record<string, true>> = {}
        for (const [ns, module] of namespaces) {
          names[ns] ||= {}
          const re = new RegExp(`^import {(.+)} from ['"]${module}['"];$`, 'gm')
          code = code.replace(re, (_, imports: string) => {
            for (let name of imports.split(',')) {
              name = name.trim()
              if (name) names[ns][name] = true
            }
            return ''
          })
        }
        for (const [ns] of namespaces) {
          names[ns] ||= {}
          const re = new RegExp(`\\b${ns.replace(/\$/g, '\\$')}\\.(\\w+)\\b`, 'g')
          code = code.replace(re, (_, name) => {
            names[ns][name] = true
            return name
          })
        }
        code = code.replace(/^import \* as (\S+) from\b/gm, (_, ns) => {
          return `import { ${Object.keys(names[ns]).join(', ')} } from`
        })
        return code
      }
    },
  }
}
