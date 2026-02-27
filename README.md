# deno-generate-manifest-action

Generate `package.json` or `jsr.json` from a repository `deno.json`.

This action:

- reads `deno.json` from the root of the calling repository
- runs the generator script with `--type=...`
- writes the generated manifest to the file you choose

## Usage

```yaml
name: Generate package manifest

on:
  workflow_dispatch:

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: denoland/setup-deno@v2
        with:
          deno-version: v2.x

      - uses: quentinadam/deno-manifest-action@v1
        with:
          type: npm
          output_file: package.json
```

## Inputs

| Name          | Required | Description                                                                             |
| ------------- | -------- | --------------------------------------------------------------------------------------- |
| `type`        | yes      | Target manifest type: `npm` or `jsr`                                                    |
| `output_file` | yes      | Output file path relative to repository root (for example `package.json` or `jsr.json`) |

## Examples

Generate `package.json`:

```yaml
- uses: quentinadam/deno-generate-manifest-action@v1
  with:
    type: npm
    output_file: package.json
```

Generate `jsr.json`:

```yaml
- uses: quentinadam/deno-generate-manifest-action@v1
  with:
    type: jsr
    output_file: jsr.json
```

## Notes

- The action expects `deno.json` to exist at repository root.
- The generated `output_file` is written to repository root.
