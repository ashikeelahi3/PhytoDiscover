from collections import defaultdict
from pathlib import Path
import requests
import py3Dmol
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import nglview as nv
import os
import tempfile
from pathlib import Path
import subprocess

from rdkit import Chem
from rdkit.Chem import AllChem, Draw
# from rdkit.Chem import Draw
from Bio.PDB import PDBParser, PDBIO, Select, StructureBuilder, Model, Chain, Residue
# from Bio.PDB import StructureBuilder, Model, Chain, Residue

def charge_optimization(file):
    
    try:
 
        mol = Chem.MolFromMolBlock(file)
        mol = Chem.AddHs(mol) 
        params = AllChem.ETKDGv3()
        params.randomSeed = 42

        conf_ids = AllChem.EmbedMultipleConfs(mol, numConfs=50, params=params)


        energies = []

        for conf_id in conf_ids:
            AllChem.MMFFOptimizeMolecule(mol, confId=conf_id)
            
            props = AllChem.MMFFGetMoleculeProperties(mol)

            ff = AllChem.MMFFGetMoleculeForceField(mol, props, confId=conf_id)
            
            ff.Minimize(maxIts=500, energyTol=1e-6, forceTol=1e-5)
            
            energy = ff.CalcEnergy()
            energies.append((conf_id, energy))
    
        return mol, energies[0][0]  
   
    except:
        pass 



def structure_collection_from_name(compound):
    """
    # Input: cid/IUPAC/market name/ smiles of the compound
    """
    separator = os.sep
    try:
        if compound.startswith("CID") or compound.startswith("cid"):
            cid_of_the_compound = compound[3:]
            sdf = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{cid_of_the_compound}/sdf"      
            response = requests.get(sdf)  
            mol_data = response.text

        
        else:
            sdf = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{compound}/sdf"      
            response = requests.get(sdf)  
            mol_data = response.text
    
        mol_structure, minimized_structure = charge_optimization(file = mol_data)

        Chem.MolToPDBFile(mol =mol_structure,
            confId= minimized_structure[0][0],
            filename= pathway + separator + "drug_pdb_filesf"+ separator + "{compound}.pdb")
    except:
        pass 




def structure_collection_from_smiles(smiles):
        separator = os.sep
        mol = Chem.MolFromSmiles(smiles)
        mol = Chem.AddHs(mol) 
        params = AllChem.ETKDGv3()
        params.randomSeed = 42

        conf_ids = AllChem.EmbedMultipleConfs(mol, numConfs=50, params=params)


        energies = []

        for conf_id in conf_ids:
            AllChem.MMFFOptimizeMolecule(mol, confId=conf_id)
            
            props = AllChem.MMFFGetMoleculeProperties(mol)

            ff = AllChem.MMFFGetMoleculeForceField(mol, props, confId=conf_id)
            
            ff.Minimize(maxIts=500, energyTol=1e-6, forceTol=1e-5)
            
            energy = ff.CalcEnergy()
            energies.append((conf_id, energy))
        
        Chem.MolToPDBFile(mol = mol,confId= energies[0][0],
        filename= pathway + separator + "drug_pdb_files"+ separator + f"{smiles}.pdb")


def drug_from_provided_drug_list(compounds, smiles = False):
    if smiles == False:
        for i in compounds:
            structure_collection_from_name(compound= i)
    else:
        for i in compounds:
            structure_collection_from_smiles(smiles = i)



def drug_from_provided_plant_list(compounds):
    
    separator = os.sep
    compound = []
    corresponding_compound_smiles = []##function() that will give you list of the corresponding smiles of the compounds  
    for (name,smiles) in zip(compound,corresponding_compound_smiles):
        mol = Chem.MolFromSmiles(smiles)
        mol = Chem.AddHs(mol) 
        params = AllChem.ETKDGv3()
        params.randomSeed = 42

        conf_ids = AllChem.EmbedMultipleConfs(mol, numConfs=50, params=params)


        energies = []

        for conf_id in conf_ids:
            AllChem.MMFFOptimizeMolecule(mol, confId=conf_id)
            
            props = AllChem.MMFFGetMoleculeProperties(mol)

            ff = AllChem.MMFFGetMoleculeForceField(mol, props, confId=conf_id)
            
            ff.Minimize(maxIts=500, energyTol=1e-6, forceTol=1e-5)
            
            energy = ff.CalcEnergy()
            energies.append((conf_id, energy))
        
        Chem.MolToPDBFile(mol = mol,confId= energies[0][0],
        filename= pathway + separator + "drug_pdb_files"+ separator + f"{name}.pdb")
      


def pdb_to_pdbqt(path = pathway):
    pdb_dir = Path(pathway + "drug_pdb_files")
    output_dir = Path(pathway + "drug_pdbqt_files")

    pdb_files = list(pdb_dir.glob("*.pdb"))

    for file in pdb_files:
        input_path = file
        output_name = file.stem.replace(" ", "_") + ".pdbqt"
        output_path = output_dir / output_name

        subprocess.run([
            "obabel",
            str(input_path),
            "-O",
            str(output_path),
            "--partialcharge",
            "gasteiger"
        ])


