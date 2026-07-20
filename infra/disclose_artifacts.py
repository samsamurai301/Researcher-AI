#!/usr/bin/env python3
"""Apply the AI Scientist license disclosure to generated manuscript sources and PDFs."""

from __future__ import annotations

import argparse
from pathlib import Path


DISCLOSURE = (
    "This manuscript was autonomously generated or produced using The AI Scientist. "
    "Human reviewers remain responsible for verification, attribution, and publication decisions."
)
MARKER = "RESEARCHER_AI_DISCLOSURE_APPLIED"


def add_tex_disclosure(file_path: Path) -> bool:
    text = file_path.read_text(encoding="utf-8", errors="replace")
    if MARKER in text or "This manuscript was autonomously generated" in text:
        return False
    latex = f"\n% {MARKER}\n\\noindent\\textbf{{AI disclosure:}} {DISCLOSURE}\n\n"
    abstract = "\\begin{abstract}"
    if abstract in text:
        text = text.replace(abstract, f"{abstract}{latex}", 1)
    else:
        document = "\\begin{document}"
        text = text.replace(document, f"{document}{latex}", 1) if document in text else f"% {MARKER}\n% {DISCLOSURE}\n{text}"
    file_path.write_text(text, encoding="utf-8")
    return True


def add_pdf_cover(file_path: Path) -> bool:
    import fitz  # PyMuPDF is installed by the upstream requirements.

    source = fitz.open(file_path)
    if source.page_count and MARKER in (source.metadata.get("keywords") or ""):
        source.close()
        return False

    cover = fitz.open()
    page = cover.new_page(width=595, height=842)
    page.insert_text((64, 88), "AI-GENERATION DISCLOSURE", fontsize=18, fontname="helv", color=(0.08, 0.25, 0.18))
    page.insert_textbox(
        fitz.Rect(64, 128, 531, 300),
        DISCLOSURE,
        fontsize=12,
        fontname="helv",
        lineheight=1.35,
        color=(0.12, 0.12, 0.12),
    )
    page.insert_textbox(
        fitz.Rect(64, 330, 531, 520),
        "This disclosure page is part of the manuscript and must not be removed when the work is shared, reviewed, or published.",
        fontsize=10,
        fontname="helv",
        lineheight=1.3,
        color=(0.3, 0.3, 0.3),
    )

    output = fitz.open()
    output.insert_pdf(cover)
    output.insert_pdf(source)
    metadata = dict(source.metadata)
    metadata["keywords"] = ", ".join(filter(None, [metadata.get("keywords"), MARKER]))
    output.set_metadata(metadata)
    temporary = file_path.with_suffix(".disclosed.pdf")
    output.save(temporary, garbage=4, deflate=True)
    output.close()
    cover.close()
    source.close()
    temporary.replace(file_path)
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("artifact_root", type=Path)
    args = parser.parse_args()
    root = args.artifact_root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    (root / "AI_GENERATION_DISCLOSURE.md").write_text(f"# AI-generation disclosure\n\n{DISCLOSURE}\n", encoding="utf-8")

    changed_tex = 0
    changed_pdf = 0
    for file_path in root.rglob("*.tex"):
        if file_path.is_file() and add_tex_disclosure(file_path):
            changed_tex += 1
    for file_path in root.rglob("*.pdf"):
        relative_depth = len(file_path.relative_to(root).parts)
        if file_path.is_file() and relative_depth <= 3 and add_pdf_cover(file_path):
            changed_pdf += 1

    (root / "DISCLOSURE_APPLIED.txt").write_text(
        f"{MARKER}\nTeX files updated: {changed_tex}\nPDF manuscripts updated: {changed_pdf}\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
