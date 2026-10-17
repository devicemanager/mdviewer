#!/usr/bin/env bash
#
# build-appstore-ios.sh — archive + export the Tauri iPhone app for the App Store.
#
# The iOS counterpart of build-appstore.sh (which builds the Swift *Mac* app).
# Same App Store Connect record: bundle ID org.devicemanager.mdviewer, with iOS
# as a second platform (universal purchase). Written 2026-10-17 for the first
# iOS submission; see docs/appstore/listing-ios.md for the listing itself.
#
#   ./build-appstore-ios.sh            # archive + export an .ipa (no upload)
#   ./build-appstore-ios.sh --upload   # archive + upload to App Store Connect
#
# Uploading puts the build into App Store Connect (TestFlight processing). It
# does NOT submit for review — that stays a manual step in App Store Connect.
#
# Signing: the export re-signs for App Store distribution with automatic
# signing (-allowProvisioningUpdates), which needs ONE of:
#   - an Apple ID signed into Xcode (Settings → Accounts) for team 64G8P2LG44, or
#   - an App Store Connect API key, via the environment:
#       ASC_KEY_PATH=/path/AuthKey_XXXX.p8 ASC_KEY_ID=XXXX ASC_ISSUER_ID=uuid
# Without either, xcodebuild stops with "No Accounts" / "No profiles for
# 'org.devicemanager.mdviewer' were found" — that is the expected failure.
#
# Before every upload, bump bundle.iOS.bundleVersion in src-tauri/tauri.conf.json:
# App Store Connect rejects a build number it has already seen for a version.
#
set -euo pipefail

UPLOAD=false
[[ "${1:-}" == "--upload" ]] && UPLOAD=true

TEAM_ID="${TEAM_ID:-64G8P2LG44}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GEN_APPLE="$REPO_ROOT/src-tauri/gen/apple"
ARCHIVE="$GEN_APPLE/build/mdviewer_iOS.xcarchive"
APP="$ARCHIVE/Products/Applications/MDViewer.app"
EXPORT_DIR="$GEN_APPLE/build/export-appstore"
EXPORT_OPTIONS="$GEN_APPLE/build/ExportOptions-AppStore.plist"

# Rust/iOS builds need rustup's cargo, not Homebrew's (file-browser-plan.md §5).
export PATH="$HOME/.cargo/bin:$PATH"

AUTH_ARGS=()
if [[ -n "${ASC_KEY_PATH:-}${ASC_KEY_ID:-}${ASC_ISSUER_ID:-}" ]]; then
    : "${ASC_KEY_PATH:?set all three of ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID}"
    : "${ASC_KEY_ID:?set all three of ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID}"
    : "${ASC_ISSUER_ID:?set all three of ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID}"
    AUTH_ARGS=(-authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi

echo "==> Configuring the generated iOS project…"
"$REPO_ROOT/configure-ios-project.sh"

echo "==> Archiving (release)…"
rm -rf "$ARCHIVE"
(cd "$REPO_ROOT" && npm run tauri ios build -- --target aarch64 --archive-only)

echo "==> Checking the archived bundle…"
plist() { /usr/libexec/PlistBuddy -c "Print :$1" "$APP/Info.plist"; }
fail() { echo "error: $1" >&2; exit 1; }
[[ -f "$APP/PrivacyInfo.xcprivacy" ]] || fail "PrivacyInfo.xcprivacy missing from the bundle root"
[[ "$(plist UIDeviceFamily | tr -d ' \n')" == "Array{1}" ]] || fail "UIDeviceFamily is not iPhone-only"
[[ "$(plist ITSAppUsesNonExemptEncryption)" == "false" ]] || fail "ITSAppUsesNonExemptEncryption not set"
echo "    version $(plist CFBundleShortVersionString) (build $(plist CFBundleVersion)), iPhone only, privacy manifest present"

DESTINATION=export
$UPLOAD && DESTINATION=upload
cat > "$EXPORT_OPTIONS" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store-connect</string>
    <key>teamID</key>
    <string>$TEAM_ID</string>
    <key>signingStyle</key>
    <string>automatic</string>
    <key>uploadSymbols</key>
    <true/>
    <key>destination</key>
    <string>$DESTINATION</string>
</dict>
</plist>
PLIST

echo "==> Exporting for App Store Connect (destination: $DESTINATION)…"
rm -rf "$EXPORT_DIR"
xcodebuild -exportArchive \
    -archivePath "$ARCHIVE" \
    -exportPath "$EXPORT_DIR" \
    -exportOptionsPlist "$EXPORT_OPTIONS" \
    -allowProvisioningUpdates \
    ${AUTH_ARGS[@]+"${AUTH_ARGS[@]}"}  # bash 3.2-safe empty-array expansion

echo
if $UPLOAD; then
    echo "Uploaded. It appears in App Store Connect → TestFlight once processing"
    echo "finishes; attach it to the iOS version there and submit for review."
else
    echo "Done. IPA: ${EXPORT_DIR#"$REPO_ROOT"/}/MDViewer.ipa"
    echo "Upload with './build-appstore-ios.sh --upload', Transporter, or Xcode Organizer."
fi
