import unittest
from unittest.mock import Mock, patch

from scratch import national_support_flow_cli as flow


class NationalSupportFlowTest(unittest.TestCase):
    def execute(self):
        return flow.execute_flow(
            "13081723666",
            "92410057447",
            "최길홍",
            "김주호",
            "010-2991-3090",
            "2026",
            "하반기",
        )

    @patch.object(flow, "cleanup_profile")
    @patch.object(flow, "apply_with_driver")
    @patch.object(flow, "lookup_with_driver", return_value="SUPPORT")
    @patch.object(flow, "create_driver")
    def test_support_closes_one_driver_without_application(
        self, create_driver, lookup_with_driver, apply_with_driver, cleanup_profile
    ):
        driver = Mock()
        create_driver.return_value = driver

        result = self.execute()

        self.assertEqual(result["result"], "SUPPORT")
        create_driver.assert_called_once_with()
        self.assertIs(lookup_with_driver.call_args.args[0], driver)
        apply_with_driver.assert_not_called()
        driver.quit.assert_called_once_with()
        cleanup_profile.assert_called_once_with()

    @patch.object(flow, "cleanup_profile")
    @patch.object(flow, "apply_with_driver", return_value="APPLIED")
    @patch.object(flow, "lookup_with_driver", return_value="NO_RESULT")
    @patch.object(flow, "create_driver")
    def test_no_result_applies_with_the_same_driver(
        self, create_driver, lookup_with_driver, apply_with_driver, cleanup_profile
    ):
        driver = Mock()
        create_driver.return_value = driver

        result = self.execute()

        self.assertEqual(result["result"], "APPLIED")
        self.assertEqual(result["stage"], "application")
        create_driver.assert_called_once_with()
        self.assertIs(lookup_with_driver.call_args.args[0], driver)
        self.assertIs(apply_with_driver.call_args.args[0], driver)
        driver.quit.assert_called_once_with()
        cleanup_profile.assert_called_once_with()

    @patch.object(flow, "cleanup_profile")
    @patch.object(flow, "apply_with_driver")
    @patch.object(flow, "lookup_with_driver", return_value="STANDBY")
    @patch.object(flow, "create_driver")
    def test_standby_never_submits_duplicate_application(
        self, create_driver, lookup_with_driver, apply_with_driver, cleanup_profile
    ):
        driver = Mock()
        create_driver.return_value = driver

        result = self.execute()

        self.assertEqual(result["result"], "STANDBY")
        apply_with_driver.assert_not_called()
        driver.quit.assert_called_once_with()
        cleanup_profile.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
