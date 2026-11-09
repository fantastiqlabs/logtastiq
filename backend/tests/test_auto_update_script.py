import os
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "auto-update.sh"
REVISION = "a" * 40


class ScheduledUpdaterTests(unittest.TestCase):
    def run_script(self, frontend_revision=REVISION):
        with tempfile.TemporaryDirectory(prefix="logtastiq-updater-") as temp:
            root = Path(temp)
            fake_bin = root / "bin"
            fake_bin.mkdir()
            compose_file = root / "compose.yml"
            env_file = root / ".env"
            compose_file.touch()
            env_file.write_text("private values are not read by the test\n")
            calls = root / "calls"
            docker = fake_bin / "docker"
            docker.write_text(
                """#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
with pathlib.Path(os.environ["DOCKER_CALLS"]).open("a") as stream:
    stream.write(json.dumps({"args": args, "backend": os.getenv("LOGTASTIQ_BACKEND_IMAGE"), "frontend": os.getenv("LOGTASTIQ_FRONTEND_IMAGE")}) + "\\n")
if args[0] == "ps": print("old-backend\\nold-frontend")
elif args[0] == "inspect":
    fmt, target = args[2], args[3]
    if "Config.Image" in fmt: print("ghcr.io/fantastiqlabs/logtastiq-" + ("backend" if "backend" in target else "frontend") + ":latest")
    elif "com.docker.compose.project" in fmt: print("hellotherelogs")
    elif "RepoDigests" in fmt: print("ghcr.io/fantastiqlabs/logtastiq-" + ("backend" if "backend" in target else "frontend") + "@sha256:" + ("1" if "backend" in target else "2") * 64)
    elif ".Image" in fmt: print("running-" + target)
    elif ".State.Status" in fmt: print("running")
elif args[:2] == ["image", "inspect"]:
    target = args[-1]
    is_frontend = "frontend" in target
    if "Config.Labels" in args[3]: print("c" * 40 if target.startswith("running-") else (os.environ["FRONTEND_REVISION"] if is_frontend else os.environ["BACKEND_REVISION"]))
    else: print("ghcr.io/fantastiqlabs/logtastiq-" + ("frontend" if is_frontend else "backend") + "@sha256:" + ("3" if is_frontend else "4") * 64)
elif args[0] == "pull": pass
elif args[0] == "exec":
    if "backups" in args[-2]: print("SQLite backup created")
elif args[0] == "compose" and "config" in args: print("backend\\nfrontend")
elif args[0] == "compose" and "ps" in args: print("new-" + args[-1])
elif args[0] == "compose" and "up" in args: pass
else: raise SystemExit("Unexpected docker call: " + repr(args))
"""
            )
            docker.chmod(0o755)
            env = os.environ.copy()
            env.update({
                "PATH": f"{fake_bin}:{env['PATH']}",
                "DOCKER_CALLS": str(calls),
                "BACKEND_REVISION": REVISION,
                "FRONTEND_REVISION": frontend_revision,
                "LOGTASTIQ_COMPOSE_FILE": str(compose_file),
                "LOGTASTIQ_ENV_FILE": str(env_file),
            })
            result = subprocess.run(["bash", str(SCRIPT)], env=env, capture_output=True, text=True)
            records = [json.loads(line) for line in calls.read_text().splitlines()] if calls.exists() else []
            return result, records

    def test_mismatched_image_revisions_leave_stack_untouched(self):
        result, calls = self.run_script("b" * 40)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("do not have matching full source revisions", result.stderr)
        self.assertFalse(any(call["args"][0] == "compose" and "up" in call["args"] for call in calls))
        self.assertFalse(any(call["args"][0] == "exec" for call in calls))

    def test_matching_images_are_deployed_as_a_pinned_pair(self):
        result, calls = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        deploy = next(call for call in calls if call["args"][0] == "compose" and "up" in call["args"])
        self.assertEqual(deploy["backend"], "ghcr.io/fantastiqlabs/logtastiq-backend@sha256:" + "4" * 64)
        self.assertEqual(deploy["frontend"], "ghcr.io/fantastiqlabs/logtastiq-frontend@sha256:" + "3" * 64)
        self.assertIn("SQLite backup created", result.stdout)


if __name__ == "__main__":
    unittest.main()
