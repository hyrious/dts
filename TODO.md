It is possible to bundle TypeScript declarations without any other tools
like abusing rollup.

1. Find or use the compiler API to generate d.ts files

2. For each file,

   1. Extract symbols and _used_ symbols from each statement

      ```ts
      declare const foo: string // symbol: foo, used: []
      declare const bar: typeof foo // symbol: bar, used: [foo]
      import { buzz } from 'buzz' // symbol: buzz, module: buzz
      export { bar } // exported.push(bar), NOTE: no symbol
      export { xxx } from 'xxx' // exported.push(xxx), symbol: xxx, module: xxx
      ```

   2. For each exported symbol, pull itself and its used symbols into bundle

      ```ts
      // pull in export("bar")
      export { bar }
      // pull in 'bar' since it depends on symbol(bar)
      declare const bar: typeof foo
      // pull in 'foo' since it is used by symbol(bar)
      declare const foo: string
      ```

   3. Reverse the bundle and we're done

      ```ts
      declare const foo: string
      declare const bar: typeof foo
      export { bar }
      ```

3. Name conflicts: when pulling dependencies, it is possible to pull in a
   conflicting name. We can rename it when it happens.

### What do we need?

As said in previous section, we need tools to do these works:

- Generate d.ts files from ts files.
- Extract symbols from a ts statement.
- Resolve external modules from path.

To do that, we can use the compiler API to:

- Generate d.ts files from ts files.

  ```ts
  const program = ts.createProgram(['foo.ts'], { declaration: true })
  program.emit(undefined, (_, text) => {
    sourceFile = ts.createSourceFile('foo.d.ts', text, ts.ScriptTarget.Latest)
  })
  ```

- Extract symbols from a ts statement.

  ```ts
  const checker = program.getTypeChecker()
  const symbol = checker.getSymbolAtLocation(sourceFile.statements[0])
  ```

- Resolve external modules from path.

  ```ts
  ts.resolveModuleName('foo', 'bar.ts', {}, ts.sys)
  ```
