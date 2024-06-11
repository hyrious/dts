import { readFile } from 'node:fs/promises'

function decode(source: string | Uint8Array | ArrayBuffer) {
  if (source instanceof Uint8Array || source instanceof ArrayBuffer) {
    source = new TextDecoder().decode(source)
  }
  return source
}

function patch(url: string, source: string) {
  if (/node_modules[\\/]rollup-plugin-dts/.test(url)) {
    source = decode(source)
    source = source.replaceAll('ts.createCompilerHost(', 'createCompilerHost(')
    source += `
function createCompilerHost(compilerOptions, setParentNodes = false) {
  const host = ts.createCompilerHost(compilerOptions, setParentNodes);
  host.readFile = readAndMangleComments;
  return host;
}
function readAndMangleComments(name) {
  let file = ts.sys.readFile(name);
  if (file && !name.includes('node_modules'))
    file = file.replace(/(?<=^|\\n)(?:([ \\t]*)\\/\\/\\/.*\\r?\\n)+/g, (comment, space) => {
      if (comment.indexOf("\\n") + 1 === comment.length) {
        return \`\${space}/** \${comment.slice(space.length).replace(/\\/\\/\\/ ?/g, "").trimEnd()} */\\n\`;
      }
      return \`\${space}/**\\n\${space}\${comment.slice(space.length).replace(/\\/\\/\\/ ?/g, " * ")}\${space} */\\n\`;
    });
  return file;
}
`
  }
  return source
}

export async function load(url: string, context: any, nextLoad: any) {
  if (!/node_modules[\\/]rollup-plugin-dts/.test(url)) {
    return nextLoad(url, context)
  }

  let result = await nextLoad(url, context)
  if (result.format === 'commonjs') {
    result.source ??= await readFile(new URL(result.responseURL ?? url), 'utf8')
  }
  if (result.format === 'commonjs' || result.format === 'module') {
    result.source = patch(url, result.source)
  }

  return result
}
