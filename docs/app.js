// APOC Data Explorer - Main Application
const GITHUB_REPO = 'NickCrews/apoc-data';
let currentDataset = null;
let latestRelease = null;

// Initialize the application
async function init() {
    const viewer = document.getElementById('viewer');
    const statusText = document.getElementById('status-text');

    // Fetch latest release info
    try {
        statusText.textContent = 'Loading release information...';
        latestRelease = await fetchLatestRelease();
        statusText.textContent = `Ready. Using release: ${latestRelease.tag}`;
    } catch (error) {
        statusText.textContent = `Error loading release info: ${error.message}`;
        console.error('Error fetching release:', error);
        return;
    }

    // Set up dataset button click handlers
    const datasetButtons = document.querySelectorAll('.dataset-btn');
    datasetButtons.forEach(button => {
        button.addEventListener('click', async () => {
            const dataset = button.getAttribute('data-dataset');
            await loadDataset(dataset);

            // Update active state
            datasetButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
        });
    });
}

// Fetch latest release information from GitHub
async function fetchLatestRelease() {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);

    if (!response.ok) {
        throw new Error(`Failed to fetch release: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return {
        tag: data.tag_name,
        url: data.html_url,
        assets: data.assets
    };
}

// Load a dataset and display it in Perspective
async function loadDataset(datasetName) {
    const viewer = document.getElementById('viewer');
    const statusText = document.getElementById('status-text');
    const container = document.getElementById('viewer-container');

    if (currentDataset === datasetName) {
        return; // Already loaded
    }

    try {
        container.classList.add('loading');
        statusText.textContent = `Loading ${datasetName}...`;

        // Construct the URL for the CSV file
        const csvUrl = `https://github.com/${GITHUB_REPO}/releases/download/${latestRelease.tag}/${datasetName}.csv`;

        // Fetch the CSV data
        const response = await fetch(csvUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${datasetName}: ${response.status} ${response.statusText}`);
        }

        const csvText = await response.text();

        // Parse CSV to arrow format for Perspective
        const data = parseCSV(csvText);

        // Load into Perspective viewer
        await viewer.load(data);

        // Configure the viewer with sensible defaults
        await viewer.restore({
            plugin: 'Datagrid',
            settings: true,
            theme: 'Pro Light'
        });

        currentDataset = datasetName;
        statusText.textContent = `Loaded ${datasetName} (${data.length} rows)`;

    } catch (error) {
        statusText.textContent = `Error loading ${datasetName}: ${error.message}`;
        console.error('Error loading dataset:', error);
    } finally {
        container.classList.remove('loading');
    }
}

// Simple CSV parser
function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length === 0) {
        return [];
    }

    // Parse header
    const headers = parseCSVLine(lines[0]);

    // Parse data rows
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length === headers.length) {
            const row = {};
            headers.forEach((header, index) => {
                row[header] = values[index];
            });
            data.push(row);
        }
    }

    return data;
}

// Parse a single CSV line, handling quoted fields
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                // Escaped quote
                current += '"';
                i++;
            } else {
                // Toggle quote state
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            // End of field
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }

    // Add the last field
    result.push(current.trim());

    return result;
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
