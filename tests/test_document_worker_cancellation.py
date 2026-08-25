import hashlib
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from document_worker import (
    CancelledJobRecoveryMonitor,
    JobLeaseHeartbeat,
    process_job,
    process_next_queued_job,
)


class CancellationClient:
    def __init__(self, sources, cancel_at_check):
        self.sources = sources
        self.cancel_at_check = cancel_at_check
        self.check_count = 0
        self.downloads = []

    def is_cancellation_requested(self, _job_id):
        self.check_count += 1
        return self.check_count >= self.cancel_at_check

    def download_template(self, _job_id, template_id, destination):
        self.downloads.append(template_id)
        destination.write_bytes(self.sources[template_id].read_bytes())


class AutomationSpy:
    def __init__(self):
        self.calls = []

    def fill(self, path, values, fields=None):
        self.calls.append((path, dict(values), list(fields or [])))


class DocumentWorkerCancellationTest(unittest.TestCase):
    def setUp(self):
        self.snapshot = {
            "measurement_year": "2026",
            "measurement_period": "하반기",
            "business_code": "H0507",
            "business_name": "취소 테스트 사업장",
        }

    def test_cancelled_at_job_start_does_not_download_or_automate(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            job, sources = self._job(root, ["GENERAL_PRELIMINARY_SURVEY"])
            client = CancellationClient(sources, cancel_at_check=1)
            hwp = AutomationSpy()

            status, results, _error = process_job(job, client, root / "output", hwp, AutomationSpy())

            self.assertEqual(status, "CANCELLED")
            self.assertEqual([row["status"] for row in results], ["CANCELLED"])
            self.assertEqual(client.downloads, [])
            self.assertEqual(hwp.calls, [])

    def test_cancelled_after_download_does_not_start_com(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            job, sources = self._job(root, ["GENERAL_PRELIMINARY_SURVEY"])
            client = CancellationClient(sources, cancel_at_check=3)
            hwp = AutomationSpy()

            status, results, _error = process_job(job, client, root / "output", hwp, AutomationSpy())

            self.assertEqual(status, "CANCELLED")
            self.assertEqual(results[0]["status"], "CANCELLED")
            self.assertEqual(client.downloads, ["GENERAL_PRELIMINARY_SURVEY-template"])
            self.assertEqual(hwp.calls, [])

    def test_cancelled_after_com_does_not_publish(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            job, sources = self._job(root, ["GENERAL_PRELIMINARY_SURVEY"])
            client = CancellationClient(sources, cancel_at_check=5)
            hwp = AutomationSpy()

            with patch("document_worker.publish_file") as publish:
                status, results, _error = process_job(
                    job, client, root / "output", hwp, AutomationSpy()
                )

            self.assertEqual(status, "CANCELLED")
            self.assertEqual(results[0]["status"], "CANCELLED")
            self.assertEqual(len(hwp.calls), 1)
            publish.assert_not_called()

    def test_cancelled_at_final_publish_guard_does_not_publish(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            job, sources = self._job(root, ["GENERAL_PRELIMINARY_SURVEY"])
            client = CancellationClient(sources, cancel_at_check=6)

            with patch("document_worker.publish_file") as publish:
                status, results, _error = process_job(
                    job, client, root / "output", AutomationSpy(), AutomationSpy()
                )

            self.assertEqual(status, "CANCELLED")
            self.assertEqual(results[0]["status"], "CANCELLED")
            publish.assert_not_called()

    def test_cancelled_after_first_publish_keeps_file_and_marks_partial_success(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            document_types = ["GENERAL_PRELIMINARY_SURVEY", "FIELD_PRELIMINARY_SURVEY"]
            job, sources = self._job(root, document_types)
            client = CancellationClient(sources, cancel_at_check=7)

            status, results, _error = process_job(
                job, client, root / "output", AutomationSpy(), AutomationSpy()
            )

            self.assertEqual(status, "PARTIAL_SUCCESS")
            self.assertEqual([row["status"] for row in results], ["COMPLETED", "CANCELLED"])
            self.assertTrue(Path(results[0]["path"]).exists())
            self.assertNotIn("path", results[1])

    def test_late_cancel_after_all_files_are_published_preserves_completed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            job, sources = self._job(root, ["GENERAL_PRELIMINARY_SURVEY"])
            client = CancellationClient(sources, cancel_at_check=7)

            status, results, error = process_job(
                job, client, root / "output", AutomationSpy(), AutomationSpy()
            )

            self.assertEqual(status, "COMPLETED")
            self.assertEqual(results[0]["status"], "COMPLETED")
            self.assertIsNone(error)

    def test_heartbeat_keeps_renewing_lease_until_completing_scope_exits(self):
        class LeaseClient:
            def __init__(self):
                self.heartbeats = 0

            def heartbeat(self, _job_id):
                self.heartbeats += 1
                return False

        client = LeaseClient()
        with JobLeaseHeartbeat(client, "job", interval_seconds=0.01):
            deadline = time.monotonic() + 0.5
            while client.heartbeats < 2 and time.monotonic() < deadline:
                time.sleep(0.005)
        completed_heartbeats = client.heartbeats
        time.sleep(0.02)

        self.assertGreaterEqual(completed_heartbeats, 2)
        self.assertEqual(client.heartbeats, completed_heartbeats)

    def test_recovery_monitor_rechecks_expired_cancelled_leases_independently(self):
        class RecoveryClient:
            def __init__(self):
                self.recoveries = 0

            def recover_cancelled_jobs(self):
                self.recoveries += 1
                return []

        client = RecoveryClient()
        monitor = CancelledJobRecoveryMonitor(client, interval_seconds=0.01)
        monitor.start()
        deadline = time.monotonic() + 0.5
        while client.recoveries < 2 and time.monotonic() < deadline:
            time.sleep(0.005)
        monitor.stop()

        self.assertGreaterEqual(client.recoveries, 2)

    def test_worker_restart_recovers_cancelled_orphans_before_claim(self):
        class RestartedClient:
            def __init__(self):
                self.events = []

            def recover_cancelled_jobs(self):
                self.events.append("recover")
                return [{"id": "orphan", "status": "CANCELLED"}]

            def claim(self):
                self.events.append("claim")
                return None

        client = RestartedClient()
        self.assertIsNone(process_next_queued_job(client, Path("unused")))
        self.assertEqual(client.events, ["recover", "claim"])

    def test_published_result_is_checkpointed_before_next_document(self):
        class CheckpointClient(CancellationClient):
            def __init__(self, sources):
                super().__init__(sources, cancel_at_check=999)
                self.checkpoints = []

            def checkpoint_progress(self, _job_id, results):
                self.checkpoints.append([dict(result) for result in results])
                return False

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            job, sources = self._job(root, ["GENERAL_PRELIMINARY_SURVEY"])
            client = CheckpointClient(sources)

            status, results, _error = process_job(
                job, client, root / "output", AutomationSpy(), AutomationSpy()
            )

            self.assertEqual(status, "COMPLETED")
            self.assertEqual(results[0]["status"], "COMPLETED")
            self.assertEqual(client.checkpoints[0][0]["status"], "COMPLETED")

    def _job(self, root, document_types):
        templates = {}
        sources = {}
        for document_type in document_types:
            template_id = f"{document_type}-template"
            template_path = root / f"{template_id}.hwpx"
            template_path.write_bytes(document_type.encode())
            sources[template_id] = template_path
            templates[document_type] = {
                "template_id": template_id,
                "size_bytes": template_path.stat().st_size,
                "sha256": hashlib.sha256(template_path.read_bytes()).hexdigest(),
                "version": 1,
            }
        return (
            {
                "id": "cancellation-job",
                "payload": {
                    "snapshot": self.snapshot,
                    "templates": templates,
                    "selected_documents": document_types,
                },
            },
            sources,
        )


if __name__ == "__main__":
    unittest.main()
