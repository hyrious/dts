# @hyrious/dts

> Invoke [rollup-plugin-dts](https://github.com/Swatinem/rollup-plugin-dts) to generate bundled .d.ts file

## Usage

```bash
npx @hyrious/dts src/index.ts -o dist/index.d.ts
```

### Bonus

- Add `-p` to enable tripple-slash doc comments (will be transformed to `/** comments */`).
- Add env `NO_DTS` to turn the CLI to no-op, useful in local developing without type changes.

> [!IMPORTANT]
> Do not use this package as a type-checking linter.
> It intentionally ignores any type error to make it work with any codebase.
> My goal is to generate `.d.ts` files instead of checking types.

## Changelog

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
