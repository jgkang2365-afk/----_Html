import unittest

from 건강디딤돌_접수_자동화 import classify_journal_guard_result


class HealthGuard2ContractTests(unittest.TestCase):
    def test_only_explicit_journal_reason_is_skip(self):
        self.assertEqual(
            classify_journal_guard_result(
                {"allow": False, "reason": "JOURNAL_REGISTERED"}
            ),
            "JOURNAL_REGISTERED",
        )

    def test_explicit_allow_is_the_only_success(self):
        self.assertEqual(classify_journal_guard_result({"allow": True}), "ALLOW")

    def test_invalid_or_error_responses_fail_closed(self):
        for response in (
            None,
            False,
            {},
            {"allow": None},
            {"allow": False},
            {"allow": False, "reason": "GUARD_ERROR"},
        ):
            with self.subTest(response=response):
                self.assertEqual(classify_journal_guard_result(response), "GUARD_ERROR")


if __name__ == "__main__":
    unittest.main()
