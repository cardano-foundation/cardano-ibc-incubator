#!/usr/bin/env python3
"""Clock profile for the owned rehearsal's actual probabilistic counterparty.

The supported verifier fixes its producer registration cutoff at 2026-01-01.
Genesis registration is conservatively represented by slot 1, because slot 0
means missing evidence. A newly created September-2026 chain cannot qualify any
producer. Keep the verifier and registration facts intact; use a historical
disposable genesis and a shared relative offset computed once before startup.
"""
import datetime
import time

UTC = datetime.timezone.utc
REGISTRATION_CUTOFF = datetime.datetime(2026, 1, 1, tzinfo=UTC)
REHEARSAL_START = datetime.datetime(2025, 12, 29, tzinfo=UTC)


def initial_offset(now=None):
    return int(REHEARSAL_START.timestamp()) - int(time.time() if now is None else now)


def require_qualified_genesis(genesis):
    if genesis.get('slotLength') != 1:
        raise ValueError('Migration rehearsal requires one-second Cardano slots')
    start = datetime.datetime.fromisoformat(genesis['systemStart'].replace('Z', '+00:00'))
    if start.tzinfo is None:
        raise ValueError('Migration rehearsal genesis systemStart must include its UTC offset')
    # With one-second slots, ceil(cutoff - systemStart) must exceed the
    # authenticated genesis registration slot (1) for the strict comparison.
    if (REGISTRATION_CUTOFF - start).total_seconds() <= 1:
        raise ValueError(
            'Genesis cannot qualify its pools under the supported 2026-01-01 registration cutoff. '
            'Create a fresh owned rehearsal with --clock-offset-seconds "$(python3 '
            'scripts/ci/migration-clock-profile.py)"; preserve verifier rules and registration evidence.'
        )


if __name__ == '__main__':
    print(initial_offset())
