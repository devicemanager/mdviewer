#!/usr/bin/env bash
#
# configure-ios-project.sh — Reapply the hand-edits to the generated iOS project.
#
# `src-tauri/gen/` is gitignored (it is generated output), but three things in
# there are NOT reproducible from tracked config, and losing them fails in
# confusing ways:
#
#   1. LSSupportsOpeningDocumentsInPlace in Info.plist
#      Without it the app builds and installs fine but never appears in the
#      Files app's long-press menu for a .md file — nothing errors, the app is
#      simply absent from the list. This key is about whether iOS may hand the
#      app a live reference to a document still sitting in Files/iCloud Drive,
#      as opposed to only ever a copy; it is not about editing.
#
#   2. Manual code-signing settings in project.pbxproj
#      Tauri scaffolds automatic signing with an "iPhone Developer" identity.
#      Ad-hoc distribution needs manual signing against the Apple Distribution
#      certificate the provisioning profile actually embeds, or the build fails
#      with "doesn't include signing certificate".
#
#   3. ExportOptions-AdHoc.plist
#      Tauri does not generate an ad-hoc/manual-signing export options file, so
#      `xcodebuild -exportArchive` has nothing to work from.
#
#   4. Minimum iOS deployment target (15.0, not the scaffolded 14.0)
#      Xcode 27 refuses IPHONEOS_DEPLOYMENT_TARGET = 14.0 — a fresh `tauri
#      ios init` scaffolds 14.0 into project.yml/Podfile and the very first
#      device archive fails before compiling anything. Patched here in all
#      three places the minimum version is declared (project.yml, which
#      xcodegen regenerates the .xcodeproj from; the .pbxproj itself; and
#      the Podfile's `platform :ios` line, when one exists).
#
# Run this once after `tauri ios init`, and again any time the generated
# project is recreated. Idempotent — safe to re-run at any point.
#
# The file-association entries (CFBundleDocumentTypes, UTExportedTypeDeclarations)
# are deliberately NOT handled here: those ARE generated, from
# src-tauri/tauri.conf.json's bundle.fileAssociations, and hand-writing them
# produces duplicates.
#
# Config comes from the environment so a different developer/team can use this
# without editing the script; the defaults are this repo's own values.
#
set -euo pipefail

# ---- Config ---------------------------------------------------------------
TEAM_ID="${TEAM_ID:-64G8P2LG44}"
BUNDLE_ID="${BUNDLE_ID:-org.devicemanager.mdviewer}"
# The provisioning profile's *name*, which for this project matches the bundle
# id. Set PROVISIONING_PROFILE explicitly if yours is named differently.
PROVISIONING_PROFILE="${PROVISIONING_PROFILE:-$BUNDLE_ID}"
SIGN_IDENTITY="${SIGN_IDENTITY:-Apple Distribution}"
# Xcode 27 dropped support for building with a 14.0 minimum (see item 4 in
# the header); 15.0 is the value verified working with a real device archive.
IOS_DEPLOYMENT_TARGET="${IOS_DEPLOYMENT_TARGET:-15.0}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GEN_APPLE="$REPO_ROOT/src-tauri/gen/apple"
INFO_PLIST="$GEN_APPLE/mdviewer_iOS/Info.plist"
PBXPROJ="$GEN_APPLE/mdviewer.xcodeproj/project.pbxproj"
EXPORT_OPTIONS="$GEN_APPLE/build/ExportOptions-AdHoc.plist"
PROJECT_YML="$GEN_APPLE/project.yml"
PODFILE="$GEN_APPLE/Podfile"

# ---- Preflight ------------------------------------------------------------
if [[ ! -d "$GEN_APPLE" ]]; then
    echo "error: $GEN_APPLE does not exist." >&2
    echo "       Run 'npm run tauri ios init' first, then re-run this script." >&2
    exit 1
fi
for f in "$INFO_PLIST" "$PBXPROJ"; do
    if [[ ! -f "$f" ]]; then
        echo "error: expected generated file is missing: $f" >&2
        echo "       The generated project looks incomplete; try 'tauri ios init' again." >&2
        exit 1
    fi
done

# ---- 1. Info.plist --------------------------------------------------------
# PlistBuddy's Add fails if the key exists and Set fails if it doesn't, so try
# Set first and fall back to Add. That makes this idempotent either way.
if /usr/libexec/PlistBuddy -c "Set :LSSupportsOpeningDocumentsInPlace true" "$INFO_PLIST" 2>/dev/null; then
    echo "Info.plist: LSSupportsOpeningDocumentsInPlace already present, ensured true"
else
    /usr/libexec/PlistBuddy -c "Add :LSSupportsOpeningDocumentsInPlace bool true" "$INFO_PLIST"
    echo "Info.plist: added LSSupportsOpeningDocumentsInPlace"
fi
plutil -lint "$INFO_PLIST" >/dev/null

# ---- 2. Code signing ------------------------------------------------------
# Tauri emits CODE_SIGN_IDENTITY in each XCBuildConfiguration block but none of
# the manual-signing keys. Rewrite the identity, then insert the other three
# immediately after it if they are not already there.
if grep -q "CODE_SIGN_STYLE = Manual;" "$PBXPROJ"; then
    echo "project.pbxproj: manual signing already configured, leaving as is"
else
    # Match whatever identity is currently there (a fresh scaffold uses
    # "iPhone Developer") rather than assuming one specific value.
    python3 - "$PBXPROJ" "$SIGN_IDENTITY" "$TEAM_ID" "$PROVISIONING_PROFILE" <<'PY'
import re
import sys

path, identity, team, profile = sys.argv[1:5]
with open(path) as f:
    contents = f.read()

replacement = (
    f'CODE_SIGN_IDENTITY = "{identity}";\n'
    f'\t\t\t\tCODE_SIGN_STYLE = Manual;\n'
    f'\t\t\t\tDEVELOPMENT_TEAM = {team};\n'
    f'\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "{profile}";'
)
contents, count = re.subn(r'CODE_SIGN_IDENTITY = "[^"]*";', replacement, contents)
if count == 0:
    sys.exit("error: found no CODE_SIGN_IDENTITY entries to rewrite in project.pbxproj")

with open(path, "w") as f:
    f.write(contents)
print(f"project.pbxproj: configured manual signing in {count} build configuration(s)")
PY
fi

# ---- 3. Export options ----------------------------------------------------
mkdir -p "$(dirname "$EXPORT_OPTIONS")"
cat > "$EXPORT_OPTIONS" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>ad-hoc</string>
    <key>teamID</key>
    <string>$TEAM_ID</string>
    <key>signingStyle</key>
    <string>manual</string>
    <key>signingCertificate</key>
    <string>$SIGN_IDENTITY</string>
    <key>provisioningProfiles</key>
    <dict>
        <key>$BUNDLE_ID</key>
        <string>$PROVISIONING_PROFILE</string>
    </dict>
    <key>compileBitcode</key>
    <false/>
</dict>
</plist>
PLIST
plutil -lint "$EXPORT_OPTIONS" >/dev/null
echo "ExportOptions-AdHoc.plist: written to ${EXPORT_OPTIONS#"$REPO_ROOT"/}"

# ---- 4. Minimum iOS deployment target ------------------------------------
# Xcode 27 refuses a 14.0 minimum outright, and the failure surfaces as an
# opaque build misconfiguration rather than a clear "raise your deployment
# target" message — easy to re-derive the hard way, which is why it lives
# here. A fresh `tauri ios init` scaffolds 14.0, so reapply the target
# everywhere the minimum version is declared. Idempotent: values already
# equal to the target are left untouched.
if [[ -f "$PROJECT_YML" ]]; then
    if grep -Eq "^[[:space:]]*iOS: $IOS_DEPLOYMENT_TARGET\$" "$PROJECT_YML"; then
        echo "project.yml: iOS deployment target already $IOS_DEPLOYMENT_TARGET"
    elif grep -Eq "^[[:space:]]*iOS: [0-9]+\.[0-9]+" "$PROJECT_YML"; then
        sed -i '' -E "s/^([[:space:]]*iOS: )[0-9]+\.[0-9]+.*$/\1$IOS_DEPLOYMENT_TARGET/" "$PROJECT_YML"
        echo "project.yml: iOS deployment target set to $IOS_DEPLOYMENT_TARGET"
    else
        echo "project.yml: no deploymentTarget iOS key found — raise it manually" >&2
    fi
fi
if grep -q "IPHONEOS_DEPLOYMENT_TARGET" "$PBXPROJ"; then
    if grep -q "IPHONEOS_DEPLOYMENT_TARGET = $IOS_DEPLOYMENT_TARGET;" "$PBXPROJ"; then
        echo "project.pbxproj: IPHONEOS_DEPLOYMENT_TARGET already $IOS_DEPLOYMENT_TARGET"
    else
        sed -i '' "s/IPHONEOS_DEPLOYMENT_TARGET = [0-9.]*;/IPHONEOS_DEPLOYMENT_TARGET = $IOS_DEPLOYMENT_TARGET;/g" "$PBXPROJ"
        echo "project.pbxproj: IPHONEOS_DEPLOYMENT_TARGET set to $IOS_DEPLOYMENT_TARGET"
    fi
fi
if [[ -f "$PODFILE" ]]; then
    if grep -Eq "^[#[:space:]]*platform :ios, '$IOS_DEPLOYMENT_TARGET'" "$PODFILE"; then
        echo "Podfile: platform :ios already $IOS_DEPLOYMENT_TARGET (or commented)"
    elif grep -Eq "^[#[:space:]]*platform :ios, '" "$PODFILE"; then
        sed -i '' -E "s/^([#[:space:]]*platform :ios, ')[0-9.]*'/\1$IOS_DEPLOYMENT_TARGET'/" "$PODFILE"
        echo "Podfile: platform :ios set to $IOS_DEPLOYMENT_TARGET"
    else
        echo "Podfile: no platform :ios line found — leaving as is (CocoaPods default)"
    fi
fi

echo
echo "iOS project configured. Build an ad-hoc IPA with:"
echo "  npm run tauri ios build -- --debug --target aarch64 --archive-only"
echo "  xcodebuild -exportArchive \\"
echo "    -archivePath src-tauri/gen/apple/build/mdviewer_iOS.xcarchive \\"
echo "    -exportPath src-tauri/gen/apple/build/export-adhoc \\"
echo "    -exportOptionsPlist src-tauri/gen/apple/build/ExportOptions-AdHoc.plist"
