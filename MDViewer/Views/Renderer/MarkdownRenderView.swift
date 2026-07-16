import SwiftUI
import WebKit

struct MarkdownRenderView: View {
    @ObservedObject var documentVM: DocumentViewModel
    @ObservedObject var renderVM: RenderViewModel
    @ObservedObject var sidebarVM: SidebarViewModel

    @State private var isSearchVisible: Bool = false
    @State private var searchText: String = ""
    @State private var folderToGrant: URL?

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ZStack(alignment: .top) {
            ZStack(alignment: .bottomLeading) {
                WebRendererView(renderVM: renderVM, sidebarVM: sidebarVM)

                if !renderVM.hoveredURL.isEmpty {
                    Text(renderVM.hoveredURL)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 4))
                        .padding(6)
                        .transition(.opacity)
                }
            }
            .onReceive(documentVM.$text) { newText in
                guard !newText.isEmpty else { return }
                folderToGrant = nil
                if let fileURL = documentVM.fileURL {
                    // Reuse a previously-authorised folder so local images load
                    // without prompting; the banner appears only if a read fails.
                    FolderAccessManager.shared.useAccessIfAvailable(for: fileURL.deletingLastPathComponent())
                    renderVM.setBaseURL(fileURL.deletingLastPathComponent())
                }
                renderVM.renderMarkdown(newText)
                sidebarVM.extractTOC(from: newText)
            }
            .onReceive(NotificationCenter.default.publisher(for: .localResourceAccessDenied)) { note in
                guard let dir = note.object as? URL else { return }
                // Only prompt for the currently-open document's directory.
                if let base = documentVM.fileURL?.deletingLastPathComponent(),
                   dir.standardizedFileURL == base.standardizedFileURL {
                    folderToGrant = dir
                }
            }
            .onChange(of: colorScheme) { _, newScheme in
                renderVM.applySystemAppearance(isDark: newScheme == .dark)
            }

            if let dir = folderToGrant {
                HStack(spacing: 10) {
                    Image(systemName: "photo.badge.exclamationmark")
                        .foregroundStyle(.secondary)
                    Text("This document references local images.")
                        .font(.system(size: 12))
                    Spacer(minLength: 8)
                    Button("Grant Folder Access…") {
                        if FolderAccessManager.shared.requestAccess(to: dir) {
                            folderToGrant = nil
                            renderVM.renderMarkdown(documentVM.text)
                        }
                    }
                    .controlSize(.small)
                    Button {
                        folderToGrant = nil
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(.regularMaterial)
                .transition(.move(edge: .top).combined(with: .opacity))
            }

            if isSearchVisible {
                SearchBarView(
                    searchText: $searchText,
                    isVisible: $isSearchVisible,
                    webView: renderVM.webView
                )
                .transition(.move(edge: .top).combined(with: .opacity))
            }

            if documentVM.isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(NSColor.windowBackgroundColor).opacity(0.7))
            }
        }
        .animation(.easeInOut(duration: 0.15), value: isSearchVisible)
        .animation(.easeInOut(duration: 0.15), value: folderToGrant)
        .onAppear {
            renderVM.applyCurrentThemeAndFontSize()
            if !documentVM.text.isEmpty {
                renderVM.renderMarkdown(documentVM.text)
                sidebarVM.extractTOC(from: documentVM.text)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .showSearchBar)) { _ in
            withAnimation { isSearchVisible = true }
        }
    }
}

extension Notification.Name {
    static let showSearchBar = Notification.Name("MDViewer.showSearchBar")
}
