import os
import json
import math
from xml.dom import minidom


# ---- simplification ----------------------------------------------------

def perp_distance(pt, a, b):
    """Perpendicular distance from pt to line a-b, in degrees (equirect approx)."""
    ax, ay = a[1], a[0]
    bx, by = b[1], b[0]
    px, py = pt[1], pt[0]
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    cx, cy = ax + t * dx, ay + t * dy
    return math.hypot(px - cx, py - cy)


def rdp(points, epsilon):
    """Ramer-Douglas-Peucker simplification, iterative (handles long tracks
    without hitting recursion limits)."""
    if len(points) < 3:
        return points

    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]

    while stack:
        start, end = stack.pop()
        if end - start < 2:
            continue
        a, b = points[start], points[end]
        dmax, idx = 0.0, -1
        for i in range(start + 1, end):
            d = perp_distance(points[i], a, b)
            if d > dmax:
                dmax, idx = d, i
        if dmax > epsilon and idx != -1:
            keep[idx] = True
            stack.append((start, idx))
            stack.append((idx, end))

    return [p for p, k in zip(points, keep) if k]


EPSILON = 0.0003   # ~30m at mid-latitudes; invisible at overview zoom
DECIMALS = 5       # ~1.1m precision


# ---- KML extraction (same three formats the frontend parser supports) --

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


def extract_from_placemarks(doc):
    """FR24-style export: many <Placemark><Point><coordinates>lon,lat,alt</coordinates>
    with a sibling <TimeStamp><when>. We only need lon/lat here for the overview line,
    but we still require a Point to exist so we don't pick up unrelated Placemarks."""
    coords = []
    placemarks = doc.getElementsByTagName('Placemark')
    for pm in placemarks:
        points = pm.getElementsByTagName('Point')
        if not points:
            continue
        coord_tag = points[0].getElementsByTagName('coordinates')
        if not coord_tag or not coord_tag[0].firstChild:
            continue
        parts = coord_tag[0].firstChild.nodeValue.strip().split(',')
        if len(parts) >= 2:
            lon, lat = float(parts[0]), float(parts[1])
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

    if not coords:
        coords = extract_from_placemarks(doc)

    return coords


def main():
    kml_dir = 'kml'
    output = []

    total_before = 0
    total_after = 0

    for filename in sorted(os.listdir(kml_dir)):
        if not filename.endswith('.kml'):
            continue

        path = os.path.join(kml_dir, filename)
        coords = extract_coordinates_from_kml(path)

        if not coords:
            print(f"skip (no usable points): {filename}")
            continue

        total_before += len(coords)
        simplified = rdp([tuple(c) for c in coords], EPSILON)
        total_after += len(simplified)

        rounded = [[round(lat, DECIMALS), round(lng, DECIMALS)] for lat, lng in simplified]

        output.append({
            'name': filename.replace('.kml', ''),
            'path': rounded
        })

    # NOTE: no indent= here -- pretty-printing a few hundred thousand
    # coordinate pairs bloats file size for zero benefit, since nobody
    # reads this file by hand.
    with open('kml_polylines.json', 'w') as f:
        json.dump(output, f, separators=(',', ':'))

    print(f"Processed {len(output)} flights")
    if total_before:
        print(f"Points: {total_before:,} -> {total_after:,} "
              f"({100 * total_after / total_before:.1f}% kept)")


if __name__ == '__main__':
    main()
