---
name: atomic-metadata
description: Use when the user wants to upload pump.fun token metadata (name, symbol, image) to pump.fun's IPFS endpoint and get back a `https://ipfs.io/ipfs/<CID>` URI for use in the create instruction. Triggers on "upload metadata", "pump.fun IPFS upload", "metadata.js", "get a URI for my token", or any pre-launch metadata-uploading task.
---

# atomic-metadata — upload pump.fun token metadata to IPFS

`src/metadata.js` uploads a name + symbol + image to pump.fun's IPFS endpoint and returns the `https://ipfs.io/ipfs/<CID>` URI that the `createV2` / `fire-jito` flows expect as the `URI` env var.

## When to invoke

Pick this skill when the user wants to:

- **Prepare metadata for a launch.** Always run this before `fire-jito.js` unless reusing an existing URI.
- **Refresh a coin's metadata.** Upload new metadata, then update the coin via pump.fun's UI (the on-chain `URI` field is set at create time and not generally mutable from this toolkit).
- **Verify the IPFS endpoint is reachable.** Useful pre-flight check before a coordinated launch.

Skip this skill if:

- You already have a URI from a previous upload — reuse it.
- You're uploading to a different IPFS pinner (Pinata, Filebase, etc.) — this script targets pump.fun's endpoint specifically.

## Required environment

```bash
NAME=MyCoin                     # token name (1-32 chars)
SYMBOL=MEME                     # ticker (1-10 chars, conventionally uppercase)
IMAGE_PATH=./logo.png           # local path to a PNG/JPG/WebP; under ~1 MB recommended
# Optional metadata fields (some pump.fun UIs surface these):
# DESCRIPTION="A meme coin"
# TWITTER="https://twitter.com/handle"
# TELEGRAM="https://t.me/group"
# WEBSITE="https://example.com"
```

No signing keys needed — this is a plain HTTP upload, not a Solana tx.

## Usage

```bash
NAME="MyCoin" SYMBOL=MEME IMAGE_PATH=./logo.png \
  npm run metadata
```

Output: a single URI line, e.g.:

```
https://ipfs.io/ipfs/QmXXX...
```

Capture this and pass it as `URI` to `fire-jito.js` / `fire-atomic-create.js`.

## Behavior

The script:

1. Reads `IMAGE_PATH` and uploads the image to pump.fun's IPFS pinner.
2. Builds a metadata JSON with `name`, `symbol`, `image` (the uploaded CID), and any optional fields.
3. Uploads the metadata JSON to IPFS.
4. Prints the metadata URI to stdout.

Both image + metadata are pinned to IPFS by pump.fun. Pinning lifetime is whatever pump.fun guarantees — generally indefinite for tokens that successfully launch, but don't depend on it for off-pump.fun infrastructure.

## Failure modes and fixes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `"IMAGE_PATH does not exist"` | Wrong path or running from wrong directory | Use absolute paths, or `cd` to the directory containing the image. |
| `"Image too large"` | Image > 5 MB | Resize. Most token logos are 256×256 or 512×512. |
| HTTP 429 from pump.fun | Rate limited | Wait a few minutes; pump.fun limits per-IP uploads. |
| `"Invalid name/symbol"` | Name has emoji or symbol exceeds 10 chars | Use plain ASCII for the symbol; emojis are fine in the name. |
| URI returned but image doesn't load on pump.fun | IPFS gateway not propagated yet | Wait 30-60 seconds; try `https://gateway.pinata.cloud/ipfs/<CID>`. |

## Worked example

Uploading a coin called "PumpKitty" with ticker `KITTY`:

```bash
NAME="PumpKitty" SYMBOL=KITTY IMAGE_PATH=./pumpkitty.png \
DESCRIPTION="The official PumpKitty meme coin." \
TWITTER="https://twitter.com/pumpkitty_sol" \
  npm run metadata

# Output:
# https://ipfs.io/ipfs/QmAbc...XyZ
```

Then feed that URI to the launcher:

```bash
URI="https://ipfs.io/ipfs/QmAbc...XyZ" \
NAME=PumpKitty SYMBOL=KITTY \
FUNDER_SECRET=<base58> \
CREATOR_SECRET=<base58> \
JITO_TIP=0.01 \
  npm run launch
```

## Reference

- Script: [`src/metadata.js`](../../src/metadata.js)
- Per-script docs: [`docs/scripts/metadata.md`](../../docs/scripts/metadata.md)
- Downstream consumer: [`skills/launch/`](../launch/) (uses the URI this skill produces)
