"""Deploy-readiness smoke test for Muri (stdlib only, no DB, no API key).

Run with:  python tests/test_smoke.py
Or with pytest if installed:  pytest tests/ -q
"""

import ast
import json
import os
import subprocess
import sys
import unittest
from types import SimpleNamespace
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
        exports_app = any(
            isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == "app"
                    for target in node.targets)
            for node in tree.body
        )
        self.assertTrue(exports_app, "app.py must expose an `app` object")


class TestBackendModules(unittest.TestCase):
    def test_backend_parses(self):
        for name in ("main.py", "auth.py", "db.py", "models.py", "learning.py"):
            with self.subTest(module=name):
                ast.parse((BACKEND / name).read_text())

    def test_admin_access_is_configured_and_role_protected(self):
        auth_source = (BACKEND / "auth.py").read_text()
        main_source = (BACKEND / "main.py").read_text()
        models_source = (BACKEND / "models.py").read_text()
        frontend_app = (ROOT / "frontend" / "src" / "App.tsx").read_text()
        auth_screen = (
            ROOT / "frontend" / "src" / "components" / "AuthScreen.tsx"
        ).read_text()
        admin_dashboard = (
            ROOT / "frontend" / "src" / "components" / "AdminDashboard.tsx"
        ).read_text()
        self.assertIn('os.getenv("MURI_ADMIN_EMAIL"', auth_source)
        self.assertIn('os.getenv("MURI_ADMIN_PASSWORD"', auth_source)
        self.assertIn("def login_admin(", auth_source)
        self.assertIn('@app.post("/api/auth/admin/login")', main_source)
        self.assertIn("auth.login_admin(req.email, req.password)", main_source)
        self.assertIn("def require_admin(", auth_source)
        self.assertIn('@app.get("/api/admin/overview")', main_source)
        self.assertIn("= Depends(require_admin)", main_source)
        self.assertIn('response.headers["Cache-Control"] = "no-store"', main_source)
        self.assertIn('if request.url.path.startswith("/api/"):', main_source)
        self.assertIn('response.headers["Pragma"] = "no-cache"', main_source)
        self.assertIn("class ModelUsage(Base):", models_source)
        self.assertIn("const ADMIN_LOGIN_PATH = '/admin/login'", frontend_app)
        self.assertIn("adminOnly={adminLogin}", frontend_app)
        self.assertIn(
            "adminLogin && user.role !== 'admin'", frontend_app
        )
        self.assertIn("adminOnly = false", auth_screen)
        self.assertIn("adminLogin(email, password)", auth_screen)
        self.assertIn("placeholder={adminOnly ? 'Admin email' : 'Email'}", auth_screen)
        self.assertIn("adminOnly ? 'admin' : 'user'", auth_screen)
        self.assertIn("window.setInterval(refresh, 60_000)", admin_dashboard)
        self.assertIn("onClick={() => void refreshOverview()}", admin_dashboard)

    def test_requirements_cover_imports(self):
        pinned = (ROOT / "requirements.txt").read_text().lower()
        for dep in ("fastapi", "sqlalchemy", "pymysql", "google-genai",
                    "python-dotenv", "requests", "pydantic", "uvicorn"):
            self.assertIn(dep, pinned, f"{dep} missing from requirements.txt")

    def test_env_example_has_placeholders_not_secrets(self):
        example = (BACKEND / ".env.example").read_text()
        self.assertIn("GEMINI_API_KEY=", example)
        self.assertIn("your_gemini_api_key_here", example)
        self.assertIn("MURI_ADMIN_PASSWORD=", example)

    def test_db_supports_hosted_tls(self):
        source = (BACKEND / "db.py").read_text()
        self.assertIn("MYSQL_SSL_CA", source)
        self.assertIn("ssl_ca", source)

    def test_backend_loads_its_own_env_file(self):
        expected = 'load_dotenv(dotenv_path=Path(__file__).with_name(".env"), override=False)'
        for name in ("db.py", "main.py"):
            with self.subTest(module=name):
                source = (BACKEND / name).read_text()
                self.assertIn(expected, source)

    def test_real_env_is_not_git_tracked(self):
        try:
            tracked = subprocess.run(
                ["git", "ls-files", "muri/backend/.env", ".env"],
                capture_output=True, text=True, cwd=ROOT,
            ).stdout
        except FileNotFoundError:
            self.skipTest("git not available")
        self.assertEqual(tracked.strip(), "", "real .env must not be committed")


class TestFrontendPath(unittest.TestCase):
    def test_configured_frontend_path_skips_local_path_fallback(self):
        tree = ast.parse((BACKEND / "main.py").read_text())
        assignment = next(
            node
            for node in tree.body
            if isinstance(node, ast.Assign)
            and any(
                isinstance(target, ast.Name) and target.id == "FRONTEND_DIST"
                for target in node.targets
            )
        )
        frontend_dist = eval(
            compile(
                ast.Expression(assignment.value),
                str(BACKEND / "main.py"),
                "eval",
            ),
            {
                "Path": Path,
                "os": SimpleNamespace(getenv=lambda _: "/srv/static"),
                "__file__": "/srv/main.py",
            },
        )
        self.assertEqual(frontend_dist, Path("/srv/static"))


class TestDatabaseUrlNormalization(unittest.TestCase):
    """The connection-string shapes hosting providers hand out must all work.

    Runs without a database: VERCEL=1 skips the CREATE DATABASE probe and
    engine creation is lazy, so nothing ever connects. Skipped entirely when
    sqlalchemy is not installed (stdlib-only environments).
    """

    @classmethod
    def setUpClass(cls):
        try:
            import sqlalchemy  # noqa: F401
        except ImportError:
            raise unittest.SkipTest("sqlalchemy not installed")
        cls._saved = {
            key: os.environ.get(key)
            for key in ("VERCEL", "PYTHON_DOTENV_DISABLED", "DATABASE_URL")
        }
        os.environ["VERCEL"] = "1"          # no CREATE DATABASE probe -> no DB
        os.environ["PYTHON_DOTENV_DISABLED"] = "1"
        os.environ["DATABASE_URL"] = "mysql+pymysql://db.example:3306/muri"
        sys.path.insert(0, str(BACKEND))
        import db  # noqa: PLC0415
        cls.db = db

    @classmethod
    def tearDownClass(cls):
        for key, value in cls._saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_provider_scheme_gets_pymysql_driver(self):
        # Railway/Aiven/PlanetScale print mysql:// with no driver; SQLAlchemy
        # would then require the uninstalled MySQLdb driver.
        url = self.db._normalize_database_url("mysql://user:pass@host:3306/muri")
        self.assertTrue(url.startswith("mysql+pymysql://"), url)

    def test_raw_at_in_password_is_repaired(self):
        from sqlalchemy.engine import make_url

        url = self.db._normalize_database_url(
            "mysql://user:my@pass@host:3306/muri"
        )
        parsed = make_url(url)
        self.assertEqual(parsed.host, "host", "raw @ must not leak into the host")
        self.assertEqual(parsed.password, "my@pass", "password must round-trip")

    def test_already_encoded_password_is_untouched(self):
        raw = "mysql+pymysql://user:my%40pass@host:3306/muri"
        self.assertEqual(self.db._normalize_database_url(raw), raw)

    def test_correct_url_is_untouched(self):
        raw = "mysql+pymysql://user:pass@host:3306/muri?charset=utf8mb4"
        self.assertEqual(self.db._normalize_database_url(raw), raw)

    def test_unsupported_charset_has_actionable_configuration_error(self):
        url = self.db._normalize_database_url(
            "mysql+pymysql://user:pass@db.example:3306/muri?charset=utf-8"
        )
        self.assertIn("charset=utf8mb4", self.db._database_config_error(url))

    def test_empty_falls_back_to_local_default(self):
        url = self.db._normalize_database_url("")
        self.assertTrue(url.startswith("mysql+pymysql://"), url)
        self.assertIn("127.0.0.1", url)

    def test_serverless_loopback_is_detected(self):
        self.assertTrue(self.db._is_loopback("mysql+pymysql://root@127.0.0.1:3306/muri"))
        self.assertTrue(self.db._is_loopback("mysql+pymysql://root@localhost/muri"))
        self.assertFalse(self.db._is_loopback("mysql+pymysql://u:p@db.example:3306/muri"))


class TestFrontendConfig(unittest.TestCase):
    def test_vite_config_proxies_api(self):
        self.assertIn("/api", (ROOT / "frontend" / "vite.config.ts").read_text())

    def test_build_script_exists(self):
        package = json.loads((ROOT / "frontend" / "package.json").read_text())
        self.assertIn("build", package.get("scripts", {}))


if __name__ == "__main__":
    sys.exit(0 if unittest.main(verbosity=2, exit=False).result.wasSuccessful() else 1)
