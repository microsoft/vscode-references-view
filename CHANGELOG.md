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
