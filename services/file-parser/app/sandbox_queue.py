import base64
import json
import os
from pathlib import Path
import time
import uuid


QUEUE_DIR = Path(os.getenv("SANDBOX_QUEUE_DIR", "/sandbox"))
MAX_CONTENT_BYTES = 25 * 1024 * 1024


class SandboxExecutionError(RuntimeError):
    pass


def submit_python_job(source_code, content, specification, timeout_seconds=30):
    if not isinstance(content, bytes) or not content:
        raise SandboxExecutionError("Sandbox fixture content is required")
    if len(content) > MAX_CONTENT_BYTES:
        raise SandboxExecutionError("Sandbox fixture exceeds 25 MB")
    QUEUE_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(QUEUE_DIR, 0o700)
    job_id = str(uuid.uuid4())
    job_path = QUEUE_DIR / f"{job_id}.job.json"
    temporary_path = QUEUE_DIR / f"{job_id}.job.tmp"
    result_path = QUEUE_DIR / f"{job_id}.result.json"
    payload = {
        "jobId": job_id,
        "sourceCode": source_code,
        "contentBase64": base64.b64encode(content).decode("ascii"),
        "specification": specification,
    }
    temporary_path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    os.chmod(temporary_path, 0o600)
    os.replace(temporary_path, job_path)
    deadline = time.monotonic() + timeout_seconds
    try:
        while time.monotonic() < deadline:
            if result_path.exists():
                result = json.loads(result_path.read_text(encoding="utf-8"))
                if not result.get("ok"):
                    raise SandboxExecutionError(str(result.get("error") or "Sandbox execution failed"))
                return result["result"]
            time.sleep(0.1)
        raise SandboxExecutionError("Sandbox execution timed out")
    finally:
        for path in (job_path, temporary_path, result_path, QUEUE_DIR / f"{job_id}.running.json"):
            try:
                path.unlink()
            except FileNotFoundError:
                pass
