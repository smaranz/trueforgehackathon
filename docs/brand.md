# Probe identity

**Probe** is a team of AI agents that tests a product across separate user accounts, verifies interaction failures and produces executable regressions.

## Logo

- Symbol: `public/brand/probe-mark.svg`
- Wordmark lockup: `public/brand/probe-logo.svg`
- Color: forest green `#3F6549`, with ink `#292D28`
- Interface wordmark: Geist, medium/semibold, compact spacing

The symbol uses two interlocking paths to form a P. It represents separate accounts investigating one shared product state. It is a hand-authored vector logo, scales without raster blur, and is used in the app header and favicon.

## ElevenLabs generation attempt

The official Image & Video / Flows API was checked:

- [Image & Video quickstart](https://elevenlabs.io/docs/eleven-api/guides/cookbooks/image-and-video)
- [Create image generation](https://elevenlabs.io/docs/api-reference/flows/image/create)

A request to `POST https://api.elevenlabs.io/v1/flows/image` using `gpt-image-1.5` and a transparent-background logo prompt was rejected with HTTP 401, `missing_permissions`: the supplied key lacks **`image_video_generation`** permission. No AI-generated image was returned. The API also requires a Pro plan or above, as documented; this request stopped at the permission check.

The current vector logo is an original design, not an ElevenLabs output. A sanitized provider error is saved in `.data/branding/elevenlabs-error.json`. The one-time key was removed from temporary storage and was never added to project source, `.env`, or frontend code.

To retry after enabling Image & Video / Flows permission, provide the key through a shell environment variable or a private file and run:

```bash
node scripts/generate-logo.mjs
```

The script reads `ELEVENLABS_API_KEY` or `ELEVENLABS_KEY_FILE`; it never logs either. A successful generation is downloaded to `public/brand/probe-mark-source.png` for visual review before replacing the current vector mark. `--resume` resumes polling a saved pending generation rather than submitting another paid request.

## Historical identifiers

Existing runs, immutable evidence and regression artifacts retain their original labels. The SQLite filename `customer-zero.sqlite` and internal `CZ_*` regression variables remain compatibility identifiers so the rename preserves the verified run history.
