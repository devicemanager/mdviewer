#!/usr/bin/env bash
#
# package-dmg.sh - wrap the notarized MDViewer.app into a signed, notarized,
# stapled .dmg for internal distribution (no MDM: employees open the image and
# drag MDViewer to Applications).
#
# Prerequisite: run ./build-notarize.sh first - it produces the signed,
# notarized, stapled app that this script packages.
#
# No secrets here: signing uses the Developer ID Application identity in your
# Keychain; notarization uses the "notarytool" Keychain profile.
#
set -euo pipefail

APP_NAME="MDViewer"
SIGN_ID="Developer ID Application"
NOTARY_PROFILE="notarytool"
BUILD_DIR="build"
APP_PATH="${BUILD_DIR}/DerivedData/Build/Products/Release/${APP_NAME}.app"

if [[ ! -d "${APP_PATH}" ]]; then
  echo "error: ${APP_PATH} not found - run ./build-notarize.sh first." >&2
  exit 1
fi

# Refuse to package an app that isn't already notarized/Gatekeeper-accepted.
if ! spctl -a -vv "${APP_PATH}" 2>&1 | grep -q "source=Notarized Developer ID"; then
  echo "error: ${APP_PATH} is not notarized. Run ./build-notarize.sh first." >&2
  exit 1
fi

VERSION="$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "${APP_PATH}/Contents/Info.plist")"
DMG_PATH="${BUILD_DIR}/${APP_NAME}-${VERSION}.dmg"

# ---- Stage image contents (app + drag target) -----------------------------
echo "==> Staging disk image contents..."
STAGING="$(mktemp -d)"
cp -R "${APP_PATH}" "${STAGING}/"
ln -s /Applications "${STAGING}/Applications"

# ---- Build the compressed image -------------------------------------------
echo "==> Creating ${DMG_PATH} ..."
rm -f "${DMG_PATH}"
hdiutil create -volname "${APP_NAME}" -srcfolder "${STAGING}" -ov -format UDZO "${DMG_PATH}" >/dev/null
rm -rf "${STAGING}"

# ---- Sign, notarize, staple the image -------------------------------------
echo "==> Signing the disk image (Developer ID) ..."
codesign --sign "${SIGN_ID}" --timestamp "${DMG_PATH}"

echo "==> Notarizing the disk image ..."
xcrun notarytool submit "${DMG_PATH}" --keychain-profile "${NOTARY_PROFILE}" --wait

echo "==> Stapling ticket ..."
xcrun stapler staple "${DMG_PATH}"

# ---- Verify ---------------------------------------------------------------
echo "==> Verifying ..."
xcrun stapler validate "${DMG_PATH}"
spctl -a -t open --context context:primary-signature -v "${DMG_PATH}" || true

echo ""
echo "Done: ${DMG_PATH}"
