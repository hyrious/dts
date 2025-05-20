import sade from 'sade'
import { bgBlue, bgGray, black } from 'yoctocolors'

import { existsSync } from 'fs'
import { basename, dirname, join } from 'path'
import mod from 'module'

import { name, version, description } from '../package.json'

type SadeValue = boolean | number | string | string[] | undefined

function as_string(e: SadeValue) {
  if (e == null) return ''
  if (Array.isArray(e)) return as_string(e[0])
  return String(e)
}

// Sade Handler with 0 positional arguments
interface SadeHandler0<Keys extends string> {
  (options: Record<Keys | '_', SadeValue>): void
}

function error_exit(err: any): never {
  if (err.loc) {
    console.warn(`Error parsing: ${err.loc.file}:${err.loc.line}:${err.loc.column}`)
  }
  if (err.frame) {
    console.warn(err.message)
    console.warn(err.frame)
  } else {
    console.error(err.message || err.stack || err + '')
  }
  process.exit(1)
}

function strip_ext(file: string) {
  let i = file.lastIndexOf('.')
  if (i > 2) {
    // Strip .d.ts
    if (file[i - 1] === 'd' && file[i - 2] === '.') i -= 2
    return file.slice(0, i)
  }
  return file
}

// `input` should be `['foo.ts', 'bar=buzz.ts']` and return
// `[{ in: 'foo.ts', out: 'foo' }, { in: 'buzz.ts', out: 'bar' }]`.
function parse_entry(cwd: string, input: SadeValue): { [out: string]: string } {
  input = to_array(input)

  if (!input || input.length === 0) {
    let file: string
    if (existsSync(join(cwd, (file = 'index.ts')))) return { index: file }
    if (existsSync(join(cwd, (file = 'src/index.ts')))) return { index: file }
    if (existsSync(join(cwd, (file = 'src/index.tsx')))) return { index: file }
    error_exit(new Error('Cannot find entry file, guessing src/index.ts'))
  }

  let result: { [out: string]: string } = {}
  for (let raw of input) {
    let i = raw.indexOf('=')
    if (i >= 0) {
      result[raw.slice(0, i)] = raw.slice(i + 1)
    } else {
      result[strip_ext(basename(raw))] = raw
    }
  }
  return result
}

// Update the `out` field of each entry and return the output directory.
function update_entry_points(entries: { [out: string]: string }, file: SadeValue, dir: SadeValue): string {
  // Fast path: only one entry.
  let outs = Object.keys(entries)
  if (outs.length === 1) {
    if (typeof file === 'string') {
      let out = strip_ext(basename(file))
      if (out !== outs[0]) {
        entries[out] = entries[outs[0]]
        delete entries[outs[0]]
      }
      return dirname(file)
    }
    if (typeof dir === 'string') {
      return dir
    }
    return 'dist'
  }

  if (typeof file === 'string') {
    error_exit(new Error('Cannot specify -o with multiple entry points'))
  }

  return as_string(dir) || 'dist'
}

function to_array(e: boolean | number | string | string[] | undefined) {
  if (Array.isArray(e)) return e
  if (typeof e === 'string') return [e]
  return undefined
}

function to_dict(aliases: string[] | undefined) {
  const dict: Record<string, string> = {}
  if (aliases) {
    for (const entry of aliases) {
      const [key, value] = entry.split('=')
      dict[key] = value
    }
  }
  return dict
}

type Keys = 'file' | 'dir' | 'include' | 'exclude' | 'patch' | 'alias' | 'empty' | 'cjs'

sade(name)
  .version(version)
  .describe(description)

  .command('build', 'Build .d.ts files from .ts files', { default: true })
  .option('-o, --file', 'Output file, defaults to "src/index.ts"')
  .option('-d, --dir', 'Output directory, defaults to "dist"')
  .option('-i, --include', 'Force include a module in the bundle')
  .option('-e, --exclude', 'Force exclude a module from the bundle')
  .option('-m, --empty', 'Force ignore a module (treat as empty) in the bundle')
  .option('-p, --patch', 'Patch rollup-plugin-dts to handle `/// doc comments`')
  .option('-a, --alias', 'Rename an external path to something else')
  .option('--cjs', 'Assume the output is CommonJS', false)
  .example('src/index.ts -o dist/index.d.ts')
  .action(<SadeHandler0<Keys>>(async options => {
    if (process.env.NO_DTS) {
      console.log(`${bgGray(black(' DTS '))} Skipping build due to env NO_DTS`)
      return
    }

    const entryPoints = parse_entry(process.cwd(), options._)
    const outdir = update_entry_points(entryPoints, options.file, options.dir)

    const include = to_array(options.include)
    const exclude = to_array(options.exclude)
    const empty = to_array(options.empty)
    const alias = to_dict(to_array(options.alias))
    const cjs = !!options.cjs
    try {
      if (include?.some(e => exclude?.includes(e))) {
        throw new Error('Cannot both include and exclude a module')
      }
      if (options.patch && mod.register) {
        mod.register('./patch.js', import.meta.url)
      }
      const { build } = await import('./index.js')
      const { output, elapsed } = await build({
        entryPoints,
        outdir,
        include,
        exclude,
        empty,
        alias,
        cjs,
      })
      const output_files = output.map(e => e.fileName).join(', ')
      console.log(`${bgBlue(black(' DTS '))} Built ${output_files} in ${Math.floor(elapsed)}ms`)
    } catch (err) {
      error_exit(err)
    }
  }))

  .parse(process.argv)
