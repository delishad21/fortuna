import json
import os
from pathlib import Path
import resource
import signal
import subprocess
import tempfile
import time

from .sandbox_policy import validate_candidate_source


QUEUE_DIR = Path(os.getenv("SANDBOX_QUEUE_DIR", "/sandbox"))
SANDBOX_UID = int(os.getenv("SANDBOX_UID", "65534"))
SANDBOX_GID = int(os.getenv("SANDBOX_GID", "65534"))
WALL_TIMEOUT_SECONDS = int(os.getenv("SANDBOX_WALL_TIMEOUT_SECONDS", "20"))


def _limit_child():
    os.setsid()
    os.setgroups([])
    os.setgid(SANDBOX_GID)
    os.setuid(SANDBOX_UID)
    resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_FSIZE, (4 * 1024 * 1024, 4 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_NPROC, (16, 16))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def _execute(payload):
    validate_candidate_source(payload.get("sourceCode"))
    with tempfile.TemporaryFile() as stdout_file, tempfile.TemporaryFile() as stderr_file:
        process = subprocess.Popen(
            ["python", "-I", "-B", "/app/app/sandbox_harness.py"],
            stdin=subprocess.PIPE,
            stdout=stdout_file,
            stderr=stderr_file,
            cwd="/tmp",
            env={"PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8", "PYTHONHASHSEED": "0"},
            preexec_fn=_limit_child,
        )
        try:
            process.communicate(json.dumps(payload, separators=(",", ":")).encode("utf-8"), timeout=WALL_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            raise RuntimeError("Candidate exceeded the 20 second wall-time limit")
        stdout_file.seek(0)
        raw_output = stdout_file.read(4 * 1024 * 1024 + 1)
        stderr_file.seek(0)
        raw_error = stderr_file.read(16_384).decode("utf-8", errors="replace")
        if len(raw_output) > 4 * 1024 * 1024:
            raise RuntimeError("Candidate result exceeded 4 MB")
        if process.returncode is not None and process.returncode < 0 and not raw_output:
            raise RuntimeError(
                f"Candidate was terminated by sandbox resource limit (signal {-process.returncode})"
            )
        try:
            result = json.loads(raw_output)
        except Exception as error:
            raise RuntimeError(f"Sandbox returned invalid output: {raw_error[-1000:]}") from error
        if process.returncode != 0 or result.get("error"):
            raise RuntimeError(str(result.get("error") or raw_error[-1000:] or "Candidate failed"))
        return result


def _write_result(job_id, value):
    temporary = QUEUE_DIR / f"{job_id}.result.tmp"
    final = QUEUE_DIR / f"{job_id}.result.json"
    temporary.write_text(json.dumps(value, separators=(",", ":")), encoding="utf-8")
    os.chmod(temporary, 0o600)
    os.replace(temporary, final)


def run_worker():
    QUEUE_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(QUEUE_DIR, 0o700)
    print("Fortuna parser sandbox worker ready", flush=True)
    while True:
        jobs = sorted(QUEUE_DIR.glob("*.job.json"), key=lambda item: item.stat().st_mtime)
        if not jobs:
            time.sleep(0.1)
            continue
        job_path = jobs[0]
        job_id = job_path.name.removesuffix(".job.json")
        running_path = QUEUE_DIR / f"{job_id}.running.json"
        try:
            os.replace(job_path, running_path)
        except FileNotFoundError:
            continue
        try:
            payload = json.loads(running_path.read_text(encoding="utf-8"))
            _write_result(job_id, {"ok": True, "result": _execute(payload)})
        except Exception as error:
            _write_result(job_id, {"ok": False, "error": str(error)})
        finally:
            try:
                running_path.unlink()
            except FileNotFoundError:
                pass


if __name__ == "__main__":
    run_worker()
