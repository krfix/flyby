import os
import json
from xml.dom import minidom

def extract_from_gx_track(track):
    coords = []
    gx_coords = track.getElementsByTagName('gx:coord')
    for gx in gx_coords:
        parts = gx.firstChild.nodeValue.strip().split()
        if len(parts) >= 2:
            lon, lat = map(float, parts[:2])
            coords.append([lat, lon])
    return coords

def extract_from_linestring(linestring):
    coords = []
    coord_tag = linestring.getElementsByTagName('coordinates')
    if coord_tag:
        points = coord_tag[0].firstChild.nodeValue.strip().split()
        for point in points:
            parts = point.split(',')
            if len(parts) >= 2:
                lon, lat = map(float, parts[:2])
                coords.append([lat, lon])
    return coords

def extract_coordinates_from_kml(filepath):
    coords = []
    doc = minidom.parse(filepath)
    tracks = doc.getElementsByTagName('gx:Track')
    for track in tracks:
        coords.extend(extract_from_gx_track(track))
    if not coords:
        lines = doc.getElementsByTagName('LineString')
        for line in lines:
            coords.extend(extract_from_linestring(line))
    return coords

def main():
    kml_dir = 'kml'
    output = []
    for filename in os.listdir(kml_dir):
        if filename.endswith('.kml'):
            path = os.path.join(kml_dir, filename)
            coords = extract_coordinates_from_kml(path)
            if coords:
                output.append({
                    'name': filename.replace('.kml', ''),
                    'path': coords
                })

    with open('kml_polylines.json', 'w') as f:
        json.dump(output, f, indent=2)

if __name__ == '__main__':
    main()