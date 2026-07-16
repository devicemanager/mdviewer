import SwiftUI

struct PreferencesView: View {
    private enum Tab: String, CaseIterable {
        case general = "General"
        case appearance = "Appearance"
        case privacy = "Privacy"
    }

    @State private var selectedTab: Tab = .general

    var body: some View {
        TabView(selection: $selectedTab) {
            GeneralPrefsView()
                .tabItem { Label("General", systemImage: "gear") }
                .tag(Tab.general)

            AppearancePrefsView()
                .tabItem { Label("Appearance", systemImage: "paintbrush") }
                .tag(Tab.appearance)

            PrivacyPrefsView()
                .tabItem { Label("Privacy", systemImage: "hand.raised") }
                .tag(Tab.privacy)
        }
        .frame(width: 440, height: 340)
        .padding()
    }
}

// MARK: - Remote content policy

/// User policy for loading remote (http/https) resources referenced by a
/// Markdown document — e.g. images hosted on the internet.
enum RemoteContentPolicy: String, CaseIterable, Identifiable {
    /// Block remote content, then ask (once per document) whether to load it.
    case ask
    /// Load remote content without asking.
    case always
    /// Never load remote content and never ask.
    case never

    var id: String { rawValue }

    var label: String {
        switch self {
        case .ask: return "Ask each time"
        case .always: return "Always load"
        case .never: return "Never (block)"
        }
    }

    /// Shared UserDefaults key.
    static let defaultsKey = "remoteContentPolicy"

    /// Effective policy from UserDefaults (defaults to `.ask`).
    static var current: RemoteContentPolicy {
        RemoteContentPolicy(rawValue: UserDefaults.standard.string(forKey: defaultsKey) ?? "") ?? .ask
    }

    /// Whether the CSP served to the WebView may permit remote images.
    /// `.never` hard-blocks at the WebKit level; `.ask`/`.always` permit the
    /// load, with the JS layer still gating `.ask` until the user consents.
    var cspAllowsRemote: Bool { self != .never }
}

// MARK: - Privacy preferences

struct PrivacyPrefsView: View {
    @AppStorage(RemoteContentPolicy.defaultsKey) private var policyRaw: String = RemoteContentPolicy.ask.rawValue

    var body: some View {
        Form {
            Section("Remote Content") {
                Picker("Internet images & resources", selection: $policyRaw) {
                    ForEach(RemoteContentPolicy.allCases) { p in
                        Text(p.label).tag(p.rawValue)
                    }
                }
                Text("Markdown files can reference images hosted online. Loading one reveals your IP address (and that you opened the document) to that server. “Ask” blocks them and prompts you per document; “Never” blocks them silently with no prompts. The Quick Look preview always blocks remote content.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding()
    }
}
