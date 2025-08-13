# @hyrious/dts

> Invoke [rollup-plugin-dts](https://github.com/Swatinem/rollup-plugin-dts) to generate bundled .d.ts file

## Usage

```bash
npx @hyrious/dts src/index.ts -o dist/index.d.ts
```

### Bonus

- Add `-p` to enable:
  - tripple-slash doc comments (will be transformed to `/** comments */`).
  - add `--oxc` to generate types with `oxc-transform`.
- Add env `NO_DTS` to turn the CLI to no-op, useful in local developing without type changes.
- Add env `DTS_FAST` to reuse last build output.

> [!IMPORTANT]
> Do not use this package as a type-checking linter. You still need `tsc --noEmit`.
> It intentionally ignores any type error to make it work with any codebase.
> My goal is to generate `.d.ts` files instead of checking types.

## Changelog

### 0.3.5

- Use `TypeScript` itself instead of esbuild to resolve aliases.
- Add `--oxc` to get types from `oxc-transform`, which can be super fast.

### 0.3.4

- Fix `-o file.d.mts` should emit correct file.

### 0.3.3

- Add env `DTS_FAST=1` to enable `--fast` for easier usage.
- Change the API output `reused` to the cache location.

### 0.3.2

- Add `--fast` to reuse last build output for impatient users like me.

### 0.3.1

- Add `--cjs` to enable `fix-dts-default-cjs-exports` to transform CJS types.

  This assumes the default export will become the whole CJS export (`module.exports = default_export`). So the bundler should be configured correctly to do so. For example, [Rollup](https://rollupjs.org/repl/?shareable=JTdCJTIyZXhhbXBsZSUyMiUzQSUyMiUyMiUyQyUyMm1vZHVsZXMlMjIlM0ElNUIlN0IlMjJjb2RlJTIyJTNBJTIyZnVuY3Rpb24lMjBmb28oKSUyMCU3QiU1Q24lMjAlMjByZXR1cm4lMjAxJTVDbiU3RCU1Q24lNUNuZXhwb3J0JTIwZGVmYXVsdCUyMGZvbyUyMiUyQyUyMmlzRW50cnklMjIlM0F0cnVlJTJDJTIybmFtZSUyMiUzQSUyMm1haW4uanMlMjIlN0QlNUQlMkMlMjJvcHRpb25zJTIyJTNBJTdCJTIyb3V0cHV0JTIyJTNBJTdCJTIyZm9ybWF0JTIyJTNBJTIyY2pzJTIyJTdEJTdEJTdE) will do this when there's only one export (and is default export).

- Fix a typo bug which causes `-d` not working.

### 0.3.0

- **Breaking**: Change `--outfile` to `--file` so it will be more like rollup.

- Add `-d` option to specify the output directory, and now it supports multiple entry points!

  The input args grammar is like esbuild:

  ```console
  $ dts foo=src/foo.ts bar=src/buzz.ts
  Will build dist/foo.d.ts and dist/bar.d.ts
  ```

- Remove the `json` plugin. Now json imports are externalized and the path will be rewritten to relative to the output file.

### 0.2.11

- Temporarily patch `rollup-plugin-dts` (using `-p`) to force emit (ignore any type error).

### 0.2.10

- Change the dependency version of `esbuild` to `*`.

### 0.2.9

- Fix: Do not resolve JavaScript files.

### 0.2.8

- Downgrade `esbuild` to `^0.21.5` to be compatible with `vite` related toolchains.

### 0.2.7

- Add `--empty` option to mark modules as empty, like virtual modules.
- Resolve paths alias with esbuild.
- Turn off all strict options.

### 0.2.6

- Add `NO_DTS` env to disable dts generation when using the CLI.

### 0.2.5

- Add `--alias` option to rename external modules, because `rollup-plugin-dts` does not read `"paths"` when they are externalized.

### 0.2.4

- Remove `preserveSymlinks` config, which seems work differently than setting it.

### 0.2.0

- Upgrade `rollup-plugin-dts` to 6.x (was 5.x)

## License

MIT @ [hyrious](https://github.com/hyrious)
