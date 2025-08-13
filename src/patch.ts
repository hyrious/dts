function decode(source: string | Uint8Array | ArrayBuffer): string {
  if (source instanceof Uint8Array || source instanceof ArrayBuffer) {
    source = new TextDecoder().decode(source)
  }
  return source
}

function patch(url: string, source: string, oxc: boolean): string {
  if (/node_modules[\\/]rollup-plugin-dts/.test(url)) {
    source = decode(source)

    source = source.replaceAll('ts.createCompilerHost(', 'createCompilerHost(')
    source = source.replace(
      'code = preprocessed.code.toString();',
      'code = mangleComments(preprocessed.code.toString());',
    )
    source += `
function createCompilerHost(compilerOptions, setParentNodes = false) {
  const host = ts.createCompilerHost(compilerOptions, setParentNodes);
  host.readFile = readAndMangleComments;
  return host;
}
function readAndMangleComments(name) {
  let file = ts.sys.readFile(name);
  if (file && !name.includes('node_modules'))
    file = mangleComments(file);
  return file;
}
function mangleComments(file) {
  return file.replace(/(?<=^|\\n)(?:([ \\t]*)\\/\\/\\/.*\\r?\\n)+/g, (comment, space) => {
    if (comment.indexOf("\\n") + 1 === comment.length) {
      return \`\${space}/** \${comment.slice(space.length).replace(/\\/\\/\\/ ?/g, "").trimEnd().replace(/\\*\\//g, '*\\u200B/')} */\\n\`;
    }
    return \`\${space}/**\\n\${space}\${comment.slice(space.length).replace(/\\/\\/\\/ ?/g, " * ").replace(/\\r/g, '').replace(/\\*\\//g, '*\\u200B/')}\${space} */\\n\`;
  });
}
`
    if (oxc) {
      // Skip creating the first program.
      source = source.replace('const programs = [];', 'const programs = []; return programs;')
      // Patch the `treatTsAsDts` function to use oxc-transform.
      source = source.replace(
        'const treatTsAsDts = () => {',
        [
          'const treatTsAsDts = () => {',
          `const esmRequire = createRequire(${JSON.stringify(import.meta.url)});`,
          'const oxc = esmRequire("oxc-transform");',
          'const oxcResult = oxc.isolatedDeclaration(id, mangleComments(code), { stripInternal: true });',
          'if (oxcResult.errors.length) { throw new Error(oxcResult.errors.map(e => e.message).join("\\n")); }',
          'return transformPlugin.transform.call(this, oxcResult.code, getDeclarationId(id));',
        ].join('\n'),
      )
    }
  }
  return source
}

export async function load(url: string, context: any, nextLoad: any) {
  if (!/node_modules[\\/]rollup-plugin-dts/.test(url)) {
    return nextLoad(url, context)
  }

  let result = await nextLoad(url, context)
  if (result.format === 'commonjs') {
    // Since my package is ESM, there's no chance that the source is from the CJS module.
    return result
  }
  if (result.format === 'module') {
    result.source = patch(url, result.source, import.meta.url.includes('oxc=1'))
  }

  return result
}
