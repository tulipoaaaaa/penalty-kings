"""B4: builds games/penalty-kings/assets/departure-mono-pk-subset.woff2 (not run in CI; the output is vendored).

Source: Departure Mono v1.500 by Helena Zhang, SIL Open Font License 1.1, no Reserved Font Name
(official release DepartureMono-1.500.zip from github.com/rektdeckard/departure-mono, file
DepartureMono-Regular.woff2, sha256 5b4fed1daa90708a…61038cfb).
Licence: games/penalty-kings/assets/DepartureMono-OFL.txt (the zip's LICENSE); the copyright and licence
name-table entries are kept in the subset.

What it does:
  1. keeps only digits, number punctuation (+ , - . % × −), A–Z and a few heading marks;
  2. tightens the monospaced cell for numbers set inside Pixelify text: digits keep one fixed advance (tabular)
     but the cell goes from 7 to 6 design px (the 5 px glyph centred, half a pixel each side), and . , - : lose
     their wide mono cell, so "500,000 RF" and "31.5%" fit where Pixelify's digits did (the pot banner line
     "block 73,949,883 · ends in …" must not overflow at 960 px).

Usage: pip install fonttools brotli && python3 scripts/font-subset.py DepartureMono-Regular.woff2 out.woff2
"""
import sys
from fontTools.ttLib import TTFont
from fontTools.subset import Subsetter, Options
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.transformPen import TransformPen

UNICODES = [*range(0x20, 0x23), *range(0x25, 0x2A), *range(0x2B, 0x3B), 0x3F, *range(0x41, 0x5B), 0xB7, 0xD7, 0x2212]
PX = 50  # one design pixel (550 units per em, 11 px per em)
# glyph name → (shift left in pixels, new advance in pixels)
DIGIT_ADVANCE = 6
TIGHTEN = {**{name: (0.5, DIGIT_ADVANCE) for name in ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "plus", "multiply", "minus"]},
           "period": (2, 3), "comma": (1, 4), "hyphen": (1, 5), "colon": (2, 3)}

src, out = sys.argv[1], sys.argv[2]
font = TTFont(src)
options = Options(); options.flavor = "woff2"; options.name_IDs = ["*"]; options.name_languages = ["*"]; options.layout_features = []
subsetter = Subsetter(options); subsetter.populate(unicodes=UNICODES); subsetter.subset(font)

cff = font["CFF "].cff; top = cff[cff.fontNames[0]]; strings = top.CharStrings; glyphs = font.getGlyphSet()
for name, (shift, advance) in TIGHTEN.items():
    pen = T2CharStringPen(round(advance * PX), glyphs)
    glyphs[name].draw(TransformPen(pen, (1, 0, 0, 1, -round(shift * PX), 0)))
    charstring = pen.getCharString(private=top.Private, globalSubrs=cff.GlobalSubrs)
    strings[name] = charstring
    lsb = font["hmtx"][name][1] - round(shift * PX)
    font["hmtx"][name] = (round(advance * PX), lsb)
font.save(out)
print(out)
