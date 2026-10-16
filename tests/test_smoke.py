"""Deploy-readiness smoke test for Muri (stdlib only, no DB, no API key).

Run with:  python tests/test_smoke.py
Or with pytest if installed:  pytest tests/ -q
"""

import ast
import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "muri" / "backend"


class TestVercelConfig(unittest.TestCase):
    def test_vercel_json_is_valid_services_config(self):
        config = json.loads((ROOT / "vercel.json").read_text())
        services = config.get("services", {})
        self.assertIn("app", services, "backend service missing")
        self.assertIn("frontend", services, "frontend service missing")

        backend = services["app"]
        entrypoint = backend.get("entrypoint", "")
        self.assertTrue(entrypoint, "backend service needs an entrypoint")
        module, _, attr = entrypoint.partition(":")
        self.assertTrue(module and attr, f"bad entrypoint {entrypoint!r}")
        for candidate in (ROOT / f"{module}.py", BACKEND / f"{module}.py"):
            if candidate.is_file():
                break
        else:
            self.fail(f"entrypoint module {module!r} not found")

        rewrites = config.get("rewrites", [])
        self.assertTrue(rewrites, "no rewrites defined")
        first = json.dumps(rewrites[0])
        self.assertIn("/api", first, "first rewrite must route /api/*")
        self.assertEqual(
            rewrites[0].get("destination", {}).get("service"),
            "app",
            "first rewrite must target the backend service",
        )

    def test_entrypoint_exposes_app(self):
        tree = ast.parse((ROOT / "app.py").read_text())
        names = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                for alias in node.names:
                    names.add(alias.asname or alias.name)
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    names.add(alias.asname or alias.name)
        self.assertIn("app", names, "app.py must expose an `app` object")


class TestBackendModules(unittest.TestCase):
    def test_backend_parses(self):
        for name in ("main.py", "auth.py", "db.py", "models.py", "learning.py"):
            with self.subTest(module=name):
                ast.parse((BACKEND / name).read_text())

    def test_requirements_cover_imports(self):
        pinned = (ROOT / "requirements.txt").read_text().lower()
        for dep in ("fastapi", "sqlalchemy", "pymysql", "google-genai",
                    "python-dotenv", "requests", "pydantic", "uvicorn"):
            self.assertIn(dep, pinned, f"{dep} missing from requirements.txt")

    def test_env_example_has_placeholders_not_secrets(self):
        example = (BACKEND / ".env.example").read_text()
        self.assertIn("GEMINI_API_KEY=", example)
        self.assertIn("your_gemini_api_key_here", example)

    def test_real_env_is_not_git_tracked(self):
        try:
            tracked = subprocess.run(
                ["git", "ls-files", "muri/backend/.env", ".env"],
                capture_output=True, text=True, cwd=ROOT,
            ).stdout
        except FileNotFoundError:
            self.skipTest("git not available")
        self.assertEqual(tracked.strip(), "", "real .env must not be committed")


class TestFrontendConfig(unittest.TestCase):
    def test_vite_config_proxies_api(self):
        self.assertIn("/api", (ROOT / "frontend" / "vite.config.ts").read_text())

    def test_build_script_exists(self):
        package = json.loads((ROOT / "frontend" / "package.json").read_text())
        self.assertIn("build", package.get("scripts", {}))


if __name__ == "__main__":
    sys.exit(0 if unittest.main(verbosity=2, exit=False).result.wasSuccessful() else 1)
