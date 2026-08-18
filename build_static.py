import os, json, shutil

BASE_DIR = r"c:\Users\William\OneDrive - Yale University\桌面\MAXI"
EPOCHS_DIR = os.path.join(BASE_DIR, "project2", "CCI_epochs")
DATA_DIR = os.path.join(BASE_DIR, "DATA", "json")

OUT_DIR = os.path.join(r"c:\Users\William\OneDrive - Yale University\桌面\MAXI\project2\cci_web_app", "data")
LC_DIR = os.path.join(OUT_DIR, "lightcurves")

os.makedirs(LC_DIR, exist_ok=True)

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
        obj_class = target_info.get('compact_object_class', 'Unknown')
        custom_subclass = target_info.get('subclass', 'Unknown')
        in_de_beurs = target_info.get('in_de_beurs_paper', False)
        
        epochs_data = data.get('epochs', {})
        parsed_epochs = []
        
        for epoch_key, points in epochs_data.items():
            if not points:
                continue
                
            epoch_id = f"{object_name}_{epoch_key}"
            
            times = [p.get('bincenter', 0) for p in points if 'bincenter' in p]
            length_days = max(times) - min(times) if times else 0
            
            parsed_epoch = {
                "id": epoch_id,
                "object": object_name,
                "class": obj_class,
                "subclass": custom_subclass,
                "in_de_beurs": in_de_beurs,
                "length_days": length_days,
                "points": points
            }
            parsed_epochs.append(parsed_epoch)
            
        all_data.extend(parsed_epochs)

with open(os.path.join(OUT_DIR, "master_data.json"), 'w') as f:
    json.dump({"data": all_data}, f)
print(f"Successfully processed {len(all_data)} epochs.")

print("Copying lightcurve JSON files...")
# We only need to copy lightcurves for objects that are actually in the master data!
unique_objects = set([ep['object'] for ep in all_data])
copied = 0
for obj in unique_objects:
    # Handle special characters in obj filename? Flask used <object_name>.json directly!
    src = os.path.join(DATA_DIR, f"{obj}.json")
    if os.path.exists(src):
        # We need to URI encode the filename because the JS uses encodeURIComponent, so the web server might request it encoded or not, but GitHub Pages is a static server!
        # Wait, if JS fetches /data/lightcurves/encodeURIComponent(obj).json, then the actual filename needs to be the encoded string!
        # GitHub Pages serves exact file names.
        import urllib.parse
        encoded_name = urllib.parse.quote(obj, safe='')
        dst = os.path.join(LC_DIR, f"{encoded_name}.json")
        shutil.copy2(src, dst)
        copied += 1
    else:
        print(f"Warning: Lightcurve {src} not found!")

print(f"Copied {copied} lightcurve files.")
