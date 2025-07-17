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


// Initialize the map
function initializeMap() {
    const map = L.map('map', {
        zoomControl: true,
        zoomSnap: 0 // Enable fractional zoom for smoother padding adjustments
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

// Add polylines to the map
function addPolylinesToMap(map, dropdown, polylines, polylineGroup) {
    polylines.forEach(polylineData => {
        L.polyline(polylineData.path, { color: '#3C3CE8', weight: 2, opacity: 1.0 })
            .addTo(polylineGroup)
            .bindTooltip(polylineData.name);
    });

    if (polylineGroup.getLayers().length > 0) {
        map.fitBounds(polylineGroup.getBounds(), {
            padding: [50, 50]
        });
    }

    polylines.sort().reverse().forEach(polylineData => {
        const option = document.createElement('option');
        option.value = polylineData.name;
        option.text = polylineData.name;
        dropdown.appendChild(option);
    });

    dropdown.addEventListener('change', function () {
        const selectedPolylineName = this.value;
        map.eachLayer(function (layer) {
            if (layer instanceof L.Polyline) {
                if (selectedPolylineName === 'all' || selectedPolylineName === '') {
                    layer.setStyle({ color: '#3C3CE8', opacity: 1.0 });
                    if (selectedPolylineName === 'all' || selectedPolylineName === '') {
                        map.fitBounds(polylineGroup.getBounds(), { padding: [50, 50] });
                    }
                } else if (layer.getTooltip() && layer.getTooltip().getContent() === selectedPolylineName) {
                    layer.setStyle({ color: '#FF0000', opacity: 1.0 });
                    map.fitBounds(layer.getBounds());
                } else {
                    layer.setStyle({ opacity: 0.0 });
                }
            }
        });
    });
}

// Main function to initialize and process everything
function main() {
    const { map, polylineGroup } = initializeMap();
    const dropdown = createDropdown();

    processKmlFiles().then(polylines => {
        if (polylines.length === 0) {
            console.error('No KML files found or processed.');
            return;
        }
        addPolylinesToMap(map, dropdown, polylines, polylineGroup);
    });
}

// Run the main function
main();
