# metadata.js

Upload token metadata (name, symbol, description, socials, image) to pump.fun's IPFS endpoint and print the resulting `metadataUri`. Off-chain — no Solana RPC involved.

The output URI is what you pass as `URI=…` to [`fire-jito`](fire-jito.md) or [`fire-atomic-create`](fire-atomic-create.md).

- **Source:** [`src/metadata.js`](../../src/metadata.js)
- **npm alias:** `npm run metadata`
- **Network:** outbound HTTPS to `https://pump.fun/api/ipfs`. No Solana calls.

## Environment

| Var | Required | Default | Notes |
|---|---|---|---|
| `NAME` | no | `MyCoin` | Token display name. |
| `SYMBOL` | no | `MEME` | Ticker. |
| `DESCRIPTION` | no | `''` | Free text. |
| `TWITTER` | no | `''` | Full URL or handle, your choice — passed through. |
| `TELEGRAM` | no | `''` | Same. |
| `WEBSITE` | no | `''` | Same. |
| `SHOW_NAME` | no | `true` | When `'true'`, pump.fun renders the coin name on the card. |
| `IMAGE_PATH` | no | (built-in 1x1 PNG placeholder) | Path to a local image file. Read with `fs.createReadStream`. |

## What it does

1. Builds a `multipart/form-data` POST containing the image and metadata fields.
2. POSTs to `https://pump.fun/api/ipfs`.
3. Logs the full JSON response to stderr, prints `metadataUri` (or `metadata_uri`) to stdout.

If `IMAGE_PATH` is unset, an embedded 1×1 transparent PNG is uploaded as a placeholder. The pump.fun launch form will accept this — useful for dry runs or scripts where you want to launch first and add the image later through the website.

## Example

```bash
NAME="MyCoin" \
SYMBOL="MEME" \
DESCRIPTION="A coin about a thing" \
TWITTER=https://twitter.com/example \
IMAGE_PATH=./logo.png \
npm run metadata
# stderr: Full response: { metadataUri: "https://ipfs.io/ipfs/Qm…", … }
# stdout: https://ipfs.io/ipfs/Qm…
```

To capture just the URI for the next step:

```bash
URI=$(NAME="MyCoin" SYMBOL="MEME" IMAGE_PATH=./logo.png npm run metadata --silent)
echo "$URI"
```

(`npm run … --silent` suppresses npm's own banner so only the script's stdout reaches you.)

## Failure modes

- `IPFS upload failed 400/500: <html>` — pump.fun rejected the form. Usually a malformed image (not a PNG/JPEG/GIF) or pump.fun rate-limiting you. Check `IMAGE_PATH` and retry.
- Network error — the script will exit non-zero with the error printed. No state is persisted; safe to re-run.

## Notes

- This *does not* mint anything or touch Solana. It's a content-upload step. The token mint is created later by the launch script.
- The placeholder PNG approach lets you script automated launches without committing to artwork upfront.
- pump.fun's IPFS endpoint occasionally returns HTML error pages instead of JSON when overloaded; the script logs `IPFS upload failed <status>` with the body so you can see what came back.
