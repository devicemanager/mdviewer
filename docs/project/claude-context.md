# MDViewer Project Instructions

## Release Process

**Required**: Always run the notarized build before releasing.

```bash
./build-notarize.sh
```

This script handles building, signing, notarization, stapling, and zip creation.
Upload the generated `build/MDViewer.zip` (stapled) to GitHub Release before publishing.

### Steps

1. Run `./build-notarize.sh`
2. On success, `build/MDViewer.zip` is generated
3. Create the release with `gh release create vX.X.X build/MDViewer.zip ...`
4. Do not release without the zip

### App Password & Notarization Settings

Credentials are **not** stored in the repo. `build-notarize.sh` reads your Apple ID
and Team ID from environment variables and uses a Keychain-stored notarization profile.

- Set `APPLE_ID` and `TEAM_ID` in your environment before running the build.
- Keychain profile name: `notarytool` — create it once with
  `xcrun notarytool store-credentials "notarytool"` (stores the app-specific
  password in your Keychain; re-run to update it if the password is regenerated).
