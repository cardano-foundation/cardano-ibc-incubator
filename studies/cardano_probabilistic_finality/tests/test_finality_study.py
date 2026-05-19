import unittest

from studies.cardano_probabilistic_finality.finality_study import (
    Block,
    PoolRegistration,
    StakeEntry,
    analyze_epoch,
)


def block(index, pool, epoch=10, previous=None):
    block_hash = f"b{index}"
    return Block(
        hash=block_hash,
        epoch=epoch,
        slot=1000 + index,
        time=1_700_000_000 + index * 20,
        height=index,
        previous_block=previous,
        next_block=None,
        slot_leader=pool,
    )


class FinalityStudyTests(unittest.TestCase):
    def test_two_25_percent_pools_cross_exactly_at_50_percent(self):
        blocks = [
            block(1, "poola", previous="genesis"),
            block(2, "poola", previous="b1"),
            block(3, "poolb", previous="b2"),
        ]
        stake = {
            "poola": StakeEntry(10, "poola", 25),
            "poolb": StakeEntry(10, "poolb", 25),
            "poolc": StakeEntry(10, "poolc", 50),
        }
        registrations = {
            "poola": PoolRegistration("poola", 10, "test"),
            "poolb": PoolRegistration("poolb", 10, "test"),
            "poolc": PoolRegistration("poolc", 10, "test"),
        }

        results, issues = analyze_epoch(
            10, blocks, stake, sum(e.active_stake for e in stake.values()), registrations, [5000], registration_cutoff_slot=100
        )

        anchor = next(
            row
            for row in results
            if row.anchor_hash == "b1"
            and row.threshold_bps == 5000
            and row.eligibility_mode == "exact"
        )
        self.assertEqual([], issues)
        self.assertTrue(anchor.crossed)
        self.assertEqual(2, anchor.crossing_depth)
        self.assertEqual(5000, anchor.final_unique_stake_bps)

    def test_duplicate_descendant_producers_only_count_once(self):
        blocks = [
            block(1, "poola", previous="genesis"),
            block(2, "poola", previous="b1"),
            block(3, "poola", previous="b2"),
            block(4, "poolb", previous="b3"),
        ]
        stake = {
            "poola": StakeEntry(10, "poola", 400),
            "poolb": StakeEntry(10, "poolb", 100),
            "poolc": StakeEntry(10, "poolc", 500),
        }
        registrations = {
            "poola": PoolRegistration("poola", 10, "test"),
            "poolb": PoolRegistration("poolb", 10, "test"),
            "poolc": PoolRegistration("poolc", 10, "test"),
        }

        results, _ = analyze_epoch(
            10, blocks, stake, sum(e.active_stake for e in stake.values()), registrations, [5000], registration_cutoff_slot=100
        )

        anchor = next(
            row
            for row in results
            if row.anchor_hash == "b1"
            and row.threshold_bps == 5000
            and row.eligibility_mode == "exact"
        )
        self.assertTrue(anchor.crossed)
        self.assertEqual(3, anchor.crossing_depth)
        self.assertEqual(2, anchor.unique_pool_count)

    def test_descendants_after_epoch_rollover_do_not_count(self):
        blocks = [
            block(1, "poola", previous="genesis"),
            block(2, "poola", previous="b1"),
            block(3, "poolb", epoch=11, previous="b2"),
        ]
        stake = {
            "poola": StakeEntry(10, "poola", 25),
            "poolb": StakeEntry(10, "poolb", 25),
            "poolc": StakeEntry(10, "poolc", 50),
        }
        registrations = {
            "poola": PoolRegistration("poola", 10, "test"),
            "poolb": PoolRegistration("poolb", 10, "test"),
            "poolc": PoolRegistration("poolc", 10, "test"),
        }

        results, _ = analyze_epoch(
            10, blocks, stake, sum(e.active_stake for e in stake.values()), registrations, [5000], registration_cutoff_slot=100
        )

        anchor = next(
            row
            for row in results
            if row.anchor_hash == "b1"
            and row.threshold_bps == 5000
            and row.eligibility_mode == "exact"
        )
        self.assertFalse(anchor.crossed)
        self.assertEqual(2500, anchor.final_unique_stake_bps)
        self.assertEqual("epoch_ended_before_threshold", anchor.failure_reason)

    def test_missing_or_late_pool_registration_is_ineligible_in_exact_mode(self):
        blocks = [
            block(1, "poola", previous="genesis"),
            block(2, "poola", previous="b1"),
            block(3, "poolb", previous="b2"),
        ]
        stake = {
            "poola": StakeEntry(10, "poola", 400),
            "poolb": StakeEntry(10, "poolb", 200),
            "poolc": StakeEntry(10, "poolc", 400),
        }
        registrations = {
            "poola": PoolRegistration("poola", None, "test"),
            "poolb": PoolRegistration("poolb", 500, "test"),
            "poolc": PoolRegistration("poolc", 10, "test"),
        }

        results, _ = analyze_epoch(
            10, blocks, stake, sum(e.active_stake for e in stake.values()), registrations, [5000], registration_cutoff_slot=100
        )

        exact = next(
            row
            for row in results
            if row.anchor_hash == "b1"
            and row.threshold_bps == 5000
            and row.eligibility_mode == "exact"
        )
        unfiltered = next(
            row
            for row in results
            if row.anchor_hash == "b1"
            and row.threshold_bps == 5000
            and row.eligibility_mode == "unfiltered"
        )
        self.assertFalse(exact.crossed)
        self.assertEqual(0, exact.final_unique_stake_bps)
        self.assertEqual("pool_registration_missing", exact.failure_reason)
        self.assertTrue(unfiltered.crossed)
        self.assertEqual(6000, unfiltered.final_unique_stake_bps)


if __name__ == "__main__":
    unittest.main()
