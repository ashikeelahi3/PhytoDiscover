def validate_smiles(smiles: str) -> dict:
    """
    Validates a single SMILES string using RDKit and returns computed
    molecular properties.  Never raises — returns is_valid=False on
    any error (import failure, invalid structure, unexpected exception).
    """
    try:
        from rdkit import Chem
        from rdkit.Chem import Descriptors, rdMolDescriptors

        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return {"is_valid": False, "smiles": smiles}

        mw   = Descriptors.MolWt(mol)
        logp = Descriptors.MolLogP(mol)
        hbd  = rdMolDescriptors.CalcNumHBD(mol)
        hba  = rdMolDescriptors.CalcNumHBA(mol)
        tpsa = Descriptors.TPSA(mol)
        rb   = rdMolDescriptors.CalcNumRotatableBonds(mol)
        lip  = mw < 500 and logp < 5 and hbd <= 5 and hba <= 10

        return {
            "is_valid": True,
            "smiles": smiles,
            "molecular_weight": round(mw, 3),
            "logp": round(logp, 3),
            "h_bond_donors": hbd,
            "h_bond_acceptors": hba,
            "tpsa": round(tpsa, 3),
            "rotatable_bonds": rb,
            "lipinski_pass": lip,
        }

    except Exception:
        return {"is_valid": False, "smiles": smiles}
