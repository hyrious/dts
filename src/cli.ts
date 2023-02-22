import cleanStack from 'clean-stack'
import sade from 'sade'

import { existsSync } from 'fs'
import { join } from 'path'

import { version } from '../package.json'
import { build } from './index'

// Sade Handler with 1 positional argument
interface SadeHandler1<Keys extends string> {
  (entry: string | undefined, options: Record<Keys, boolean | number | string | string[] | undefined>): void
}

function error_exit(err: Error): never {
  console.error(cleanStack(err.stack, { pretty: true, basePath: process.cwd() }))
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

sade('dts')
  .version(version)
  .describe('Invoke rollup-plugin-dts to generate bundled .d.ts file')

  .command('build [index.ts]', 'Build a .d.ts file from a .ts file', { default: true })
  .option('-o, --outfile', 'Output file')
  .option('-i, --include', 'Force include a module in the bundle')
  .option('-e, --exclude', 'Force exclude a module from the bundle')
  .option('--expand-star', 'Expand namespace imports to named imports (experimental)')
  .example('src/index.ts dist/index.d.ts')
  .action(<SadeHandler1<'outfile' | 'include' | 'exclude' | 'expand-star'>>(async (entry, options) => {
    entry ||= guess_entry(process.cwd())
    const outfile = (options.outfile && String(options.outfile)) || entry.replace(/\.tsx?$/, '.d.ts')
    const include = to_array(options.include)
    const exclude = to_array(options.exclude)
    const expandStar = !!options['expand-star']
    try {
      if (include?.some(e => exclude?.includes(e))) {
        throw new Error('Cannot both include and exclude a module')
      }
      const { output, elapsed } = await build(entry, outfile, {
        include,
        exclude,
        experimental: { expandStar },
      })
      console.log(`Built ${output.map(e => e.fileName).join(', ')} in ${Math.floor(elapsed)}ms`)
    } catch (err) {
      error_exit(err)
    }
  }))

  .parse(process.argv)
