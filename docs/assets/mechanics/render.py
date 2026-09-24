#!/usr/bin/env python3
"""Render the animated GIFs that explain bridge mechanics.

Each scene is a function of time. Frames are drawn at 2x with Pillow and
encoded to GIF with ffmpeg's palette filters.

    python3 docs/assets/mechanics/render.py            # all scenes
    python3 docs/assets/mechanics/render.py light-client-data-flow

Requires Pillow and ffmpeg. Fonts default to macOS system fonts and fall back
to DejaVu.
"""

from __future__ import annotations

import math
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT_DIR = Path(__file__).resolve().parent
W, H = 1200, 675
S = 2  # supersampling factor
FPS = 15
# Scenes are laid out on a 1200x675 grid. The band above the first row of
# content is cropped from the output.
TOP_CROP = 80

BG = (15, 23, 42)
PANEL = (30, 41, 59)
PANEL_2 = (38, 52, 74)
BORDER = (71, 85, 105)
TEXT = (226, 232, 240)
MUTED = (148, 163, 184)
FAINT = (100, 116, 139)
BLUE = (96, 165, 250)
GREEN = (74, 222, 128)
AMBER = (251, 191, 36)
RED = (248, 113, 113)
TEAL = (45, 212, 191)
PURPLE = (192, 132, 252)
PINK = (244, 114, 182)

FONT_CANDIDATES = {
    "sans": [("/System/Library/Fonts/HelveticaNeue.ttc", 0),
             ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 0)],
    "bold": [("/System/Library/Fonts/HelveticaNeue.ttc", 1),
             ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 0)],
    "mono": [("/System/Library/Fonts/Menlo.ttc", 0),
             ("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 0)],
}
_font_cache: dict = {}


def font(size: float, kind: str = "sans") -> ImageFont.FreeTypeFont:
    key = (kind, size)
    if key not in _font_cache:
        for path, index in FONT_CANDIDATES[kind]:
            if os.path.exists(path):
                _font_cache[key] = ImageFont.truetype(path, int(size * S), index=index)
                break
        else:
            raise SystemExit(f"No {kind} font found")
    return _font_cache[key]


# ---------------------------------------------------------------- timing ---

def clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def ease(x: float) -> float:
    x = clamp(x)
    return x * x * (3 - 2 * x)


def prog(t: float, a: float, b: float) -> float:
    """Eased progress of t through [a, b]."""
    return ease((t - a) / (b - a)) if b > a else float(t >= a)


def lerp(a: float, b: float, u: float) -> float:
    return a + (b - a) * u


def mix(c1, c2, u: float):
    return tuple(int(round(lerp(a, b, clamp(u)))) for a, b in zip(c1, c2))


def fade(color, alpha: float, under=BG):
    return mix(under, color, alpha)


# ---------------------------------------------------------------- canvas ---

class Canvas:
    def __init__(self):
        self.img = Image.new("RGB", (W * S, H * S), BG)
        self.d = ImageDraw.Draw(self.img)

    def rrect(self, x, y, w, h, fill=None, outline=None, width=1.5, r=10):
        self.d.rounded_rectangle(
            [x * S, y * S, (x + w) * S, (y + h) * S], radius=r * S,
            fill=fill, outline=outline, width=max(1, int(width * S)))

    def rect(self, x, y, w, h, fill):
        self.d.rectangle([x * S, y * S, (x + w) * S, (y + h) * S], fill=fill)

    def circle(self, cx, cy, r, fill=None, outline=None, width=1.5):
        self.d.ellipse([(cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S],
                       fill=fill, outline=outline, width=max(1, int(width * S)))

    def line(self, pts, color, width=2.0):
        self.d.line([(x * S, y * S) for x, y in pts], fill=color,
                    width=max(1, int(width * S)), joint="curve")

    def dashed(self, p1, p2, color, width=2.0, dash=8, gap=6, offset=0.0):
        (x1, y1), (x2, y2) = p1, p2
        length = math.hypot(x2 - x1, y2 - y1)
        if length == 0:
            return
        ux, uy = (x2 - x1) / length, (y2 - y1) / length
        pos = -(offset % (dash + gap))
        while pos < length:
            a, b = max(pos, 0), min(pos + dash, length)
            if b > a:
                self.line([(x1 + ux * a, y1 + uy * a), (x1 + ux * b, y1 + uy * b)],
                          color, width)
            pos += dash + gap

    def arrow(self, p1, p2, color, width=2.0, head=9, dashed=False, offset=0.0):
        (x1, y1), (x2, y2) = p1, p2
        ang = math.atan2(y2 - y1, x2 - x1)
        bx, by = x2 - head * 0.8 * math.cos(ang), y2 - head * 0.8 * math.sin(ang)
        if dashed:
            self.dashed((x1, y1), (bx, by), color, width, offset=offset)
        else:
            self.line([(x1, y1), (bx, by)], color, width)
        left = (x2 - head * math.cos(ang - 0.45), y2 - head * math.sin(ang - 0.45))
        right = (x2 - head * math.cos(ang + 0.45), y2 - head * math.sin(ang + 0.45))
        self.d.polygon([(x2 * S, y2 * S), (left[0] * S, left[1] * S),
                        (right[0] * S, right[1] * S)], fill=color)

    def text(self, x, y, s, size=16, color=TEXT, kind="sans", anchor="la"):
        self.d.text((x * S, y * S), s, font=font(size, kind), fill=color,
                    anchor=anchor)

    def text_width(self, s, size=16, kind="sans") -> float:
        return self.d.textlength(s, font=font(size, kind)) / S

    def wrap(self, s, size, max_w, kind="sans"):
        lines, cur = [], ""
        for word in s.split():
            trial = f"{cur} {word}".strip()
            if self.text_width(trial, size, kind) <= max_w or not cur:
                cur = trial
            else:
                lines.append(cur)
                cur = word
        if cur:
            lines.append(cur)
        return lines

    def paragraph(self, x, y, s, size=15, color=TEXT, max_w=400, leading=1.35,
                  kind="sans"):
        for i, line in enumerate(self.wrap(s, size, max_w, kind)):
            self.text(x, y + i * size * leading, line, size, color, kind)

    def check(self, cx, cy, size, color, u=1.0):
        """Checkmark drawn progressively as u goes 0 -> 1."""
        p0 = (cx - size * 0.5, cy)
        p1 = (cx - size * 0.15, cy + size * 0.35)
        p2 = (cx + size * 0.55, cy - size * 0.4)
        if u <= 0:
            return
        first = clamp(u / 0.4)
        self.line([p0, (lerp(p0[0], p1[0], first), lerp(p0[1], p1[1], first))],
                  color, 3)
        if u > 0.4:
            second = clamp((u - 0.4) / 0.6)
            self.line([p1, (lerp(p1[0], p2[0], second), lerp(p1[1], p2[1], second))],
                      color, 3)

    def vdots(self, cx, cy, color, gap=7, r=2.2):
        for k in (-1, 0, 1):
            self.circle(cx, cy + k * gap, r, fill=color)

    def cross(self, cx, cy, size, color, width=3):
        h = size / 2
        self.line([(cx - h, cy - h), (cx + h, cy + h)], color, width)
        self.line([(cx - h, cy + h), (cx + h, cy - h)], color, width)

    def chip(self, x, y, label, color, alpha=1.0, size=13, pad=9, h=26,
             under=BG, kind="sans"):
        w = self.text_width(label, size, kind) + pad * 2
        self.rrect(x, y, w, h, fill=fade(PANEL_2, alpha, under),
                   outline=fade(color, alpha, under), width=1.5, r=h / 2)
        self.text(x + w / 2, y + h / 2, label, size, fade(TEXT, alpha, under),
                  kind, anchor="mm")
        return w

    def finish(self) -> Image.Image:
        cropped = self.img.crop((0, TOP_CROP * S, W * S, H * S))
        return cropped.resize((W, H - TOP_CROP), Image.LANCZOS)


def box(c: Canvas, x, y, w, h, title, sub=None, color=BORDER, alpha=1.0,
        title_size=17, sub_size=13, under=BG, fill=PANEL):
    c.rrect(x, y, w, h, fill=fade(fill, alpha, under),
            outline=fade(color, alpha, under), width=2, r=12)
    c.text(x + 14, y + 12, title, title_size, fade(TEXT, alpha, under), "bold")
    if sub:
        c.paragraph(x + 14, y + 16 + title_size, sub, sub_size,
                    fade(MUTED, alpha, under), max_w=w - 28)


def header(c: Canvas, t, title, subtitle):
    """Scenes name themselves here for readers of this file. The rendered GIF
    has no title so the animation carries the explanation."""


def caption(c: Canvas, t, steps):
    """steps: list of (start_time, text). Shows the latest started step."""
    c.rect(0, 600, W, 75, fade(PANEL, 1.0))
    c.line([(0, 600), (W, 600)], BORDER, 1)
    current = [(s, txt) for s, txt in steps if t >= s]
    if not current:
        return
    start, txt = current[-1]
    a = prog(t, start, start + 0.45)
    lines = c.wrap(txt, 18, W - 100)
    y0 = 637 - (len(lines) - 1) * 12
    for i, line in enumerate(lines):
        c.text(W / 2, y0 + i * 24, line, 18, fade(TEXT, a, PANEL), anchor="mm")


def travel(p1, p2, u):
    return lerp(p1[0], p2[0], u), lerp(p1[1], p2[1], u)


# ---------------------------------------------- 1. light client data flow ---

def scene_light_client(t: float) -> Image.Image:
    c = Canvas()
    header(c, t, "How the Cosmos light client verifies Cardano",
           "08-cardano-probabilistic never makes a network call. "
           "Everything it checks arrives inside the relayer's message.")
    a = prog(t, 0.3, 1.2)

    # Lanes
    for x, label in [(40, "CARDANO DATA SOURCES"), (330, "GATEWAY"),
                     (560, "HERMES RELAYER"), (780, "COSMOS CHAIN")]:
        c.text(x, 100, label, 12, fade(FAINT, a), "bold")

    sources = [
        ("Yaci Store", "block bytes, HostState tx", TEAL, "block CBOR"),
        ("Ogmios / Blockfrost", "stake distribution", AMBER, "stake dist."),
        ("Yaci / Blockfrost", "epoch nonce", AMBER, "epoch nonce"),
    ]
    for i, (title, sub, color, _) in enumerate(sources):
        box(c, 40, 125 + i * 85, 260, 70, title, sub, color, a)
    box(c, 330, 125, 200, 265, "Gateway", "NestJS · gRPC", BLUE, a)
    box(c, 560, 125, 200, 265, "Hermes", "Rust relayer", PURPLE, a)
    c.rrect(780, 115, 390, 470, fill=fade(PANEL, a), outline=fade(BORDER, a),
            width=2, r=14)
    c.text(796, 127, "Cosmos chain", 17, fade(TEXT, a), "bold")
    lc_x, lc_y, lc_w, lc_h = 796, 160, 358, 410
    c.rrect(lc_x, lc_y, lc_w, lc_h, fill=fade(PANEL_2, a),
            outline=fade(GREEN, a * 0.8), width=2, r=12)
    c.text(lc_x + 14, lc_y + 12, "08-cardano-probabilistic", 17,
           fade(TEXT, a, PANEL_2), "bold")
    c.text(lc_x + 14, lc_y + 34, "light client module (Go)", 13,
           fade(MUTED, a, PANEL_2))

    # "No network" badge, pulses when the header arrives
    pulse = 0.5 + 0.5 * math.sin((t - 9.6) * 9) if 9.6 < t < 11.2 else 0
    badge_col = mix(RED, (255, 200, 200), pulse)
    bx, by = 1170 - 166, 121
    c.rrect(bx, by, 152, 34, fill=fade(PANEL, a, PANEL_2),
            outline=fade(badge_col, a, PANEL_2), width=1.5, r=8)
    c.circle(bx + 18, by + 17, 9, outline=fade(badge_col, a, PANEL), width=1.5)
    c.line([(bx + 9, by + 17), (bx + 27, by + 17)], fade(badge_col, a, PANEL), 1)
    c.line([(bx + 11, by + 9), (bx + 25, by + 25)], fade(badge_col, a, PANEL), 2.2)
    c.text(bx + 34, by + 5, "no network access", 12, fade(TEXT, a, PANEL), "bold")
    c.text(bx + 34, by + 20, "no HTTP · gRPC · RPC", 10, fade(MUTED, a, PANEL))

    # Faint lane arrows
    for p1, p2 in [((300, 245), (330, 245)), ((530, 245), (560, 245)),
                   ((760, 245), (796, 245))]:
        c.arrow(p1, p2, fade(BORDER, a), 2, head=8)

    # Step 1: data chips fly into the gateway
    envelope_home = (344, 215)
    for i, (_, _, color, chip_label) in enumerate(sources):
        start = 1.4 + i * 0.5
        u = prog(t, start, start + 1.6)
        if t < start or t > 6.4:
            continue
        src = (160, 147 + i * 85)
        dst = (350, 200 + i * 34)
        x, y = travel(src, dst, u)
        gather = prog(t, 5.0, 6.2)
        gx, gy = travel((x, y), (envelope_home[0] + 20, envelope_home[1] + 60), gather)
        c.chip(gx, gy, chip_label, color, alpha=1 - prog(t, 5.8, 6.4))

    # The header envelope
    env_w, env_h = 172, 160
    if t >= 5.4:
        appear = prog(t, 5.4, 6.4)
        move_h = prog(t, 7.4, 8.6)
        move_c = prog(t, 9.6, 10.8)
        ex, ey = travel(envelope_home, (574, 215), move_h)
        ex, ey = travel((ex, ey), (lc_x + 14, lc_y + 70), move_c)
        shrink = prog(t, 10.4, 11.0)
        env_alpha = appear * (1 - shrink)
        if env_alpha > 0:
            under = PANEL
            c.rrect(ex, ey, env_w, env_h, fill=fade((24, 35, 56), env_alpha, under),
                    outline=fade(BLUE, env_alpha, under), width=2, r=10)
            c.text(ex + 10, ey + 9, "ProbabilisticHeader", 13,
                   fade(TEXT, env_alpha, under), "bold")
            rows = [("anchor block (full CBOR)", TEXT),
                    ("bridge blocks", TEXT),
                    ("24+ descendant headers", TEXT),
                    ("HostState tx ref", TEXT),
                    ("epoch context:", AMBER),
                    ("  stake + epoch nonce", AMBER)]
            for j, (label, col) in enumerate(rows):
                c.text(ex + 12, ey + 33 + j * 20, label, 12,
                       fade(col, env_alpha, under))
            tag = prog(t, 8.6, 9.2)
            if tag > 0:
                c.chip(ex + 18, ey - 31, "MsgUpdateClient", PURPLE,
                       alpha=tag * (1 - shrink), under=PANEL)
        if shrink > 0:
            c.chip(lc_x + 14, lc_y + 64, "MsgUpdateClient · ProbabilisticHeader",
                   PURPLE, alpha=shrink, under=PANEL_2, size=12)

    # Step 4: the checklist
    checks = [
        "Blocks chain back to the trusted checkpoint",
        "Each block is signed by its pool (opcert, KES)",
        "VRF proof is valid for the epoch nonce",
        "The pool was eligible to lead that slot",
        "24+ blocks from 5+ pools sit on top",
        "Read ibc_state_root from the HostState tx",
    ]
    for i, label in enumerate(checks):
        start = 11.0 + i * 0.7
        u = prog(t, start, start + 0.5)
        if t < start - 0.3:
            continue
        row_a = prog(t, start - 0.3, start)
        y = lc_y + 106 + i * 44
        is_last = i == len(checks) - 1
        col = GREEN if not is_last else BLUE
        c.circle(lc_x + 28, y + 9, 12, fill=fade(PANEL, row_a, PANEL_2),
                 outline=fade(col, row_a, PANEL_2), width=1.5)
        if is_last:
            if u > 0:
                c.arrow((lc_x + 21, y + 9), (lc_x + 36, y + 9), fade(col, u, PANEL), 2.5,
                        head=7)
        else:
            c.check(lc_x + 28, y + 10, 12, col, u)
        c.text(lc_x + 50, y + 1, label, 14, fade(TEXT, row_a, PANEL_2))

    # Step 5: result
    res = prog(t, 15.2, 15.8)
    if res > 0:
        rx, ry = lc_x + 14, lc_y + lc_h - 62
        c.rrect(rx, ry, lc_w - 28, 48, fill=fade((20, 60, 40), res, PANEL_2),
                outline=fade(GREEN, res, PANEL_2), width=2, r=10)
        c.text(rx + 12, ry + 8, "New ConsensusState stored", 14,
               fade(TEXT, res, (20, 60, 40)), "bold")
        c.text(rx + 12, ry + 27, "ibc_state_root = 9f3a…c21e", 13,
               fade(GREEN, res, (20, 60, 40)), "mono")

    # Trusted-input callout
    ta = prog(t, 16.8, 17.5)
    if ta > 0:
        tx, ty, tw, th = 40, 405, 720, 130
        c.rrect(tx, ty, tw, th, fill=fade((50, 40, 15), ta), outline=fade(AMBER, ta),
                width=2, r=12)
        c.text(tx + 16, ty + 14, "The one input the client takes on trust", 16,
               fade(AMBER, ta, (50, 40, 15)), "bold")
        c.paragraph(tx + 16, ty + 42,
                    "The stake distribution and epoch nonce come from the relayer. "
                    "The client checks their shape (a 32-byte nonce, stakes that sum "
                    "to 1) but cannot check where they came from. Everything else is "
                    "verified from the block bytes themselves.",
                    14, fade(TEXT, ta, (50, 40, 15)), max_w=tw - 32)

    caption(c, t, [
        (1.2, "1. The Gateway reads Cardano data: blocks from Yaci, stake and "
              "epoch nonce from Ogmios or Blockfrost."),
        (4.8, "2. It packs everything the light client needs into one "
              "ProbabilisticHeader."),
        (7.4, "3. Hermes wraps the header in a MsgUpdateClient and submits it "
              "to the Cosmos chain."),
        (9.6, "4. The light client checks the header using only the bytes "
              "inside the message."),
        (15.2, "5. If every check passes, it stores a new consensus state with "
               "Cardano's IBC state root."),
        (16.8, "The epoch context (amber) is the only outside input, and it is "
               "only shape-checked."),
    ])
    return c.finish()


# ------------------------------------------------- 2. yaci vs blockfrost ---

def chain_timeline(c: Canvas, x, y, w, a, under, blocks, block_alpha=1.0):
    """A chain drawn as a bar of blocks from genesis to tip."""
    c.rrect(x, y, w, 14, fill=fade(BG, a, under), outline=fade(BORDER, a, under),
            width=1, r=7)
    n = 28
    step = (w - 12) / n
    for i in range(int(blocks * n)):
        c.rect(x + 6 + i * step, y + 3, step - 3, 8,
               fade(GREEN, a * block_alpha, under))
    c.text(x, y + 30, "genesis", 12, fade(MUTED, a, under))
    c.text(x + w, y + 30, "tip", 12, fade(MUTED, a, under), anchor="ra")


def yaci_box(c: Canvas, x, y, w, a, sub):
    box(c, x, y, w, 128, "Yaci Store  ·  Postgres", sub, TEAL, a, 15, 12, PANEL,
        PANEL_2)


def scene_yaci_blockfrost(t: float) -> Image.Image:
    c = Canvas()
    header(c, t, "Yaci Store vs Blockfrost: two different jobs",
           "They are not alternatives. Yaci runs on every network. Blockfrost "
           "only fills in epoch and pool history on public networks.")
    a = prog(t, 0.3, 1.2)
    off = t * 30
    for px, title in [(30, "Local devnet (Caribic)"), (610, "Preprod / preview")]:
        c.rrect(px, 100, 560, 485, fill=fade(PANEL, a), outline=fade(BORDER, a),
                width=2, r=14)
        c.text(px + 18, 114, title, 18, fade(TEXT, a, PANEL), "bold")

    yaci_w = 370
    tl_off_x, tl_off_y, tl_w = 14, 66, yaci_w - 28

    # ---- Left: local devnet
    L = 30
    box(c, L + 18, 150, 150, 62, "cardano-node", "local, magic 42", GREEN, a,
        15, 12, PANEL, PANEL_2)
    box(c, L + 180, 150, 96, 62, "Kupo", "UTxOs", BLUE, a, 15, 12, PANEL, PANEL_2)
    box(c, L + 288, 150, 118, 62, "Blockfrost", "not used", FAINT, a * 0.45, 15, 12,
        PANEL, PANEL_2)
    c.line([(L + 294, 200), (L + 400, 164)], fade(RED, a * 0.7, PANEL), 2)
    box(c, L + 418, 150, 124, 62, "Ogmios", "live stake", BLUE, a, 15, 12, PANEL,
        PANEL_2)

    yaci_y = 250
    yaci_box(c, L + 18, yaci_y, yaci_w, a,
             "follows the node and indexes blocks, txs, UTxOs, pools, epoch nonces")
    c.arrow((L + 93, 212), (L + 93, yaci_y), fade(TEAL, a, PANEL), 2, dashed=True,
            offset=-off)
    c.text(L + 100, 222, "follows", 12, fade(TEAL, a, PANEL))
    tx, ty = L + 18 + tl_off_x, yaci_y + tl_off_y
    chain_timeline(c, tx, ty, tl_w, a, PANEL_2, prog(t, 1.4, 5.2))
    fill = prog(t, 1.7, 5.5)
    if fill > 0:
        c.rrect(tx, ty + 18, tl_w * fill, 5, fill=TEAL, r=2)
        c.text(tx + tl_w / 2, ty + 30, "indexed from genesis", 12,
               fade(TEAL, fill, PANEL_2), anchor="ma")

    gw_y = 440
    box(c, L + 18, gw_y, 524, 90, "Gateway", "builds light-client headers and IBC "
        "proofs", BLUE, a, 15, 12, PANEL, PANEL_2)
    l_q = prog(t, 5.6, 6.4)
    if l_q > 0:
        c.arrow((L + 150, gw_y), (L + 150, yaci_y + 128), fade(TEAL, l_q, PANEL),
                2.5, dashed=True, offset=off)
        c.text(L + 162, 392, "blocks, bridge history,", 12, fade(TEXT, l_q, PANEL))
        c.text(L + 162, 408, "epoch nonce", 12, fade(TEXT, l_q, PANEL))
        c.arrow((L + 500, gw_y), (L + 500, 212), fade(BLUE, l_q, PANEL), 2.5,
                dashed=True, offset=off)
        c.text(L + 420, 392, "live stake", 12, fade(TEXT, l_q, PANEL))
        c.text(L + 420, 408, "distribution", 12, fade(TEXT, l_q, PANEL))

    # ---- Right: public networks
    R = 610
    box(c, R + 18, 150, 150, 62, "Public relay", "someone else's node", GREEN, a,
        15, 12, PANEL, PANEL_2)
    box(c, R + 180, 150, 226, 62, "Ogmios / Kupo", "hosted, used to build txs", BLUE, a, 15, 12, PANEL, PANEL_2)
    box(c, R + 418, 150, 124, 62, "Blockfrost", "hosted HTTP API", AMBER, a, 15, 12,
        PANEL, PANEL_2)

    yaci_box(c, R + 18, yaci_y, yaci_w, a,
             "follows a public relay, starting from a recent checkpoint")
    c.arrow((R + 93, 212), (R + 93, yaci_y), fade(TEAL, a, PANEL), 2, dashed=True,
            offset=-off)
    c.text(R + 100, 222, "follows", 12, fade(TEAL, a, PANEL))
    rx, ry = R + 18 + tl_off_x, yaci_y + tl_off_y
    chain_timeline(c, rx, ry, tl_w, a, PANEL_2, 1.0, block_alpha=0.55)
    cp_x = rx + tl_w * 0.72
    if t >= 7.4:
        ga = prog(t, 7.4, 8.0)
        c.arrow((R + 470, 212), (cp_x + 4, ry - 4), fade(AMBER, ga, PANEL), 2.5,
                dashed=True, offset=-off)
        c.text(R + 470, 226, "checkpoint for Caribic", 11, fade(AMBER, ga, PANEL),
               anchor="ra")
    cp = prog(t, 8.0, 9.0)
    if cp > 0:
        c.line([(cp_x, ry - 8), (cp_x, ry + 22)], fade(AMBER, cp, PANEL_2), 3)
    r_fill = prog(t, 9.4, 12.0)
    if r_fill > 0:
        c.rrect(cp_x, ry + 18, (rx + tl_w - cp_x) * r_fill, 5, fill=TEAL, r=2)
    hatch = prog(t, 10.2, 11.2)
    if hatch > 0:
        for k in range(int((cp_x - rx - 8) / 9)):
            hx = rx + 6 + k * 9
            c.line([(hx, ry + 12), (hx + 6, ry + 2)], fade(PANEL_2, hatch * 0.9,
                                                          GREEN), 2)
        c.text((rx + cp_x) / 2, ry + 30, "not in Yaci", 12,
               fade(MUTED, hatch, PANEL_2), anchor="ma")
    if cp > 0:
        c.text(cp_x + 4, ry + 30, "indexed", 12, fade(TEAL, r_fill, PANEL_2))

    box(c, R + 18, gw_y, 524, 90, "Gateway", "builds light-client headers and IBC "
        "proofs", BLUE, a, 15, 12, PANEL, PANEL_2)
    r_q = prog(t, 12.6, 13.6)
    if r_q > 0:
        c.arrow((R + 150, gw_y), (R + 150, yaci_y + 128), fade(TEAL, r_q, PANEL),
                2.5, dashed=True, offset=off)
        c.text(R + 162, 400, "blocks, bridge history", 12, fade(TEXT, r_q, PANEL))
        c.arrow((R + 520, gw_y), (R + 520, 212), fade(AMBER, r_q, PANEL), 2.5,
                dashed=True, offset=off)
        for k, line in enumerate(["epoch nonces,", "stake snapshots,",
                                  "pool registration", "history"]):
            c.text(R + 506, 318 + k * 16, line, 12, fade(TEXT, r_q, PANEL),
                   anchor="ra")

    # End card
    e = prog(t, 16.4, 17.2)
    if e > 0:
        under = (12, 18, 33)
        ex, ey, ew, eh = 150, 205, 900, 250
        c.rrect(ex, ey, ew, eh, fill=fade(under, e), outline=fade(BORDER, e),
                width=2, r=16)
        c.rrect(ex + 30, ey + 34, 12, 70, fill=fade(TEAL, e, under), r=4)
        c.text(ex + 58, ey + 32, "Yaci Store", 22, fade(TEAL, e, under), "bold")
        c.text(ex + 58, ey + 66, "Our own indexed copy of chain history, in Postgres.",
               17, fade(TEXT, e, under))
        c.text(ex + 58, ey + 90, "Runs on every network.", 15, fade(MUTED, e, under))
        c.rrect(ex + 30, ey + 144, 12, 70, fill=fade(AMBER, e, under), r=4)
        c.text(ex + 58, ey + 142, "Blockfrost", 22, fade(AMBER, e, under), "bold")
        c.text(ex + 58, ey + 176, "A hosted API for epoch and pool history, plus "
               "Caribic's sync checkpoint.", 17, fade(TEXT, e, under))
        c.text(ex + 58, ey + 200, "Public networks only. It replaced Koios.", 15,
               fade(MUTED, e, under))

    caption(c, t, [
        (1.2, "Local devnet: Caribic runs a node, Ogmios, Kupo and Yaci. Yaci "
              "indexes the whole chain from genesis."),
        (5.6, "The Gateway reads history from Yaci and live stake from Ogmios. "
              "Blockfrost is never used locally."),
        (7.4, "Public networks: Caribic asks Blockfrost for a recent checkpoint, "
              "and Yaci starts syncing there."),
        (10.2, "Yaci only indexes from the checkpoint onward, so it never replays "
               "years of chain."),
        (12.6, "The Gateway still reads blocks from Yaci, and asks Blockfrost for "
               "epoch and pool history."),
        (16.4, "Same Gateway, different data sources depending on the network."),
    ])
    return c.finish()


# ------------------------------------------ 3. state root -> cosmos proof ---

def tree_positions(x0, x1, y0, level_gap, levels):
    """Node centres for a small binary tree drawn as a stand-in for depth 64."""
    pos = []
    for lvl in range(levels):
        n = 2 ** lvl
        row = []
        for i in range(n):
            row.append((x0 + (x1 - x0) * (i + 0.5) / n, y0 + lvl * level_gap))
        pos.append(row)
    return pos


def scene_membership_proof(t: float) -> Image.Image:
    c = Canvas()
    header(c, t, "How a Cardano state root becomes a Cosmos proof",
           "Every IBC record lives in one Merkle tree. Its root is on Cardano, and a "
           "proof is the path from one leaf to that root.")
    a = prog(t, 0.3, 1.2)
    for x, label in [(30, "CARDANO"), (450, "GATEWAY AND HERMES"), (770, "COSMOS CHAIN")]:
        c.text(x, 100, label, 12, fade(FAINT, a), "bold")

    # HostState UTxO card
    hl = prog(t, 1.2, 2.0)
    root_col = mix(TEXT, GREEN, hl)
    c.rrect(30, 122, 390, 92, fill=fade(PANEL, a), outline=fade(BORDER, a), width=2,
            r=12)
    c.text(46, 134, "HostState UTxO", 16, fade(TEXT, a, PANEL), "bold")
    c.text(46, 158, "holds the HostState NFT", 13, fade(MUTED, a, PANEL))
    c.text(46, 182, "datum.ibc_state_root = 9f3a…c21e", 14, fade(root_col, a, PANEL),
           "mono")

    # Tree
    levels = 4
    pos = tree_positions(40, 410, 250, 50, levels)
    leaf_row_y = 250 + (levels - 1) * 50 + 76
    leaves = [(40 + 370 * (i + 0.5) / 8, leaf_row_y) for i in range(8)]
    target = 5
    # path: leaf index -> nodes at each visible level
    path_idx = [target >> (levels - 1 - lvl) for lvl in range(levels)]
    climb = prog(t, 3.4, 5.6)
    if hl > 0:
        c.dashed((225, 214), (225, pos[0][0][1] - 14), fade(GREEN, hl), 2)
    for lvl in range(levels):
        for i, (x, y) in enumerate(pos[lvl]):
            if lvl + 1 < levels:
                for child in (2 * i, 2 * i + 1):
                    cx, cy = pos[lvl + 1][child]
                    c.line([(x, y), (cx, cy)], fade(BORDER, a), 1.5)
    for lvl in range(levels):
        for i, (x, y) in enumerate(pos[lvl]):
            col = BORDER
            depth_from_leaf = levels - lvl
            on_path = i == path_idx[lvl]
            is_sibling = lvl > 0 and i == (path_idx[lvl] ^ 1)
            reveal = climb * (levels + 1)
            if on_path and reveal >= depth_from_leaf:
                col = GREEN
            if is_sibling and reveal >= depth_from_leaf:
                col = AMBER
            if lvl == 0:
                col = mix(col, GREEN, hl)
            c.circle(x, y, 9, fill=fade(PANEL_2, a), outline=fade(col, a), width=2)
    for x, _ in pos[-1]:
        c.vdots(x, leaf_row_y - 38, fade(FAINT, a), gap=5, r=1.6)

    for i, (x, y) in enumerate(leaves):
        col = BORDER
        if i == target:
            col = mix(BORDER, GREEN, prog(t, 3.0, 3.6))
        elif i == (target ^ 1) and climb > 0:
            col = AMBER
        c.rrect(x - 17, y - 11, 34, 22, fill=fade(PANEL_2, a), outline=fade(col, a),
                width=2, r=5)
    la = prog(t, 3.0, 3.6)
    if la > 0:
        lx, ly = leaves[target]
        c.chip(lx - 105, ly + 18, "connections/connection-0", GREEN, alpha=la, size=12)
    c.text(30, 524, "Drawn 4 levels deep. The real tree is 64 levels deep.", 12,
           fade(MUTED, a))
    c.text(30, 546, "leaf = sha256(0x00 || sha256(key) || sha256(value))", 11,
           fade(MUTED, a), "mono")
    c.text(30, 564, "node = sha256(0x01 || left || right)", 11, fade(MUTED, a),
           "mono")

    # Gateway and Hermes
    box(c, 450, 122, 290, 110, "Gateway", "rebuilds the tree from Yaci history, "
        "then serializes an ICS-23 proof", BLUE, a)
    box(c, 450, 330, 290, 124, "Hermes", "sends the proof inside the IBC message, "
        "e.g. MsgConnectionOpenTry", PURPLE, a)

    # proof packet
    pk_label = "proof: leaf + 64 sibling hashes"
    if t >= 6.0:
        build = prog(t, 6.0, 7.2)
        # sibling chips fly from tree to gateway
        for k in range(4):
            sx, sy = (pos[k + 1 if k + 1 < levels else levels - 1][0]
                      if k < 3 else leaves[target ^ 1])
            u = prog(t, 6.0 + k * 0.15, 7.0 + k * 0.15)
            if u < 1:
                x, y = travel((sx, sy), (520, 200), u)
                c.circle(x, y, 6, fill=AMBER)
        p1 = prog(t, 8.4, 9.4)
        p2 = prog(t, 9.6, 10.6)
        x, y = travel((466, 196), (466, 414), p1)
        x, y = travel((x, y), (790, 170), p2)
        fade_out = prog(t, 10.4, 10.9)
        if build * (1 - fade_out) > 0:
            c.chip(x, y, pk_label, AMBER, alpha=build * (1 - fade_out), size=12,
                   under=PANEL)

    # Cosmos side
    c.rrect(770, 122, 400, 460, fill=fade(PANEL, a), outline=fade(BORDER, a), width=2,
            r=14)
    c.text(786, 134, "08-cardano-probabilistic", 16, fade(TEXT, a, PANEL), "bold")
    c.text(786, 156, "VerifyMembership", 13, fade(MUTED, a, PANEL), "mono")

    rows = [("leaf", "sha256(0x00||k||v)"), ("level 63", "sha256(0x01||L||R)"),
            ("level 62", "sha256(0x01||L||R)"), ("...", ""),
            ("level 1", "sha256(0x01||L||R)"), ("root", "")]
    for i, (label, formula) in enumerate(rows):
        start = 10.8 + i * 0.6
        u = prog(t, start, start + 0.45)
        if u <= 0:
            continue
        y = 520 - i * 58
        x0 = 800
        is_root = label == "root"
        col = GREEN if is_root else BLUE
        if label == "...":
            c.vdots(x0 + 60, y + 18, fade(MUTED, u, PANEL))
            continue
        c.rrect(x0, y, 170, 36, fill=fade(PANEL_2, u, PANEL),
                outline=fade(col, u, PANEL), width=2, r=8)
        text = "computed root" if is_root else label
        c.text(x0 + 10, y + 10, text, 13, fade(TEXT, u, PANEL_2), "bold")
        if formula:
            c.text(x0 + 180, y + 11, formula, 11, fade(MUTED, u, PANEL), "mono")
        if not is_root and label != "leaf":
            c.circle(x0 + 160, y + 18, 5, fill=fade(AMBER, u, PANEL_2))
        if i > 0 and rows[i - 1][0] != "...":
            c.arrow((x0 + 60, y + 58 - 2), (x0 + 60, y + 38), fade(BORDER, u, PANEL), 2,
                    head=7)
    cmp_a = prog(t, 14.6, 15.2)
    if cmp_a > 0:
        c.text(1000, 222, "9f3a…c21e", 14, fade(GREEN, cmp_a, PANEL), "mono")
        c.rrect(790, 176, 360, 34, fill=fade((20, 60, 40), cmp_a, PANEL),
                outline=fade(GREEN, cmp_a, PANEL), width=2, r=8)
        c.text(802, 186, "ConsensusState.ibc_state_root = 9f3a…c21e", 12,
               fade(TEXT, cmp_a, (20, 60, 40)), "mono")
        m = prog(t, 15.2, 15.8)
        if m > 0:
            c.chip(1000, 252, "match", GREEN, alpha=m, under=PANEL)
            c.check(1080, 265, 14, GREEN, m)

    caption(c, t, [
        (1.2, "On Cardano, the HostState datum holds ibc_state_root, the root of a "
              "64-level Merkle tree of all IBC state."),
        (3.0, "Each IBC record is a leaf. Proving one needs the sibling hash at "
              "every level on the way to the root."),
        (6.0, "The Gateway rebuilds the tree from Yaci history and serializes the "
              "leaf and its 64 siblings as an ICS-23 proof."),
        (8.4, "Hermes passes the proof along inside the IBC message."),
        (10.8, "VerifyMembership hashes the leaf with each sibling, level by level, "
               "up to a root."),
        (14.6, "The computed root matches the one stored by the last header update, "
               "so the record is proven."),
    ])
    return c.finish()


# --------------------------------------------------- 4. finality depth ---

# Illustrative stake shares. Pools reach 5 at block 12, stake reaches 5.11% at
# block 17, and depth reaches 24 last.
POOLS = {
    "P1": (0.9, BLUE, True), "P2": (0.6, PURPLE, True), "P3": (1.1, TEAL, True),
    "P4": (1.4, PINK, False), "P5": (0.7, (163, 230, 53), True),
    "P6": (0.8, (251, 146, 60), True), "P7": (1.3, (129, 140, 248), True),
}
LEADERS = ["P1", "P3", "P1", "P2", "P3", "P4", "P1", "P5", "P3", "P2", "P1", "P6",
           "P3", "P1", "P5", "P2", "P7", "P1", "P3", "P4", "P6", "P1", "P2", "P3"]


def scene_finality(t: float) -> Image.Image:
    c = Canvas()
    header(c, t, "Why the client waits for 24 blocks",
           "A header's state root is accepted only once enough independent stake "
           "has built blocks on top of it.")
    a = prog(t, 0.3, 1.2)

    anc = prog(t, 1.0, 1.6)
    c.rrect(40, 118, 130, 120, fill=fade((20, 50, 40), anc), outline=fade(GREEN, anc),
            width=2.5, r=10)
    c.text(105, 138, "anchor", 16, fade(TEXT, anc, (20, 50, 40)), "bold", anchor="ma")
    c.text(105, 162, "block", 16, fade(TEXT, anc, (20, 50, 40)), "bold", anchor="ma")
    c.text(105, 190, "HostState tx", 12, fade(GREEN, anc, (20, 50, 40)), anchor="ma")
    c.text(105, 206, "new root", 12, fade(GREEN, anc, (20, 50, 40)), anchor="ma")

    step = 0.42
    first = 2.0
    shown = 0
    seen: set = set()
    pools = 0
    stake = 0.0
    for i, pid in enumerate(LEADERS):
        start = first + i * step
        u = prog(t, start, start + 0.25)
        if u <= 0:
            break
        shown = i + 1
        stake_pct, col, eligible = POOLS[pid]
        if pid not in seen:
            seen.add(pid)
            if eligible:
                pools += 1
                stake += stake_pct
        row, colm = divmod(i, 12)
        bx = 196 + colm * 80
        by = 128 + row * 64
        c.rrect(bx, by, 70, 50, fill=fade(PANEL_2, u), outline=fade(col, u), width=2,
                r=8)
        c.text(bx + 35, by + 9, pid, 15, fade(col, u, PANEL_2), "bold", anchor="ma")
        c.text(bx + 35, by + 30, f"#{i + 1}", 11, fade(MUTED, u, PANEL_2),
               anchor="ma")
        if not eligible:
            c.dashed((bx + 4, by + 46), (bx + 66, by + 4), fade(PINK, u * 0.8, PANEL_2),
                     1.5, dash=4, gap=3)
        if colm == 0 and row == 0:
            c.arrow((170, 153), (bx - 2, by + 25), fade(BORDER, u), 2, head=7)

    # Meters
    my = 300
    meters = [
        ("Descendant blocks", shown, 24, f"{shown} / 24"),
        ("Qualified unique pools", pools, 5, f"{pools} / 5"),
        ("Unique stake from those pools", stake, 5.11, f"{stake:.2f}% / 5.11%"),
    ]
    for k, (label, val, goal, txt) in enumerate(meters):
        y = my + k * 70
        met = val >= goal - 1e-9
        c.text(40, y, label, 16, fade(TEXT, a), "bold")
        c.text(1160, y, txt, 16, fade(GREEN if met else MUTED, a), "mono", anchor="ra")
        c.rrect(40, y + 26, 1120, 16, fill=fade(PANEL, a), outline=fade(BORDER, a),
                width=1, r=8)
        frac = clamp(val / goal)
        if frac > 0:
            c.rrect(40, y + 26, 1120 * frac, 16, fill=GREEN if met else BLUE, r=8)

    note = prog(t, first + 5 * step, first + 5 * step + 0.5)
    if note > 0:
        c.chip(40, 512, "P4 registered too recently: its blocks add depth, but not "
               "pools or stake", PINK, alpha=note, size=13)

    done = prog(t, first + 24 * step + 0.2, first + 24 * step + 0.8)
    if done > 0:
        c.rrect(40, 548, 1120, 40, fill=fade((20, 60, 40), done),
                outline=fade(GREEN, done), width=2, r=10)
        c.text(W / 2, 568, "All three thresholds met: the anchor block's "
               "ibc_state_root becomes a new consensus state", 16,
               fade(TEXT, done, (20, 60, 40)), "bold", anchor="mm")

    caption(c, t, [
        (1.0, "The anchor block holds the HostState transaction with the new IBC "
              "state root."),
        (2.0, "Blocks built on top count toward three thresholds. Each block names "
              "the pool that produced it."),
        (first + 6 * step, "A pool counts once, and only if it was registered "
                           "early enough, so fresh pools cannot pad the numbers."),
        (first + 24 * step + 0.2, "Once all three thresholds are met, the header's "
                                  "state root is accepted."),
    ])
    return c.finish()


# ------------------------------------------------------------- driver ---

SCENES = {
    "light-client-data-flow": (scene_light_client, 21.0),
    "yaci-vs-blockfrost": (scene_yaci_blockfrost, 20.5),
    "membership-proof": (scene_membership_proof, 18.5),
    "finality-thresholds": (scene_finality, 16.5),
}


def render(name: str) -> Path:
    fn, duration = SCENES[name]
    out = OUT_DIR / f"{name}.gif"
    tmp = Path(tempfile.mkdtemp(prefix=f"{name}-"))
    try:
        n = int(duration * FPS)
        for i in range(n):
            fn(i / FPS).save(tmp / f"f{i:04d}.png")
        subprocess.run([
            "ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS),
            "-i", str(tmp / "f%04d.png"), "-vf",
            "split[a][b];[a]palettegen=max_colors=128:stats_mode=full[p];"
            "[b][p]paletteuse=dither=none:diff_mode=rectangle",
            "-loop", "0", str(out)], check=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return out


if __name__ == "__main__":
    names = sys.argv[1:] or list(SCENES)
    for name in names:
        path = render(name)
        print(f"{path.name}: {path.stat().st_size / 1e6:.2f} MB")
