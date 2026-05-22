import requests
import nglview as nv
from Bio.PDB.MMCIFParser import MMCIFParser
from io import StringIO
import warnings
from Bio.PDB.PDBExceptions import PDBConstructionWarning
warnings.simplefilter('ignore', PDBConstructionWarning)
warnings.simplefilter('ignore', PDBConstructionWarning)
import os
from Bio.PDB import PDBIO
import numpy as np
from AutoDockTools.Utilities24 import protein_preparation_likeADT
from pathlib import Path

def directory_creation(path):
    os.chdir(path)
    os.mkdir("protein_pdb_files")
    os.mkdir('protien_pdbqt_files')
    os.mkdir('drug_pdb_files')
    os.mkdir("drug_pdbqt_files")
    os.mkdir("output_files_1")
    os.mkdir("output_files_2")
    return path

# pathway = directory_creation(path='/home/kaderi/Feroj/first/practice')

def alpha_fold_entity_selector(alpha_fold_id):
    url = f"https://alphafold.ebi.ac.uk/api/prediction/{alpha_fold_id}"       
    response =  requests.get(url)
    data = response.json()
    entity_list = []
    for i in data:
            entity_list.append((i['cifUrl'].split("/")[4]).split(".")[0])
    return(entity_list) 


def alpha_fold_structure(AF_id):
    alpha_fold_entity_selector(alpha_fold_id= AF_id)
    specific_model = input("please slect the entitity you want to work with")
    cif_url = f'https://alphafold.ebi.ac.uk/files/{specific_model}.cif'
    response = requests.get(cif_url)
    cif_data = StringIO(response.text)
    parser = MMCIFParser()
    structure = parser.get_structure(AF_id, cif_data)
    return structure

## updated function for later

""" def alpha_fold_structure(AF_id):    
        cif_url = f'https://alphafold.ebi.ac.uk/files/{AF_id}.cif'
        response = requests.get(cif_url)
        cif_data = StringIO(response.text)
        parser = MMCIFParser()
        structure = parser.get_structure(AF_id, cif_data)
        return structure """


def protein_structure(pdb_id):
    url = f"https://files.rcsb.org/download/{pdb_id}.cif"

    response = requests.get(url)
    cif_data = StringIO(response.text)
    parser = MMCIFParser()
    structure = parser.get_structure(pdb_id, cif_data)

    return(structure)




def protein_structure_calling (id):
    """
    Enter proten PDB id or Alphafold id

    id : " Protein id"
    output : return the whole protein structures
    """

    try:
        three_d_structure = protein_structure(pdb_id= id)
    except:
        try:
            three_d_structure = alpha_fold_structure(AF_id= id)
            
        except:
            return ("please provide a valid id")
  
    return (three_d_structure,id)

# three_d_structure, protein_id = protein_structure_calling(id = "8wxy")

def chain_list (model_structure = three_d_structure):
    list = []
    for chain in model_structure.get_chains():
        list.append(chain.id)
    print (list)




def chain_selection(chain_name):
    model = three_d_structure[0][f"{chain_name}"]
    return model

# updated_model = chain_selection(chain_name="A")

def chain_cleaning(structure = updated_model):
    to_remove = []

    for residue in structure:
        if residue.id[0] != " ":
            to_remove.append(residue.id)

    for rid in to_remove:
        structure.detach_child(rid)
    return structure

# final_model = chain_cleaning(structure= updated_model)

def calculate_grid_box_bd(protein):
    """
    This function specially designed for creating conf file for molecular docking
    in AutoDockVina

    Parameters:
        pdb_file (str or directory path): Receptor file or directory of the receptors.
        output_directory (directory path): path where you want to save your config file
        padding (float): default is 3. Padding around the protein (in Ångströms).
        all_pdb_files (bool): default False, Chenge to True you want to work all pdb files at a time.

    output:
        conf_file (txt):It returns configuration file/files of the protein that one can directly use in AutoDockVina
        for molecular docking

    """
    separator = os.sep
    structure = protein
    atoms = [atom for atom in structure.get_atoms()]
    coords = np.array([atom.coord for atom in atoms])

    min_coords = np.min(coords, axis=0)
    max_coords = np.max(coords, axis=0)
    center = (min_coords + max_coords) / 2
    size = max_coords - min_coords + 2 * 3 

    with open(pathway + separator + "configuration_file" +separator+ f"{protein_id}.txt", 'w') as f:
        f.write(f"receptor= {protein_id}.pdbqt\n")
        f.write(f"center_x = {center[0]}\n")
        f.write(f"center_y = {center[1]}\n")
        f.write(f"center_z = {center[2]}\n")
        f.write(f"size_x = {size[0]}\n")
        f.write(f"size_y = {size[1]}\n")
        f.write(f"size_z = {size[2]}\n")
        f.write(f"exhaustiveness = {8}\n")
        f.write(f"num_modes = {10}\n")
        f.write(f"energy_range = {4}\n")


def calculate_grid_box_as( x_coord, y_coord, z_coord, radius ):
    """
    This function specially designed for creating conf file for molecular docking
    in AutoDockVina

    Parameters:
        x_coord: coordination of x-axis.
        y_coord: coordination of y-axis
        z_coord: coordination of z-axis
        radius: raius of the active site.

    output:
        conf_file (txt):It returns configuration file/files of the protein that one can directly use in AutoDockVina
        for molecular docking

    """
    separator = os.sep

    with open(pathway + separator + "configuration_file" +separator+ f"{protein_id}.txt", 'w') as f:
        f.write(f"receptor= {protein_id}.pdbqt\n")
        f.write(f"center_x = {x_coord}\n")
        f.write(f"center_y = {y_coord}\n")
        f.write(f"center_z = {z_coord}\n")
        f.write(f"size_x = {radius*2}\n")
        f.write(f"size_y = {radius*2}\n")
        f.write(f"size_z = {radius*2}\n")
        f.write(f"exhaustiveness = {8}\n")
        f.write(f"num_modes = {10}\n")
        f.write(f"energy_range = {4}\n")


def protein_saving(model = updated_model):
    separator = os.sep
    io =  PDBIO()
    io.set_structure(updated_model)
    io.save(pathway + model + "protein_pdb_files" + separator + f"{protein_id}.pdb")




def protein_preparation_automate():
    separator = os.sep

    pre_processed_protein = list(Path(pathway + separator + "protein_pdb_files").glob("*.pdb"))
    pre_processed_protein_name = [i.stem for i in pre_processed_protein]


    for i,j in enumerate(pre_processed_protein):

        protein_preparation_likeADT.main(receptor_filename=pathway + separator + "protein_pdb_files"+ separator + f"{pre_processed_protein_name[i]}.pdb",
                outputfilename = pathway + separator + "protien_pdbqt_files" + separator +f"{pre_processed_protein_name[i]}.pdbqt" ,
                charges_to_add = "Kollman",repairs = "hydrogens",cleanup  = "nphs_lps_waters_nonstdres_deleteAltB")


