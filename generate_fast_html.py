from xml.dom import minidom
import os

# Path to KML files
kml_folder = r"E:\G Drive\Code\fpl\map\kml"
output_html = os.path.join(kml_folder, "combined_flight_map.html")

# HTML header
html_head = """<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Flight Paths</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.3/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.3/dist/leaflet.js"></script>
  <style>
    html, body, #map {
      height: 100%;
      margin: 0;
    }
  </style>
</head>
<body>
<div id="map"></div>
<script>
  const map = L.map('map').setView([52.0, 19.0], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
"""

html_tail = """
</script>
</body>
</html>
"""

def extract_coords_from_track(track):
    timestamps = track.getElementsByTagName("when")
    coords = track.getElementsByTagName("gx:coord")
    path = []
    for i in range(len(coords)):
        coord_text = coords[i].firstChild.nodeValue.strip()
        lon, lat, _ = map(float, coord_text.split())
        path.append((lat, lon))
    return path

def extract_coords_from_linestring(linestring):
    coords_text = linestring.getElementsByTagName("coordinates")[0].firstChild.nodeValue.strip()
    coords = coords_text.split()
    path = []
    for coord in coords:
        parts = coord.split(",")
        if len(parts) >= 2:
            lon, lat = map(float, parts[:2])
            path.append((lat, lon))
    return path

# Collect all polylines
polylines_js = []

for file in os.listdir(kml_folder):
    if file.endswith(".kml"):
        filepath = os.path.join(kml_folder, file)
        doc = minidom.parse(filepath)
        path = []

        # Try gx:Track first
        tracks = doc.getElementsByTagName("gx:Track")
        if tracks:
            for track in tracks:
                path += extract_coords_from_track(track)

        # If no gx:Track, try LineString
        if not path:
            linestrings = doc.getElementsByTagName("LineString")
            for ls in linestrings:
                path += extract_coords_from_linestring(ls)

        if path:
            js_array = "[" + ",".join(f"[{lat}, {lon}]" for lat, lon in path) + "]"
            name = os.path.splitext(file)[0]
            js = f"L.polyline({js_array}, {{color: '#3C3CE8', weight: 2, opacity: 1.0}}).addTo(map).bindTooltip('{name}');"
            polylines_js.append(js)

# Combine all parts
with open(output_html, "w", encoding="utf-8") as f:
    f.write(html_head)
    for js in polylines_js:
        f.write(js + "\n")
    f.write(html_tail)

print(f"✅ Combined map saved to: {output_html}")
