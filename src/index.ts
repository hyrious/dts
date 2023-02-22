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
      ignore(CommonExts),
      json({
        preferConst: true,
      }),
      dts({
        respectExternal: true,
        ...options.dts,
        compilerOptions,
      }),
      fix_trivia(),
      expandStar && expand_star(),
    ],
    external: [...get_external(entry, new Set(include)), ...exclude],
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
