# Changelog

All notable changes to Shortcut Tutor are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.2] – 2026-10-18

### Added

- Above **Learned**, a collapsible section for each chosen learning focus area lists all of its shortcuts; learned ones are dimmed and can be undone there.
- **★** in these sections boosts a single shortcut so it ranks higher in **Useful Now**. Boosted shortcuts are listed under the new reason **Boosted by you** in the Reasons editor, where their bonus can be changed.
- **Search** field at the top of the view: finds shortcuts by name, command id or key (e.g. `ctrl+k`) across all shortcuts, regardless of the current situation. Results can be marked as learned, boosted or edited; `Esc` clears the search.
- **Filter by shortcut**: with **⌨** next to the search field, pressing keys shows what they do, followed by shortcuts that need more keys: additional modifiers (`Ctrl+K` also lists `Ctrl+Shift+K`) or further chords (`Ctrl+K Ctrl+S`). Filters live while keys are held: holding `Ctrl` lists all `Ctrl` shortcuts, adding `Shift` narrows them. `Esc` clears the recorded keys, a second `Esc` ends recording.
- Hovering a shortcut's title also shows the **when** clause of its bindings.

## [0.1.1] – 2026-10-18

### Added

- `Ctrl+Alt+Shift+K` / **Shortcut Tutor: Toggle Useful Shortcuts View** shows or hides the view.

## [0.1.0] – 2026-10-18

First release.

### Added

- **Useful Now** view in the Activity Bar: a ranked list of the shortcuts most worth learning in the current situation, each with its key combinations and the reasons it is listed.
- Ranking from curated base importance (“Essentials”), the current situation (selection, multiple cursors, debugging, diff editor, language, file type, notebook, unsaved changes, problems in the file, long file, many open editors, open terminal) and detected workflows.
- Evaluation of `when` clauses against the current context; shortcuts that cannot apply right now are left out.
- **Learning focus**: choose areas (Editing, Navigation, Code Intelligence, Search, Files & Explorer, Editors & Layout, Terminal, Debugging, Source Control, Notebooks, Chat & AI, Window & Settings) whose shortcuts get a bonus.
- **Tips** for slow workflows: duplicating or moving lines via the clipboard, commenting by hand, long arrow-key runs, deleting character by character, mouse selection of lines or all text, mouse multi-cursor, opening many files, switching back and forth between two files. Shown as a card in the view and optionally as a notification.
- **Got it** to mark shortcuts as learned, with a **Learned** section to undo; synced via Settings Sync.
- **✎** button to open the Keyboard Shortcuts editor filtered to a command.
- **Edit Reasons** editor with navigation to turn reasons on or off and change their text, bonus, thresholds, commands and the base importance list; stored as differences in `shortcutTutor.reasons`.
- `shortcutTutor.keyboardLayout` setting to label keys that VS Code defines by physical position (e.g. `[Equal]`), with automatic detection from the system locale.
- `shortcutTutor.notifications` setting to turn tip notifications off.
- Responsive layout: reasons and keys wrap onto a second line in narrow sidebars.
- Extension icon and MIT license.
