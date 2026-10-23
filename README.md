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
- Linux: `~/.config/Cloudfs/config.json`

Settings shows that path and can reveal the file in Finder or Explorer. The file holds store display names, access keys, secrets, region, SSL, the optional endpoint, theme color, dark or light appearance, and open tabs. It is plaintext. The file mode is `0600` on macOS. Treat a copy of it like a password.

Incomplete multipart uploads are recorded beside it in `transfers.json`, so a restart can resume them.

Export writes a copy you choose. Import replaces the saved stores after a confirmation.

## Stores

S3 is the working adapter: display name, access key, secret, region, SSL, and an optional endpoint for S3-compatible stores such as MinIO or Wasabi. Azure Blob and Google Cloud Storage appear in the add-store list and open an info dialog. They do not collect credentials.

## Releases and auto-update

Every push to `main` runs `.github/workflows/release.yml`. That workflow builds installers for Linux, Windows, and macOS, then publishes a GitHub Release. Pull requests run the same build and do not publish. A manual run from the Actions tab publishes only when it is started from `main`.

The release is published, not left as a draft. `electron-updater` ignores drafts. The release carries the installers and the metadata files the updater reads: `latest-linux.yml`, `latest.yml` (Windows), and `latest-mac.yml`.

### Version numbers

`electron-updater` only offers a release whose version is newer than the one that is installed. The copy of `package.json` in git stays at a base version such as `0.1.0`. During the workflow the patch is replaced with `github.run_number`, the counter for this workflow file:

`0.1.12` means major.minor `0.1` from `package.json`, and run number 12.

The counter goes up on every run, including pull requests, so published versions can skip numbers (`0.1.4`, then `0.1.7`). They do not go backwards. Pushes to `main` are queued, so an older build cannot publish after a newer one and become GitHub's "latest" release.

Do not rename `.github/workflows/release.yml`. The counter belongs to that file and would start again at 1. If the file has to be replaced, raise the major or minor in `package.json` first so the new versions sort above anything already published. Do not lower the major or minor while releases exist.

`GITHUB_TOKEN` is created by Actions. The workflow sets `contents: write` so that token can create the release. No personal access token is required.

### What the installed app does

A packaged app checks GitHub Releases for `dcworldwide/cloudfs` on launch and downloads a newer version in the background. The status is in Settings. When the download finishes, a bar offers **Restart to update**. Quitting the app also installs a download that is already waiting. Restart waits while a transfer is still running, then installs when the queue is idle.

Update checks do not run from `npm start`. That process is not a packaged build, and there is no release metadata to read. Failures are written to the updater log and shown in Settings. They do not close the app.

- macOS: `~/Library/Logs/Cloudfs/updater.log`
- Windows: `%APPDATA%\Cloudfs\logs\updater.log`
- Linux: `~/.config/Cloudfs/logs/updater.log`

### Installing a release

- Linux: download the `.AppImage`, run `chmod +x` on it, and open it. Later versions install themselves. This works without a certificate.
- Windows: run the NSIS `.exe`. SmartScreen may warn until the app is signed; choose More info, then Run anyway. Later versions install themselves without a certificate. A signed build checks the next update's signature.
- macOS: open the `.dmg` and drag Cloudfs to Applications. The `.zip` on the same release is what the updater installs, not the dmg. Auto-update does not run until that copy is signed with a Developer ID certificate and notarized. Until then, install new macOS releases by hand. The first signed build also has to be installed by hand. Builds after that update themselves.

### Signing secrets

No secrets are required for the workflow to publish. Signing is skipped when a secret is absent, and it is picked up on the next `main` push when you add it. Add secrets in the repo settings. Do not commit the files. Encode each file as a single base64 line (`base64 -i Certificate.p12 | tr -d '\n'`).

| Secret | Required for | What it is |
|---|---|---|
| `CSC_LINK` | macOS signing | Base64 of the Developer ID Application `.p12` |
| `CSC_KEY_PASSWORD` | macOS signing | Password for that `.p12` |
| `APPLE_API_KEY` | macOS notarization | Base64 of the App Store Connect API `.p8` |
| `APPLE_API_KEY_ID` | macOS notarization | App Store Connect API key id |
| `APPLE_API_ISSUER` | macOS notarization | App Store Connect issuer id |
| `WIN_CSC_LINK` | Windows signing, optional | Base64 of the Authenticode `.pfx` |
| `WIN_CSC_KEY_PASSWORD` | Windows signing, optional | Password for that `.pfx` |

macOS auto-update needs the five Apple secrets together: the Developer ID certificate and the notarization key. Notarization can instead use `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. Windows auto-update works unsigned. `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` are how you remove the SmartScreen warning. An EV certificate or Microsoft Trusted Signing is what makes a new publisher look established to SmartScreen. Linux AppImage updates do not use a certificate.

If Actions cannot create releases, open Settings, then Actions, then General, then Workflow permissions, and choose **Read and write permissions**. The repository is public. The updater downloads release assets without a token, so making the repository private would stop auto-update.

## Sharing

Share the repo. Someone else clones it, runs `npm install` and `npm start`, and gets their own config file. Installed copies come from the GitHub Release assets published by the workflow above.
