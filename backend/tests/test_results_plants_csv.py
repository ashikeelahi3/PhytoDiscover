import uuid
from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal
from app.models.session import UserSession
from app.models.docking_job import DockingJob
from app.models.protein import Protein, ProteinSource
from app.models.phytochemical import Phytochemical
from app.models.result import Result

client = TestClient(app)

def test_results_plants_csv():
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
            phytochemical = Phytochemical(name="Test Compound", smiles="CC", source_plant="Mangifera indica", plant_family="Anacardiaceae")
            db.add(phytochemical)
            db.commit()

        # Create a docking job
        job = DockingJob(
            compound_id=phytochemical.id,
            protein_id=protein.id,
            session_id=session.id,
            pathway="/tmp/test_pathway",
        )
        db.add(job)
        db.commit()

        # Create a result for this job
        result = Result(
            job_id=job.id,
            compound_name=phytochemical.name,
            binding_score=-7.5,
        )
        db.add(result)
        db.commit()

        # Set session cookie and request
        client.cookies.set("pd_session", session_token)
        response = client.get(f"/api/docking/results/{job.id}/plants/csv")
        
        assert response.status_code == 200
        assert "text/csv" in response.headers["content-type"]
        
        csv_content = response.text
        lines = csv_content.strip().split("\n")
        assert len(lines) >= 2
        assert "compound_name,smiles,source_plant,plant_family" in lines[0]
        assert phytochemical.name in lines[1]
        
    finally:
        db.close()

