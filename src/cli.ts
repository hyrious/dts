import sade from 'sade'
import { bgBlue, black } from 'yoctocolors'

import { existsSync } from 'fs'
import { join } from 'path'
import mod from 'module'

import { name, version, description } from '../package.json'

// Sade Handler with 1 positional argument
interface SadeHandler1<Keys extends string> {
  (entry: string | undefined, options: Record<Keys, boolean | number | string | string[] | undefined>): void
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

function guess_entry(cwd: string) {
  if (existsSync(join(cwd, 'index.ts'))) return 'index.ts'
  if (existsSync(join(cwd, 'src/index.ts'))) return 'src/index.ts'
  if (existsSync(join(cwd, 'src/index.tsx'))) return 'src/index.tsx'
  error_exit(new Error('Cannot find entry file, guessing src/index.ts'))
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

sade(name)
  .version(version)
  .describe(description)

  .command('build [index.ts]', 'Build a .d.ts file from a .ts file', { default: true })
  .option('-o, --outfile', 'Output file')
  .option('-i, --include', 'Force include a module in the bundle')
  .option('-e, --exclude', 'Force exclude a module from the bundle')
  .option('-p, --patch', 'Patch rollup-plugin-dts to handle `/// doc comments`')
  .option('-a, --alias', 'Rename an external path to something else')
  .example('src/index.ts -o dist/index.d.ts')
  .action(<SadeHandler1<'outfile' | 'include' | 'exclude' | 'patch' | 'alias'>>(async (entry, options) => {
    entry ||= guess_entry(process.cwd())
    entry = entry.replace(/[\\]/g, '/')
    const outfile =
      (options.outfile && String(options.outfile)) ||
      entry.replace(/\.tsx?$/, '.d.ts').replace(/\bsrc\//, 'dist/')
    const include = to_array(options.include)
    const exclude = to_array(options.exclude)
    const alias = to_dict(to_array(options.alias))
    try {
      if (include?.some(e => exclude?.includes(e))) {
        throw new Error('Cannot both include and exclude a module')
      }
      if (options.patch && mod.register) {
        mod.register('./patch.js', import.meta.url)
      }
      const { build } = await import('./index')
      const { output, elapsed } = await build(entry, outfile, {
        include,
        exclude,
        alias,
      })
      const output_files = output.map(e => e.fileName).join(', ')
      console.log(`${bgBlue(black(' DTS '))} Built ${output_files} in ${Math.floor(elapsed)}ms`)
    } catch (err) {
      error_exit(err)
    }
  }))

  .parse(process.argv)
