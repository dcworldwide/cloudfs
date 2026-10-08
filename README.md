# Cloudfs

A local desktop file explorer for Amazon S3, and later for other cloud file stores. It runs on your computer. Transfers go from this machine to the store. Credentials are not sent anywhere else.

## Run it

Requires Node.js 20 or newer.

```
npm install
npm start
```

`npm start` opens the Electron window and loads the renderer from a local Vite server. `npm test` runs the unit tests. `npm run dist` builds an unpackaged app without certificates.

## Where configuration lives

The app writes one JSON file in the operating system user-data directory:

- macOS: `~/Library/Application Support/Cloudfs/config.json`
- Windows: `%APPDATA%\Cloudfs\config.json`

Settings shows that path and can reveal the file in Finder or Explorer. The file holds store display names, access keys, secrets, region, SSL, the optional endpoint, theme color, dark or light appearance, and open tabs. It is plaintext. The file mode is `0600` on macOS. Treat a copy of it like a password.

Incomplete multipart uploads are recorded beside it in `transfers.json`, so a restart can resume them.

Export writes a copy you choose. Import replaces the saved stores after a confirmation.

## Stores

S3 is the working adapter: display name, access key, secret, region, SSL, and an optional endpoint for S3-compatible stores such as MinIO or Wasabi. Azure Blob and Google Cloud Storage appear in the add-store list and open an info dialog. They do not collect credentials.

## Updates

Packaged builds check GitHub Releases on launch through `electron-updater`. A restart is offered only when no transfer is running. The first tagged release needs the signing secrets below. The release workflow refuses to publish when they are missing.

Tag `v0.1.0` (or any `v*`) on the public GitHub repo to publish. Set `repository` in `package.json` to that repo before the first tag.

### Signing secrets

Add these as GitHub Actions secrets. Do not commit the files.

| Secret | Used for |
|---|---|
| `CSC_LINK` | Base64 of the Apple Developer ID Application `.p12` |
| `CSC_KEY_PASSWORD` | Password for that `.p12` |
| `APPLE_API_KEY` | Base64 of the App Store Connect API `.p8` (notarization) |
| `APPLE_API_KEY_ID` | App Store Connect API key id |
| `APPLE_API_ISSUER` | App Store Connect issuer id |
| `WIN_CSC_LINK` | Base64 of the Windows Authenticode `.pfx` |
| `WIN_CSC_KEY_PASSWORD` | Password for that `.pfx` |

`GITHUB_TOKEN` is provided by Actions and publishes the release. macOS artifacts are a notarized DMG and a zip (the zip is what the updater installs). Windows is a signed NSIS installer. An EV certificate, or Microsoft Trusted Signing, is what keeps SmartScreen from warning on a new publisher. The workflow is the same either way.

## Sharing

Share the repo. Someone else clones it, runs `npm install` and `npm start`, and gets their own config file. Installed copies come from the GitHub Release assets once a signed tag has been published.
