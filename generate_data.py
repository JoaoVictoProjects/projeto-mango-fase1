import json
from openpyxl import load_workbook

CIVIL = "/workspace/scratch/4148897ce3f2/project_sources/Projeto_Mango_Base_Civil_2024_v1.0.xlsx"
MILITARY = "/workspace/scratch/4148897ce3f2/project_sources/Projeto_Mango_Poder_Militar_v1.0_195_paises.xlsx"
GEO = "/tmp/countries.geojson"
OUT = "/workspace/sites/projeto-mango-fase1/dist/assets/world-data.js"

playable = {"US", "CN", "DE", "JP", "IN", "GB", "FR", "IT", "BR", "CA"}

wb = load_workbook(MILITARY, data_only=True)
ws = wb["Poder Militar 195"]
mil = {}
for row in ws.iter_rows(min_row=2, values_only=True):
    iso2, name = row[0], row[1]
    mil[iso2] = {
        "iso2": iso2,
        "name": name,
        "military": round(float(row[9]), 4),
        "rank": int(row[10]),
        "classification": row[11],
        "playable": iso2 in playable,
    }

geo = json.load(open(GEO, encoding="utf-8"))
iso3_to_iso2 = {}
features = {}
antarctica_feature = None
for feature in geo["features"]:
    p = feature["properties"]
    iso2 = p.get("ISO3166-1-Alpha-2")
    iso3 = p.get("ISO3166-1-Alpha-3")
    if iso2 and iso2 != "-99":
        iso3_to_iso2[iso3] = iso2
        features[iso2] = feature
        if iso2 == "AQ":
            antarctica_feature = feature

# Natural Earth publica França e Noruega com códigos vazios em algumas versões.
# O vínculo abaixo corrige somente a chave cartográfica padronizada.
for feature in geo["features"]:
    name = feature["properties"].get("name")
    if name == "France":
        iso3_to_iso2["FRA"] = "FR"
        features["FR"] = feature
    elif name == "Norway":
        iso3_to_iso2["NOR"] = "NO"
        features["NO"] = feature

wb = load_workbook(CIVIL, data_only=True)
ws = wb["Dados 195"]
for row in ws.iter_rows(min_row=2, values_only=True):
    iso3 = row[0]
    iso2 = iso3_to_iso2.get(iso3)
    if not iso2 or iso2 not in mil:
        continue
    mil[iso2].update({
        "iso3": iso3,
        "region": (row[2] or "").strip(),
        "area": row[3],
        "population": row[10],
        "gdp": row[13] if row[13] is not None else None,
        "gdpStatus": row[15],
    })

def thin_ring(ring, clockwise):
    if len(ring) <= 36:
        pts = ring
    else:
        step = max(1, len(ring) // 90)
        pts = ring[::step]
        if pts[-1] != ring[-1]:
            pts.append(ring[-1])
    pts = [[round(p[0], 2), round(p[1], 2)] for p in pts]
    signed_area = sum(
        p1[0] * p2[1] - p2[0] * p1[1]
        for p1, p2 in zip(pts, pts[1:])
    ) / 2
    # D3 interpreta anéis externos no sentido horário e furos no anti-horário.
    if (clockwise and signed_area > 0) or (not clockwise and signed_area < 0):
        pts.reverse()
    return pts

def geometry(feature):
    if not feature:
        return []
    g = feature["geometry"]
    polygons = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
    out = []
    for poly in polygons:
        if not poly or len(poly[0]) < 3:
            continue
        out.append([thin_ring(r, i == 0) for i, r in enumerate(poly) if len(r) >= 3])
    return out

records = []
for iso2, item in mil.items():
    item.setdefault("iso3", None)
    item.setdefault("region", "")
    item.setdefault("area", None)
    item.setdefault("population", None)
    item.setdefault("gdp", None)
    item.setdefault("gdpStatus", "Não disponível")
    item["geometry"] = geometry(features.get(iso2))
    records.append(item)

records.sort(key=lambda x: x["name"])
assert len(records) == 195
assert sum(1 for x in records if x["population"] is not None) == 195
assert sum(1 for x in records if x["gdp"] is not None) == 194

with open(OUT, "w", encoding="utf-8") as f:
    f.write("window.MANGO_COUNTRIES=")
    json.dump(records, f, ensure_ascii=False, separators=(",", ":"))
    f.write(";window.MANGO_ANTARCTICA=")
    json.dump({"name": "Antártida", "geometry": geometry(antarctica_feature)}, f, ensure_ascii=False, separators=(",", ":"))
    sovereign_iso2 = set(mil)
    parent = {"GF":"FR","GP":"FR","MQ":"FR","MF":"FR","BL":"FR","RE":"FR","YT":"FR","PM":"FR","NC":"FR","PF":"FR","WF":"FR","TF":"FR","FK":"GB","GI":"GB","BM":"GB","KY":"GB","TC":"GB","VG":"GB","AI":"GB","MS":"GB","SH":"GB","PN":"GB","GS":"GB","GG":"GB","JE":"GB","IM":"GB","PR":"US","VI":"US","GU":"US","AS":"US","MP":"US","UM":"US","AW":"NL","CW":"NL","SX":"NL","BQ":"NL","GL":"DK","FO":"DK","AX":"FI","SJ":"NO","CX":"AU","CC":"AU","NF":"AU","CK":"NZ","NU":"NZ","TK":"NZ","HK":"CN","MO":"CN"}
    pt = {"GF":"Guiana Francesa","GP":"Guadalupe","MQ":"Martinica","MF":"São Martinho","BL":"São Bartolomeu","RE":"Reunião","YT":"Mayotte","FK":"Ilhas Malvinas","GL":"Groenlândia","FO":"Ilhas Faroé","HK":"Hong Kong","MO":"Macau"}
    territories=[]
    for feature in geo["features"]:
        p=feature["properties"]; code=p.get("ISO3166-1-Alpha-2")
        if not code or code=="-99" or code in sovereign_iso2 or code=="AQ": continue
        territories.append({"id":"T-"+code,"iso2":code,"name":pt.get(code,p.get("name",code)),"sovereign":parent.get(code),"geometry":geometry(feature)})
    f.write(";window.MANGO_TERRITORIES=")
    json.dump(territories, f, ensure_ascii=False, separators=(",", ":"))
    f.write(";\n")
