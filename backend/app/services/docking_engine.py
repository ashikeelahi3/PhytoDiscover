import os
import subprocess
import logging
import pandas as pd
from pathlib import Path

from app.config import get_settings

logger = logging.getLogger(__name__)


def find_vina() -> str:
    """
    Finds the AutoDock Vina binary.
    Checks in order:
    1. VINA_PATH from .env
    2. PATH (which vina)
    3. Common Mac locations
    Raises FileNotFoundError if not found.
    """
    settings = get_settings()

    if hasattr(settings, "VINA_PATH") and settings.VINA_PATH:
        if Path(settings.VINA_PATH).exists():
            return str(settings.VINA_PATH)

    import shutil
    vina = shutil.which("vina")
    if vina:
        return vina

    candidates = [
        "/usr/local/bin/vina",
        "/opt/homebrew/bin/vina",
        str(Path.home() / "bin" / "vina"),
    ]
    for path in candidates:
        if Path(path).exists():
            return path

    raise FileNotFoundError(
        "AutoDock Vina binary not found. "
        "Please install Vina and set VINA_PATH in .env"
    )


def run_docking(pathway: str, job_id: str) -> int:
    """
    Runs AutoDock Vina for all ligand/protein combinations.

    Expects in pathway/:
      protein_pdbqt_files/  — one .pdbqt file (receptor)
      drug_pdbqt_files/     — one or more .pdbqt files (ligands)
      protien_pdbqt_files/  — same as above (typo folder also checked)
      configuration_file/   — .txt config files (created by this function
                               if they don't exist)

    Writes results to:
      output_files_1/{protein_name}/{drug_name}.pdbqt
      output_files_1/{protein_name}/{drug_name}.log

    Returns count of successful docking runs.
    """
    sep = os.sep
    vina_bin = find_vina()

    # Find receptor PDBQT — check both folder spellings
    receptor_dir = Path(pathway) / "protein_pdbqt_files"
    receptor_dir_typo = Path(pathway) / "protien_pdbqt_files"

    receptors = list(receptor_dir.glob("*.pdbqt")) if receptor_dir.exists() else []
    if not receptors:
        receptors = list(receptor_dir_typo.glob("*.pdbqt")) if receptor_dir_typo.exists() else []

    if not receptors:
        raise FileNotFoundError(
            f"No receptor PDBQT files found in {receptor_dir}"
        )

    # Find ligand PDBQTs
    drug_dir = Path(pathway) / "drug_pdbqt_files"
    drugs = list(drug_dir.glob("*.pdbqt")) if drug_dir.exists() else []

    if not drugs:
        raise FileNotFoundError(
            f"No ligand PDBQT files found in {drug_dir}"
        )

    logger.info("[%s] Found %d receptor(s), %d ligand(s)",
                job_id, len(receptors), len(drugs))

    # Check for config files — if none exist, generate blind docking configs
    config_dir = Path(pathway) / "configuration_file"
    config_dir.mkdir(exist_ok=True)

    config_files = list(config_dir.glob("*.txt"))
    if not config_files:
        logger.info("[%s] No config files found — generating blind docking configs",
                    job_id)
        config_files = generate_blind_configs(receptors, config_dir, pathway, job_id)

    successful = 0

    for receptor in receptors:
        receptor_name = receptor.stem
        out_folder = Path(pathway) / "output_files_1" / receptor_name
        out_folder.mkdir(parents=True, exist_ok=True)

        # Find matching config file (receptor-specific, then first available)
        config = config_dir / f"{receptor_name}.txt"
        if not config.exists() and config_files:
            config = config_files[0]

        for drug in drugs:
            drug_name = drug.stem
            out_pdbqt = out_folder / f"{drug_name}.pdbqt"
            out_log   = out_folder / f"{drug_name}.log"

            if out_pdbqt.exists():
                logger.info("[%s] Skipping %s (already docked)", job_id, drug_name)
                successful += 1
                continue

            cmd = [
                vina_bin,
                "--config", str(config),
                "--ligand", str(drug),
                "--out",    str(out_pdbqt),
            ]

            logger.info("[%s] Docking %s against %s", job_id, drug_name, receptor_name)

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                cwd=str(receptor.parent),
            )

            # Save stdout as the log file (Vina v1.2.7 removed --log flag)
            if result.stdout:
                out_log.write_text(result.stdout)
            elif result.stderr:
                out_log.write_text(result.stderr)

            if result.returncode == 0:
                successful += 1
                logger.info("[%s] ✓ %s done", job_id, drug_name)
            else:
                logger.warning("[%s] ✗ %s failed: %s",
                               job_id, drug_name, result.stderr[:200])

    return successful


def generate_blind_configs(
    receptors: list,
    config_dir: Path,
    pathway: str,
    job_id: str,
) -> list:
    """
    Generates AutoDock Vina config files for blind docking.
    Uses a 126 Å box centered at origin — large enough to cover any protein.
    Only called when no config files already exist in configuration_file/.
    """
    config_files = []

    for receptor in receptors:
        config_path = config_dir / f"{receptor.stem}.txt"
        config_content = (
            f"receptor = {receptor}\n"
            f"center_x = 0\n"
            f"center_y = 0\n"
            f"center_z = 0\n"
            f"size_x = 126\n"
            f"size_y = 126\n"
            f"size_z = 126\n"
            f"exhaustiveness = 8\n"
            f"num_modes = 9\n"
            f"energy_range = 3\n"
        )
        config_path.write_text(config_content)
        config_files.append(config_path)
        logger.info("[%s] Generated blind docking config for %s",
                    job_id, receptor.stem)

    return config_files


def parse_results(pathway: str, job_id: str) -> pd.DataFrame:
    """
    Replaces preparing_bs_csv().
    Reads all .log files from output_files_1/ and extracts the best
    (mode 1) binding affinity, RMSD bounds, and pose file path.
    Saves a combined CSV to output_files_2/Binding affinity scores.csv.
    Returns a DataFrame of all results.
    """
    sep = os.sep
    output_dir = Path(pathway) / "output_files_1"
    results = []

    for protein_folder in output_dir.iterdir():
        if not protein_folder.is_dir():
            continue
        protein_name = protein_folder.name

        for log_file in protein_folder.glob("*.log"):
            try:
                content  = log_file.read_text()
                in_table = False
                best_score = None
                rmsd_lb    = None
                rmsd_ub    = None

                for line in content.split("\n"):
                    if "-----+------------" in line:
                        in_table = True
                        continue
                    if in_table and line.strip():
                        parts = line.split()
                        if len(parts) >= 4 and parts[0] == "1":
                            try:
                                best_score = float(parts[1])
                                rmsd_lb    = float(parts[2])
                                rmsd_ub    = float(parts[3])
                            except ValueError:
                                pass
                            break

                pose_file = str(protein_folder / f"{log_file.stem}.pdbqt")

                results.append({
                    "compound_name": log_file.stem.replace("_", " "),
                    "protein_name":  protein_name,
                    "binding_score": best_score,
                    "rmsd_lower":    rmsd_lb,
                    "rmsd_upper":    rmsd_ub,
                    "h_bond_count":  0,
                    "pose_file":     pose_file,
                })
            except Exception as e:
                logger.warning("[%s] Could not parse %s: %s", job_id, log_file, e)

    df = pd.DataFrame(results)

    if not df.empty:
        df.sort_values("binding_score", ascending=True, inplace=True)
        out_csv = Path(pathway) / "output_files_2" / "Binding affinity scores.csv"
        df.to_csv(out_csv, index=False)
        logger.info("[%s] Saved results CSV: %s", job_id, out_csv)

    return df
