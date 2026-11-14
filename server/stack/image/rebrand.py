#!/usr/bin/env python3
"""Put our own name and icon on the stock Vaultwarden web vault and templates.

Runs inside the image build (see Dockerfile). Every rule says how many matches
it expects: when a new upstream version moves things around, the build stops
with a clear message instead of quietly shipping the old branding.
"""
import argparse
import hashlib
import html
import json
import math
import re
import shutil
import struct
import subprocess
import sys
import tarfile
import urllib.parse
from pathlib import Path

FAILS = []
NOTES = []

INK = "#17202A"        # wordmark colour on light backgrounds
UPSTREAM = re.compile(r"Vaultwarden|Bitwarden")


def fail(msg):
    FAILS.append(msg)


def note(msg):
    NOTES.append(msg)


def load_env(path):
    env = {}
    for line in Path(path).read_text(encoding="utf8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        quoted = re.match(r'^"([^"]*)"|^\'([^\']*)\'', value)
        if quoted:
            value = quoted.group(1) if quoted.group(1) is not None else quoted.group(2)
        else:
            value = value.split("#", 1)[0].strip()
        env[key.strip()] = value
    return env


def sub(text, pattern, repl, name, minimum=1, regex=False):
    """Replace and record the match count; fewer than `minimum` is a build failure."""
    if regex:
        new, count = re.subn(pattern, lambda _m: repl, text)
    else:
        count = text.count(pattern)
        new = text.replace(pattern, repl)
    if count < minimum:
        fail(f"{name}: expected at least {minimum} match(es), found {count}")
    note(f"{name}: {count}")
    return new


# ---------------------------------------------------------------- artwork

def find_font():
    for pattern in ("InterVariable.ttf", "Inter-SemiBold.otf", "Inter*.ttf", "Inter*.otf"):
        hits = sorted(Path("/usr/share/fonts").rglob(pattern))
        if hits:
            return hits[0]
    raise SystemExit("rebrand: no Inter font found (apk add font-inter)")


def wordmark(text, weight=650):
    """The name as outlines, so it looks the same on every device.

    Returns path data in font units, baseline at y=0, y pointing down."""
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.ttLib import TTFont

    font = TTFont(str(find_font()))
    glyphs = font.getGlyphSet(location={"wght": weight}) if "fvar" in font else font.getGlyphSet()
    cmap = font.getBestCmap()
    cap = getattr(font["OS/2"], "sCapHeight", 0) or int(font["head"].unitsPerEm * 0.72)
    x = 0
    parts = []
    for char in text:
        glyph = glyphs[cmap.get(ord(char), ".notdef")]
        pen = SVGPathPen(glyphs, ntos=lambda v: ("%.1f" % v).rstrip("0").rstrip("."))
        glyph.draw(TransformPen(pen, (1, 0, 0, -1, x, 0)))
        if pen.getCommands():
            parts.append(pen.getCommands())
        x += glyph.width
    return {"d": "".join(parts), "width": x, "cap": cap}


def read_mark(path):
    """Path elements of the one-colour mark (viewBox 0 0 64 64)."""
    text = Path(path).read_text(encoding="utf8")
    paths = []
    for tag in re.findall(r"<path\b[^>]*>", text):
        d = re.search(r'\bd="([^"]+)"', tag)
        if d:
            paths.append((d.group(1), 'fill-rule="evenodd"' in tag))
    if not paths:
        raise SystemExit("rebrand: mark.svg has no <path d=...>")
    return paths


class Art:
    def __init__(self, name, mark_paths):
        self.mark = mark_paths
        self.word = wordmark(name)

    def _paths(self, paths_attr):
        out = []
        for d, evenodd in self.mark:
            rule = ' fill-rule="evenodd" clip-rule="evenodd"' if evenodd else ""
            out.append(f'<path {paths_attr}{rule} d="{d}"/>')
        return "".join(out)

    def mark_inner(self, box_w, box_h, attr):
        """The mark alone, centred in a box."""
        size = min(box_w, box_h)
        scale = size / 64
        tx = (box_w - size) / 2
        ty = (box_h - size) / 2
        return f'<g transform="translate({tx:.2f} {ty:.2f}) scale({scale:.4f})">{self._paths(attr)}</g>'

    def logo_inner(self, box_w, box_h, mark_attr, text_attr):
        """Mark + name on one line, left aligned, fitted into a box."""
        mark_size = box_h * 0.8
        cap_px = box_h * 0.44
        gap = box_h * 0.22
        text_scale = cap_px / self.word["cap"]
        text_w = self.word["width"] * text_scale
        total = mark_size + gap + text_w
        fit = min(1.0, box_w / total)
        mark_scale = mark_size / 64
        top = (box_h - mark_size) / 2
        baseline = box_h / 2 + cap_px / 2
        inner = (
            f'<g transform="translate(0 {top:.2f}) scale({mark_scale:.4f})">{self._paths(mark_attr)}</g>'
            f'<path {text_attr} transform="translate({mark_size + gap:.2f} {baseline:.2f}) scale({text_scale:.5f})" '
            f'd="{self.word["d"]}"/>'
        )
        if fit < 1.0:
            dy = box_h * (1 - fit) / 2
            inner = f'<g transform="translate(0 {dy:.2f}) scale({fit:.4f})">{inner}</g>'
        return inner, min(box_w, total)

    def logo_file(self, title, mark_fill, text_fill):
        inner, width = self.logo_inner(10000, 60, f'fill="{mark_fill}"', f'fill="{text_fill}"')
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width + 2:.0f} 60">'
            f"<title>{html.escape(title)}</title>{inner}</svg>\n"
        )

    def mark_file(self, title, fill):
        attr = 'fill="%s"' % fill
        return (
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
            f"<title>{html.escape(title)}</title>{self._paths(attr)}</svg>\n"
        )


def render_png(svg_path, out_path, width, height=None):
    cmd = ["rsvg-convert", "-w", str(width)]
    if height:
        cmd += ["-h", str(height)]
    subprocess.run(cmd + [str(svg_path), "-o", str(out_path)], check=True)


def write_ico(path, pngs):
    """A .ico that simply wraps PNG images (valid since Windows Vista)."""
    header = struct.pack("<HHH", 0, 1, len(pngs))
    offset = 6 + 16 * len(pngs)
    entries = b""
    blob = b""
    for size, data in pngs:
        entries += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
        blob += data
    Path(path).write_bytes(header + entries + blob)


def make_images(web, brand_dir, env, art, work):
    name = env["BRAND_NAME"]
    colour = env.get("BRAND_COLOR", "#1F6F5C")
    images = web / "images"

    icon_src = work / "icon.svg"
    icon_src.write_text(
        (brand_dir / "icon.svg").read_text(encoding="utf8").replace("{{BRAND_COLOR}}", colour), encoding="utf8"
    )
    (images / "logo.svg").write_text(art.logo_file(name, colour, INK), encoding="utf8")
    (images / "logo-white.svg").write_text(art.logo_file(name, "#fff", "#fff"), encoding="utf8")
    (images / "icon-white.svg").write_text(art.mark_file(name, "#fff"), encoding="utf8")
    mark_dark = work / "mark-dark.svg"
    mark_dark.write_text(art.mark_file(name, INK), encoding="utf8")
    pinned = art.mark_file(name, "#000")
    for target in (images / "safari-pinned-tab.svg", images / "icons" / "safari-pinned-tab.svg"):
        if target.exists():
            target.write_text(pinned, encoding="utf8")

    render_png(images / "logo.svg", images / "logo-dark@2x.png", 568)
    render_png(images / "logo-white.svg", images / "logo-white@2x.png", 568)
    render_png(mark_dark, images / "icon-dark.png", 32, 32)
    render_png(images / "icon-white.svg", images / "icon-white.png", 32, 32)

    sizes = {
        "android-chrome-192x192.png": 192,
        "android-chrome-512x512.png": 512,
        "apple-touch-icon.png": 180,
        "favicon-16x16.png": 16,
        "favicon-32x32.png": 32,
        "mstile-150x150.png": 270,
    }
    for filename, size in sizes.items():
        for folder in (images, images / "icons"):
            if (folder / filename).exists():
                render_png(icon_src, folder / filename, size, size)
    ico = []
    for size in (16, 32, 48):
        tmp = work / f"ico-{size}.png"
        render_png(icon_src, tmp, size, size)
        ico.append((size, tmp.read_bytes()))
    write_ico(web / "favicon.ico", ico)
    note("images: logos, icons and favicon regenerated")


# ---------------------------------------------------------------- colours

def _to_linear(value):
    value /= 255
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def _from_linear(value):
    value = min(1.0, max(0.0, value))
    value = 12.92 * value if value <= 0.0031308 else 1.055 * value ** (1 / 2.4) - 0.055
    return round(min(1.0, max(0.0, value)) * 255)


def _oklab(rgb):
    r, g, b = (_to_linear(v) for v in rgb)
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    return (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)


def _linear_rgb(L, a, b):
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)


def rehue(rgb, hue):
    """The same colour turned to another hue. Lightness is kept, so text contrast stays as designed."""
    L, a, b = _oklab(rgb)
    chroma = math.hypot(a, b)
    if chroma < 0.004:
        return tuple(rgb)
    linear = (0, 0, 0)
    for step in range(41):
        c = chroma * (1 - step * 0.025)
        linear = _linear_rgb(L, c * math.cos(hue), c * math.sin(hue))
        if all(-0.0005 <= v <= 1.0005 for v in linear):
            break
    return tuple(_from_linear(v) for v in linear)


def hex_rgb(text):
    text = text.strip().lstrip("#")
    if len(text) == 3:
        text = "".join(ch * 2 for ch in text)
    return tuple(int(text[i:i + 2], 16) for i in (0, 2, 4))


def colour_css(web, colour):
    """Turn the stock blue into the brand colour: every blue keeps its lightness and takes our hue."""
    files = sorted(web.glob("styles.*.css"))
    if not files:
        fail("colours: no styles.*.css found")
        return ""
    css = files[0].read_text(encoding="utf8")
    _, a, b = _oklab(hex_rgb(colour))
    hue = math.atan2(b, a)

    palette = []
    for name, value in re.findall(r"(--color-brand-\d+(?:-rgb)?)\s*:\s*([^;}]+)", css):
        value = value.strip()
        if value.startswith("#"):
            palette.append(f"  {name}: #{'%02x%02x%02x' % rehue(hex_rgb(value), hue)};")
        elif re.fullmatch(r"\d+\s*,\s*\d+\s*,\s*\d+", value):
            palette.append(f"  {name}: {', '.join(str(v) for v in rehue(tuple(int(x) for x in value.split(',')), hue))};")
    palette.append(f"  --color-bw-blue: {' '.join(str(v) for v in hex_rgb(colour))};")

    def themed(selector):
        lines = []
        for block in re.findall(re.escape(selector) + r"\s*\{([^}]*)\}", css):
            for name, value in re.findall(r"(--color-primary-\d+)\s*:\s*(\d+ \d+ \d+)\s*;", block):
                lines.append(f"  {name}: {' '.join(str(v) for v in rehue(tuple(int(x) for x in value.split()), hue))};")
        return lines

    light = themed(":root") + themed(".theme_light")
    dark = themed(".theme_dark")
    if len(palette) < 8 or len(light) < 3 or len(dark) < 3:
        fail(f"colours: the stock palette changed shape (ramp {len(palette)}, light {len(light)}, dark {len(dark)})")
    note(f"colours: {len(palette)} ramp steps and {len(light) + len(dark)} theme colours turned to {colour}")
    return (
        "/* Generated from BRAND_COLOR: the stock blues, turned to the brand hue (lightness kept). */\n"
        ":root, .theme_light, .theme_dark {\n" + "\n".join(palette) + "\n}\n"
        ":root, .theme_light {\n" + "\n".join(light) + "\n}\n"
        ".theme_dark {\n" + "\n".join(dark) + "\n}\n"
    )


# ---------------------------------------------------------------- brand kit

def write_kit(kit, brand_dir, env, art, work):
    """The same artwork as plain files, for the phone app and the browser extension."""
    name = env["BRAND_NAME"]
    colour = env.get("BRAND_COLOR", "#1F6F5C")
    kit.mkdir(parents=True, exist_ok=True)
    icon = (brand_dir / "icon.svg").read_text(encoding="utf8").replace("{{BRAND_COLOR}}", colour)
    (kit / "icon.svg").write_text(icon, encoding="utf8")
    (kit / "mark.svg").write_text(art.mark_file(name, "#000"), encoding="utf8")
    glyph = brand_dir / "glyph.svg"
    if glyph.exists():
        shutil.copyfile(glyph, kit / "glyph.svg")
    word = art.word
    scale = 26 / word["cap"]
    width = word["width"] * scale
    (kit / "wordmark.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.1f} 34"><title>{html.escape(name)}</title>'
        f'<path fill="#000" transform="translate(0 30) scale({scale:.5f})" d="{word["d"]}"/></svg>\n', encoding="utf8")
    (kit / "logo.svg").write_text(art.logo_file(name, colour, INK), encoding="utf8")
    (kit / "logo-white.svg").write_text(art.logo_file(name, "#fff", "#fff"), encoding="utf8")
    for size in (48, 96, 192, 256, 512, 1024):
        render_png(kit / "icon.svg", kit / f"icon-{size}.png", size, size)
    render_png(kit / "logo.svg", kit / "logo.png", 900)
    (kit / "brand.json").write_text(json.dumps({
        "name": name,
        "tagline": env.get("BRAND_TAGLINE", ""),
        "colour": colour,
        "ink": INK,
        "wordmark_font": "Inter, weight 650, converted to outlines",
        "status": "placeholder artwork until the owner approves or replaces it",
        "source": "server/stack/image (brand.env, icon.svg, mark.svg, glyph.svg)",
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf8")


# ---------------------------------------------------------------- web vault

def js_text(value):
    """Safe inside a double-quoted JS string."""
    return json.dumps(value, ensure_ascii=False)[1:-1]


def tpl_text(value):
    """Safe inside a JS template literal that holds SVG markup."""
    return html.escape(value).replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")


def replace_brand_svgs(js, art, name, colour):
    """Swap every inline SVG that is an upstream logo.

    A logo is recognised by its <title>, by the navigation-logo colour class, or by being the
    small blue app icon. Everything else (illustrations, third-party logos) is left alone and listed."""
    out = []
    pos = 0
    swapped = []
    kept = []
    for match in re.finditer(r"<svg\b[^>]*>", js):
        if match.start() < pos:
            continue
        end = js.find("</svg>", match.end())
        if end < 0:
            continue
        body = js[match.start():end + 6]
        box = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', match.group(0))
        if not box:
            continue
        box_w, box_h = float(box.group(1)), float(box.group(2))
        size = f"{box_w:g}x{box_h:g}"
        title = re.search(r"<title>([^<]*)</title>", body)
        titled = bool(title and UPSTREAM.search(title.group(1)))
        nav_logo = "tw-fill-fg-nav" in body
        app_icon = "tw-fill-bw-blue" in body and box_w == box_h and box_w <= 32
        if not (titled or nav_logo or app_icon):
            kept.append(size)
            continue
        css_class = re.search(r'<path\b[^>]*\bclass="([^"]+)"', body)
        if app_icon:
            attr = f'fill="{colour}"'
        elif css_class:
            attr = f'class="{css_class.group(1)}"'
        else:
            attr = 'fill="currentColor"'
        if box_w < box_h * 1.5:
            inner = art.mark_inner(box_w, box_h, attr)
        else:
            inner, _ = art.logo_inner(box_w, box_h, attr, attr)
        out.append(js[pos:match.start()])
        out.append(f"{match.group(0)}<title>{tpl_text(name)}</title>{inner}</svg>")
        pos = end + 6
        swapped.append(size)
    out.append(js[pos:])
    if len(swapped) < 5:
        fail(f"inline logos: expected at least 5, found {len(swapped)} ({', '.join(swapped)})")
    note(f"inline logos replaced: {', '.join(swapped)}")
    note(f"other inline graphics left alone (worth a look after an upstream update): {', '.join(kept)}")
    return "".join(out)


def patch_main_js(web, art, name, about_url, env):
    files = sorted((web / "app").glob("main.*.js"))
    if len(files) != 1:
        fail(f"expected one app/main.*.js, found {len(files)}")
        return
    path = files[0]
    js = path.read_text(encoding="utf8")
    brand = js_text(name)
    quoted = urllib.parse.quote(name, safe="")

    js = replace_brand_svgs(js, art, name, env.get("BRAND_COLOR", "#1F6F5C"))
    js = sub(js, '"Vaultwarden Web"', f'"{brand}"', "page title and footer name", 3)
    js = sub(js, '"alt","Vaultwarden"', f'"alt","{brand}"', "logo alt text (new)", 1)
    js = sub(js, '"alt","Bitwarden"', f'"alt","{brand}"', "logo alt text (old)", 0)
    js = sub(js, "otpauth://totp/Vaultwarden:", f"otpauth://totp/{quoted}:", "authenticator QR label", 1)
    js = sub(js, "&issuer=Vaultwarden", f"&issuer={quoted}", "authenticator QR issuer", 1)
    js = sub(js, r'"[^"]*Bitwarden® Web Vault[^"]*"', '" Self-hosted, built on open-source software."',
             "footer line 1", 1, regex=True)
    js = sub(js, r'"[^"]*not associated with the Bitwarden®[^"]*"',
             f'" Licences and source: {js_text(about_url)} "', "footer line 2", 1, regex=True)
    js = sub(js, '"https://github.com/dani-garcia/vaultwarden"', f'"{js_text(about_url)}"', "help menu link", 1)
    js = sub(js, '"Bitwarden Authenticator"', f'"{js_text(env["AUTHENTICATOR_APP"])}"', "authenticator app hint", 0)
    js = sub(js, '"https://bitwarden.com/products/authenticator/"', f'"{js_text(env["AUTHENTICATOR_URL"])}"',
             "authenticator app link", 0)

    left = sorted(set(re.findall(r".{0,40}Vaultwarden.{0,40}", js)))
    for snippet in left:
        fail(f"'Vaultwarden' still visible in main.js: …{snippet}…")

    digest = hashlib.sha256(js.encode("utf8")).hexdigest()[:10]
    new_name = re.sub(r"\.js$", f".{digest}.js", path.name)
    (path.parent / new_name).write_text(js, encoding="utf8")
    path.unlink()

    index = web / "index.html"
    page = index.read_text(encoding="utf8")
    page = sub(page, f"app/{path.name}", f"app/{new_name}", "index.html script link", 1)
    index.write_text(page, encoding="utf8")
    check = subprocess.run(["node", "--check", str(path.parent / new_name)], capture_output=True, text=True)
    if check.returncode != 0:
        fail("patched main.js no longer parses: " + check.stderr.strip()[:400])
    note(f"main.js -> {new_name}")


def patch_pages(web, name):
    safe = html.escape(name)
    index = web / "index.html"
    page = index.read_text(encoding="utf8")
    page = sub(page, "Vaultwarden Web", safe, "index.html title", 1)
    page = sub(page, "Vaultwarden", safe, "index.html logo alt", 0)
    index.write_text(page, encoding="utf8")

    for path in sorted(web.glob("*.json")):
        text = path.read_text(encoding="utf8")
        if '"Vaultwarden Web"' in text:
            path.write_text(text.replace('"Vaultwarden Web"', json.dumps(name)), encoding="utf8")
            note(f"manifest {path.name}: renamed")

    titles = 0
    for path in sorted(web.glob("*.html")):
        if path.name == "index.html":
            continue
        text = path.read_text(encoding="utf8")
        new = re.sub(r"<title>([^<]*)</title>",
                     lambda m: "<title>" + UPSTREAM.sub(safe, m.group(1)).replace(" Web vault", "") + "</title>", text)
        if path.name == "404.html":
            new = re.sub(r"(>[^<]*)", lambda m: UPSTREAM.sub(safe, m.group(1)), new)
            new = re.sub(r'https://bitwarden\.com/help/?', "about.html", new)
        if new != text:
            path.write_text(new, encoding="utf8")
            titles += 1
    note(f"other pages retitled: {titles}")


def patch_locales(web, name, authenticator):
    files = sorted((web / "locales").glob("*/messages.json"))
    if len(files) < 10:
        fail(f"locales: expected many languages, found {len(files)}")
    changed = 0
    for path in files:
        data = json.loads(path.read_text(encoding="utf8"))
        for entry in data.values():
            message = entry.get("message") if isinstance(entry, dict) else None
            if isinstance(message, str) and "Bitwarden" in message:
                entry["message"] = message.replace("Bitwarden Authenticator", authenticator).replace("Bitwarden", name)
                changed += 1
        path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf8")
    if changed < 100:
        fail(f"locales: expected hundreds of strings, changed {changed}")
    note(f"locale strings renamed: {changed} in {len(files)} languages")


def write_about(web, brand_dir, env, vw_version):
    web_version = ""
    for candidate in ("vw-version.json", "version.json"):
        path = web / candidate
        if path.exists():
            try:
                web_version = json.loads(path.read_text(encoding="utf8")).get("version", "")
            except ValueError:
                pass
            if web_version:
                break
    support = env.get("BRAND_SUPPORT", "")
    if support:
        href = support if "://" in support else "mailto:" + support
        support = f'<p>Contact: <a href="{html.escape(href)}">{html.escape(support)}</a></p>'
    source = env.get("BRAND_SOURCE_URL", "")
    source = (f'<a href="{html.escape(source)}">{html.escape(source)}</a>' if source
              else "available from the operator of this server on request")
    text = (brand_dir / "about.html.tmpl").read_text(encoding="utf8")
    for key, value in {
        "{{BRAND_NAME}}": html.escape(env["BRAND_NAME"]),
        "{{BRAND_TAGLINE}}": html.escape(env.get("BRAND_TAGLINE", "")),
        "{{BRAND_COLOR}}": html.escape(env.get("BRAND_COLOR", "#1F6F5C")),
        "{{BRAND_SUPPORT}}": support,
        "{{BRAND_SOURCE}}": source,
        "{{SERVER_VERSION}}": html.escape(vw_version),
        "{{WEB_VERSION}}": html.escape(web_version),
    }.items():
        text = text.replace(key, value)
    (web / "about.html").write_text(text, encoding="utf8")


# ---------------------------------------------------------------- server templates

def patch_templates(source_tar, out, env):
    name = env["BRAND_NAME"]
    safe = html.escape(name)
    colour = env.get("BRAND_COLOR", "#1F6F5C")
    templates = {}
    with tarfile.open(source_tar) as tar:
        for member in tar.getmembers():
            marker = "/src/static/templates/"
            if member.isfile() and marker in member.name and member.name.endswith(".hbs"):
                rel = member.name.split(marker, 1)[1]
                templates[rel] = tar.extractfile(member).read().decode("utf8")
    if len(templates) < 40:
        fail(f"templates: expected the upstream set, found {len(templates)}")

    written = 0
    for rel, text in sorted(templates.items()):
        new = text
        if rel.startswith("email/"):
            is_html = rel.endswith(".html.hbs") or rel in ("email/email_header.hbs", "email/email_footer.hbs")
            label = safe if is_html else name
            if rel == "email/email_header.hbs":
                wordmark_html = (
                    f'<span style="font-family: \'Helvetica Neue\', Helvetica, Arial, sans-serif; font-size: 26px; '
                    f'font-weight: bold; letter-spacing: -0.3px; color: {colour}; line-height: 39px;">{safe}</span>'
                )
                new = sub(new, r'<img src="\{\{img_src\}\}logo-gray\.png"[^>]*>', wordmark_html,
                          "email header logo", 1, regex=True)
            if rel == "email/email_footer.hbs":
                new = sub(new, r'<a href="https://github\.com/dani-garcia/vaultwarden"[^>]*>.*?</a>',
                          f"{safe}", "email footer link", 1, regex=True)
            if rel == "email/email_footer_text.hbs":
                new = sub(new, r"Github: https://github\.com/dani-garcia/vaultwarden", name,
                          "email text footer", 1, regex=True)
            new = new.replace("the vaultwarden server", label).replace("Vaultwarden", label)
        elif rel == "admin/base.hbs":
            new = sub(new, "<title>Vaultwarden Admin Panel</title>", f"<title>{safe} Admin</title>", "admin title", 1)
            new = sub(new, r'<img class="vaultwarden-icon" src="[^"]*" alt="V">aultwarden Admin',
                      f'<img class="vaultwarden-icon" src="{{{{urlpath}}}}/images/apple-touch-icon.png" alt=""> {safe} Admin',
                      "admin navbar", 1, regex=True)
            new = new.replace("{{urlpath}}/vw_static/vaultwarden-favicon.png", "{{urlpath}}/images/favicon-32x32.png")
        elif rel == "404.hbs":
            new = sub(new, r'<img class="vaultwarden-icon" src="[^"]*" alt="V">aultwarden',
                      f'<img class="vaultwarden-icon" src="{{{{urlpath}}}}/images/apple-touch-icon.png" alt=""> {safe}',
                      "404 navbar", 1, regex=True)
            new = new.replace("{{urlpath}}/vw_static/vaultwarden-favicon.png", "{{urlpath}}/images/favicon-32x32.png")
            new = new.replace('href="https://github.com/dani-garcia/vaultwarden"', 'href="{{urlpath}}/about.html"')
            new = re.sub(r"Vaultwarden \(unofficial Bitwarden&reg; server\)", safe, new)
            new = new.replace("Vaultwarden", safe)
        else:
            continue
        if new != text:
            target = out / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(new, encoding="utf8")
            written += 1
            if rel.startswith("email/") and UPSTREAM.search(re.sub(r"https?://\S+", "", new)):
                fail(f"template {rel} still names the upstream products")
    extra_css = Path(args.brand) / "brand.scss"
    styles = env.get("_COLOUR_CSS", "")
    if extra_css.exists():
        styles += "\n" + extra_css.read_text(encoding="utf8")
    if styles.strip():
        target = out / "scss" / "user.vaultwarden.scss.hbs"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(styles, encoding="utf8")
    note(f"server templates written: {written}")


# ---------------------------------------------------------------- main

def main():
    env = load_env(Path(args.brand) / "brand.env")
    name = env.get("BRAND_NAME", "").strip()
    if not name:
        raise SystemExit("rebrand: BRAND_NAME is empty in brand.env")
    if UPSTREAM.search(name) or re.search(r"[<>{}`\\\"]", name):
        raise SystemExit("rebrand: BRAND_NAME must be our own name, without < > { } ` \\ or quotes")

    brand_dir = Path(args.brand)
    out = Path(args.out)
    web = out / "web-vault"
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(args.web_vault, web)
    work = out / ".work"
    work.mkdir()

    for junk in web.rglob("*.map"):
        junk.unlink()

    art = Art(name, read_mark(brand_dir / "mark.svg"))
    make_images(web, brand_dir, env, art, work)
    patch_pages(web, name)
    env.setdefault("AUTHENTICATOR_APP", "Ente Auth")
    env.setdefault("AUTHENTICATOR_URL", "https://ente.io/auth/")
    patch_main_js(web, art, name, "about.html", env)
    patch_locales(web, name, env["AUTHENTICATOR_APP"])
    write_about(web, brand_dir, env, args.vw_version)
    if env.get("RECOLOUR", "yes").lower() in ("yes", "true", "1"):
        env["_COLOUR_CSS"] = colour_css(web, env.get("BRAND_COLOR", "#1F6F5C"))
    patch_templates(args.source, out / "templates", env)
    write_kit(out / "kit", brand_dir, env, art, work)
    shutil.rmtree(work)

    print(f"rebrand: '{name}'")
    for line in NOTES:
        print("  ok   " + line)
    for line in FAILS:
        print("  FAIL " + line)
    if FAILS:
        raise SystemExit(f"rebrand: {len(FAILS)} rule(s) no longer match this upstream version; fix rebrand.py")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--web-vault", required=True)
    parser.add_argument("--source", required=True, help="upstream source tarball of the same version")
    parser.add_argument("--brand", required=True, help="folder with brand.env, icon.svg, mark.svg, about.html.tmpl")
    parser.add_argument("--out", required=True)
    parser.add_argument("--vw-version", default="")
    args = parser.parse_args()
    main()
