# Omniscient Reader’s Viewpoint Reader

A static, searchable reader for the machine-assisted fan translation of the novel by Sing Shong.
It uses the shared reader layout of Black Sheep Town and Albatross Koukairoku.

## Reader features

- An English reader, with search in a chapter or the whole novel, and stable paragraph links.
- A Korean and English side-by-side view, which runs only on a local copy. See below.
- Chapter navigation in reading order: prologue, 99 chapters, author’s note, five epilogues, closing note.
- The reader notes of the translation project, at the first use of each term.
- Responsive layouts, dark mode, and keyboard-accessible controls.

The site is plain HTML, CSS, JavaScript and JSON. GitHub Pages serves it from the root of `main`.

## The Korean text

The Korean text is not in this repository and is not on the public site. The translation project
keeps it private, and it is the complete text of a novel on sale. `.gitignore` excludes `data/source/`,
and the reader does not ask for those files on `jehlp.net`.

To read side by side on your own computer:

```sh
python3 tools/build_data.py --korean
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open <http://127.0.0.1:8000/>. The `KO / EN` and `English reader` controls appear when the
Korean files are present.

## The English text

The public English is edition 42 of the translation project, which Readers published at commit
`d163eeca79877d63aa8fe8c2e9ee3d0f094abf42`. The project is in `../readers/data/orv` and is not in this
repository. It has later English changes that have not passed its release review, so a build must
choose its source:

```sh
python3 tools/build_data.py --english-from-edition DIR --updated 2026-10-24
python3 tools/build_data.py --english-from-target --updated YYYY-MM-DD
```

The first command reads a published edition. The second command reads the current project English.
Use it only for a new reviewed edition, then set the edition number in `data/index.json`.

## Checks

```sh
npm test
```

The tests check the chapter and paragraph counts, the notes, the search and loading behavior,
and that no Korean text is in the public data.

## Disclaimer

This is an unofficial, noncommercial fan project. The English text is a machine-assisted draft and may
change as review continues. Please support the author and buy the official edition.
