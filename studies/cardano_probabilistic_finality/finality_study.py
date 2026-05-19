#!/usr/bin/env python3
"""Blockfrost-backed Cardano probabilistic finality timing study.

The fetch phase caches raw Blockfrost JSON. The analysis phase normalizes the
cached data and computes threshold crossing rows without network access.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import csv
import datetime as dt
import hashlib
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Any, Iterable, Sequence


BLOCKFROST_MAINNET_URL = "https://cardano-mainnet.blockfrost.io/api/v0"
CARDANO_POOL_REGISTRATION_CUTOFF = dt.datetime(
    2026, 1, 1, tzinfo=dt.timezone.utc
)
DEFAULT_CARDANO_SYSTEM_START = dt.datetime(
    2017, 9, 23, 21, 44, 51, tzinfo=dt.timezone.utc
)
DEFAULT_THRESHOLDS_BPS = (5000, 4000, 6000, 6700)


@dataclass(frozen=True)
class Block:
    hash: str
    epoch: int
    slot: int
    time: int
    height: int
    previous_block: str | None
    next_block: str | None
    slot_leader: str


@dataclass(frozen=True)
class StakeEntry:
    epoch: int
    pool_id: str
    active_stake: int


@dataclass(frozen=True)
class PoolRegistration:
    pool_id: str
    first_registration_slot: int | None
    source: str
    ambiguous: bool = False


@dataclass(frozen=True)
class AnchorResult:
    eligibility_mode: str
    threshold_bps: int
    anchor_hash: str
    epoch: int
    anchor_slot: int
    anchor_time: int
    crossed: bool
    crossing_depth: int | None
    seconds_to_crossing: int | None
    crossing_slot: int | None
    crossing_hash: str | None
    final_unique_stake_bps: int
    unique_pool_count: int
    descendant_count: int
    failure_reason: str


@dataclass(frozen=True)
class DataIssue:
    scope: str
    subject: str
    issue_type: str
    detail: str


def normalize_pool_id(pool_id: Any) -> str:
    return str(pool_id or "").strip().lower()


def parse_int(value: Any, default: int = 0) -> int:
    if value is None or value == "":
        return default
    return int(value)


def utc_from_unix(seconds: int) -> str:
    return dt.datetime.fromtimestamp(seconds, tz=dt.timezone.utc).isoformat()


def cutoff_slot(
    cutoff: dt.datetime = CARDANO_POOL_REGISTRATION_CUTOFF,
    system_start: dt.datetime = DEFAULT_CARDANO_SYSTEM_START,
    slot_length_seconds: int = 1,
) -> int:
    if cutoff <= system_start:
        return 0
    delta = cutoff - system_start
    return math.ceil(delta.total_seconds() / slot_length_seconds)


class BlockfrostCache:
    def __init__(
        self,
        cache_dir: Path,
        project_id: str | None,
        base_url: str = BLOCKFROST_MAINNET_URL,
        offline: bool = False,
        sleep_seconds: float = 0.0,
    ) -> None:
        self.cache_dir = cache_dir
        self.raw_dir = cache_dir / "raw"
        self.project_id = project_id
        self.base_url = base_url.rstrip("/")
        self.offline = offline
        self.sleep_seconds = sleep_seconds
        self.failures: list[DataIssue] = []
        self._failure_lock = Lock()
        self.raw_dir.mkdir(parents=True, exist_ok=True)

    def get_json(
        self,
        path: str,
        params: dict[str, Any] | None = None,
        *,
        allow_404: bool = False,
    ) -> Any:
        params = {k: v for k, v in (params or {}).items() if v is not None}
        cache_path = self._cache_path(path, params)
        if cache_path.exists():
            return json.loads(cache_path.read_text())
        if self.offline:
            raise RuntimeError(f"cache miss in offline mode: {path} {params}")
        if not self.project_id:
            raise RuntimeError(
                "BLOCKFROST_PROJECT_ID_MAINNET or BLOCKFROST_PROJECT_ID is required for fetch"
            )

        query = urllib.parse.urlencode(params)
        url = f"{self.base_url}{path}"
        if query:
            url = f"{url}?{query}"
        request = urllib.request.Request(url)
        request.add_header("project_id", self.project_id)
        request.add_header("User-Agent", "cardano-ibc-probabilistic-finality-study")
        payload = self._fetch_with_retries(request, path, allow_404)
        if payload is None:
            cache_path.write_text("null\n")
            return None

        if self.sleep_seconds > 0:
            time.sleep(self.sleep_seconds)
        tmp_path = cache_path.with_suffix(".tmp")
        tmp_path.write_text(payload + "\n")
        tmp_path.replace(cache_path)
        return json.loads(payload)

    def _fetch_with_retries(
        self, request: urllib.request.Request, path: str, allow_404: bool
    ) -> str | None:
        for attempt in range(1, 7):
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    return response.read().decode("utf-8")
            except urllib.error.HTTPError as exc:
                if allow_404 and exc.code == 404:
                    return None
                body = exc.read().decode("utf-8", errors="replace")
                if exc.code not in (429, 500, 502, 503, 504) or attempt == 6:
                    with self._failure_lock:
                        self.failures.append(
                            DataIssue("blockfrost", path, f"http_{exc.code}", body[:500])
                        )
                    raise
                retry_after = exc.headers.get("Retry-After")
                delay = float(retry_after) if retry_after else min(2**attempt, 30)
                time.sleep(delay)
            except urllib.error.URLError as exc:
                if attempt == 6:
                    with self._failure_lock:
                        self.failures.append(
                            DataIssue("blockfrost", path, "url_error", str(exc)[:500])
                        )
                    raise
                time.sleep(min(2**attempt, 30))
        raise RuntimeError(f"unreachable retry state for {path}")

    def get_pages(
        self,
        path: str,
        *,
        order: str = "asc",
        count: int = 100,
        page_limit: int | None = None,
    ) -> list[Any]:
        items: list[Any] = []
        page = 1
        while True:
            if page_limit is not None and page > page_limit:
                break
            batch = self.get_json(
                path, {"page": page, "count": count, "order": order}, allow_404=False
            )
            if not batch:
                break
            if not isinstance(batch, list):
                raise TypeError(f"expected list from {path}, got {type(batch).__name__}")
            items.extend(batch)
            if len(batch) < count:
                break
            page += 1
        return items

    def write_failures(self) -> None:
        if not self.failures:
            return
        path = self.cache_dir / "fetch_failures.jsonl"
        with path.open("a") as handle:
            for failure in self.failures:
                handle.write(json.dumps(failure.__dict__, sort_keys=True) + "\n")

    def _cache_path(self, path: str, params: dict[str, Any]) -> Path:
        key = json.dumps({"path": path, "params": params}, sort_keys=True)
        digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
        return self.raw_dir / f"{digest}.json"


def fetch_study_data(args: argparse.Namespace) -> None:
    cache_dir = Path(args.cache_dir)
    client = BlockfrostCache(
        cache_dir,
        project_id=args.project_id
        or os.getenv("BLOCKFROST_PROJECT_ID_MAINNET")
        or os.getenv("BLOCKFROST_PROJECT_ID"),
        base_url=args.base_url,
        offline=False,
        sleep_seconds=args.sleep_seconds,
    )

    tip = client.get_json("/blocks/latest")
    latest_epoch = client.get_json("/epochs/latest")
    tip_time = parse_int(tip.get("time"))
    window_end = dt.datetime.fromtimestamp(tip_time, tz=dt.timezone.utc)
    window_start = window_end - dt.timedelta(days=args.days)

    epochs: list[int] = []
    epoch_no = parse_int(latest_epoch.get("epoch"))
    while epoch_no >= 0:
        epoch_info = client.get_json(f"/epochs/{epoch_no}")
        first_time = parse_int(epoch_info.get("first_block_time") or epoch_info.get("start_time"))
        last_time = parse_int(epoch_info.get("last_block_time") or epoch_info.get("end_time"))
        end_time = parse_int(epoch_info.get("end_time"), last_time)

        if end_time > tip_time:
            epoch_no -= 1
            continue
        if last_time < int(window_start.timestamp()):
            break
        if first_time <= tip_time and last_time >= int(window_start.timestamp()):
            epochs.append(epoch_no)
        epoch_no -= 1

    epochs = sorted(set(epochs))
    if args.epoch_limit is not None:
        epochs = epochs[-args.epoch_limit :]

    producing_pools: set[str] = set()
    for epoch in epochs:
        print(f"Fetching epoch {epoch} block list", flush=True)
        block_refs = client.get_pages(f"/epochs/{epoch}/blocks", order="asc")
        if args.block_limit is not None:
            block_refs = block_refs[: args.block_limit]
        block_hashes = [
            block_ref.get("hash") if isinstance(block_ref, dict) else block_ref
            for block_ref in block_refs
        ]

        def fetch_block(block_hash: str) -> str:
            block = client.get_json(f"/blocks/{block_hash}")
            leader = normalize_pool_id(block.get("slot_leader"))
            if leader:
                producing_pools.add(leader)
            return str(block_hash)

        parallel_fetch(
            block_hashes,
            fetch_block,
            workers=args.workers,
            label=f"epoch {epoch} block details",
        )

    target_epochs = set(epochs)

    print(f"Fetching pool history for {len(producing_pools)} producing pools", flush=True)

    def fetch_pool_history(pool_id: str) -> str:
        found_epochs: set[int] = set()
        for page in range(1, args.pool_history_page_limit + 1):
            rows = client.get_json(
                f"/pools/{pool_id}/history",
                {"page": page, "count": 100, "order": "desc"},
                allow_404=False,
            )
            if not rows:
                break
            for row in rows:
                row_epoch = row.get("epoch")
                if row_epoch is not None and int(row_epoch) in target_epochs:
                    found_epochs.add(int(row_epoch))
            if target_epochs.issubset(found_epochs):
                break
        return pool_id

    parallel_fetch(
        sorted(producing_pools),
        fetch_pool_history,
        workers=args.workers,
        label="pool histories",
    )

    print(f"Fetching first registration slots for {len(producing_pools)} producing pools", flush=True)
    registration_fetch_disabled = {"value": False}
    registration_fetch_lock = Lock()

    def fetch_pool_registration(pool_id: str) -> str:
        with registration_fetch_lock:
            if registration_fetch_disabled["value"]:
                return pool_id
        try:
            updates = client.get_json(
                f"/pools/{pool_id}/updates",
                {"page": 1, "count": 100, "order": "asc"},
                allow_404=False,
            )
        except urllib.error.HTTPError as exc:
            if exc.code == 402:
                with registration_fetch_lock:
                    registration_fetch_disabled["value"] = True
                return pool_id
            raise
        seen_tx_hashes: set[str] = set()
        for update in updates[:1]:
            tx_hash = update.get("tx_hash")
            if not tx_hash or tx_hash in seen_tx_hashes:
                continue
            seen_tx_hashes.add(tx_hash)
            try:
                client.get_json(f"/txs/{tx_hash}", allow_404=True)
            except urllib.error.HTTPError as exc:
                if exc.code == 402:
                    with registration_fetch_lock:
                        registration_fetch_disabled["value"] = True
                    return pool_id
                raise
        return pool_id

    parallel_fetch(
        sorted(producing_pools),
        fetch_pool_registration,
        workers=args.workers,
        label="pool registrations",
    )

    metadata = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "window_start": window_start.isoformat(),
        "window_end": window_end.isoformat(),
        "days": args.days,
        "epochs": epochs,
        "tip_hash": tip.get("hash"),
        "tip_time": tip_time,
        "blockfrost_base_url": args.base_url,
        "block_limit": args.block_limit,
        "pool_history_page_limit": args.pool_history_page_limit,
        "stake_source": "epoch_active_stake_and_pool_history",
    }
    cache_dir.mkdir(parents=True, exist_ok=True)
    (cache_dir / "study_input.json").write_text(json.dumps(metadata, indent=2) + "\n")
    client.write_failures()


def parallel_fetch(
    items: Sequence[str],
    fn: Any,
    *,
    workers: int,
    label: str,
) -> None:
    total = len(items)
    if total == 0:
        return
    if workers <= 1:
        for index, item in enumerate(items, start=1):
            fn(item)
            if index == total or index % 1000 == 0:
                print(f"Fetched {index}/{total} {label}", flush=True)
        return

    completed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(fn, item) for item in items]
        for future in concurrent.futures.as_completed(futures):
            future.result()
            completed += 1
            if completed == total or completed % 1000 == 0:
                print(f"Fetched {completed}/{total} {label}", flush=True)


def load_cached_study(
    cache_dir: Path,
) -> tuple[
    dict[str, Any],
    dict[int, list[Block]],
    dict[int, dict[str, StakeEntry]],
    dict[int, int],
    dict[str, PoolRegistration],
    list[DataIssue],
]:
    client = BlockfrostCache(cache_dir, project_id=None, offline=True)
    metadata = json.loads((cache_dir / "study_input.json").read_text())
    issues: list[DataIssue] = []
    blocks_by_epoch: dict[int, list[Block]] = {}
    stake_by_epoch: dict[int, dict[str, StakeEntry]] = {}
    epoch_total_active_stake: dict[int, int] = {}
    producing_pools: set[str] = set()

    for epoch in metadata["epochs"]:
        epoch_info = client.get_json(f"/epochs/{epoch}")
        total_active_stake = parse_int(epoch_info.get("active_stake"))
        if total_active_stake <= 0:
            issues.append(DataIssue("epoch", str(epoch), "missing_epoch_active_stake", ""))
        epoch_total_active_stake[epoch] = total_active_stake

        block_refs = client.get_pages(f"/epochs/{epoch}/blocks", order="asc")
        block_limit = metadata.get("block_limit")
        if block_limit is not None:
            block_refs = block_refs[: int(block_limit)]
        blocks: list[Block] = []
        for block_ref in block_refs:
            block_hash = block_ref.get("hash") if isinstance(block_ref, dict) else block_ref
            raw = client.get_json(f"/blocks/{block_hash}")
            missing = [
                field
                for field in ("hash", "epoch", "slot", "time", "height", "slot_leader")
                if raw.get(field) in (None, "")
            ]
            if missing:
                issues.append(
                    DataIssue("block", str(block_hash), "missing_fields", ",".join(missing))
                )
                continue
            block = Block(
                hash=str(raw["hash"]),
                epoch=parse_int(raw["epoch"]),
                slot=parse_int(raw["slot"]),
                time=parse_int(raw["time"]),
                height=parse_int(raw["height"]),
                previous_block=raw.get("previous_block"),
                next_block=raw.get("next_block"),
                slot_leader=normalize_pool_id(raw.get("slot_leader")),
            )
            blocks.append(block)
            if block.slot_leader:
                producing_pools.add(block.slot_leader)
        blocks_by_epoch[epoch] = sorted(blocks, key=lambda b: (b.height, b.slot))
        stake_by_epoch[epoch] = {}

    target_epochs = set(int(epoch) for epoch in metadata["epochs"])
    pool_history_page_limit = int(metadata.get("pool_history_page_limit") or 10)
    for pool_id in sorted(producing_pools):
        found_epochs: set[int] = set()
        for page in range(1, pool_history_page_limit + 1):
            try:
                rows = client.get_json(
                    f"/pools/{pool_id}/history",
                    {"page": page, "count": 100, "order": "desc"},
                    allow_404=False,
                )
            except RuntimeError:
                issues.append(
                    DataIssue("epoch_pool_stake", pool_id, "missing_pool_history_cache", "")
                )
                break
            if not rows:
                break
            for row in rows:
                row_epoch = row.get("epoch")
                if row_epoch is None:
                    continue
                epoch = int(row_epoch)
                if epoch not in target_epochs:
                    continue
                active_stake = parse_int(row.get("active_stake"))
                stake_by_epoch.setdefault(epoch, {})[pool_id] = StakeEntry(
                    epoch=epoch,
                    pool_id=pool_id,
                    active_stake=active_stake,
                )
                found_epochs.add(epoch)
            if target_epochs.issubset(found_epochs):
                break

    registrations = load_pool_registrations(client, producing_pools, issues)
    return (
        metadata,
        blocks_by_epoch,
        stake_by_epoch,
        epoch_total_active_stake,
        registrations,
        issues,
    )


def load_pool_registrations(
    client: BlockfrostCache, pool_ids: Iterable[str], issues: list[DataIssue]
) -> dict[str, PoolRegistration]:
    registrations: dict[str, PoolRegistration] = {}
    for pool_id in sorted(pool_ids):
        slots: list[int] = []
        ambiguous = False
        try:
            updates = client.get_json(
                f"/pools/{pool_id}/updates",
                {"page": 1, "count": 100, "order": "asc"},
                allow_404=False,
            )
        except RuntimeError:
            issues.append(
                DataIssue("pool_registration", pool_id, "missing_pool_updates_cache", "")
            )
            registrations[pool_id] = PoolRegistration(pool_id, None, "missing_cache")
            continue

        for update in updates[:1]:
            action = str(update.get("action") or update.get("update_type") or "").lower()
            if action and "registration" not in action and action != "registered":
                ambiguous = True
                continue
            tx_hash = update.get("tx_hash")
            if not tx_hash:
                ambiguous = True
                continue
            try:
                tx = client.get_json(f"/txs/{tx_hash}", allow_404=True)
            except RuntimeError:
                tx = None
            if not tx:
                ambiguous = True
                continue
            slot = tx.get("slot")
            if slot is None:
                ambiguous = True
                continue
            slots.append(parse_int(slot))

        first_slot = min(slots) if slots else None
        if first_slot is None:
            issues.append(
                DataIssue("pool_registration", pool_id, "first_registration_slot_unavailable", "")
            )
        registrations[pool_id] = PoolRegistration(
            pool_id=pool_id,
            first_registration_slot=first_slot,
            source="blockfrost_pool_updates",
            ambiguous=ambiguous,
        )
    return registrations


def analyze_epoch(
    epoch: int,
    blocks: Sequence[Block],
    stake_by_pool: dict[str, StakeEntry],
    total_active_stake: int,
    registrations: dict[str, PoolRegistration],
    thresholds_bps: Sequence[int],
    registration_cutoff_slot: int,
    *,
    eligibility_modes: Sequence[str] = ("exact", "unfiltered"),
) -> tuple[list[AnchorResult], list[DataIssue]]:
    issues: list[DataIssue] = []
    results: list[AnchorResult] = []
    if total_active_stake <= 0:
        issues.append(DataIssue("epoch", str(epoch), "zero_total_active_stake", ""))
        return results, issues

    epoch_blocks = [block for block in blocks if block.epoch == epoch]
    epoch_blocks = sorted(epoch_blocks, key=lambda b: (b.height, b.slot))

    for anchor_index, anchor in enumerate(epoch_blocks):
        for mode in eligibility_modes:
            unique_pools: set[str] = set()
            unique_stake = 0
            missing_registration_seen = False
            late_registration_seen = False
            missing_stake_seen = False
            chain_gap_seen = False
            crossed_at: dict[int, tuple[int, int, int, str]] = {}
            previous_hash = anchor.hash
            descendant_count = 0

            for descendant in epoch_blocks[anchor_index + 1 :]:
                if descendant.epoch != anchor.epoch:
                    break
                if descendant.previous_block and descendant.previous_block != previous_hash:
                    chain_gap_seen = True
                    issues.append(
                        DataIssue(
                            "anchor",
                            anchor.hash,
                            "descendant_chain_gap",
                            f"expected previous {previous_hash}, got {descendant.previous_block}",
                        )
                    )
                    break

                descendant_count += 1
                previous_hash = descendant.hash
                pool_id = descendant.slot_leader
                if not pool_id or pool_id in unique_pools:
                    continue

                stake_entry = stake_by_pool.get(pool_id)
                if stake_entry is None:
                    missing_stake_seen = True
                    issues.append(
                        DataIssue(
                            "anchor",
                            anchor.hash,
                            "descendant_pool_missing_from_epoch_stake",
                            pool_id,
                        )
                    )
                    continue

                eligible = True
                if mode == "exact":
                    registration = registrations.get(pool_id)
                    if registration is None or registration.first_registration_slot is None:
                        eligible = False
                        missing_registration_seen = True
                    elif registration.first_registration_slot >= registration_cutoff_slot:
                        eligible = False
                        late_registration_seen = True

                if not eligible:
                    continue

                unique_pools.add(pool_id)
                unique_stake += stake_entry.active_stake
                stake_bps = min((unique_stake * 10_000) // total_active_stake, 10_000)
                for threshold in thresholds_bps:
                    if threshold not in crossed_at and stake_bps >= threshold:
                        crossed_at[threshold] = (
                            descendant_count,
                            descendant.time - anchor.time,
                            descendant.slot,
                            descendant.hash,
                        )

            final_bps = min((unique_stake * 10_000) // total_active_stake, 10_000)
            for threshold in thresholds_bps:
                crossed = threshold in crossed_at
                if crossed:
                    depth, seconds, slot, block_hash = crossed_at[threshold]
                    reason = ""
                else:
                    depth, seconds, slot, block_hash = None, None, None, None
                    reason = failure_reason(
                        chain_gap_seen=chain_gap_seen,
                        missing_stake_seen=missing_stake_seen,
                        missing_registration_seen=missing_registration_seen,
                        late_registration_seen=late_registration_seen,
                    )
                results.append(
                    AnchorResult(
                        eligibility_mode=mode,
                        threshold_bps=threshold,
                        anchor_hash=anchor.hash,
                        epoch=anchor.epoch,
                        anchor_slot=anchor.slot,
                        anchor_time=anchor.time,
                        crossed=crossed,
                        crossing_depth=depth,
                        seconds_to_crossing=seconds,
                        crossing_slot=slot,
                        crossing_hash=block_hash,
                        final_unique_stake_bps=final_bps,
                        unique_pool_count=len(unique_pools),
                        descendant_count=descendant_count,
                        failure_reason=reason,
                    )
                )

    return results, issues


def failure_reason(
    *,
    chain_gap_seen: bool,
    missing_stake_seen: bool,
    missing_registration_seen: bool,
    late_registration_seen: bool,
) -> str:
    if chain_gap_seen:
        return "descendant_chain_gap"
    if missing_registration_seen:
        return "pool_registration_missing"
    if missing_stake_seen:
        return "descendant_pool_missing_from_epoch_stake"
    if late_registration_seen:
        return "only_late_registered_pools_remaining"
    return "epoch_ended_before_threshold"


def analyze_cached_data(args: argparse.Namespace) -> None:
    cache_dir = Path(args.cache_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    (
        metadata,
        blocks_by_epoch,
        stake_by_epoch,
        epoch_total_active_stake,
        registrations,
        issues,
    ) = load_cached_study(cache_dir)
    thresholds = tuple(args.threshold_bps)
    registration_cutoff_slot = args.registration_cutoff_slot or cutoff_slot()

    all_results: list[AnchorResult] = []
    for epoch in metadata["epochs"]:
        results, epoch_issues = analyze_epoch(
            epoch=epoch,
            blocks=blocks_by_epoch.get(epoch, []),
            stake_by_pool=stake_by_epoch.get(epoch, {}),
            total_active_stake=epoch_total_active_stake.get(epoch, 0),
            registrations=registrations,
            thresholds_bps=thresholds,
            registration_cutoff_slot=registration_cutoff_slot,
        )
        all_results.extend(results)
        issues.extend(epoch_issues)

    write_blocks(output_dir / "blocks.csv", blocks_by_epoch)
    write_epoch_pool_stake(
        output_dir / "epoch_pool_stake.csv",
        stake_by_epoch,
        epoch_total_active_stake,
    )
    write_pool_registration(output_dir / "pool_registration.csv", registrations)
    write_anchor_results(output_dir / "anchor_results.csv", all_results)
    write_epoch_summary(output_dir / "epoch_summary.csv", all_results, args.near_epoch_end_depth)
    write_threshold_summary(output_dir / "threshold_summary.csv", all_results)
    write_data_quality(output_dir / "data_quality.csv", issues)
    write_report(
        output_dir / "report.md",
        metadata,
        all_results,
        issues,
        registration_cutoff_slot,
        thresholds,
        args.near_epoch_end_depth,
    )


def write_blocks(path: Path, blocks_by_epoch: dict[int, list[Block]]) -> None:
    rows = []
    for blocks in blocks_by_epoch.values():
        for block in blocks:
            rows.append(
                {
                    "hash": block.hash,
                    "epoch": block.epoch,
                    "slot": block.slot,
                    "height": block.height,
                    "time": block.time,
                    "time_utc": utc_from_unix(block.time),
                    "previous_block": block.previous_block or "",
                    "next_block": block.next_block or "",
                    "slot_leader": block.slot_leader,
                }
            )
    write_csv(path, rows)


def write_epoch_pool_stake(
    path: Path,
    stake_by_epoch: dict[int, dict[str, StakeEntry]],
    epoch_total_active_stake: dict[int, int],
) -> None:
    rows = []
    for epoch, stake_map in stake_by_epoch.items():
        total = epoch_total_active_stake.get(epoch, 0)
        for entry in stake_map.values():
            rows.append(
                {
                    "epoch": epoch,
                    "pool_id": entry.pool_id,
                    "active_stake": entry.active_stake,
                    "epoch_total_active_stake": total,
                    "active_stake_bps": (entry.active_stake * 10_000) // total
                    if total
                    else 0,
                }
            )
    write_csv(path, rows)


def write_pool_registration(
    path: Path, registrations: dict[str, PoolRegistration]
) -> None:
    write_csv(
        path,
        [
            {
                "pool_id": registration.pool_id,
                "first_registration_slot": registration.first_registration_slot
                if registration.first_registration_slot is not None
                else "",
                "source": registration.source,
                "ambiguous": registration.ambiguous,
            }
            for registration in registrations.values()
        ],
    )


def write_anchor_results(path: Path, results: Sequence[AnchorResult]) -> None:
    write_csv(path, [result.__dict__ for result in results])


def write_data_quality(path: Path, issues: Sequence[DataIssue]) -> None:
    write_csv(path, [issue.__dict__ for issue in issues])


def write_epoch_summary(
    path: Path, results: Sequence[AnchorResult], near_epoch_end_depth: int
) -> None:
    rows = []
    grouped: dict[tuple[int, int, str], list[AnchorResult]] = {}
    for result in results:
        grouped.setdefault(
            (result.epoch, result.threshold_bps, result.eligibility_mode), []
        ).append(result)
    for (epoch, threshold, mode), group in sorted(grouped.items()):
        crossed_seconds = [
            result.seconds_to_crossing
            for result in group
            if result.crossed and result.seconds_to_crossing is not None
        ]
        failed = [result for result in group if not result.crossed]
        near_epoch_end = [
            result
            for result in group
            if result.descendant_count <= near_epoch_end_depth and not result.crossed
        ]
        rows.append(
            {
                "epoch": epoch,
                "threshold_bps": threshold,
                "eligibility_mode": mode,
                "anchor_count": len(group),
                "crossed_count": len(crossed_seconds),
                "failure_count": len(failed),
                "failure_rate": rate(len(failed), len(group)),
                "near_epoch_end_failure_count": len(near_epoch_end),
                "near_epoch_end_failure_rate": rate(len(near_epoch_end), len(group)),
                "median_seconds": percentile(crossed_seconds, 0.50),
                "p90_seconds": percentile(crossed_seconds, 0.90),
                "p95_seconds": percentile(crossed_seconds, 0.95),
                "p99_seconds": percentile(crossed_seconds, 0.99),
                "max_seconds": max(crossed_seconds) if crossed_seconds else "",
                "median_depth": percentile(
                    [
                        result.crossing_depth
                        for result in group
                        if result.crossed and result.crossing_depth is not None
                    ],
                    0.50,
                ),
            }
        )
    write_csv(path, rows)


def write_threshold_summary(path: Path, results: Sequence[AnchorResult]) -> None:
    rows = []
    grouped: dict[tuple[int, str], list[AnchorResult]] = {}
    for result in results:
        grouped.setdefault((result.threshold_bps, result.eligibility_mode), []).append(result)
    for (threshold, mode), group in sorted(grouped.items()):
        crossed_seconds = [
            result.seconds_to_crossing
            for result in group
            if result.crossed and result.seconds_to_crossing is not None
        ]
        crossed_depths = [
            result.crossing_depth
            for result in group
            if result.crossed and result.crossing_depth is not None
        ]
        failures = [result for result in group if not result.crossed]
        rows.append(
            {
                "threshold_bps": threshold,
                "eligibility_mode": mode,
                "anchor_count": len(group),
                "crossed_count": len(crossed_seconds),
                "failure_count": len(failures),
                "failure_rate": rate(len(failures), len(group)),
                "median_seconds": percentile(crossed_seconds, 0.50),
                "p90_seconds": percentile(crossed_seconds, 0.90),
                "p95_seconds": percentile(crossed_seconds, 0.95),
                "p99_seconds": percentile(crossed_seconds, 0.99),
                "max_seconds": max(crossed_seconds) if crossed_seconds else "",
                "median_depth": percentile(crossed_depths, 0.50),
                "p90_depth": percentile(crossed_depths, 0.90),
                "p95_depth": percentile(crossed_depths, 0.95),
                "p99_depth": percentile(crossed_depths, 0.99),
                "max_depth": max(crossed_depths) if crossed_depths else "",
            }
        )
    write_csv(path, rows)


def write_report(
    path: Path,
    metadata: dict[str, Any],
    results: Sequence[AnchorResult],
    issues: Sequence[DataIssue],
    registration_cutoff_slot: int,
    thresholds: Sequence[int],
    near_epoch_end_depth: int,
) -> None:
    primary = [
        result
        for result in results
        if result.threshold_bps == 5000 and result.eligibility_mode == "exact"
    ]
    crossed = [
        result.seconds_to_crossing
        for result in primary
        if result.crossed and result.seconds_to_crossing is not None
    ]
    failures = [result for result in primary if not result.crossed]
    issue_counts: dict[str, int] = {}
    for issue in issues:
        issue_counts[issue.issue_type] = issue_counts.get(issue.issue_type, 0) + 1
    missing_registration_count = issue_counts.get("missing_pool_updates_cache", 0) + issue_counts.get(
        "first_registration_slot_unavailable", 0
    )

    lines = [
        "# Cardano Probabilistic Finality Timing Study",
        "",
        "## Summary",
        "",
        "This report measures the Cardano `08-cardano-probabilistic` unique-stake timing heuristic over cached Blockfrost mainnet data.",
        "",
        f"- Window: `{metadata.get('window_start')}` to `{metadata.get('window_end')}`",
        f"- Epochs: `{', '.join(str(epoch) for epoch in metadata.get('epochs', []))}`",
        f"- Thresholds: `{', '.join(str(threshold) for threshold in thresholds)}` bps",
        f"- Registration cutoff slot: `{registration_cutoff_slot}`",
        f"- Primary rows: `{len(primary)}` anchors at 5000 bps with exact eligibility",
        f"- Primary failures: `{len(failures)}` ({rate(len(failures), len(primary))})",
        "",
        "## Headline Findings",
        "",
    ]
    if crossed:
        lines.extend(
            [
                f"- Median time to 50% unique eligible stake: `{percentile(crossed, 0.50)}` seconds",
                f"- p90 time to 50% unique eligible stake: `{percentile(crossed, 0.90)}` seconds",
                f"- p95 time to 50% unique eligible stake: `{percentile(crossed, 0.95)}` seconds",
                f"- p99 time to 50% unique eligible stake: `{percentile(crossed, 0.99)}` seconds",
                f"- Max observed time among crossed anchors: `{max(crossed)}` seconds",
            ]
        )
    else:
        lines.append("- No primary anchors crossed in the analyzed cached data.")
    if missing_registration_count:
        lines.append(
            f"- Exact eligibility is incomplete because `{missing_registration_count}` producing pools were missing first-registration data. Exact rows are therefore fail-closed; use the `unfiltered` rows as the timing sensitivity view until registration data is complete."
        )

    lines.extend(
        [
            "",
            "## Methodology",
            "",
            "For every block in each analyzed completed epoch, the block is treated as an anchor candidate. The analyzer walks forward through contiguous same-epoch descendants only. Each descendant slot leader is counted once. For exact eligibility, the pool contributes stake only when Blockfrost pool history reports active stake for that pool in the anchor epoch and its first registration slot is earlier than the configured cutoff. The numerator is the active stake of unique eligible descendant-producing pools; the denominator is the total active stake in the anchor epoch metadata.",
            "",
            "The analyzer computes:",
            "",
            "```text",
            "qualified_unique_stake_bps = min(qualified_unique_stake * 10000 / epoch_total_active_stake, 10000)",
            "```",
            "",
            "Rows with unavailable first-registration data are not approximated as eligible in exact mode. The `unfiltered` mode is included as a sensitivity result that ignores registration eligibility and should not be treated as the light-client result.",
            "",
            "## Data Source",
            "",
            "- Blockfrost mainnet API: latest block, epochs, epoch blocks, pool history, pool updates, and transaction details.",
            "- Blockfrost overview: <https://blockfrost.dev/>",
            "- Blockfrost API documentation collection: <https://www.postman.com/blockfrost-io/my-workspace/collection/gc3tehz/blockfrost-io-api-documentation>",
            "- Blockfrost pool history and epoch endpoints from the API documentation collection.",
            "- Client semantics source: `cosmos/cardano-probabilistic-light-client-v8/update.go` and `cosmos/cardano-probabilistic-light-client-v10/update.go`.",
            "",
            "## Data Quality",
            "",
        ]
    )
    if issue_counts:
        for issue_type, count in sorted(issue_counts.items()):
            lines.append(f"- `{issue_type}`: `{count}`")
    else:
        lines.append("- No data-quality issues were recorded.")

    lines.extend(
        [
            "",
            "## Output Tables",
            "",
            "- `anchor_results.csv`: one row per anchor, threshold, and eligibility mode.",
            "- `epoch_summary.csv`: per-epoch timing and failure statistics.",
            "- `threshold_summary.csv`: aggregate timing and failure statistics by threshold.",
            "- `data_quality.csv`: missing fields, cache misses, ambiguous registrations, and excluded data.",
            "",
            "## Limitations",
            "",
            f"- Near-epoch-end failures are reported for anchors with at most `{near_epoch_end_depth}` same-epoch descendants remaining.",
            "- The study is only as complete as Blockfrost's historical block, stake, and pool update data.",
            "- Exact eligibility requires reconstructing first-registration slots from each producing pool's earliest pool update transaction. Any unresolved pool is treated as ineligible in exact mode and reported in `data_quality.csv`.",
            "",
        ]
    )
    path.write_text("\n".join(lines))


def write_csv(path: Path, rows: Sequence[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("")
        return
    fieldnames = list(rows[0].keys())
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def percentile(values: Sequence[int | None], quantile: float) -> int | str:
    cleaned = sorted(int(value) for value in values if value is not None)
    if not cleaned:
        return ""
    if len(cleaned) == 1:
        return cleaned[0]
    index = math.ceil(quantile * len(cleaned)) - 1
    return cleaned[max(0, min(index, len(cleaned) - 1))]


def rate(numerator: int, denominator: int) -> str:
    if denominator == 0:
        return ""
    return f"{numerator / denominator:.6f}"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    def add_common_fetch_flags(subparser: argparse.ArgumentParser) -> None:
        subparser.add_argument("--cache-dir", required=True)
        subparser.add_argument("--days", type=int, default=90)
        subparser.add_argument("--project-id")
        subparser.add_argument("--base-url", default=BLOCKFROST_MAINNET_URL)
        subparser.add_argument("--sleep-seconds", type=float, default=0.0)
        subparser.add_argument("--workers", type=int, default=8)
        subparser.add_argument(
            "--epoch-limit",
            type=int,
            help="Limit fetch to the latest N completed epochs in the selected window.",
        )
        subparser.add_argument(
            "--block-limit",
            type=int,
            help="Limit fetched block details per epoch. Intended for smoke tests only.",
        )
        subparser.add_argument(
            "--pool-history-page-limit",
            type=int,
            default=10,
            help="Maximum descending pool-history pages to fetch per producing pool.",
        )

    def add_analyze_flags(subparser: argparse.ArgumentParser) -> None:
        subparser.add_argument("--cache-dir", required=True)
        subparser.add_argument("--output-dir", required=True)
        subparser.add_argument(
            "--threshold-bps",
            type=int,
            nargs="+",
            default=list(DEFAULT_THRESHOLDS_BPS),
        )
        subparser.add_argument("--registration-cutoff-slot", type=int)
        subparser.add_argument("--near-epoch-end-depth", type=int, default=24)
        subparser.add_argument(
            "--offline",
            action="store_true",
            help="Document intent; analyze always reads from cache only.",
        )

    fetch_parser = subparsers.add_parser("fetch")
    add_common_fetch_flags(fetch_parser)

    analyze_parser = subparsers.add_parser("analyze")
    add_analyze_flags(analyze_parser)

    run_parser = subparsers.add_parser("run")
    add_common_fetch_flags(run_parser)
    run_parser.add_argument("--output-dir", required=True)
    run_parser.add_argument(
        "--threshold-bps",
        type=int,
        nargs="+",
        default=list(DEFAULT_THRESHOLDS_BPS),
    )
    run_parser.add_argument("--registration-cutoff-slot", type=int)
    run_parser.add_argument("--near-epoch-end-depth", type=int, default=24)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "fetch":
        fetch_study_data(args)
    elif args.command == "analyze":
        analyze_cached_data(args)
    elif args.command == "run":
        fetch_study_data(args)
        analyze_cached_data(args)
    else:
        parser.error(f"unknown command {args.command}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
