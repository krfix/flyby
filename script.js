const kmlBaseUrl = 'kml';
const kmlListUrl = `kml_files.json`;
const polylinesJs = [];

function extractCoordsFromTrack(track) {
    const coords = [];
    const latitudes = track.getElementsByTagName('gx:coord');
    for (let i = 0; i < latitudes.length; i++) {
        const coord = latitudes[i].textContent.trim().split(' ');
        coords.push([parseFloat(coord[1]), parseFloat(coord[0])]);
    }
    return coords;
}

function extractCoordsFromLineString(lineString) {
    const coords = [];
    const coordinates = lineString.getElementsByTagName('coordinates')[0];
    if (coordinates) {
        const points = coordinates.textContent.trim().split(/\s+/);
        for (const point of points) {
            const [lon, lat] = point.split(',').map(Number);
            coords.push([lat, lon]);
        }
    }
    return coords;
}

async function fetchKmlList() {
    try {
        const response = await fetch(kmlListUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch KML list: ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Error fetching KML list:', error);
        return [];
    }
}

async function processKmlFiles() {
    try {
        const response = await fetch('kml_polylines.json');
        if (!response.ok) {
            throw new Error(`Failed to fetch preprocessed polylines: ${response.statusText}`);
        }
        const polylines = await response.json();
        return polylines;
    } catch (error) {
        console.error('Error loading preprocessed KML data:', error);
        return [];
    }
}

function haversineDistance(coord1, coord2) {
    const R = 6371; // Earth radius in km
    const toRad = deg => deg * Math.PI / 180;

    const lat1 = toRad(coord1[0]);
    const lon1 = toRad(coord1[1]);
    const lat2 = toRad(coord2[0]);
    const lon2 = toRad(coord2[1]);

    const dLat = lat2 - lat1;
    const dLon = lon2 - lon1;

    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(dLon / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // distance in km
}

function calculatePathDistance(path) {
    let total = 0;
    for (let i = 1; i < path.length; i++) {
        total += haversineDistance(path[i - 1], path[i]);
    }
    return total;
}


// Initialize the map
function initializeMap() {
    const map = L.map('map', {
        zoomControl: true,
        zoomSnap: 0, // Enable fractional zoom for smoother padding adjustments
        zoomDelta: 0.35, // Finer zoom steps for pinch gestures    
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    const polylineGroup = L.featureGroup().addTo(map);
    return { map, polylineGroup };
}

// Create and style the dropdown
function createDropdown() {
    const dropdown = document.createElement('select');
    dropdown.id = 'polyline-selector';
    dropdown.style.position = 'absolute';
    dropdown.style.top = '10px';
    dropdown.style.right = '10px';
    dropdown.style.zIndex = '1000';
    dropdown.style.backgroundColor = 'white';
    dropdown.style.padding = '5px';
    dropdown.style.borderRadius = '5px';
    dropdown.style.boxShadow = '0 0 5px rgba(0, 0, 0, 0.3)';
    dropdown.style.fontSize = '14px';
    dropdown.style.fontFamily = 'Arial, sans-serif';
    dropdown.style.cursor = 'pointer';
    dropdown.style.width = '200px';
    dropdown.style.height = '30px';

    // Add default option
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.text = 'Select a flight';
    dropdown.appendChild(defaultOption);

    // Add "All flights" option
    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.text = 'All flights';
    dropdown.appendChild(allOption);

    document.body.appendChild(dropdown);
    return dropdown;
}

function createDistanceBox() {
    const box = document.createElement('div');
    box.id = 'distance-box';
    box.style.position = 'absolute';
    box.style.bottom = '10px';
    box.style.right = '10px';
    box.style.zIndex = '1000';
    box.style.backgroundColor = 'white';
    box.style.padding = '8px 12px';
    box.style.borderRadius = '8px';
    box.style.boxShadow = '0 0 5px rgba(0, 0, 0, 0.3)';
    box.style.fontSize = '14px';
    box.style.fontFamily = 'Arial, sans-serif';
    box.innerText = 'Total Distance: 0 km';
    document.body.appendChild(box);
    return box;
}


// Add polylines to the map
function addPolylinesToMap(map, dropdown, polylines, polylineGroup, distanceBox) {
    const polylineObjects = [];

    polylines.forEach(polylineData => {
        const distance = calculatePathDistance(polylineData.path);
        const polyline = L.polyline(polylineData.path, { color: '#3C3CE8', weight: 2, opacity: 1.0 })
            .addTo(polylineGroup)
            .bindTooltip(`${polylineData.name} (${distance.toFixed(1)} km)`);

        polylineObjects.push({ polyline, name: polylineData.name, distance });
    });

    // Fit to all paths
    if (polylineGroup.getLayers().length > 0) {
        map.fitBounds(polylineGroup.getBounds(), { padding: [50, 50], maxZoom: 12 });
    }

    // Fill dropdown
    polylines.sort((a, b) => b.name.localeCompare(a.name)).forEach(polylineData => {
        const option = document.createElement('option');
        option.value = polylineData.name;
        option.text = polylineData.name;
        dropdown.appendChild(option);
    });

    // Handle selection
    dropdown.addEventListener('change', function () {
        const selected = this.value;
        if (selected === 'all' || selected === '') {
            polylineObjects.forEach(obj => obj.polyline.setStyle({ color: '#3C3CE8', opacity: 1.0 }));
            map.fitBounds(polylineGroup.getBounds(), { padding: [50, 50], maxZoom: 12 });

            const total = polylineObjects.reduce((sum, obj) => sum + obj.distance, 0);
            distanceBox.innerText = `Total Distance: ${total.toFixed(1)} km`;

        } else {
            polylineObjects.forEach(obj => {
                if (obj.name === selected) {
                    obj.polyline.setStyle({ color: '#FF0000', opacity: 1.0 });
                    map.fitBounds(obj.polyline.getBounds(), { padding: [50, 50] });
                    distanceBox.innerText = `Distance: ${obj.distance.toFixed(1)} km`;
                } else {
                    obj.polyline.setStyle({ opacity: 0.0 });
                }
            });
        }
    });

    // Show initial total distance
    const total = polylineObjects.reduce((sum, obj) => sum + obj.distance, 0);
    distanceBox.innerText = `Total Distance: ${total.toFixed(1)} km`;
}


// Main function to initialize and process everything
function main() {
    const { map, polylineGroup } = initializeMap();
    const dropdown = createDropdown();
    const distanceBox = createDistanceBox();

    processKmlFiles().then(polylines => {
        if (polylines.length === 0) {
            console.error('No KML files found or processed.');
            return;
        }
        addPolylinesToMap(map, dropdown, polylines, polylineGroup, distanceBox);
    });
}


// Run the main function
main();
