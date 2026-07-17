#!/usr/bin/env bash
#
# build-appstore.sh — archive + export MDViewer for the Mac App Store.
#
# This produces an App Store package (.pkg) signed with your Apple Distribution
# certificate and App Store provisioning profiles, ready to upload to App Store
# Connect. It is a SEPARATE pipeline from build-notarize.sh (Developer ID /
# direct download + Homebrew).
#
# One-time prerequisites (interactive, in the Apple Developer portal / Xcode):
#   1. Paid Apple Developer Program membership (individual account is fine).
#   2. The bundle IDs registered as App IDs under team 64G8P2LG44:
#        org.devicemanager.mdviewer
#        org.devicemanager.mdviewer.qlextension
#      (Xcode registers these automatically the first time you archive while
#       signed in — that's what `-allowProvisioningUpdates` below enables.)
#   3. An app record created in App Store Connect for org.devicemanager.mdviewer.
#
# Bundle ID: org.devicemanager.mdviewer  (see MDViewer.xcodeproj)
#
set -euo pipefail

PROJECT="MDViewer.xcodeproj"
SCHEME="MDViewer"
CONFIG="Release"
TEAM_ID="${TEAM_ID:-64G8P2LG44}"

BUILD_DIR="build/appstore"
ARCHIVE="${BUILD_DIR}/MDViewer.xcarchive"
EXPORT_DIR="${BUILD_DIR}/export"

rm -rf "${BUILD_DIR}"
mkdir -p "${BUILD_DIR}"

echo "==> Archiving ${SCHEME} (${CONFIG}) for App Store distribution…"
xcodebuild \
  -project "${PROJECT}" \
  -scheme "${SCHEME}" \
  -configuration "${CONFIG}" \
  -destination 'generic/platform=macOS' \
  -archivePath "${ARCHIVE}" \
  DEVELOPMENT_TEAM="${TEAM_ID}" \
  archive -allowProvisioningUpdates

echo "==> Exporting App Store package…"
xcodebuild -exportArchive \
  -archivePath "${ARCHIVE}" \
  -exportPath "${EXPORT_DIR}" \
  -exportOptionsPlist ExportOptions-AppStore.plist \
  -allowProvisioningUpdates

echo ""
echo "Done. Package: ${EXPORT_DIR}/MDViewer.pkg"
echo ""
echo "Upload to App Store Connect with ONE of:"
echo "  • Xcode → Window → Organizer → select the archive → Distribute App (easiest), or"
echo "  • Transporter.app  (drag ${EXPORT_DIR}/MDViewer.pkg in), or"
echo "  • xcrun altool --upload-app -f \"${EXPORT_DIR}/MDViewer.pkg\" -t macos \\"
echo "        --apiKey <KEY_ID> --apiIssuer <ISSUER_ID>   # App Store Connect API key"
