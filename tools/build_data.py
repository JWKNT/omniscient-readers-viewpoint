#!/usr/bin/env python3
"""Build the reader data from the ORV translation project.

The Korean text is private. It goes only to data/source/, which Git ignores.

  python3 tools/build_data.py --korean
      Write the Korean rows for the local side-by-side view.

  python3 tools/build_data.py --english-from-edition DIR --updated 2026-10-24
      Rebuild the public English from a published readers edition.

  python3 tools/build_data.py --english-from-target --updated YYYY-MM-DD
      Rebuild the public English from the translation project.
      Use this only for a new reviewed edition. See data/orv/project.json.
"""
import argparse
import html
import json
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PROJECT = ROOT.parent / "readers/data/orv"
PARAGRAPH = re.compile(r"<p\b([^>]*)>(.*?)</p>", re.S)
PARAGRAPH_ID = re.compile(r'\bid="(p-\d+)"')


class BuildError(ValueError):
    """The project data does not match the expected reader shape."""


def require(condition, message):
    if not condition:
        raise BuildError(message)


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def write_rows(path, head, key, rows):
    """Write one row per line, so a later edition gives a readable diff."""
    body = ",\n".join(compact(row) for row in rows)
    path.write_text(f'{compact(head)[:-1]},"{key}":[\n{body}\n]}}\n', encoding="utf-8")


def project_chapters(project):
    """Return the chapters in reading order, with their aligned source rows."""
    manifest = load(project / "source-manifest.json")
    chapters = []
    for record in manifest["chapters"]:
        source = load(project / "source" / f"{record['id']}.json")
        require(source["sourceHash"] == record["sourceHash"], f"{record['id']}: source hash mismatch")
        ids = [row["id"] for row in source["rows"]]
        require(ids == [f"p-{n:03d}" for n in range(1, len(ids) + 1)], f"{record['id']}: paragraph IDs are not contiguous")
        chapters.append(record | {"rows": source["rows"]})
    return chapters


def edition_text(edition, chapter):
    """Read the paragraph text and title of one chapter from a published edition."""
    published = load(edition / "chapters" / f"{chapter['id']}.json")
    require(published["sourceHash"] == chapter["sourceHash"], f"{chapter['id']}: edition has another source")
    text = {}
    for attributes, inner in PARAGRAPH.findall(published["html"]):
        paragraph = PARAGRAPH_ID.search(attributes)
        if paragraph is None:
            raise BuildError(f"{chapter['id']}: paragraph without an ID")
        inner = re.sub(r"<br\s*/?>", "\n", inner)
        inner = re.sub(r"<[^>]+>", "", inner)
        text[paragraph.group(1)] = html.unescape(inner)
    return published["title"], text


def target_text(project, chapter):
    """Read the paragraph text and title of one chapter from the translation project."""
    target = load(project / "target" / f"{chapter['id']}.json")
    require(target["sourceHash"] == chapter["sourceHash"], f"{chapter['id']}: target has another source")
    return target["title"], {row["id"]: row["text"] for row in target["rows"]}


def public_notes(project):
    """Return the reader notes without the private source evidence."""
    return [{key: value for key, value in note.items() if key != "evidence"}
            for note in load(project / "annotations.json")]


def place_notes(notes, chapters, english):
    """Find the first use of each note, in reading order, within its chapter scope."""
    placed = {}
    for note in notes:
        pattern = re.compile("|".join(re.escape(alias) for alias in note["aliases"]), re.I)
        scope = note.get("includeChapters")
        for chapter in chapters:
            if chapter["kind"] == "reference" or (scope and chapter["id"] not in scope):
                continue
            match = next(((row["id"], found.group(0)) for row in chapter["rows"]
                          if (found := pattern.search(english[chapter["id"]][row["id"]]))), None)
            if match:
                placed[(chapter["id"], match[0])] = {"term": note["id"], "text": match[1]}
                break
        else:
            raise BuildError(f"{note['id']}: no use of this note in the text")
    return placed


def label_for(chapter):
    if chapter["kind"] == "reference" or chapter.get("number") == 0:
        return ""
    prefix = "Epilogue " if chapter["volume"] == "epilogue" else ""
    return f"{prefix}{chapter['number']}"


def build_english(project, read_text, updated, edition_number):
    chapters = project_chapters(project)
    titles, english = {}, {}
    for chapter in chapters:
        titles[chapter["id"]], english[chapter["id"]] = read_text(chapter)
        require(set(english[chapter["id"]]) == {row["id"] for row in chapter["rows"]},
                f"{chapter['id']}: English and source paragraphs differ")
    notes = public_notes(project)
    placed = place_notes(notes, chapters, english)
    dividers = {(entry["chapterId"], entry["paragraphId"])
                for entry in load(project / "graphic-dividers.json")["dividers"]}

    output = ROOT / "data/chapters"
    output.mkdir(parents=True, exist_ok=True)
    for stale in output.glob("*.json"):
        stale.unlink()
    parts, records = [], []
    for chapter in chapters:
        slug = chapter["id"]
        lines = []
        for number, row in enumerate(chapter["rows"], 1):
            line = {"id": f"{slug}:{number}", "i": number}
            if row["type"] == "system":
                line["t"] = "system"
            elif row["type"] == "scene-break":
                line["t"] = "break"
            if (slug, row["id"]) in dividers:
                line["div"] = 1
            if (slug, row["id"]) in placed:
                line["note"] = placed[(slug, row["id"])]
            line["en"] = english[slug][row["id"]]
            lines.append(line)
        # The source has two author's notes, so a part is a run of one source volume.
        if not parts or parts[-1]["volume"] != chapter["volume"]:
            label = titles[slug] if chapter["kind"] == "reference" else chapter["volumeTitle"]
            parts.append({"id": f"part-{len(parts) + 1}", "label": label, "volume": chapter["volume"], "chapters": []})
        parts[-1]["chapters"].append(slug)
        meta = {"slug": slug, "part": parts[-1]["id"], "label": label_for(chapter),
                "title": titles[slug], "lineCount": len(lines)}
        records.append(meta)
        write_rows(output / f"{slug}.json", {key: meta[key] for key in ("slug", "part", "label", "title")}, "lines", lines)
    for part in parts:
        del part["volume"]
    index = {
        "generatedAt": updated,
        "edition": edition_number,
        "chapterCount": len(records),
        "lineCount": sum(record["lineCount"] for record in records),
        "parts": parts,
        "chapters": records,
        "notes": {note["id"]: {key: note[key] for key in ("term", "note", "sources", "sourceLabel") if key in note}
                  for note in notes},
    }
    (ROOT / "data/index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return index


def build_korean(project):
    """Write the Korean rows for local reading. Git ignores this directory."""
    index = load(ROOT / "data/index.json")
    sources = {chapter["id"]: chapter for chapter in project_chapters(project)}
    output = ROOT / "data/source"
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    for meta in index["chapters"]:
        rows = sources[meta["slug"]]["rows"]
        require(len(rows) == meta["lineCount"], f"{meta['slug']}: Korean and English paragraphs differ")
        write_rows(output / f"{meta['slug']}.json", {"slug": meta["slug"]}, "ko", [row["source"] for row in rows])
    (output / "index.json").write_text(compact({"chapters": len(index["chapters"])}) + "\n", encoding="utf-8")
    return len(index["chapters"])


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--project", type=Path, default=DEFAULT_PROJECT, help="translation project directory")
    parser.add_argument("--korean", action="store_true", help="write the Korean rows to data/source/")
    parser.add_argument("--english-from-edition", type=Path, metavar="DIR", help="published readers edition directory")
    parser.add_argument("--english-from-target", action="store_true", help="use the project's current English")
    parser.add_argument("--updated", help="edition date, YYYY-MM-DD")
    args = parser.parse_args()
    if not (args.korean or args.english_from_edition or args.english_from_target):
        parser.error("choose --korean, --english-from-edition or --english-from-target")
    if args.english_from_edition and args.english_from_target:
        parser.error("choose one English source")
    try:
        if args.english_from_edition or args.english_from_target:
            if not args.updated:
                parser.error("an English build needs --updated")
            if args.english_from_edition:
                edition = args.english_from_edition
                number = load(edition / "manifest.json")["editionVersion"]
                reader = lambda chapter: edition_text(edition, chapter)
            else:
                number = None
                reader = lambda chapter: target_text(args.project, chapter)
            index = build_english(args.project, reader, args.updated, number)
            print(f"English: {index['chapterCount']} chapters, {index['lineCount']} paragraphs.")
        if args.korean:
            print(f"Korean: {build_korean(args.project)} chapters in data/source/. Git ignores this directory.")
    except (BuildError, OSError, KeyError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
