from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_search_plants():
    # Test without query
    response = client.get("/api/compounds/plants")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    
    # If there are plants in the DB, verify structure
    if len(data) > 0:
        assert isinstance(data[0], str)

def test_search_plants_with_query():
    # Search with a query 'a'
    response = client.get("/api/compounds/plants?q=a")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    for plant in data:
        assert isinstance(plant, str)
        assert "a" in plant.lower()

def test_search_plants_with_smiles_filter():
    # Search with has_smiles=True
    response = client.get("/api/compounds/plants?has_smiles=true")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    if len(data) > 0:
        assert isinstance(data[0], str)

