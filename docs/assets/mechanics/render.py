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


# ------------------------------------------ 1. what the gateway asks for ---

def along(path, u):
    """Point at fraction u of a polyline."""
    lengths = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(path, path[1:])]
    target = clamp(u) * sum(lengths)
    for (a, b), seg in zip(zip(path, path[1:]), lengths):
        if target <= seg or seg == 0:
            k = target / seg if seg else 0
            return lerp(a[0], b[0], k), lerp(a[1], b[1], k)
        target -= seg
    return path[-1]


SERVICES = {
    # key: (title, what it holds, colour, row)
    "yaci_sql": ("Yaci Store · Postgres", "indexed chain history", TEAL, 0),
    "yaci_rest": ("Yaci Store · REST", "raw block bytes", TEAL, 1),
    "relay": ("Relay (node-to-node)", "fallback for block bytes", GREEN, 2),
    "blockfrost": ("Blockfrost", "epoch and pool history", AMBER, 3),
    "ogmios": ("Ogmios", "live ledger, evaluate, submit", BLUE, 4),
    "kupo": ("Kupo", "live UTxOs", BLUE, 5),
}
SVC_X, SVC_W, SVC_Y0, SVC_H, SVC_PITCH = 350, 340, 100, 62, 72
HERMES_X, HERMES_W = 40, 262
GATEWAY_X, GATEWAY_W = 770, 390
PANEL_Y, PANEL_H = 100, 430
LANE_Y = 556

# Act 1: the Gateway builds a light-client header. Each step names the service,
# the call, and the header field it fills.
HEADER_STEPS = [
    ("yaci_sql", "SELECT … FROM block WHERE number > …", "Block list", "heights, hashes, slots",
     "Yaci's block table lists every block from the trusted height to the anchor, plus 24+ on top."),
    ("yaci_rest", "GET /blocks/{hash}/cbor", "Raw block and header bytes", "signed witnesses",
     "The light client re-checks every signature, so it needs the raw bytes. The relay is the fallback."),
    ("yaci_sql", "bridge_utxo_history · HostState NFT", "HostState tx in the anchor", "carries the new root",
     "The anchor block must contain the HostState transaction that carries the new IBC state root."),
    ("blockfrost", "GET /epochs/{n}/parameters", "Epoch nonce", "for VRF checks",
     "VRF proofs are checked against the epoch nonce. On public networks it comes from Blockfrost."),
    ("ogmios", "stakePools · liveStakeDistribution", "Stake and VRF key per pool", "for leader checks",
     "Leader checks need every pool's stake and VRF key: the live ledger from Ogmios, epoch totals from Blockfrost."),
    ("yaci_sql", "bridge_spo_event_history", "Pool registration slots", "fresh pools don't count",
     "Pools must be registered early enough to count, so the Gateway looks up when each one registered."),
    ("ogmios", "queryNetwork/genesisConfiguration", "KES and slot parameters", "from genesis",
     "KES and slot-leader maths need the network's genesis parameters, which Ogmios reads from the node."),
]
# Secondary calls shown alongside a step: (step index, service, call)
HEADER_EXTRA = [(1, "relay", "BlockFetch if Yaci misses"),
                (4, "blockfrost", "GET /pools/extended · /epochs/{n}"),
                (5, "blockfrost", "GET /pools/{id}/updates if missing")]

# Act 2: building, checking and submitting a transaction.
TX_GATEWAY_STEPS = [
    ("kupo", "/matches/{policy.asset}?unspent", "HostState, channel, wallet UTxOs", "inputs to spend",
     "Kupo returns the live UTxOs the transaction spends: HostState, the channel, and wallet funds."),
    (None, None, "New IBC state root", "from its in-memory tree",
     "The Gateway computes the new IBC state root itself, from its own copy of the IBC tree."),
    ("ogmios", "queryNetwork/tip", "Validity window", "from the chain tip",
     "Ogmios gives the chain tip, which sets the transaction's validity window."),
    ("ogmios", "evaluateTransaction", "Script execution units", "to size the budget",
     "Ogmios evaluates the validators so the Gateway can size their execution budget."),
]
TX_HERMES_STEPS = [
    ("kupo", "/matches/*@{txid}?unspent", "Every input exists, unspent",
     "Before signing, Hermes checks every input against Kupo itself."),
    ("ogmios", "evaluateTransaction", "Validators pass",
     "It re-evaluates the transaction with Ogmios, so it never signs one that would fail."),
    (None, None, "Matches the bridge manifest",
     "It checks the transaction against the pinned bridge manifest, then signs with its own key."),
    ("ogmios", "submitTransaction", "Submitted",
     "Hermes submits the signed transaction straight to Ogmios."),
]

STEP = 1.75
A1_REQ = 1.0
A1_FIRST = 2.4
A1_REPLY = A1_FIRST + len(HEADER_STEPS) * STEP + 0.2
A1_END = A1_REPLY + 3.4
A2_START = A1_END + 0.6
A2_REQ = A2_START + 0.8
A2_FIRST = A2_REQ + 1.4
A2_REPLY = A2_FIRST + len(TX_GATEWAY_STEPS) * STEP + 0.2
A2_H_FIRST = A2_REPLY + 1.4
A2_OBSERVE = A2_H_FIRST + len(TX_HERMES_STEPS) * STEP + 0.2
A2_CONFIRM = A2_OBSERVE + 1.4
GATEWAY_CALLS_DURATION = A2_CONFIRM + 4.2


def service_y(key):
    return SVC_Y0 + SERVICES[key][3] * SVC_PITCH


def lane_path(to_gateway: bool):
    h = (HERMES_X + HERMES_W / 2, PANEL_Y + PANEL_H)
    g = (GATEWAY_X + GATEWAY_W / 2, PANEL_Y + PANEL_H)
    path = [h, (h[0], LANE_Y), (g[0], LANE_Y), g]
    return path if to_gateway else path[::-1]


def draw_lane_message(c, t, start, label, color, to_gateway):
    u = prog(t, start, start + 1.1)
    if t < start or t > start + 1.5:
        return
    alpha = 1 - prog(t, start + 1.1, start + 1.5)
    x, y = along(lane_path(to_gateway), u)
    w = c.text_width(label, 12) + 18
    c.chip(x - w / 2, y - 13, label, color, alpha=alpha, size=12)


def draw_call(c, t, start, key, call, from_x, active_calls):
    """Pulse a request and response between a panel edge and a service."""
    if t < start:
        return
    y = service_y(key) + SVC_H / 2
    svc_edge = SVC_X if from_x < SVC_X else SVC_X + SVC_W
    live = t < start + STEP
    a = prog(t, start, start + 0.3) * (1.0 if live else 0.35)
    col = SERVICES[key][2]
    c.line([(from_x, y), (svc_edge, y)], fade(col, a), 2.5 if live else 1.5)
    if live:
        u = clamp((t - start) / (STEP * 0.8))
        k = u * 2 if u < 0.5 else 2 - u * 2
        c.circle(lerp(from_x, svc_edge, k), y, 5, fill=col)
        active_calls[key] = call


def draw_rows(c, x, y0, rows, t, under, alpha=1.0):
    """rows: (start, title, detail, colour)."""
    for i, (start, title, detail, col) in enumerate(rows):
        u = prog(t, start + STEP * 0.55, start + STEP * 0.8) * alpha
        if u <= 0:
            continue
        y = y0 + i * 44
        c.circle(x + 11, y + 11, 10, fill=fade(PANEL, u, under), outline=fade(col, u, under),
                 width=1.5)
        c.check(x + 11, y + 12, 10, col, u)
        c.text(x + 30, y + 1, title, 13, fade(TEXT, u, under), "bold")
        if detail:
            c.text(x + 30, y + 19, detail, 11, fade(col, u, under), "mono")


def scene_gateway_calls(t: float) -> Image.Image:
    c = Canvas()
    header(c, t, "What the Gateway asks each service for",
           "Hermes never reads Cardano itself for headers; the Gateway gathers "
           "every field from a named source.")
    a = prog(t, 0.2, 1.0)
    act2 = t >= A2_START
    swap = prog(t, A1_END, A2_START)

    # Panels
    c.rrect(HERMES_X, PANEL_Y, HERMES_W, PANEL_H, fill=fade(PANEL, a), outline=fade(PURPLE, a),
            width=2, r=14)
    c.text(HERMES_X + 16, PANEL_Y + 14, "Hermes", 18, fade(TEXT, a, PANEL), "bold")
    c.rrect(GATEWAY_X, PANEL_Y, GATEWAY_W, PANEL_H, fill=fade(PANEL, a), outline=fade(BLUE, a),
            width=2, r=14)
    c.text(GATEWAY_X + 16, PANEL_Y + 14, "Gateway", 18, fade(TEXT, a, PANEL), "bold")
    sub_a = a * (1 - swap) if not act2 else prog(t, A2_START, A2_START + 0.5)
    g_sub = "building an unsigned transaction" if act2 else "building a light-client header"
    h_sub = "relaying a packet to Cardano" if act2 else "updating the Cardano client on Cosmos"
    c.text(GATEWAY_X + 16, PANEL_Y + 40, g_sub, 13, fade(MUTED, sub_a, PANEL))
    c.text(HERMES_X + 16, PANEL_Y + 40, h_sub, 13, fade(MUTED, sub_a, PANEL))

    # gRPC lane
    lane = lane_path(True)
    for p1, p2 in zip(lane, lane[1:]):
        c.dashed(p1, p2, fade(BORDER, a), 1.5, dash=6, gap=5)
    c.text((SVC_X + SVC_X + SVC_W) / 2, LANE_Y + 8, "gRPC", 11, fade(FAINT, a), anchor="ma")

    active: dict = {}
    rows_under = PANEL
    fade_a1 = 1 - swap

    if not act2:
        draw_lane_message(c, t, A1_REQ, "IBCHeader(trusted, target)", PURPLE, True)
        for i, (key, call, *_rest) in enumerate(HEADER_STEPS):
            draw_call(c, t, A1_FIRST + i * STEP, key, call, GATEWAY_X, active)
        for i, key, call in HEADER_EXTRA:
            draw_call(c, t, A1_FIRST + i * STEP + 0.25, key, call, GATEWAY_X, active)
        rows = [(A1_FIRST + i * STEP, title, detail, SERVICES[key][2])
                for i, (key, _, title, detail, _) in enumerate(HEADER_STEPS)]
        if fade_a1 > 0:
            draw_rows(c, GATEWAY_X + 18, PANEL_Y + 74, rows, t, rows_under, fade_a1)
        draw_lane_message(c, t, A1_REPLY, "ProbabilisticHeader", GREEN, False)
        done = prog(t, A1_REPLY + 1.3, A1_REPLY + 1.8) * fade_a1
        if done > 0:
            bx, by = HERMES_X + 16, PANEL_Y + 90
            c.rrect(bx, by, HERMES_W - 32, 118, fill=fade((24, 35, 56), done, PANEL),
                    outline=fade(GREEN, done, PANEL), width=2, r=10)
            c.text(bx + 12, by + 12, "ProbabilisticHeader", 13, fade(TEXT, done, (24, 35, 56)),
                   "bold")
            c.text(bx + 12, by + 34, "wrapped in MsgUpdateClient", 12,
                   fade(MUTED, done, (24, 35, 56)))
            c.text(bx + 12, by + 52, "and sent to Cosmos", 12, fade(MUTED, done, (24, 35, 56)))
            c.arrow((bx + 60, by + 132), (HERMES_X - 2, by + 132), fade(GREEN, done), 2.5, head=8)
            c.paragraph(bx + 12, by + 80, "The light client checks it with no network access.",
                        11, fade(GREEN, done, (24, 35, 56)), max_w=HERMES_W - 60)
    else:
        draw_lane_message(c, t, A2_REQ, "RecvPacket(packet, proof)", PURPLE, True)
        g_rows = []
        for i, (key, call, title, detail, _) in enumerate(TX_GATEWAY_STEPS):
            start = A2_FIRST + i * STEP
            if key:
                draw_call(c, t, start, key, call, GATEWAY_X, active)
            g_rows.append((start, title, detail, SERVICES[key][2] if key else PURPLE))
        draw_lane_message(c, t, A2_REPLY, "unsigned tx CBOR", AMBER, False)
        h_rows = []
        for i, (key, call, title, _) in enumerate(TX_HERMES_STEPS):
            start = A2_H_FIRST + i * STEP
            if key:
                draw_call(c, t, start, key, call, HERMES_X + HERMES_W, active)
            h_rows.append((start, title, call if key else "then signs", SERVICES[key][2] if key
                           else PURPLE))
        draw_lane_message(c, t, A2_OBSERVE, "ObserveTx(tx_hash)", PURPLE, True)
        draw_call(c, t, A2_CONFIRM, "yaci_sql", "bridge_tx_evidence WHERE tx_hash", GATEWAY_X,
                  active)
        g_rows.append((A2_CONFIRM, "Included, root matches", "commits its IBC tree", TEAL))
        draw_rows(c, GATEWAY_X + 18, PANEL_Y + 74, g_rows, t, rows_under)
        draw_rows(c, HERMES_X + 16, PANEL_Y + 74, h_rows, t, rows_under)
        key_a = prog(t, A2_REPLY + 0.9, A2_REPLY + 1.4)
        if key_a > 0:
            c.chip(GATEWAY_X + 18, PANEL_Y + PANEL_H - 44, "holds no signing key", FAINT,
                   alpha=key_a, under=PANEL, size=12)

    # Services, drawn last so call pulses sit underneath the boxes' edges
    for key, (title, desc, col, _) in SERVICES.items():
        y = service_y(key)
        on = key in active
        border = col if on else mix(BORDER, col, 0.45)
        c.rrect(SVC_X, y, SVC_W, SVC_H, fill=fade(PANEL_2 if on else PANEL, a),
                outline=fade(border, a), width=2.5 if on else 1.5, r=10)
        c.text(SVC_X + 14, y + 9, title, 14, fade(TEXT, a, PANEL), "bold")
        c.text(SVC_X + SVC_W - 14, y + 11, desc, 11, fade(MUTED, a, PANEL), anchor="ra")
        if on:
            c.text(SVC_X + 14, y + 36, active[key], 12, col, "mono")

    caption(c, t, [
        (A1_REQ, "Hermes asks the Gateway for a light-client header over gRPC."),
        *[(A1_FIRST + i * STEP, s[4]) for i, s in enumerate(HEADER_STEPS)],
        (A1_REPLY, "The Gateway returns the header. Hermes wraps it in MsgUpdateClient and "
                   "sends it to the Cosmos light client."),
        (A2_REQ, "To change Cardano state, Hermes asks the Gateway to build a transaction, "
                 "for example RecvPacket."),
        *[(A2_FIRST + i * STEP, s[4]) for i, s in enumerate(TX_GATEWAY_STEPS)],
        (A2_REPLY, "The Gateway returns an unsigned transaction. It never holds a signing key."),
        *[(A2_H_FIRST + i * STEP, s[3]) for i, s in enumerate(TX_HERMES_STEPS)],
        (A2_OBSERVE, "Hermes tells the Gateway only the transaction hash."),
        (A2_CONFIRM, "The Gateway waits for the transaction in Yaci, checks the new root, and "
                     "commits its IBC tree."),
    ])
    return c.finish()


# ------------------------------------------------ 2. what yaci store is ---

# (name, columns, column, row) — only tables and columns the Gateway reads.
YACI_TABLES = [
    ("block", "number · hash · slot · epoch · slot_leader", 0, 0),
    ("transaction", "tx_hash · block · invalid", 0, 1),
    ("transaction_cbor", "tx_hash · cbor_data", 0, 2),
    ("tx_input", "tx_hash · output_index · spent_tx_hash", 0, 3),
    ("address_utxo", "owner_addr · amounts · inline_datum", 1, 0),
    ("pool_registration", "pool_id · tx_hash · block", 1, 1),
    ("pool", "pool_id · registration_slot", 1, 2),
    ("epoch_nonce", "epoch · nonce", 1, 3),
]
BRIDGE_TABLES = ["bridge_utxo_history", "bridge_tx_evidence", "bridge_spo_event_history"]
DB_X, DB_Y, DB_W, DB_H = 262, 100, 578, 430
CARD_W, CARD_H = 272, 58
YACI = (30, 244, 200, 150)
NODE = (30, 104, 200, 78)
GW = (880, 100, 290, 250)
SIDECAR = (880, 380, 290, 110)
LANE_Y2 = 556

# Which tables each indexed block writes to, in order.
BLOCK_WRITES = [
    ["block", "transaction", "transaction_cbor", "tx_input", "address_utxo"],
    ["block", "transaction", "transaction_cbor", "tx_input", "address_utxo",
     "pool_registration", "pool"],
    ["block", "transaction", "transaction_cbor", "tx_input", "address_utxo", "epoch_nonce"],
]
Y_BLOCK_T0, Y_BLOCK_STEP = 1.4, 2.6
Y_OFF_T = Y_BLOCK_T0 + len(BLOCK_WRITES) * Y_BLOCK_STEP + 0.2
Y_SIDECAR_T = Y_OFF_T + 2.6
Y_SQL1_T = Y_SIDECAR_T + 4.4
Y_SQL2_T = Y_SQL1_T + 4.4
Y_REST_T = Y_SQL2_T + 4.4
Y_END_T = Y_REST_T + 4.4
YACI_STORE_DURATION = Y_END_T + 4.0

SQL_QUERIES = [
    (Y_SQL1_T, ["block"], ["SELECT number, hash, slot,", "       slot_leader FROM block",
                          "WHERE number > $1", "ORDER BY number LIMIT 24"],
     "24 rows: the descendant blocks"),
    (Y_SQL2_T, ["bridge_utxo_history"], ["SELECT tx_hash, datum", "FROM bridge_utxo_history",
                                         "WHERE block_no <= $1", "  AND assets_policy = $2"],
     "1 row: HostState at that block"),
]


def table_card_pos(name):
    for tname, _, col, row in YACI_TABLES:
        if tname == name:
            return DB_X + 14 + col * (CARD_W + 6), DB_Y + 48 + row * (CARD_H + 8)
    i = BRIDGE_TABLES.index(name)
    return DB_X + 14 + i * 186, DB_Y + 48 + 4 * (CARD_H + 8) + 12


def rows_written(name, t):
    """How many rows have landed in a table by time t."""
    n = 0
    for b, writes in enumerate(BLOCK_WRITES):
        if name in writes:
            land = Y_BLOCK_T0 + b * Y_BLOCK_STEP + 0.9 + writes.index(name) * 0.18 + 0.5
            n += t >= land
    return n


def scene_yaci_store(t: float) -> Image.Image:
    c = Canvas()
    header(c, t, "What Yaci Store is", "A chain follower that fills a Postgres database.")
    a = prog(t, 0.2, 1.0)
    off = t * 30

    # Node and Yaci
    nx, ny, nw, nh = NODE
    box(c, nx, ny, nw, nh, "cardano-node", "local node, or a public relay", GREEN, a, 15, 12)
    yx, yy, yw, yh = YACI
    c.rrect(yx, yy, yw, yh, fill=fade(PANEL, a), outline=fade(TEAL, a), width=2.5, r=12)
    c.text(yx + 14, yy + 12, "Yaci Store", 17, fade(TEXT, a, PANEL), "bold")
    c.text(yx + 14, yy + 36, "Java indexer, not a node", 12, fade(MUTED, a, PANEL))
    c.text(yx + 14, yy + 54, "bloxbean/yaci-store", 11, fade(MUTED, a, PANEL), "mono")
    c.text(yx + 14, yy + 88, "follows the chain", 12, fade(TEXT, a, PANEL))
    c.text(yx + 14, yy + 106, "writes rows to Postgres", 12, fade(TEXT, a, PANEL))
    c.text(yx + 14, yy + 124, "REST API on :8081", 12, fade(TEXT, a, PANEL))
    c.arrow((nx + nw / 2, ny + nh), (nx + nw / 2, yy), fade(GREEN, a), 2, dashed=True,
            offset=-off)
    c.text(nx + nw / 2 + 8, ny + nh + 14, "ChainSync +", 11, fade(GREEN, a))
    c.text(nx + nw / 2 + 8, ny + nh + 28, "BlockFetch", 11, fade(GREEN, a))
    c.arrow((yx + yw, yy + 60), (DB_X, yy + 60), fade(TEAL, a), 2)

    # Database
    c.rrect(DB_X, DB_Y, DB_W, DB_H, fill=fade((22, 31, 47), a), outline=fade(BORDER, a),
            width=2, r=14)
    c.text(DB_X + 16, DB_Y + 13, "Postgres", 17, fade(TEXT, a, (22, 31, 47)), "bold")
    c.text(DB_X + 104, DB_Y + 16, "database yaci_store", 12, fade(MUTED, a, (22, 31, 47)),
           "mono")
    off_a = prog(t, Y_OFF_T, Y_OFF_T + 0.5)
    if off_a > 0:
        c.text(DB_X + DB_W - 16, DB_Y + 16, "not indexed: assets · metadata · governance", 11,
               fade(RED, off_a * 0.9, (22, 31, 47)), anchor="ra")

    active_tables = set()
    for q_t, tables, _, _ in SQL_QUERIES:
        if q_t + 0.8 <= t < q_t + 4.0:
            active_tables.update(tables)
    def card(name, cols, x, y, w, color, alpha, rows):
        on = name in active_tables
        under = (22, 31, 47)
        c.rrect(x, y, w, CARD_H, fill=fade(PANEL_2 if on else PANEL, alpha, under),
                outline=fade(color if on else mix(BORDER, color, 0.5), alpha, under),
                width=2.5 if on else 1.5, r=8)
        c.text(x + 10, y + 8, name, 12 if w > 200 else 11, fade(color, alpha, PANEL), "mono")
        if cols:
            c.text(x + 10, y + 26, cols, 10, fade(MUTED, alpha, PANEL), "mono")
        for k in range(rows):
            c.rrect(x + 10 + k * 22, y + 43, 18, 7, fill=fade(color, alpha, PANEL), r=3)

    for name, cols, _, _ in YACI_TABLES:
        x, y = table_card_pos(name)
        card(name, cols, x, y, CARD_W, TEAL, a, rows_written(name, t))

    # Bridge tables appear with the sidecar
    side_a = prog(t, Y_SIDECAR_T, Y_SIDECAR_T + 0.6)
    by = table_card_pos(BRIDGE_TABLES[0])[1]
    if side_a > 0:
        c.text(DB_X + DB_W - 16, by + CARD_H + 8, "written by bridge-history-sync", 10,
               fade(AMBER, side_a, (22, 31, 47)), anchor="ra")
        for i, bt in enumerate(BRIDGE_TABLES):
            x, y = table_card_pos(bt)
            filled = int(prog(t, Y_SIDECAR_T + 1.2 + i * 0.4, Y_SIDECAR_T + 2.4 + i * 0.4) * 3)
            card(bt, None, x, y, 180, AMBER, side_a, filled)

    # Blocks travelling from node to Yaci, then rows fanning into tables
    for b, writes in enumerate(BLOCK_WRITES):
        start = Y_BLOCK_T0 + b * Y_BLOCK_STEP
        u = prog(t, start, start + 0.8)
        if start <= t < start + 0.9:
            x, y = travel((nx + nw / 2, ny + nh + 14), (yx + yw / 2, yy - 14), u)
            c.rrect(x - 26, y - 13, 52, 26, fill=GREEN, r=6)
            c.text(x, y, f"block {101 + b}", 10, BG, "bold", anchor="mm")
        for k, tname in enumerate(writes):
            s = start + 0.9 + k * 0.18
            v = prog(t, s, s + 0.5)
            if s <= t < s + 0.5:
                tx, ty = table_card_pos(tname)
                x, y = travel((yx + yw - 10, yy + 60), (tx + 30, ty + 30), v)
                c.circle(x, y, 5, fill=TEAL)

    # Sidecar
    sx, sy, sw, sh = SIDECAR
    box(c, sx, sy, sw, sh, "bridge-history-sync", "sidecar: copies only the bridge's rows "
        "into bridge_* tables", AMBER, side_a, 15, 12)
    if side_a > 0:
        c.arrow((sx, sy + 70), (DB_X + DB_W, sy + 70), fade(AMBER, side_a), 2, dashed=True,
                offset=off)
        for i in range(3):
            s = Y_SIDECAR_T + 1.2 + i * 0.4
            v = prog(t, s, s + 0.7)
            if s <= t < s + 0.7:
                tx, ty = table_card_pos(BRIDGE_TABLES[i])
                x, y = travel((sx, sy + 70), (tx + 90, ty + 30), v)
                c.circle(x, y, 5, fill=AMBER)

    # Gateway and its queries
    gx, gy, gw, gh = GW
    c.rrect(gx, gy, gw, gh, fill=fade(PANEL, a), outline=fade(BLUE, a), width=2, r=12)
    c.text(gx + 14, gy + 12, "Gateway", 17, fade(TEXT, a, PANEL), "bold")
    c.text(gx + 14, gy + 36, "reads it like any Postgres database", 12, fade(MUTED, a, PANEL))
    for q_t, tables, sql, result in SQL_QUERIES:
        qa = prog(t, q_t, q_t + 0.5) * (1 - prog(t, q_t + 4.0, q_t + 4.4))
        if qa <= 0:
            continue
        c.rrect(gx + 12, gy + 62, gw - 24, 104, fill=fade(BG, qa, PANEL),
                outline=fade(BLUE, qa * 0.6, PANEL), width=1, r=8)
        for i, line in enumerate(sql):
            c.text(gx + 22, gy + 72 + i * 22, line, 11, fade(TEXT, qa, BG), "mono")
        tx, ty = table_card_pos(tables[0])
        ra = prog(t, q_t + 0.8, q_t + 1.2) * qa
        if ra > 0:
            # Route around the cards: out of the Gateway, along a gap, into the card.
            if tables[0] in BRIDGE_TABLES:
                gap_y, end = ty + CARD_H + 26, (tx + 90, ty + CARD_H)
            else:
                gap_y, end = DB_Y + 40, (tx + CARD_W / 2, ty)
            path = [(gx, gy + 114), (DB_X + DB_W + 18, gy + 114),
                    (DB_X + DB_W + 18, gap_y), (end[0], gap_y), end]
            for p1, p2 in zip(path[:-2], path[1:-1]):
                c.dashed(p1, p2, fade(BLUE, ra), 2, offset=off)
            c.arrow(path[-2], path[-1], fade(BLUE, ra), 2, head=8)
        res = prog(t, q_t + 1.6, q_t + 2.1) * qa
        if res > 0:
            c.chip(gx + 12, gy + 178, result, GREEN, alpha=res, under=PANEL, size=12)

    # REST call along the lower lane
    ra = prog(t, Y_REST_T, Y_REST_T + 0.5) * (1 - prog(t, Y_REST_T + 4.0, Y_REST_T + 4.4))
    if ra > 0:
        path = [(gx, gy + gh - 30), (DB_X + DB_W + 18, gy + gh - 30),
                (DB_X + DB_W + 18, LANE_Y2), (yx + yw / 2, LANE_Y2), (yx + yw / 2, yy + yh)]
        for p1, p2 in zip(path, path[1:]):
            c.dashed(p1, p2, fade(BLUE, ra), 2, offset=off)
        c.text((DB_X + DB_X + DB_W) / 2, LANE_Y2 + 8, "GET :8081/api/v1/blocks/{hash}/cbor",
               12, fade(BLUE, ra), "mono", anchor="ma")
        c.rrect(gx + 12, gy + 62, gw - 24, 104, fill=fade(BG, ra, PANEL),
                outline=fade(BLUE, ra * 0.6, PANEL), width=1, r=8)
        c.text(gx + 22, gy + 72, "GET /api/v1/blocks/", 11, fade(TEXT, ra, BG), "mono")
        c.text(gx + 22, gy + 94, "    {hash}/cbor", 11, fade(TEXT, ra, BG), "mono")
        back = prog(t, Y_REST_T + 1.2, Y_REST_T + 2.4)
        if Y_REST_T + 1.2 <= t < Y_REST_T + 2.4:
            x, y = along(path[::-1], back)
            c.rrect(x - 30, y - 12, 60, 24, fill=TEAL, r=6)
            c.text(x, y, "84 03 …", 10, BG, "mono", anchor="mm")
        res = prog(t, Y_REST_T + 2.3, Y_REST_T + 2.8) * ra
        if res > 0:
            c.chip(gx + 12, gy + 178, "raw block CBOR it saved", GREEN, alpha=res, under=PANEL,
                   size=12)

    caption(c, t, [
        (0.6, "Yaci Store is an indexer, not a node: a Java program that follows a Cardano "
              "node block by block."),
        (Y_BLOCK_T0 + 0.9, "It unpacks each block into rows in its own Postgres database: "
                           "blocks, transactions, inputs and UTxOs."),
        (Y_BLOCK_T0 + Y_BLOCK_STEP + 0.9, "Pool registrations and epoch nonces land in their "
                                          "own tables too."),
        (Y_OFF_T, "Our config switches off assets, metadata and governance, and keeps raw "
                  "block and transaction CBOR."),
        (Y_SIDECAR_T, "A sidecar, bridge-history-sync, copies just the bridge's own rows into "
                      "bridge_* tables in the same database."),
        (Y_SQL1_T, "The Gateway queries it with plain SQL, for example the blocks built on top "
                   "of an anchor."),
        (Y_SQL2_T, "It reads the bridge tables the same way, for example where the HostState "
                   "UTxO was at a given block."),
        (Y_REST_T, "For raw block bytes it calls Yaci's REST API, which serves the CBOR it "
                   "saved."),
        (Y_END_T, "So Yaci Store is a chain follower plus a Postgres database. It runs on "
                  "every network."),
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


# A slower run: three large pools produce most blocks and two newly registered
# pools (N1, N2) add depth without counting. Depth reaches 24 with only 4 pools
# and 3.3% stake; the fifth pool arrives at block 26 and enough stake at block 30.
SLOW_POOLS = {
    "P1": (0.9, BLUE, True), "P2": (0.6, PURPLE, True), "P3": (1.1, TEAL, True),
    "N1": (1.4, PINK, False), "N2": (1.0, (251, 113, 133), False),
    "P5": (0.7, (163, 230, 53), True), "P6": (0.8, (251, 146, 60), True),
    "P7": (1.3, (129, 140, 248), True),
}
SLOW_LEADERS = ["P1", "P3", "P1", "N1", "P3", "P1", "P2", "P3", "N2", "P1", "P3",
                "N1", "P1", "P2", "P3", "N2", "P1", "P5", "P3", "N1", "P1", "P3",
                "N2", "P2", "P1", "P6", "P3", "N1", "P1", "P7"]

FINALITY_STEP = 0.42
FINALITY_FIRST = 2.0
DEPTH_GOAL, POOLS_GOAL, STAKE_GOAL = 24, 5, 5.11


def finality_metrics(leaders, pools_table):
    """Cumulative (depth, qualified pools, stake %) after each block."""
    seen: set = set()
    pools, stake, out = 0, 0.0, []
    for i, pid in enumerate(leaders):
        stake_pct, _, eligible = pools_table[pid]
        if pid not in seen:
            seen.add(pid)
            if eligible:
                pools += 1
                stake += stake_pct
        out.append((i + 1, pools, stake))
    return out


def accepted_at(leaders, pools_table) -> int:
    for depth, pools, stake in finality_metrics(leaders, pools_table):
        if depth >= DEPTH_GOAL and pools >= POOLS_GOAL and stake >= STAKE_GOAL - 1e-9:
            return depth
    raise ValueError("thresholds are never met")


def draw_finality(c: Canvas, t: float, leaders, pools_table, cols, note):
    """Shared layout for the finality scenes. note is (text, block index)."""
    a = prog(t, 0.3, 1.2)
    anc = prog(t, 1.0, 1.6)
    c.rrect(40, 118, 130, 120, fill=fade((20, 50, 40), anc), outline=fade(GREEN, anc),
            width=2.5, r=10)
    c.text(105, 138, "anchor", 16, fade(TEXT, anc, (20, 50, 40)), "bold", anchor="ma")
    c.text(105, 162, "block", 16, fade(TEXT, anc, (20, 50, 40)), "bold", anchor="ma")
    c.text(105, 190, "HostState tx", 12, fade(GREEN, anc, (20, 50, 40)), anchor="ma")
    c.text(105, 206, "new root", 12, fade(GREEN, anc, (20, 50, 40)), anchor="ma")

    pitch = 960 / cols
    bw = pitch - 10
    metrics = finality_metrics(leaders, pools_table)
    shown, pools, stake = 0, 0, 0.0
    for i, pid in enumerate(leaders):
        start = FINALITY_FIRST + i * FINALITY_STEP
        u = prog(t, start, start + 0.25)
        if u <= 0:
            break
        shown, pools, stake = metrics[i]
        _, col, eligible = pools_table[pid]
        row, colm = divmod(i, cols)
        bx = 196 + colm * pitch
        by = 128 + row * 64
        c.rrect(bx, by, bw, 50, fill=fade(PANEL_2, u), outline=fade(col, u), width=2,
                r=8)
        c.text(bx + bw / 2, by + 9, pid, 15, fade(col, u, PANEL_2), "bold",
               anchor="ma")
        c.text(bx + bw / 2, by + 30, f"#{i + 1}", 11, fade(MUTED, u, PANEL_2),
               anchor="ma")
        if not eligible:
            c.dashed((bx + 4, by + 46), (bx + bw - 4, by + 4),
                     fade(PINK, u * 0.8, PANEL_2), 1.5, dash=4, gap=3)
        if colm == 0 and row == 0:
            c.arrow((170, 153), (bx - 2, by + 25), fade(BORDER, u), 2, head=7)

    my = 300
    meters = [
        ("Descendant blocks", shown, DEPTH_GOAL, f"{shown} / {DEPTH_GOAL}"),
        ("Qualified unique pools", pools, POOLS_GOAL, f"{pools} / {POOLS_GOAL}"),
        ("Unique stake from those pools", stake, STAKE_GOAL,
         f"{stake:.2f}% / {STAKE_GOAL:.2f}%"),
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

    note_text, note_index = note
    note_at = FINALITY_FIRST + (note_index - 1) * FINALITY_STEP
    na = prog(t, note_at, note_at + 0.5)
    if na > 0:
        c.chip(40, 512, note_text, PINK, alpha=na, size=13)

    done_at = FINALITY_FIRST + accepted_at(leaders, pools_table) * FINALITY_STEP
    done = prog(t, done_at + 0.2, done_at + 0.8)
    if done > 0:
        c.rrect(40, 548, 1120, 40, fill=fade((20, 60, 40), done),
                outline=fade(GREEN, done), width=2, r=10)
        c.text(W / 2, 568, "All three thresholds met: the anchor block's "
               "ibc_state_root becomes a new consensus state", 16,
               fade(TEXT, done, (20, 60, 40)), "bold", anchor="mm")
    return done_at


def scene_finality(t: float) -> Image.Image:
    c = Canvas()
    header(c, t, "Why the client waits for 24 blocks",
           "A header's state root is accepted only once enough independent stake "
           "has built blocks on top of it.")
    done_at = draw_finality(c, t, LEADERS, POOLS, 12, (
        "P4 registered too recently: its blocks add depth, but not pools or stake", 6))
    step, first = FINALITY_STEP, FINALITY_FIRST
    caption(c, t, [
        (1.0, "The anchor block holds the HostState transaction with the new IBC "
              "state root."),
        (2.0, "Blocks built on top count toward three thresholds. Each block names "
              "the pool that produced it."),
        (first + 6 * step, "A pool counts once, and only if it was registered "
                           "early enough, so fresh pools cannot pad the numbers."),
        (done_at + 0.2, "Once all three thresholds are met, the header's state root "
                        "is accepted."),
    ])
    return c.finish()


def scene_finality_slow(t: float) -> Image.Image:
    c = Canvas()
    header(c, t, "Why 24 blocks is a minimum, not a guarantee",
           "Depth alone does not accept a root. Pool and stake thresholds can take "
           "longer to fill.")
    done_at = draw_finality(c, t, SLOW_LEADERS, SLOW_POOLS, 15, (
        "N1 and N2 registered too recently: their blocks add depth, but not pools "
        "or stake", 4))
    step, first = FINALITY_STEP, FINALITY_FIRST
    caption(c, t, [
        (1.0, "Same rules, a different run. The anchor block holds the new IBC "
              "state root."),
        (2.0, "Most blocks come from a few large pools, so depth grows faster than "
              "the number of independent pools."),
        (first + 5 * step, "Blocks from newly registered pools add depth, but not "
                           "pools or stake."),
        (first + 23 * step + 0.3, "Block 24: depth is met, but only 4 qualifying pools "
                            "and 3.30% of stake have taken part, so the client waits."),
        (first + 25 * step + 0.3, "A fifth qualifying pool appears at block 26, but "
                            "stake is still short of 5.11%."),
        (done_at + 0.2, "At block 30 enough qualifying stake has taken part, and "
                        "the root is accepted."),
    ])
    return c.finish()


# ------------------------------------------------------------- driver ---

SCENES = {
    # Played 10% slower than its timeline; there is a lot of text per step.
    "gateway-data-sources": (lambda t: scene_gateway_calls(t / 1.1),
                             GATEWAY_CALLS_DURATION * 1.1),
    "yaci-store": (scene_yaci_store, YACI_STORE_DURATION),
    "membership-proof": (scene_membership_proof, 18.5),
    "finality-thresholds": (scene_finality, 16.5),
    "finality-thresholds-slow": (scene_finality_slow, 19.5),
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
