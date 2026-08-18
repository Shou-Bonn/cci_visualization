import os, json, shutil

BASE_DIR = r"c:\Users\William\OneDrive - Yale University\桌面\MAXI"
EPOCHS_DIR = os.path.join(BASE_DIR, "project2", "CCI_epochs")
OUT_DIR = os.path.join(r"c:\Users\William\OneDrive - Yale University\桌面\MAXI\project2\cci_web_app", "data")

MASTER_JSON = os.path.join(BASE_DIR, "DATA", "targets", "MAXI_sources_master.json")
with open(MASTER_JSON, 'r') as f:
    master_targets = json.load(f)

all_data = []

print("Processing master data...")
for filename in os.listdir(EPOCHS_DIR):
    if not filename.endswith('.json'):
        continue
        
    filepath = os.path.join(EPOCHS_DIR, filename)
    with open(filepath, 'r') as f:
        data = json.load(f)
        
        metadata = data.get('metadata', {})
        object_name = metadata.get('object_name', filename.replace('.json', ''))
        
        target_info = master_targets.get(object_name, {})
        obj_class = target_info.get('compact_object_class') or 'Unknown'
        raw_subclass = target_info.get('subclass') or 'Unknown'
        
        custom_subclass = 'Unknown'
        if obj_class == 'Unknown' or raw_subclass == 'Unknown' or not obj_class or not raw_subclass:
            custom_subclass = 'Unknown'
        elif raw_subclass == 'LMXB':
            if obj_class == 'BH': custom_subclass = 'LMBH'
            elif obj_class == 'NS': custom_subclass = 'LMNS'
            elif obj_class == 'Pulsar': custom_subclass = 'LMPulsar'
            else: custom_subclass = 'LMXB'
        elif raw_subclass == 'HMXB':
            if obj_class == 'BH': custom_subclass = 'HMBH'
            elif obj_class == 'NS': custom_subclass = 'HMNS'
            elif obj_class == 'Pulsar': custom_subclass = 'HMPulsar'
            else: custom_subclass = 'HMXB'
            
        in_de_beurs = target_info.get('in_de_beurs_paper', False)
        is_burster = target_info.get('is_burster', False)
        
        epochs_data = data.get('epochs', {})
        parsed_epochs = []
        
        for epoch_key, points in epochs_data.items():
            if not points:
                continue
                
            epoch_id = f"{object_name}_{epoch_key}"
            
            times = [p.get('bincenter', 0) for p in points if 'bincenter' in p]
            length_days = max(times) - min(times) if times else 0
                
            parsed_epoch = {
                "epoch_id": epoch_id,
                "length_days": length_days,
                "points": []
            }
            
            for p in points:
                if 'SC' in p and 'HC' in p and 'RelInt' in p:
                    parsed_epoch["points"].append({
                        "sc": p['SC'],
                        "hc": p['HC'],
                        "relint": p['RelInt'],
                        "time": p['bincenter'],
                        "epoch_id": epoch_id
                    })
                    
            if parsed_epoch["points"]:
                parsed_epochs.append(parsed_epoch)
                
        if parsed_epochs:
            all_data.append({
                "object": object_name,
                "class": obj_class,
                "subclass": custom_subclass,
                "in_de_beurs": in_de_beurs,
                "is_burster": is_burster,
                "epochs": parsed_epochs
            })

with open(os.path.join(OUT_DIR, "master_data.json"), 'w') as f:
    json.dump({"data": all_data}, f)
print(f"Successfully processed {len(all_data)} objects.")
