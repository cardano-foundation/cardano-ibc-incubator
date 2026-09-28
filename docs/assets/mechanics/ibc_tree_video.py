#!/usr/bin/env python3
"""Render a motion-graphics video of the IBC state tree evolving under traffic.

The tree is the real sparse Merkle tree the bridge commits to in the HostState
datum: keys are the real ICS-24 paths, positions come from the first bits of
sha256(key), and every root shown is computed exactly like ics23MerkleTree.ts.
Only the stored values are illustrative bytes.

    python3 docs/assets/mechanics/ibc_tree_video.py            # full video
    python3 docs/assets/mechanics/ibc_tree_video.py --still 30  # one frame

Requires Pillow and ffmpeg.
"""

from __future__ import annotations

import hashlib
import math
import random
import subprocess
import sys
from dataclasses import dataclass, field
from multiprocessing import Pool
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))
import render as R  # noqa: E402  (shared palette, fonts and canvas)
from render import (AMBER, BG, BLUE, BORDER, FAINT, GREEN, MUTED, PANEL, PANEL_2,  # noqa: E402
                    PINK, PURPLE, RED, TEAL, TEXT, clamp, ease, fade, lerp, mix)

OUT = Path(__file__).resolve().parent / "ibc-state-tree.mp4"
VW, VH, FPS = 1920, 1080, 30
S = R.S
LIME = (163, 230, 53)
MINT = (134, 239, 172)

# ------------------------------------------------------------ the tree ---

DEPTH_BITS = 64
EMPTY = bytes(32)


def sha(b: bytes) -> bytes:
    return hashlib.sha256(b).digest()


def key_index(key: str) -> int:
    return int.from_bytes(sha(key.encode())[:8], "big")


def leaf_hash(key: str, value: bytes) -> bytes:
    if not value:
        return EMPTY
    return sha(b"\x00" + sha(key.encode()) + sha(value))


def inner_hash(left: bytes, right: bytes) -> bytes:
    if left == EMPTY and right == EMPTY:
        return EMPTY
    return sha(b"\x01" + left + right)


def tree_root(leaves: dict[str, bytes]) -> str:
    """Same algorithm as Ics23MerkleTree.ensureRebuilt, sparse over 64 levels."""
    level: dict[int, bytes] = {}
    for key, value in leaves.items():
        h = leaf_hash(key, value)
        if h != EMPTY:
            level[key_index(key)] = h
    for _ in range(DEPTH_BITS):
        parents: dict[int, bytes] = {}
        for idx in {i >> 1 for i in level}:
            p = inner_hash(level.get(idx << 1, EMPTY), level.get((idx << 1) + 1, EMPTY))
            if p != EMPTY:
                parents[idx] = p
        level = parents
    return level.get(0, EMPTY).hex()


# ---------------------------------------------------------- the traffic ---

KIND = {
    "clientState": ("client state", GREEN),
    "consensusStates": ("consensus state", MINT),
    "connections": ("connection", BLUE),
    "channelEnds": ("channel", PURPLE),
    "nextSequence": ("sequence counter", TEAL),
    "commitments": ("packet commitment", AMBER),
    "receipts": ("packet receipt", PINK),
    "acks": ("acknowledgement", LIME),
}


def key_kind(key: str) -> str:
    if key.endswith("clientState"):
        return "clientState"
    if "/consensusStates/" in key:
        return "consensusStates"
    if key.startswith("nextSequence"):
        return "nextSequence"
    return key.split("/")[0]


CLIENT = "07-tendermint-0"


def chan(c: int) -> str:
    return f"ports/transfer/channels/channel-{c}"


@dataclass
class Op:
    name: str
    blurb: str
    writes: list  # (key, value bytes); empty bytes deletes
    t: float = 0.0
    dur: float = 0.0
    root: str = ""
    version: int = 0
    before: dict = field(default_factory=dict)
    after: dict = field(default_factory=dict)


def build_ops() -> list[Op]:
    ops: list[Op] = []
    seq_send = {0: 1, 1: 1}
    seq_recv = {0: 1, 1: 1}
    height = [100]

    def update_client():
        height[0] += random.choice([6, 8, 12])
        ops.append(Op("UpdateClient", "a newer Cosmos header adds a consensus state", [
            (f"clients/{CLIENT}/consensusStates/{height[0]}", f"cs@{height[0]}".encode()),
            (f"clients/{CLIENT}/clientState", f"latest={height[0]}".encode()),
        ]))

    def open_channel(c):
        ops.append(Op("ChanOpenInit", "a transfer channel starts with its sequence counters", [
            (f"channelEnds/{chan(c)}", b"INIT"),
            (f"nextSequenceSend/{chan(c)}", b"1"),
            (f"nextSequenceRecv/{chan(c)}", b"1"),
            (f"nextSequenceAck/{chan(c)}", b"1"),
        ]))
        ops.append(Op("ChanOpenAck", "Cosmos agreed: the channel is OPEN",
                      [(f"channelEnds/{chan(c)}", b"OPEN")]))

    def send(c):
        n = seq_send[c]
        seq_send[c] += 1
        ops.append(Op("SendPacket", "a transfer leaves Cardano, its commitment waits for an ack", [
            (f"commitments/{chan(c)}/sequences/{n}", f"commit#{c}.{n}".encode()),
            (f"nextSequenceSend/{chan(c)}", str(n + 1).encode()),
        ]))
        return n

    def ack(c, n):
        ops.append(Op("AcknowledgePacket", "Cosmos acknowledged, so the commitment is deleted",
                      [(f"commitments/{chan(c)}/sequences/{n}", b"")]))

    def timeout(c, n):
        ops.append(Op("TimeoutPacket", "not delivered in time: the commitment is deleted",
                      [(f"commitments/{chan(c)}/sequences/{n}", b"")]))

    def recv(c):
        n = seq_recv[c]
        seq_recv[c] += 1
        ops.append(Op("RecvPacket", "a transfer arrives: Cardano writes a receipt and an ack", [
            (f"receipts/{chan(c)}/sequences/{n}", b"\x01"),
            (f"acks/{chan(c)}/sequences/{n}", f"ack#{c}.{n}".encode()),
        ]))

    # Handshake
    ops.append(Op("CreateClient", "Cardano starts tracking Cosmos with a Tendermint client", [
        (f"clients/{CLIENT}/clientState", b"latest=100"),
        (f"clients/{CLIENT}/consensusStates/100", b"cs@100"),
    ]))
    update_client()
    ops.append(Op("ConnOpenInit", "Cardano opens a connection to Cosmos",
                  [("connections/connection-0", b"INIT")]))
    ops.append(Op("ConnOpenAck", "Cosmos agreed: the connection is OPEN",
                  [("connections/connection-0", b"OPEN")]))
    open_channel(0)
    # First round trip
    first = send(0)
    recv(0)
    ack(0, first)
    handshake_end = len(ops)

    # High traffic
    pending = {0: [], 1: []}
    for step in range(TRAFFIC_STEPS):
        if step == 7:
            open_channel(1)
            continue
        if step % 9 == 4:
            update_client()
            continue
        if step == TIMEOUT_STEP and (pending[0] or pending[1]):
            c = 0 if pending[0] else 1
            timeout(c, pending[c].pop(0))
            continue
        channels = [0] if step < 9 else [0, 1]
        c = random.choice(channels)
        roll = random.random()
        if roll < 0.42:
            pending[c].append(send(c))
        elif roll < 0.72:
            recv(c)
        elif pending[c]:
            n = pending[c].pop(0)
            ack(c, n)
        else:
            recv(c)
    # Let the last packets settle
    for c in (0, 1):
        for n in pending[c]:
            ack(c, n)
    return ops, handshake_end


TRAFFIC_STEPS = 23
TIMEOUT_STEP = 15
HANDSHAKE_SPACING = 1.25
TRAFFIC_SPACING = (0.85, 0.34)

random.seed(7)
OPS, HANDSHAKE_END = build_ops()

INTRO = 0.8
OUTRO = 2.1


def schedule():
    t = INTRO
    state: dict[str, bytes] = {}
    n = len(OPS)
    for i, op in enumerate(OPS):
        if i < HANDSHAKE_END:
            spacing = HANDSHAKE_SPACING
        else:
            k = (i - HANDSHAKE_END) / max(1, n - HANDSHAKE_END - 1)
            # Speed up through the burst, easing back for the last few.
            fast, peak = TRAFFIC_SPACING
            spacing = lerp(fast, peak, ease(min(1, k * 1.6))) + 0.4 * ease(max(0, k - 0.85) / 0.15)
        op.t, op.dur = t, spacing
        op.before = dict(state)
        for key, value in op.writes:
            if value:
                state[key] = value
            else:
                state.pop(key, None)
        op.after = dict(state)
        op.root = tree_root(state)
        op.version = i + 1
        t += spacing
    return t


END_OF_TRAFFIC = schedule()
DURATION = END_OF_TRAFFIC + OUTRO
ALL_KEYS = []
for _op in OPS:
    for _k, _ in _op.writes:
        if _k not in ALL_KEYS:
            ALL_KEYS.append(_k)

# ---------------------------------------------------------------- look ---

# Cinematic monochrome: near-black, white hairlines, one accent for activity.
INK = (5, 5, 6)
GHOST = (26, 26, 30)
BRANCH = (74, 76, 84)
NODE = (150, 152, 162)
WHITE = (236, 238, 244)
DIM = (120, 122, 132)
ACCENT = (77, 163, 255)
R.FONT_CANDIDATES["light"] = [("/System/Library/Fonts/HelveticaNeue.ttc", 7),
                              ("/usr/share/fonts/truetype/dejavu/DejaVuSans-ExtraLight.ttf", 0)]
R.FONT_CANDIDATES["thin"] = [("/System/Library/Fonts/HelveticaNeue.ttc", 5),
                             ("/usr/share/fonts/truetype/dejavu/DejaVuSans-ExtraLight.ttf", 0)]

# --------------------------------------------------------------- layout ---

SHOW_DEPTH = 6
ROOT_XY = (VW / 2, 200)
LEVEL_DY = 74
TREE_X0, TREE_X1 = 140, VW - 140
LEAF_Y = ROOT_XY[1] + SHOW_DEPTH * LEVEL_DY + 78
LEAF_DY = 20


def node_xy(depth: int, idx: int):
    n = 2 ** depth
    x = TREE_X0 + (TREE_X1 - TREE_X0) * (idx + 0.5) / n
    return x, ROOT_XY[1] + depth * LEVEL_DY


def slot_of(key: str, depth: int = SHOW_DEPTH) -> int:
    return key_index(key) >> (DEPTH_BITS - depth)


# Keys sharing a visible slot stack under it in first-insertion order.
STACK: dict[str, int] = {}
_per_slot: dict[int, int] = {}
for _k in ALL_KEYS:
    s = slot_of(_k)
    STACK[_k] = _per_slot.get(s, 0)
    _per_slot[s] = STACK[_k] + 1


def leaf_xy(key: str):
    x, _ = node_xy(SHOW_DEPTH, slot_of(key))
    return x, LEAF_Y + STACK[key] * LEAF_DY


# -------------------------------------------------------------- timing ---

def op_phases(op: Op):
    """Fly, land, ripple and commit times for one operation."""
    d = min(op.dur, 2.7)
    fly = op.t + 0.1 * d
    land = op.t + 0.38 * d
    ripple_end = op.t + 0.66 * d
    commit = op.t + 0.72 * d
    return fly, land, ripple_end, commit


def current_op_index(t: float) -> int:
    idx = -1
    for i, op in enumerate(OPS):
        if op.t <= t:
            idx = i
    return idx


def traffic(t: float) -> float:
    """0 during the handshake, rising to 1 at peak traffic."""
    start = OPS[HANDSHAKE_END].t
    peak = OPS[HANDSHAKE_END].t + 0.7 * (END_OF_TRAFFIC - OPS[HANDSHAKE_END].t)
    return ease((t - start) / (peak - start)) * (1 - ease((t - END_OF_TRAFFIC + 4) / 4))


def camera(t: float):
    """Zoom and root screen position: a slow drift and a push as traffic builds."""
    z = 1.0 + 0.05 * traffic(t) + 0.015 * math.sin(t * 0.21)
    dx = 16 * math.sin(t * 0.13)
    root_y = ROOT_XY[1] + 6 * math.sin(t * 0.17 + 1)
    return z, dx, root_y


# ------------------------------------------------------------ drawing ---

def make_background():
    small = Image.new("RGB", (192, 108))
    px = small.load()
    for y in range(108):
        for x in range(192):
            dx, dy = (x - 96) / 100, (y - 38) / 78
            r = min(1.0, math.hypot(dx, dy))
            px[x, y] = mix((16, 17, 21), (3, 3, 4), r ** 1.2)
    return small.resize((VW * S, VH * S), Image.BICUBIC)


BACKGROUND = None


class Frame:
    def __init__(self, t: float):
        global BACKGROUND
        if BACKGROUND is None:
            BACKGROUND = make_background()
        self.t = t
        self.c = R.Canvas(VW, VH)
        self.c.img = BACKGROUND.copy()
        self.c.d = ImageDraw.Draw(self.c.img)
        # Out-of-focus layer for the empty tree, drawn at half size and blurred.
        self.far = Image.new("RGB", (VW // 2, VH // 2))
        self.fd = ImageDraw.Draw(self.far)
        self.glow = Image.new("RGB", (VW // 4, VH // 4))
        self.g = ImageDraw.Draw(self.glow)
        self.z, self.dx, self.root_y = camera(t)

    def glow_dot(self, x, y, r, color, strength=1.0):
        gx, gy, gr = x / 4, y / 4, r / 4
        col = tuple(int(v * strength) for v in color)
        self.g.ellipse([gx - gr, gy - gr, gx + gr, gy + gr], fill=col)

    def far_line(self, p1, p2, color, width=1.0):
        self.fd.line([(p1[0] / 2, p1[1] / 2), (p2[0] / 2, p2[1] / 2)], fill=color,
                     width=max(1, int(width)))

    def finish(self):
        far = self.far.filter(ImageFilter.GaussianBlur(2.2)).resize(
            (VW * S, VH * S), Image.BILINEAR)
        img = ImageChops.add(self.c.img, far)
        bloom = self.glow.filter(ImageFilter.GaussianBlur(6)).resize(
            (VW * S, VH * S), Image.BILINEAR)
        img = ImageChops.add(img, bloom).resize((VW, VH), Image.LANCZOS)
        out = ease((self.t - DURATION + 0.9) / 0.8)
        if out > 0:
            img = Image.blend(img, Image.new("RGB", img.size, (0, 0, 0)), out)
        return img


def ts(f: Frame, x, y):
    """World to screen: scale about the root, then drift."""
    return VW / 2 + f.dx + (x - ROOT_XY[0]) * f.z, f.root_y + (y - ROOT_XY[1]) * f.z


def tracked(c, x, y, text, size, color, kind="sans", spacing=0.18, anchor="l"):
    """Letter-spaced text for small uppercase labels."""
    widths = [c.text_width(ch, size, kind) for ch in text]
    total = sum(widths) + spacing * size * (len(text) - 1)
    cx = x - total if anchor == "r" else x - total / 2 if anchor == "m" else x
    for ch, w in zip(text, widths):
        c.text(cx, y, ch, size, color, kind)
        cx += w + spacing * size


def present_at(key: str, t: float):
    """(alpha, scale, (u, value) of the latest write) for a leaf at time t."""
    alive, flash, scale = 0.0, None, 1.0
    for op in OPS:
        _, land, _, _ = op_phases(op)
        for k, value in op.writes:
            if k != key:
                continue
            if t < land - 0.05:
                return alive, flash, scale
            u = clamp((t - land) / 0.45)
            if value:
                alive = 1.0
                if key not in op.before:
                    scale = ease(min(1, u * 2.5)) * (1 + 0.5 * math.sin(math.pi * u))
                else:
                    scale = 1 + 0.35 * math.sin(math.pi * u)
            else:
                alive, scale = 1 - ease(u), 1 - 0.6 * ease(u)
            flash = (u, value)
    return alive, flash, scale


def nonempty_nodes(state: dict):
    nodes = set()
    for key in state:
        idx = key_index(key)
        for depth in range(SHOW_DEPTH + 1):
            nodes.add((depth, idx >> (DEPTH_BITS - depth)))
    return nodes


def draw_tree(f: Frame, t: float):
    c = f.c
    z = f.z
    i = current_op_index(t)
    op = OPS[i] if i >= 0 else None
    committed = OPS[i - 1].after if i >= 1 else {}
    if op is not None:
        fly, land, ripple_end, commit = op_phases(op)
        state = op.after if t >= land else op.before
        new_nodes = nonempty_nodes(op.after) - nonempty_nodes(op.before)
    else:
        fly = land = ripple_end = commit = 0
        state, new_nodes = {}, set()
    live = nonempty_nodes(state)
    lw = max(1.0, 1.1 * z ** 0.5)
    k = 1.0
    ghost, branch, node, leaf = GHOST, BRANCH, NODE, WHITE

    # Empty tree, out of focus
    for depth in range(1, SHOW_DEPTH + 1):
        for idx in range(2 ** depth):
            if (depth, idx) in live:
                continue
            p = ts(f, *node_xy(depth - 1, idx >> 1))
            q = ts(f, *node_xy(depth, idx))
            f.far_line(p, q, ghost, 1)

    # Live branches
    for depth in range(1, SHOW_DEPTH + 1):
        for (d, idx) in live:
            if d != depth:
                continue
            p = ts(f, *node_xy(depth - 1, idx >> 1))
            q = ts(f, *node_xy(depth, idx))
            grow = 1.0
            if (d, idx) in new_nodes and t < land + 0.2:
                grow = clamp((t - fly - (depth - 1) * 0.045) / 0.2)
            if grow <= 0:
                continue
            c.line([p, (lerp(p[0], q[0], grow), lerp(p[1], q[1], grow))], branch, lw)

    # Hash recompute climbing each written path
    if op is not None and land <= t <= commit + 0.4:
        fade_out = 1 - clamp((t - commit) / 0.4)
        u = clamp((t - land) / max(0.05, ripple_end - land))
        head = (1 - u) * SHOW_DEPTH
        for key, _value in op.writes:
            idx = key_index(key)
            for depth in range(SHOW_DEPTH, 0, -1):
                if depth < head:
                    continue
                q = ts(f, *node_xy(depth, idx >> (DEPTH_BITS - depth)))
                p = ts(f, *node_xy(depth - 1, idx >> (DEPTH_BITS - depth + 1)))
                seg = clamp(depth - head)
                e = (lerp(q[0], p[0], seg), lerp(q[1], p[1], seg))
                c.line([q, e], mix(BRANCH, ACCENT, fade_out), 2.4 * lw)
                f.glow_dot((q[0] + e[0]) / 2, (q[1] + e[1]) / 2, 16, ACCENT, 0.5 * fade_out)
                sib = (idx >> (DEPTH_BITS - depth)) ^ 1
                if (depth, sib) in live and seg >= 1:
                    sx, sy = ts(f, *node_xy(depth, sib))
                    c.circle(sx, sy, 5 * z ** 0.5, outline=mix(BRANCH, WHITE, fade_out), width=1.2)

    # Nodes
    for (depth, idx) in live:
        if depth == 0:
            continue
        x, y = ts(f, *node_xy(depth, idx))
        c.circle(x, y, (3.2 - depth * 0.25) * z ** 0.6, fill=node)

    # Stems and leaves
    for key in ALL_KEYS:
        alive, flash, scale = present_at(key, t)
        if alive <= 0.01 and not (flash and flash[0] < 1):
            continue
        sx, sy = ts(f, *node_xy(SHOW_DEPTH, slot_of(key)))
        lx, ly = ts(f, *leaf_xy(key))
        c.dashed((sx, sy + 4), (lx, ly - 6), fade((58, 60, 68), alive * k, INK), 1, dash=2, gap=4)
        r = 3.6 * z ** 0.6 * max(scale, 0)
        if r > 0.2:
            c.circle(lx, ly, r, fill=fade(leaf, alive, INK))
            f.glow_dot(lx, ly, 10, WHITE, 0.16 * alive * k)
        if flash and flash[0] < 1:
            u, value = flash
            ring = (6 + 30 * ease(u)) * z ** 0.6
            col = ACCENT if value else WHITE
            c.circle(lx, ly, ring, outline=fade(col, 1 - u, INK), width=1.4)
            f.glow_dot(lx, ly, 26, col, 0.6 * (1 - u))

    # Root
    rx, ry = ts(f, *ROOT_XY)
    pulse = clamp(1 - abs(t - commit) / 0.4) if op is not None else 0.0
    has_root = bool(committed) or (op is not None and t >= commit)
    base = WHITE if has_root else DIM
    rr = (7 + 4 * ease(pulse)) * z ** 0.7
    f.glow_dot(rx, ry, (30 + 26 * pulse) * z ** 0.7, mix(WHITE, ACCENT, pulse),
               0.22 + 0.4 * pulse)
    c.circle(rx, ry, rr, fill=mix(base, ACCENT, pulse * 0.6))
    if pulse > 0:
        c.circle(rx, ry, rr + 34 * ease(1 - pulse) * z ** 0.5 + 4, outline=fade(ACCENT, pulse, INK),
                 width=1.4)


def root_text(t: float) -> tuple[str, int, float]:
    i = current_op_index(t)
    if i < 0:
        return EMPTY.hex(), 0, 0.0
    op = OPS[i]
    _, _, _, commit = op_phases(op)
    if t >= commit + 0.3:
        return op.root, op.version, 0.0
    prev = OPS[i - 1].root if i > 0 else EMPTY.hex()
    prev_v = OPS[i - 1].version if i > 0 else 0
    if t < commit - 0.25:
        return prev, prev_v, 0.0
    u = clamp((t - (commit - 0.25)) / 0.55)
    rnd = random.Random(int(t * FPS))
    settled = int(u * 64)
    chars = [op.root[k] if k < settled else rnd.choice("0123456789abcdef") for k in range(64)]
    return "".join(chars), op.version, 1 - u


def draw_hud(f: Frame, t: float):
    c = f.c
    a = ease(t / 0.6) * (1 - ease((t - DURATION + 1.0) / 0.9))
    i = current_op_index(t)
    op = OPS[i] if i >= 0 else None

    # Root label and hash beside the root
    rx, ry = ts(f, *ROOT_XY)
    text, version, scramble = root_text(t)
    lx = rx + 26 * f.z ** 0.7
    tracked(c, lx, ry - 22, "IBC STATE ROOT", 11, fade(DIM, a, INK), "bold", 0.28)
    c.text(lx, ry - 2, f"{text[:12]}…{text[-6:]}", 16, fade(mix(WHITE, ACCENT, scramble), a, INK),
           "mono")
    tracked(c, rx - 26 * f.z ** 0.7, ry - 8, f"V{version}", 11, fade(DIM, a, INK), "bold", 0.28,
            anchor="r")

    # Operation name, bottom left
    if op is not None:
        u = ease((t - op.t) / min(0.4, op.dur * 0.45))
        oa = u * a
        c.text(140, 956 - 14 * (1 - u), op.name, 60, fade(WHITE, oa, INK), "light")
        tracked(c, 144, 920 - 14 * (1 - u), f"TRANSACTION {op.version:02d}", 11,
                fade(DIM, oa, INK), "bold", 0.32)


def render_frame(i: int) -> bytes:
    t = i / FPS
    f = Frame(t)
    draw_tree(f, t)
    draw_hud(f, t)
    return f.finish().tobytes()


def main():
    if len(sys.argv) > 2 and sys.argv[1] == "--still":
        t = float(sys.argv[2])
        out = Path(sys.argv[3]) if len(sys.argv) > 3 else OUT.with_suffix(f".{t:05.1f}.png")
        Image.frombytes("RGB", (VW, VH), render_frame(int(t * FPS))).save(out)
        print(out)
        return
    frames = int(DURATION * FPS)
    print(f"{len(OPS)} operations, {DURATION:.1f} s, {frames} frames")
    ff = subprocess.Popen([
        "ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-s", f"{VW}x{VH}", "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "slow",
        "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(OUT)],
        stdin=subprocess.PIPE)
    with Pool() as pool:
        for n, frame in enumerate(pool.imap(render_frame, range(frames), chunksize=4)):
            ff.stdin.write(frame)
            if n % 300 == 0:
                print(f"  frame {n}/{frames}", flush=True)
    ff.stdin.close()
    ff.wait()
    print(f"{OUT.name}: {OUT.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
