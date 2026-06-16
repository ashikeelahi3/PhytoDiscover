#!/usr/bin/env python
import os
import sys
import shutil
import subprocess
from pathlib import Path

# Add the current directory to sys.path so we can import app
backend_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(backend_dir)

project_root = Path(__file__).parent.parent
env_path = project_root / ".env"
env_example_path = project_root / ".env.example"

def update_env_variable(env_file_path: Path, key: str, value: str):
    """Updates or appends a key=value pair in the .env file."""
    if not env_file_path.exists():
        env_file_path.touch()
    content = env_file_path.read_text()
    lines = content.splitlines()
    updated = False
    for i, line in enumerate(lines):
        parts = line.split('=', 1)
        if len(parts) == 2 and parts[0].strip() == key:
            lines[i] = f"{key}={value}"
            updated = True
            break
    if not updated:
        lines.append(f"{key}={value}")
    env_file_path.write_text("\n".join(lines) + "\n")

# 1. Copy .env.example to .env automatically if it doesn't exist
if not env_path.exists():
    if env_example_path.exists():
        shutil.copy(env_example_path, env_path)
        print(f"[AUTO-SETUP] Created new .env file from .env.example template.")
    else:
        print(f"[ERROR] .env.example not found in {project_root}!")

# Load environment variables into os.environ
if env_path.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(env_path)
    except ImportError:
        pass

# 2. Automatically generate secure SECRET_KEY if needed
secret_key = os.environ.get("SECRET_KEY")
if not secret_key or secret_key == "replace-with-a-long-random-secret":
    import secrets
    new_secret = secrets.token_hex(32)
    update_env_variable(env_path, "SECRET_KEY", new_secret)
    os.environ["SECRET_KEY"] = new_secret
    print(f"[AUTO-SETUP] Generated a secure, random SECRET_KEY and saved it to .env.")

# 3. Temporarily change CWD to 'backend' before importing app config
# to prevent Pydantic from trying to parse .env directly and raising extra_forbidden
original_cwd = os.getcwd()
os.chdir(backend_dir)
try:
    from app.config import get_settings
    # Instantiate once to initialize settings in LRU cache
    _ = get_settings()
finally:
    os.chdir(original_cwd)

def print_section(title):
    print("\n" + "=" * 60)
    print(f" {title} ".center(60, "="))
    print("=" * 60)

def check_python_imports():
    print_section("Checking Python Library Dependencies")
    libraries = [
        ("rdkit", "RDKit (molecular informatics)"),
        ("Bio", "Biopython (protein file parsing)"),
        ("sqlalchemy", "SQLAlchemy (ORM)"),
        ("celery", "Celery (task queue)"),
        ("redis", "Redis client"),
        ("fastapi", "FastAPI (web framework)")
    ]
    
    all_ok = True
    for lib, desc in libraries:
        try:
            __import__(lib)
            print(f"[OK] {desc} ({lib}) is installed.")
        except ImportError as e:
            print(f"[ERROR] {desc} ({lib}) is MISSING! Error: {e}")
            all_ok = False
            
    return all_ok

def check_workspace():
    print_section("Checking Workspace Directory")
    try:
        from app.config import get_settings
        settings = get_settings()
        workspace_path = settings.get_workspace_dir()
        print(f"Workspace path from configuration: {workspace_path}")
        
        # Check if we can write to it
        test_file = workspace_path / ".write_test"
        try:
            test_file.write_text("test")
            test_file.unlink()
            print(f"[OK] Workspace is writable.")
        except Exception as write_err:
            # Fallback to local workspace if the current one isn't writable
            local_workspace = project_root / "workspaces"
            local_workspace.mkdir(parents=True, exist_ok=True)
            update_env_variable(env_path, "WORKSPACE_BASE_PATH", str(local_workspace.absolute()))
            os.environ["WORKSPACE_BASE_PATH"] = str(local_workspace.absolute())
            get_settings.cache_clear()
            workspace_path = local_workspace
            print(f"  [AUTO-SETUP] Workspace was not writable ({write_err}). Changed WORKSPACE_BASE_PATH to: {local_workspace.absolute()}")
            
        # Check subdirectories
        from app.routers.docking import _SUBDIRS
        print("Checking/creating subdirectories:")
        for subdir in _SUBDIRS:
            subdir_path = workspace_path / "test_job_dir" / subdir
            subdir_path.mkdir(parents=True, exist_ok=True)
            print(f"  - Created {subdir_path.relative_to(workspace_path)}")
        
        # Cleanup test directories
        shutil.rmtree(workspace_path / "test_job_dir", ignore_errors=True)
        print(f"[OK] Subdirectory creation verified.")
        return True
    except Exception as e:
        print(f"[ERROR] Workspace check failed: {e}")
        return False

def check_external_binaries():
    print_section("Checking External Binary Dependencies")
    all_ok = True
    
    # 1. AutoDock Vina
    print("1. AutoDock Vina:")
    vina_path = os.environ.get("VINA_PATH")
    vina_bin = None
    
    # List of local candidate paths to search
    local_candidates = [
        project_root / "env" / "vina",
        project_root / "env" / "bin" / "vina",
        project_root / "env" / "vina.exe",
        project_root / "env" / "bin" / "vina.exe",
        project_root / "vina" / "vina",
        project_root / "vina" / "vina.exe",
    ]
    
    # Check if configured path is valid and exists
    if vina_path and Path(vina_path).exists() and Path(vina_path).is_file():
        vina_bin = vina_path
    else:
        # Search in candidates first (prefer local env directory)
        for candidate in local_candidates:
            if candidate.exists() and candidate.is_file():
                vina_bin = str(candidate.absolute())
                break
                
        # Fallback to system PATH
        if not vina_bin:
            vina_in_path = shutil.which("vina")
            if vina_in_path:
                vina_bin = vina_in_path

    # If we found Vina, auto-update .env with the correct absolute path
    if vina_bin:
        abs_vina_bin = str(Path(vina_bin).absolute())
        if vina_path != abs_vina_bin:
            update_env_variable(env_path, "VINA_PATH", abs_vina_bin)
            os.environ["VINA_PATH"] = abs_vina_bin
            from app.config import get_settings
            get_settings.cache_clear()
            print(f"  [AUTO-SETUP] Configured VINA_PATH in .env to: {abs_vina_bin}")
            
    if vina_bin:
        print(f"  Found Vina at: {vina_bin}")
        result = subprocess.run([vina_bin, "--version"], capture_output=True, text=True)
        if result.returncode == 0:
            print(f"  [OK] Vina version: {result.stdout.strip().splitlines()[0] if result.stdout else 'unknown'}")
        else:
            result = subprocess.run([vina_bin, "--help"], capture_output=True, text=True)
            if "AutoDock Vina" in result.stdout or "AutoDock Vina" in result.stderr:
                print("  [OK] Vina execution check passed.")
            else:
                print(f"  [ERROR] Vina executed but output is unexpected: {result.stderr or result.stdout}")
                all_ok = False
    else:
        print("  [ERROR] AutoDock Vina binary not found!")
        print("\n  >>> HOW TO INSTALL AUTODOCK VINA <<<")
        print("  Option A (Recommended Local Setup):")
        print("    1. Create an 'env' directory in the project root:")
        print(f"       mkdir -p {project_root}/env")
        print("    2. Download the AutoDock Vina binary for your OS from:")
        print("       https://github.com/ccsb-scripps/AutoDock-Vina/releases")
        print("    3. Place the executable inside the 'env' folder:")
        print(f"       Path should be: {project_root}/env/vina (or env/vina.exe on Windows)")
        print("    4. Make it executable:")
        print(f"       chmod +x {project_root}/env/vina")
        print("    5. Re-run this script! It will automatically detect it and set VINA_PATH in your .env.")
        print("\n  Option B (System-wide Install):")
        print("    Install it via your system package manager (e.g., 'brew install autodock-vina' or 'apt-get install autodock-vina')")
        print("    and update the VINA_PATH variable in your .env file.")
        all_ok = False
        
    # 2. Open Babel (obabel)
    print("\n2. Open Babel (obabel):")
    obabel_path = shutil.which("obabel")
    if obabel_path:
        print(f"  Found obabel at: {obabel_path}")
        result = subprocess.run([obabel_path, "-V"], capture_output=True, text=True)
        if result.returncode == 0:
            print(f"  [OK] Open Babel version: {result.stdout.strip()}")
        else:
            print("  [OK] Open Babel is installed.")
    else:
        print("  [WARNING] Open Babel (obabel) is NOT installed. (Note: This is a fallback and not strictly required if prepare_receptor4 is available)")
        
    # 3. prepare_receptor / prepare_receptor4
    print("\n3. AutoDockTools (prepare_receptor/prepare_receptor4):")
    prepare_receptor = shutil.which("prepare_receptor")
    if not prepare_receptor:
        prepare_receptor = shutil.which("prepare_receptor4")
    if not prepare_receptor:
        try:
            import AutoDockTools
            adt_path = os.path.dirname(AutoDockTools.__file__)
            for name in ["prepare_receptor4", "prepare_receptor"]:
                candidate = os.path.join(adt_path, "..", "..", "bin", name)
                if os.path.exists(candidate):
                    prepare_receptor = candidate
                    break
        except ImportError:
            pass
            
    if prepare_receptor:
        print(f"  Found prepare_receptor script at: {prepare_receptor}")
        result = subprocess.run([prepare_receptor, "-h"], capture_output=True, text=True)
        if "prepare_receptor" in result.stdout or "prepare_receptor" in result.stderr or "Usage" in result.stdout or "Usage" in result.stderr or result.returncode == 0:
            print(f"  [OK] prepare_receptor execution check passed.")
        else:
            print(f"  [WARNING] prepare_receptor executed but usage output is unexpected.")
    else:
        print("  [ERROR] AutoDockTools prepare_receptor or prepare_receptor4 is NOT found! Receptor preparation will fail.")
        all_ok = False
        
    return all_ok

def check_services():
    print_section("Checking DB & Redis Services")
    all_ok = True
    
    # 1. Database Connection
    print("1. Database Connection:")
    try:
        from app.config import get_settings
        from sqlalchemy import create_engine, text
        from sqlalchemy.engine import make_url
        settings = get_settings()
        db_url = os.environ.get("DATABASE_URL") or settings.DATABASE_URL
    except Exception as e:
        print(f"  [ERROR] Cannot load database settings: {e}")
        return False

    def try_connect(url_str):
        try:
            engine = create_engine(url_str, connect_args={"connect_timeout": 3})
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return True
        except Exception:
            return False

    if try_connect(db_url):
        print(f"  [OK] Successfully connected to database.")
    else:
        print("  Database connection failed with current settings. Attempting auto-discovery...")
        discovered = False
        try:
            url = make_url(db_url)
            hosts_to_try = [url.host]
            if url.host == "db":
                hosts_to_try.append("localhost")
                hosts_to_try.append("127.0.0.1")
            elif url.host in ["localhost", "127.0.0.1"]:
                hosts_to_try.append("db")

            ports_to_try = [url.port]
            if url.port == 5432:
                ports_to_try.append(5433)
            elif url.port == 5433:
                ports_to_try.append(5432)
            elif not url.port:
                ports_to_try.extend([5432, 5433])

            for host in hosts_to_try:
                for port in ports_to_try:
                    if host == url.host and port == url.port:
                        continue
                    new_url = url.set(host=host, port=port)
                    new_url_str = str(new_url)
                    if try_connect(new_url_str):
                        print(f"  [AUTO-SETUP] Successfully connected to database on host '{host}' and port '{port}'!")
                        update_env_variable(env_path, "DATABASE_URL", new_url_str)
                        os.environ["DATABASE_URL"] = new_url_str
                        get_settings.cache_clear()
                        discovered = True
                        break
                if discovered:
                    break
        except Exception as e:
            print(f"  [DEBUG] Error during DB auto-discovery: {e}")

        if not discovered:
            print("  [ERROR] Could not connect to the database with any attempted settings.")
            all_ok = False
        
    # 2. Redis Connection
    print("\n2. Redis Connection:")
    try:
        from app.config import get_settings
        import redis
        settings = get_settings()
        redis_url = os.environ.get("REDIS_URL") or settings.REDIS_URL
    except Exception as e:
        print(f"  [ERROR] Cannot load Redis settings: {e}")
        return False

    def try_redis_connect(url_str):
        try:
            r = redis.from_url(url_str, socket_timeout=3)
            r.ping()
            r.close()
            return True
        except Exception:
            return False

    if try_redis_connect(redis_url):
        print("  [OK] Successfully connected to Redis.")
    else:
        print("  Redis connection failed with current settings. Attempting auto-discovery...")
        discovered = False
        try:
            import urllib.parse
            parsed = urllib.parse.urlparse(redis_url)
            host = parsed.hostname
            port = parsed.port or 6379
            
            hosts_to_try = [host]
            if host == "redis":
                hosts_to_try.append("localhost")
                hosts_to_try.append("127.0.0.1")
            elif host in ["localhost", "127.0.0.1"]:
                hosts_to_try.append("redis")

            for h in hosts_to_try:
                if h == host:
                    continue
                netloc = h
                if parsed.port:
                    netloc += f":{parsed.port}"
                new_url = parsed._replace(netloc=netloc).geturl()
                if try_redis_connect(new_url):
                    print(f"  [AUTO-SETUP] Successfully connected to Redis on host '{h}'!")
                    update_env_variable(env_path, "REDIS_URL", new_url)
                    os.environ["REDIS_URL"] = new_url
                    get_settings.cache_clear()
                    discovered = True
                    break
        except Exception as e:
            print(f"  [DEBUG] Error during Redis auto-discovery: {e}")

        if not discovered:
            print("  [ERROR] Could not connect to Redis.")
            all_ok = False
        
    return all_ok

def main():
    print("=" * 60)
    print(" PHYTODISCOVER DEPENDENCY CHECKER ".center(60, "#"))
    print("=" * 60)
    
    imports_ok = check_python_imports()
    workspace_ok = check_workspace()
    binaries_ok = check_external_binaries()
    services_ok = check_services()
    
    print_section("Summary")
    print(f"Python libraries: {'[OK]' if imports_ok else '[FAILED]'}")
    print(f"Workspace access: {'[OK]' if workspace_ok else '[FAILED]'}")
    print(f"Binary paths:     {'[OK]' if binaries_ok else '[FAILED]'}")
    print(f"Services (DB/Redis): {'[OK]' if services_ok else '[FAILED]'}")
    print("=" * 60)
    
    if imports_ok and workspace_ok and binaries_ok and services_ok:
        print("\n[SUCCESS] All dependencies are satisfied! PhytoDiscover is ready.")
        sys.exit(0)
    else:
        print("\n[FAILURE] Some dependencies or configurations are missing or incorrect.")
        sys.exit(1)

if __name__ == "__main__":
    main()
