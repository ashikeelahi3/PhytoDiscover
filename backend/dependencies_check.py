#!/usr/bin/env python
import os
import sys
import shutil
import subprocess
from pathlib import Path

# Add the current directory to sys.path so we can import app
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass

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
        test_file.write_text("test")
        test_file.unlink()
        print(f"[OK] Workspace is writable.")
        
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
    try:
        from app.services.docking_engine import find_vina
        vina_path = find_vina()
        print(f"  Found Vina at: {vina_path}")
        result = subprocess.run([vina_path, "--version"], capture_output=True, text=True)
        if result.returncode == 0:
            print(f"  [OK] Vina version: {result.stdout.strip().splitlines()[0] if result.stdout else 'unknown'}")
        else:
            # vina --version sometimes returns non-zero, let's try with help
            result = subprocess.run([vina_path, "--help"], capture_output=True, text=True)
            if "AutoDock Vina" in result.stdout or "AutoDock Vina" in result.stderr:
                print("  [OK] Vina execution check passed.")
            else:
                print(f"  [ERROR] Vina executed but output is unexpected: {result.stderr or result.stdout}")
                all_ok = False
    except Exception as e:
        print(f"  [ERROR] Vina check failed: {e}")
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
        from app.database import SessionLocal
        from sqlalchemy import text
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        db.close()
        print("  [OK] Successfully connected to the database.")
    except Exception as e:
        print(f"  [ERROR] Database connection failed: {e}")
        all_ok = False
        
    # 2. Redis Connection
    print("\n2. Redis Connection:")
    try:
        from app.config import get_settings
        import redis
        settings = get_settings()
        r = redis.from_url(settings.REDIS_URL)
        r.ping()
        r.close()
        print("  [OK] Successfully connected to Redis.")
    except Exception as e:
        print(f"  [ERROR] Redis connection failed: {e}")
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
