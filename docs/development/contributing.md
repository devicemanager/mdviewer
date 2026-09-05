# Contributing to MDViewer

Thank you for your interest in contributing to MDViewer! This guide explains how to get involved.

## Getting Started

1. Fork the repository on GitHub
2. Clone your fork locally
3. Create a new branch for your feature or fix
4. Follow the [Setup Guide](setup.md) to get your environment ready
5. Make your changes
6. Push to your fork and open a pull request

## Before You Start

Check the [existing issues](https://github.com/devicemanager/mdviewer/issues) to see if someone is already working on what you want to do. Feel free to comment on an issue to discuss your approach.

## Types of Contributions

### Bug Reports

Found a bug? Great! Please open an issue with:
- **Steps to reproduce**: Clear, minimal steps to reproduce the issue
- **Expected behavior**: What should happen
- **Actual behavior**: What actually happens
- **Environment**: macOS version, MDViewer version, Xcode version
- **Attachments**: Screenshot or sample `.md` file if helpful

### Feature Requests

Have an idea? Open an issue describing:
- **Problem statement**: What problem does this solve?
- **Proposed solution**: How would you implement it?
- **Alternatives**: Are there other ways to solve this?
- **Use cases**: Who benefits and how?

### Code Contributions

Want to fix a bug or add a feature?

1. **Small changes** (typos, minor fixes):
   - Create a branch directly and submit a PR

2. **Larger features**:
   - Open an issue first to discuss the approach
   - Get feedback before investing time
   - Reference the issue in your PR

## Code Style

- Follow [Apple's Swift API Design Guidelines](https://swift.org/documentation/api-design-guidelines/)
- Use meaningful variable and function names
- Keep functions small and focused
- Add comments for complex logic (not for obvious code)
- Use SwiftUI when possible, AppKit when necessary

### Example

```swift
// Good: Clear, concise, follows conventions
func loadMarkdown(from url: URL) throws -> String {
    let content = try String(contentsOf: url, encoding: .utf8)
    return content
}

// Avoid: Unclear names, over-commented
func load(u: URL) throws -> String { // load from URL
    let x = try String(contentsOf: u, encoding: .utf8)  // read file
    return x  // return content
}
```

## Testing

### Run Tests

```bash
xcodebuild -scheme MDViewer test
```

Or press **⌘U** in Xcode.

### Write Tests

For bug fixes, add a test that fails before your fix and passes after. For features, add tests for the main use cases.

### Manual Testing

Always manually test in the app:
1. Open various `.md` files
2. Test the feature you changed
3. Check that existing features still work
4. Try on different window sizes
5. Test with different themes and font sizes

## Pull Request Process

1. **Branch naming**: Use descriptive names like `fix/search-highlight` or `feature/dark-mode`
2. **Commit messages**: Write clear, concise messages
   ```
   ✓ Good:     Fix search highlight not working with code blocks
   ✗ Avoid:    fix bug, update code, etc.
   ```
3. **PR description**: Include:
   - What problem this solves
   - How you solved it
   - Related issue(s) (use `#123` to link)
   - Testing done
   - Screenshots if applicable

4. **Code review**: Be open to feedback and discussion
   - We're building this together
   - Comments on code aren't personal
   - Ask questions if anything is unclear

5. **Updates**: If changes are requested:
   - Make updates in new commits (don't rebase)
   - Push to your branch
   - Comment when ready for re-review

## Documentation

Documentation is as important as code. If your change affects how users interact with MDViewer:

1. Update relevant docs in `docs/`
2. Update `README.md` if the summary changes
3. Add keyboard shortcuts to `docs/user-guide/keyboard-shortcuts.md`
4. Update `docs/user-guide/features.md` if adding features

For code changes that affect developers:
- Update comments in code
- Update `docs/development/architecture.md` if structure changes
- Update `docs/development/setup.md` if setup process changes

## Repository Structure

```
mdviewer/
├── MDViewer/                    ← App source code
├── MDViewerTests/               ← Unit tests
├── docs/                        ← User & developer documentation
├── web/                         ← Web/cross-platform testing
├── build/                       ← Build artifacts (generated)
├── build-notarize.sh            ← Distribution build script
├── build-appstore.sh            ← App Store build script
├── package-dmg.sh               ← DMG packaging script
├── README.md                    ← User-facing README
└── LICENSE                      ← MIT License
```

## Common Tasks

### Adding a New Theme

1. Create `MDViewer/Resources/Web/themes/my-theme.css`
2. Add theme colors and styles
3. Reference in `Models/MarkdownTheme.swift`
4. Test by selecting in Preferences

### Adding a Keyboard Shortcut

1. Find the appropriate `@main` view or command location
2. Add `.keyboardShortcut("key", modifiers: .command)` modifier
3. Document in `docs/user-guide/keyboard-shortcuts.md`

### Fixing a Rendering Issue

1. Identify if it's a Swift issue (view logic) or JS issue (HTML/CSS)
2. For Swift: Edit `Views/Renderer/MarkdownRenderView.swift`
3. For JS/CSS: Edit `MDViewer/Resources/Web/mdviewer.js` or theme CSS
4. Test with various Markdown samples

## Code Review Checklist

Before submitting a PR, make sure:

- [ ] Code builds without warnings
- [ ] Tests pass (`xcodebuild test`)
- [ ] Manual testing completed
- [ ] No hardcoded values or debug code left
- [ ] Comments are clear and helpful
- [ ] Code follows style guide
- [ ] Documentation is updated
- [ ] Commit messages are clear
- [ ] No unrelated changes in the PR

## Communication

- **Issues**: Use GitHub Issues for bugs and features
- **Discussions**: Use GitHub Discussions for questions
- **Pull Requests**: Keep discussion focused on the code change

Be respectful and constructive. This is a community project.

## Code of Conduct

Be kind. Treat everyone with respect. Discrimination, harassment, or toxicity has no place here.

## Questions?

- Read the [Setup Guide](setup.md)
- Read the [Architecture docs](architecture.md)
- Check [existing issues](https://github.com/devicemanager/mdviewer/issues)
- Open a discussion in [GitHub Discussions](https://github.com/devicemanager/mdviewer/discussions)

---

**Thank you for contributing!** 🎉
