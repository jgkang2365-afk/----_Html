import importlib.util
import unittest
from pathlib import Path


def load_module():
    path = Path(__file__).resolve().parent.parent / "건강디딤돌_접수_자동화.py"
    spec = importlib.util.spec_from_file_location("health_program_automation_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


module = load_module()


class NationalSupportLogicTest(unittest.TestCase):
    def test_employee_check_is_fail_closed(self):
        self.assertEqual(module.classify_employee_check("50인 미만"), "OK")
        self.assertEqual(module.classify_employee_check("70%"), "OK")
        self.assertEqual(module.classify_employee_check("50인 이상"), "OVER_50")
        self.assertEqual(module.classify_employee_check(""), "NO_INFO")
        self.assertEqual(module.classify_employee_check("확인 불가"), "EMPLOYEE_CHECK_FAILED")

    def test_success_requires_explicit_marker(self):
        self.assertTrue(module.has_application_success_marker("신청이 완료되었습니다"))
        self.assertTrue(module.has_application_success_marker("접수번호 1234"))
        self.assertFalse(module.has_application_success_marker("확인 버튼을 눌렀습니다"))


if __name__ == "__main__":
    unittest.main()
