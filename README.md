# @hyrious/dts

> Invoke [rollup-plugin-dts](https://github.com/Swatinem/rollup-plugin-dts) to generate bundled .d.ts file

## Usage

```bash
npx @hyrious/dts src/index.ts -o dist/index.d.ts
```

## Changelog

### 0.2.5

- Add `--alias` option to rename external modules, because `rollup-plugin-dts` does not read `"paths"` when they are externalized.

### 0.2.4

- Remove `preserveSymlinks` config, which seems work differently than setting it.

### 0.2.0

- Upgrade `rollup-plugin-dts` to 6.x (was 5.x)

## License

MIT @ [hyrious](https://github.com/hyrious)
