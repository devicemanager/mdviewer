#!/usr/bin/env bash
#
# build-notarize.sh — Release build for MDViewer.
#
# Produces a Developer ID-signed, hardened-runtime, notarized & stapled
# build/MDViewer.zip ready to upload to a GitHub Release.
#
# Credentials are NOT stored here:
#   • TEAM_ID  — your Apple Developer Team ID          (env var, required)
#   • APPLE_ID — your Apple ID email                   (env var, used when
#                creating the notary profile below)
#   • The app-specific notarization password lives in your Keychain, referenced
#     by the profile name below. Create it once with:
#
#       xcrun notarytool store-credentials "notarytool" \
#         --apple-id "$APPLE_ID" --team-id "$TEAM_ID"
#
set -euo pipefail

# ---- Config ---------------------------------------------------------------
PROJECT="MDViewer.xcodeproj"
SCHEME="MDViewer"
CONFIG="Release"
APP_NAME="MDViewer"
NOTARY_PROFILE="notarytool"
BUILD_DIR="build"

# ---- Required environment -------------------------------------------------
: "${TEAM_ID:?Set TEAM_ID to your Apple Developer Team ID (e.g. export TEAM_ID=XXXXXXXXXX)}"
# APPLE_ID is not required at build time: notarization authenticates through the
# Keychain profile ("$NOTARY_PROFILE"), which already stores the Apple ID and
# app-specific password. Set it up once with `xcrun notarytool store-credentials`.

DERIVED="$BUILD_DIR/DerivedData"
APP_PATH="$DERIVED/Build/Products/$CONFIG/$APP_NAME.app"
ZIP_PATH="$BUILD_DIR/$APP_NAME.zip"

# ---- Clean ----------------------------------------------------------------
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# NOTE: builds from the committed MDViewer.xcodeproj. Do not run `xcodegen
# generate` here — it would overwrite the checked-in project (and its signing
# config). Regenerate manually if you intentionally changed project.yml.

# ---- Build (Developer ID + hardened runtime + secure timestamp) -----------
echo "==> Building $SCHEME ($CONFIG) for Developer ID distribution…"
xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration "$CONFIG" \
  -derivedDataPath "$DERIVED" \
  -destination 'generic/platform=macOS' \
  CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY="Developer ID Application" \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  ENABLE_HARDENED_RUNTIME=YES \
  CODE_SIGN_INJECT_BASE_ENTITLEMENTS=NO \
  OTHER_CODE_SIGN_FLAGS="--timestamp" \
  clean build

if [[ ! -d "$APP_PATH" ]]; then
  echo "error: build did not produce $APP_PATH" >&2
  exit 1
fi

# ---- Zip for notarization -------------------------------------------------
echo "==> Zipping for notarization…"
ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$ZIP_PATH"

# ---- Notarize (password comes from the Keychain profile) ------------------
echo "==> Submitting to the Apple notary service…"
xcrun notarytool submit "$ZIP_PATH" --keychain-profile "$NOTARY_PROFILE" --wait

# ---- Staple ---------------------------------------------------------------
echo "==> Stapling ticket…"
xcrun stapler staple "$APP_PATH"

# ---- Final stapled zip ----------------------------------------------------
echo "==> Creating final stapled zip…"
rm -f "$ZIP_PATH"
ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$ZIP_PATH"

# ---- Verify ---------------------------------------------------------------
echo "==> Verifying signature & notarization…"
xcrun stapler validate "$APP_PATH"
spctl -a -vvv -t install "$APP_PATH" || true

echo ""
echo "Done: $ZIP_PATH"
