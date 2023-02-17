import cleanStack from 'clean-stack'
import sade from 'sade'

import { existsSync } from 'fs'
import { join } from 'path'

import { version } from '../package.json'
import { build } from './index'

// Sade Handler with 1 positional argument
interface SadeHandler1<Keys extends string> {
  (entry: string | undefined, options: Record<Keys, boolean | number | string | undefined>): void
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

sade('dts')
  .version(version)
  .describe('Invoke rollup-plugin-dts to generate bundled .d.ts file')

  .command('build [index.ts]', 'Build a .d.ts file from a .ts file', { default: true })
  .option('-o, --outfile', 'Output file')
  .example('src/index.ts dist/index.d.ts')
  .action(<SadeHandler1<'outfile'>>((entry, options) => {
    entry ||= guess_entry(process.cwd())
    const outfile = (options.outfile && String(options.outfile)) || entry.replace(/\.tsx?$/, '.d.ts')
    build(entry, outfile)
      .then(({ output, elapsed }) => {
        console.log(`Built ${output.map(e => e.fileName).join(', ')} in ${Math.floor(elapsed)}ms`)
      })
      .catch(error_exit)
  }))

  .parse(process.argv)
