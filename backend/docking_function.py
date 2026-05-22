import os
import random
import pandas as pd
import numpy as np
import subprocess
from pathlib import Path
import seaborn as sns
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap


def optimized_docking(path = pathway ):
    separator = os.sep    
    os.chdir(path + separator + "output_files_1")

    configure_from_path = list(Path(path + separator +"configuration_file").glob("*.txt"))
    configure_list = sorted([i.stem for i in  configure_from_path])
    drugs_from_path = list(Path(path + separator + "drug_pdbqt_files").glob("*.pdbqt"))
    drugs_list = sorted([i.stem for i in  drugs_from_path])

    vina_dir =  Path("/home/kaderi/Feroj/first/vinas")
    subdirs = [p for p in vina_dir.iterdir() if p.is_dir()]
    random_subdir = random.choice(subdirs)


    for conf in configure_list:
        folder_name = f"{conf}"

        if not os.path.exists(folder_name):
            os.makedirs(folder_name)
        else:
            pass

        list_out_file = list(Path(path+ separator + "output_files_1"+ separator +folder_name ).glob("*.pdbqt"))
        list_out_file_1 = sorted([i.stem for i in  list_out_file])

           
        
        for drug in drugs_list:
            if drug not in list_out_file_1:
                vina_command = [
                    f"{random_subdir}" + separator + "vina", 
                    "--config", path+ separator + "configuration_file" + separator +f"{conf}.txt",
                    "--ligand", path + separator + "drug_pdbqt_files" + separator + f"{drug}.pdbqt",
                    "--out", path + separator + "output_files_1" + separator + folder_name + separator +f"{drug}.pdbqt",
                    "--log", path + separator + "output_files_1" + separator + folder_name + separator + f"{drug}.log"
                ]


                result = subprocess.run(vina_command, capture_output=True, text=True, env=os.chdir(path+ separator + "protien_pdbqt_files"))



                
                print(f"Processing {drug}...")
                print("STDOUT:", result.stdout)
                print("STDERR:", result.stderr)
                os.chdir(path+ separator + "output_files_1")
            else:
                continue
        
        
        log_files = list(Path(path+ separator + "output_files_1" + separator + folder_name).glob("*.log"))

        name_of_log_files = [ i.stem for i in log_files]
        name_of_log_files = [i.replace("_"," ")  if "_" in i else i for i in name_of_log_files]
        binnding_affinity_score = [ ]

        for i in range(0,len(log_files),1):
            try:
                data_1 = pd.read_table(log_files[i],header=None)
                index_value  = data_1.iloc[:,0][data_1.iloc[:,0] == '-----+------------+----------+----------'].index[0]
                data_2 = pd.read_table(log_files[i],skipfooter= 1, skiprows= index_value+3, engine= 'python', header= None)
                binnding_affinity_score.append(float(data_2[0].str.split()[0][1]))
            except:
                binnding_affinity_score.append(pd.NA)
                continue
        
        var1 = pd.DataFrame(binnding_affinity_score,index=name_of_log_files,columns=[f"{conf}"])

        var1.to_csv(path + separator + "output_files_2" + separator+f"{conf}.csv")
        
        os.chdir(path+ separator + "configuration_file")
        
        if not os.path.exists("Completed_config"):
            os.makedirs("Completed_config")
        else:
            pass

        os.rename(path + separator + "configuration_file" + separator +f"{conf}.txt", path+ separator + "configuration_file" + separator + "Completed_config" + separator +f"{conf}.txt")

        os.chdir(path + separator + "output_files_1" )



def preparing_bs_csv(path = pathway):
    """
    This functions collects all csv files of binding score from the directory and concat them into one file.
    After that it sort the rows by the basis of the row average amd also sort the column on the basis of the column average
    

    input: path : Path is the directory location where your binding csv files

    outpu: csv_files : It return the sorten files
    """
    separator =  os.sep
    var_csv = pd.DataFrame()
    csvfiles_path = list(Path(path+ separator + "output_files_2").glob("*.csv"))
    for i in csvfiles_path:
        var_2 = pd.read_csv(i,index_col=0)
        var_csv = pd.concat([var_csv,var_2],axis = 1)

    var_csv.dropna(axis= 0,inplace= True)
    var_csv['average']=var_csv.apply(np.mean,axis = 1)
    var_csv.sort_values(by = ['average'],ascending=True,inplace= True)
    var_csv.drop('average',axis=1, inplace = True)
    var_csv.loc['average',:] = var_csv.apply(np.mean,axis = 0)
    var_csv.sort_values(by = 'average',ascending=True,inplace= True,axis= 1 )
    var_csv.drop('average',axis=0, inplace = True)
    var_csv.transpose().to_csv(path+ separator + "Binding affinity scores.csv")




# def binding_affinity_heatmap(data,
#                              title=' ',
#                              x_label='',
#                              y_label=' ',
#                              annot_font_design=None,
#                              title_font_design=None,
#                              xlabel_font_design=None,
#                              ylabel_font_design=None,
#                              x_tick_design=None,
#                              y_tick_design=None,
#                              fig_size=(15, 5),
#                              color_list_heatmap=['red', 'white', 'green'],
#                              annotation=True,
#                              linewidths=0,
#                              linecolor='white',
#                              rotation=None,
#                              highlight_xticks_index=[],
#                              highlight_yticks_index=[],
#                              design_highlight_xticks=None,
#                              design_highlight_yticks=None):
    
#     """
#     This functions mainly designed for creating heatmap from the sorted binding affinity score
    

#     input: 
    
#     data : it is Dataframe , table or csv file as an input

#     output: Figure : It returns the heatmap of the given data
#     """
#     default_font = {'fontsize': 10, 'fontweight': 'normal', 'fontstyle': 'normal',
#                     'fontfamily': 'sans-serif', 'color': 'black'}

  
#     annot_font_design = annot_font_design or default_font
#     title_font_design = title_font_design or default_font
#     xlabel_font_design = xlabel_font_design or default_font
#     ylabel_font_design = ylabel_font_design or default_font
#     x_tick_design = x_tick_design or default_font
#     y_tick_design = y_tick_design or default_font
#     design_highlight_xticks = design_highlight_xticks or default_font
#     design_highlight_yticks = design_highlight_yticks or default_font
#     rotation = rotation or {'title': 0, 'x_label': 0, "y_label": 90, "x_tick_label": 90, "y_tick_label": 0}


#     custom_cmap = LinearSegmentedColormap.from_list('colorbar_for_heatmap', color_list_heatmap, N=256)


#     fig, ax = plt.subplots(figsize=fig_size)

#     h_map = sns.heatmap(data, cmap=custom_cmap, annot=annotation, annot_kws= annot_font_design,

#                         linewidths=linewidths, linecolor=linecolor,vmin=np.floor(np.min(data)), vmax=np.ceil(np.max(data)))


#     ax.set_title(title, fontdict=title_font_design, rotation=int(rotation.get('title', 0)))
#     ax.set_xlabel(x_label, fontdict=xlabel_font_design, rotation=int(rotation.get('x_label', 0)))
#     ax.set_ylabel(y_label, fontdict=ylabel_font_design, rotation=int(rotation.get('y_label', 0)))


#     x_ticks = ax.set_xticklabels(labels=data.columns, fontdict=x_tick_design, 
#                                  rotation=int(rotation.get('x_tick_label', 90)))
#     y_ticks = ax.set_yticklabels(labels=data.index, fontdict=y_tick_design, 
#                                  rotation=int(rotation.get('y_tick_label', 0)))


#     for i, label in enumerate(x_ticks):
#         if i in highlight_xticks_index:
#             label.set_color(design_highlight_xticks.get('color', 'red'))
#             label.set_fontsize(design_highlight_xticks.get('fontsize', 14))
#             label.set_fontweight(design_highlight_xticks.get('fontweight', 'normal'))

#     for i, label in enumerate(y_ticks):
#         if i in highlight_yticks_index:
#             label.set_color(design_highlight_yticks.get('color', 'red'))
#             label.set_fontsize(design_highlight_yticks.get('fontsize', 12))
#             label.set_fontweight(design_highlight_yticks.get('fontweight', 'normal'))




    
