# @hyrious/dts

> Invoke [rollup-plugin-dts](https://github.com/Swatinem/rollup-plugin-dts) to generate bundled .d.ts file

## Usage

```bash
npx @hyrious/dts src/index.ts -o dist/index.d.ts
```

> [!IMPORTANT]
> Do not use this package as a type-checking linter. It intentionally turns off all strict type-checking options to make it work with any codebase. My goal is to generate `.d.ts` files instead of checking types.

### Bonus

Add `-p` to enable tripple-slash doc comments (will be transformed to `/** comments */`).

## Changelog

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
