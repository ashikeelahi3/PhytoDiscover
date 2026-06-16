import uuid
from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal
from app.models.session import UserSession
from app.models.docking_job import DockingJob
from app.models.protein import Protein, ProteinSource
from app.models.phytochemical import Phytochemical

client = TestClient(app)

def test_results_workspace_zip():
    import tempfile
    import shutil
    import zipfile
    import io
    import os

    # Setup database session
    db = SessionLocal()
    try:
        # Create a user session
        session_token = "test_token_" + str(uuid.uuid4())
        session = UserSession(session_token=session_token, display_name="Test User")
        db.add(session)
        db.commit()

        # Get or create a test protein
        protein = db.query(Protein).first()
        if not protein:
            protein = Protein(protein_code="6LU7", source=ProteinSource.PDB)
            db.add(protein)
            db.commit()

        # Get or create a test phytochemical
        phytochemical = db.query(Phytochemical).first()
        if not phytochemical:
            phytochemical = Phytochemical(name="Test Compound", smiles="CC")
            db.add(phytochemical)
            db.commit()

        # Create a temporary directory for the workspace pathway
        temp_workspace = tempfile.mkdtemp()
        
        # Create files inside the workspace to test zipping and exclusion
        # 1. Normal file
        normal_dir = os.path.join(temp_workspace, "drug_pdb_files")
        os.makedirs(normal_dir, exist_ok=True)
        with open(os.path.join(normal_dir, "compound.pdb"), "w") as f:
            f.write("ATOM CONTENT")

        # 2. File in misspelled directory (should be excluded)
        typo_dir = os.path.join(temp_workspace, "protien_pdbqt_files")
        os.makedirs(typo_dir, exist_ok=True)
        with open(os.path.join(typo_dir, "protein.pdbqt"), "w") as f:
            f.write("PROTEIN PDBQT CONTENT")

        # Create a docking job
        job = DockingJob(
            compound_id=phytochemical.id,
            protein_id=protein.id,
            session_id=session.id,
            pathway=temp_workspace,
        )
        db.add(job)
        db.commit()

        # Set session cookie and request
        client.cookies.set("pd_session", session_token)
        response = client.get(f"/api/docking/results/{job.id}/zip")
        
        assert response.status_code == 200
        assert "application/zip" in response.headers["content-type"]
        
        # Extract and verify zip contents
        zip_data = io.BytesIO(response.content)
        with zipfile.ZipFile(zip_data, "r") as zf:
            namelist = zf.namelist()
            # Assert normal file is in the zip
            assert "drug_pdb_files/compound.pdb" in namelist
            # Assert misspelled directory contents are excluded
            assert not any("protien_pdbqt_files" in name for name in namelist)

    finally:
        db.close()
        # Clean up temp directory
        if 'temp_workspace' in locals():
            shutil.rmtree(temp_workspace, ignore_errors=True)
