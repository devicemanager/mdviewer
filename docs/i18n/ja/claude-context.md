# MDViewer Project Instructions

## Release Process

**必須**: リリース前に必ず公証付きビルドを実行すること。

```bash
./build-notarize.sh
```

このスクリプトがビルド・署名・公証・staple・zip作成をすべて行う。
生成された `build/MDViewer.zip`（staple済み）をGitHub Releaseにアップロードしてからリリースすること。

### 手順

1. `./build-notarize.sh` を実行
2. 成功したら `build/MDViewer.zip` が生成される
3. `gh release create vX.X.X build/MDViewer.zip ...` でリリース作成
4. zipなしのリリースは不可

### アプリパスワード・公証の設定

認証情報はリポジトリには保存しない。`build-notarize.sh` は Apple ID と Team ID を
環境変数から読み取り、Keychain に保存した公証プロファイルを使用する。

- ビルド前に環境変数 `APPLE_ID` と `TEAM_ID` を設定すること。
- Keychainプロファイル名: `notarytool` — 初回のみ
  `xcrun notarytool store-credentials "notarytool"` で作成する
  （app固有パスワードをKeychainに保存。パスワードを再生成した場合は再実行して更新）。
