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
    const kmlFiles = await fetchKmlList();
    for (const file of kmlFiles) {
        const fileUrl = `${kmlBaseUrl}/${file}`;
        try {
            const response = await fetch(fileUrl);
            if (!response.ok) {
                console.error(`Failed to fetch ${file}:`, response.statusText);
                continue;
            }

            const kmlContent = await response.text();
            const doc = new DOMParser().parseFromString(kmlContent, 'text/xml');
            let path = [];

            // Try gx:Track first
            const tracks = doc.getElementsByTagName('gx:Track');
            if (tracks.length > 0) {
                for (let i = 0; i < tracks.length; i++) {
                    path = path.concat(extractCoordsFromTrack(tracks[i]));
                }
            }

            // If no gx:Track, try LineString
            if (path.length === 0) {
                const lineStrings = doc.getElementsByTagName('LineString');
                for (let i = 0; i < lineStrings.length; i++) {
                    path = path.concat(extractCoordsFromLineString(lineStrings[i]));
                }
            }

            if (path.length > 0) {
                const name = file.replace('.kml', '');
                const polylineData = { name, path };
                polylinesJs.push(polylineData);
            }
        } catch (error) {
            console.error(`Error processing ${file}:`, error);
        }
    }

    return polylinesJs;
}

// Initialize the map
function initializeMap() {
    const map = L.map('map').setView([52.0, 19.0], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    return map;
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
function addPolylinesToMap(map, dropdown, polylines) {
    polylines.forEach(polylineData => {
        L.polyline(polylineData.path, { color: '#3C3CE8', weight: 2, opacity: 1.0 })
            .addTo(map)
            .bindTooltip(polylineData.name);
    });

    // Populate dropdown with polyline names
    polylines.sort().reverse().forEach(polylineData => {
        const option = document.createElement('option');
        option.value = polylineData.name;
        option.text = polylineData.name;
        dropdown.appendChild(option);
    });

    // Add event listener to the dropdown
    dropdown.addEventListener('change', function () {
        const selectedPolylineName = this.value;
        map.eachLayer(function (layer) {
            if (layer instanceof L.Polyline) {
                if (selectedPolylineName === 'all' || selectedPolylineName === '') {
                    layer.setStyle({ color: '#3C3CE8', opacity: 1.0 }); // Reset to default style
                } else if (layer.getTooltip() && layer.getTooltip().getContent() === selectedPolylineName) {
                    layer.setStyle({ color: '#FF0000', opacity: 1.0 }); // Highlight selected polyline
                    map.fitBounds(layer.getBounds()); // Zoom to the selected polyline
                } else {
                    layer.setStyle({ opacity: 0.0 }); // Hide other polylines
                }
            }
        });
    });
}

// Main function to initialize and process everything
function main() {
    const map = initializeMap();
    const dropdown = createDropdown();

    processKmlFiles().then(polylines => {
        if (polylines.length === 0) {
            console.error('No KML files found or processed.');
            return;
        }
        addPolylinesToMap(map, dropdown, polylines);
    });
}

// Run the main function
main();
