#!/usr/bin/env bash
#
# package-dmg.sh - wrap the notarized MDViewer.app into a signed, notarized,
# stapled .dmg for internal distribution, with a drag-to-Applications layout
# and the app icon as the volume icon (via create-dmg).
#
# Prerequisite: run ./build-notarize.sh first (produces the notarized app).
# Requires: create-dmg  (brew install create-dmg)
#
# No secrets: signing uses the Developer ID Application identity in your
# Keychain; notarization uses the "notarytool" Keychain profile.
#
set -euo pipefail

APP_NAME="MDViewer"
SIGN_ID="Developer ID Application"
NOTARY_PROFILE="notarytool"
BUILD_DIR="build"
APP_PATH="${BUILD_DIR}/DerivedData/Build/Products/Release/${APP_NAME}.app"

command -v create-dmg >/dev/null 2>&1 || {
  echo "error: create-dmg not found - run: brew install create-dmg" >&2; exit 1; }

if [[ ! -d "${APP_PATH}" ]]; then
  echo "error: ${APP_PATH} not found - run ./build-notarize.sh first." >&2
  exit 1
fi

if ! spctl -a -vv "${APP_PATH}" 2>&1 | grep -q "source=Notarized Developer ID"; then
  echo "error: ${APP_PATH} is not notarized. Run ./build-notarize.sh first." >&2
  exit 1
fi

VERSION="$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "${APP_PATH}/Contents/Info.plist")"
DMG_PATH="${BUILD_DIR}/${APP_NAME}-${VERSION}.dmg"
ICNS="${APP_PATH}/Contents/Resources/AppIcon.icns"

if [[ ! -f "${ICNS}" ]]; then
  echo "error: ${ICNS} not found (needed for the volume icon)." >&2
  exit 1
fi

# ---- Stage (create-dmg adds the Applications drop-link itself) -------------
echo "==> Staging disk image contents..."
STAGING="$(mktemp -d)"
cp -R "${APP_PATH}" "${STAGING}/"

# ---- Build a laid-out image (drag-to-Applications + volume icon) ----------
# Note: create-dmg drives Finder via AppleScript to set icon positions; the
# first run may prompt for Automation permission (allow it).
echo "==> Building ${DMG_PATH} with create-dmg..."
rm -f "${DMG_PATH}"
create-dmg \
  --volname "${APP_NAME}" \
  --volicon "${ICNS}" \
  --window-pos 200 120 \
  --window-size 500 340 \
  --icon-size 100 \
  --icon "${APP_NAME}.app" 130 170 \
  --hide-extension "${APP_NAME}.app" \
  --app-drop-link 370 170 \
  --no-internet-enable \
  "${DMG_PATH}" \
  "${STAGING}" || true
rm -rf "${STAGING}"

if [[ ! -f "${DMG_PATH}" ]]; then
  echo "error: create-dmg did not produce ${DMG_PATH}" >&2
  exit 1
fi

# ---- Sign, notarize, staple -----------------------------------------------
echo "==> Signing the disk image (Developer ID)..."
codesign --sign "${SIGN_ID}" --timestamp "${DMG_PATH}"

echo "==> Notarizing the disk image..."
xcrun notarytool submit "${DMG_PATH}" --keychain-profile "${NOTARY_PROFILE}" --wait

echo "==> Stapling ticket..."
xcrun stapler staple "${DMG_PATH}"

# ---- Verify ---------------------------------------------------------------
echo "==> Verifying..."
xcrun stapler validate "${DMG_PATH}"
spctl -a -t open --context context:primary-signature -v "${DMG_PATH}" || true

echo ""
echo "Done: ${DMG_PATH}"
