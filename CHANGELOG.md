### Version 0.0.18
- copy all shouldn't open more than 100 files, #48

### Version 0.0.17
- reveal viewlet when starting search, fixes #47
- focus editor via f4/shift+f4, fixes #44
- better duplicate histry entry prevention, fixes #39
- show a message and history when not having results, fixes #40

### Version 0.0.16
- don't show editor highlights when viewlet not visible
- show history-message only after returning empty from getChildren-call, workaround for #36

### Version 0.0.15
- update screen shot (origin/master, origin/HEAD)
- update vscode.proposed.d.ts
- add dismiss comment to context menu
- add Copy Path command

### Version 0.0.14
- allow to copy one or all references to the clipboard, fixes #26
- align command names
- copy the correct element, copy should include leading/trailing whitespace
- prefetch "next" document when loading/resolve a document

### Version 0.0.13
- use sorter names for refresh and clear commands
- regression - don't show refresh, clear command after clearing

### Version 0.0.12
- show a list of recent searches after clearing results, fixes #23
- add nicer title for command-links #23
- show path with file name, fixes #18
- eng - split extension into separate files as it grows
- eng - make async creation and sync usage clear
- eng - model should emit events onto which the provider listens
- don't restore highlights when a document has changed, mitigation for #32
- make sure to clear editor highlights when clearing results, #32
- await updating context keys

### Version 0.0.11
- show a default message after clearing, fixes #5

### Version 0.0.10
- increate preview portion after matches (origin/master, origin/HEAD)
- add summary message atop the results, #15

### Version 0.0.9
- don't grow editor decorations highlights when typing inside them
- only show editor decorations when references view is visible
- show highlights in overview ruler
- rename viewlet to References, fixes #19
- Rename command to 'Find All References', fixes #16
- only hide viewlet until first interaction, then keep it, fixes #24
- clear and refresh commands should work when having no active editor, fixes #25
- fix editor highlight when refreshing/removing item

### Version 0.0.8
- Initial release
