#!/usr/bin/env python3
"""Stamp the shared partials around every page in src/pages.

Each page starts with a meta block:

    <!--meta
    title: About Zilal Cooling
    description: One sentence for search results.
    nav: about            # which header link is current
    quote: yes            # append the "Ready to Start Your Project?" band
    body: page-about      # optional body class
    -->

and the rest of the file is the page's <main> content. Output goes to the
repo root (index.html, about.html, …) so GitHub Pages serves it as-is.

Run:  python3 tools/build.py
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
PARTIALS = {p.stem: p.read_text() for p in (SRC / "partials").glob("*.html")}

NAV = [
    ("home", "index.html", "Home"),
    ("about", "about.html", "About Us"),
    ("products", "products.html", "Products"),
    ("solutions", "solutions.html", "Solutions"),
    ("projects", "projects.html", "Projects"),
    ("spare-parts", "spare-parts.html", "Spare Parts"),
    ("blog", "blog.html", "Blogs"),
    ("careers", "careers.html", "Careers"),
]


def parse(text):
    m = re.match(r"\s*<!--meta\n(.*?)\n-->\n", text, re.S)
    meta = {}
    if m:
        for line in m.group(1).splitlines():
            key, _, value = line.partition(":")
            meta[key.strip()] = value.split("#")[0].strip()
        text = text[m.end():]
    return meta, text


def nav_links(current):
    out = []
    for key, href, label in NAV:
        attr = ' aria-current="page"' if key == current else ""
        out.append(f'        <a href="{href}"{attr}>{label}</a>')
    return "\n".join(out)


def asset_version(rel):
    """Cache-busting token so a CSS/JS change reaches returning visitors."""
    return str(int((ROOT / rel).stat().st_mtime))


def stamp_assets(html):
    return re.sub(
        r'(href|src)="(assets/(?:css|js)/[^"?]+)"',
        lambda m: f'{m.group(1)}="{m.group(2)}?v={asset_version(m.group(2))}"',
        html,
    )


def build(page):
    meta, body = parse(page.read_text())
    html = PARTIALS["layout"]
    header = PARTIALS["header"].replace("{{nav}}", nav_links(meta.get("nav", "")))
    quote = PARTIALS["quote"] if meta.get("quote", "yes") == "yes" else ""
    # page-level includes: {{quotation}} etc. pull in src/partials/<name>.html
    body = re.sub(r"\{\{(\w+)\}\}", lambda m: PARTIALS.get(m.group(1), m.group(0)), body)
    html = (html.replace("{{title}}", meta.get("title", "Zilal Cooling"))
                .replace("{{description}}", meta.get("description", ""))
                .replace("{{body_class}}", meta.get("body", ""))
                .replace("{{header}}", header)
                .replace("{{content}}", body.strip("\n"))
                .replace("{{quote}}", quote)
                .replace("{{footer}}", PARTIALS["footer"]))
    out = ROOT / page.name
    out.write_text(stamp_assets(html))
    return out.name


if __name__ == "__main__":
    built = [build(p) for p in sorted((SRC / "pages").glob("*.html"))]
    print("built", len(built), "pages:", ", ".join(built))
