# Changelog

All notable changes to Shortcut Tutor are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
