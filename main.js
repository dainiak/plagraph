// Debounce utility: calls func after delay ms of inactivity.
// Also provides a cancel() method to cancel any pending call.
function debounce(func, delay) {
    let timeoutId;
    function debounced(...args) {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            func(...args);
            timeoutId = null;
        }, delay);
    }
    debounced.cancel = () => {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
    };
    return debounced;
}

// Global variables
let currentGraph = null;
let threshold = parseFloat(document.getElementById('threshold').value);
let lastGraphData = null;

// Ensure there's a progress element; if not, create one.
let progressDiv = document.getElementById('progress');
if (!progressDiv) {
    progressDiv = document.createElement('div');
    progressDiv.id = 'progress';
    progressDiv.style.margin = '1em';
    progressDiv.style.fontWeight = 'bold';
    // Insert before the graph container
    document.body.insertBefore(progressDiv, document.getElementById('graph-container'));
}
progressDiv.innerText = "Progress: 0%";

// Debounced function to update graph edges
const debouncedUpdateGraphEdges = debounce(() => {
    if (lastGraphData && currentGraph) {
        updateGraphEdges();
    }
}, 500);

// Update threshold display and call debounced update on slider input
const thresholdSlider = document.getElementById('threshold');
thresholdSlider.addEventListener('input', (e) => {
    threshold = parseFloat(e.target.value);
    document.getElementById('threshold-value').innerText = threshold.toFixed(2);
    debouncedUpdateGraphEdges();
});

// Immediately update when slider change is committed (e.g. mouse up)
thresholdSlider.addEventListener('change', (e) => {
    debouncedUpdateGraphEdges.cancel();
    if (lastGraphData && currentGraph) {
        updateGraphEdges();
    }
});

// Incrementally update graph edges based on the current threshold and smoothly reposition the graph.
function updateGraphEdges() {
    // Filter new edges from stored data based on the current threshold.
    const newEdges = lastGraphData.allEdges
        .filter(edge => edge.similarity >= threshold)
        .map(edge => ({
            id: edge.source + "_" + edge.target,
            source: edge.source,
            target: edge.target,
            weight: edge.similarity.toFixed(2)
        }));

    // Get the IDs of edges that should now be visible.
    const newEdgeIds = newEdges.map(edge => edge.id);

    // Remove edges that no longer meet the threshold.
    currentGraph.edges().forEach(edge => {
        if (!newEdgeIds.includes(edge.id())) {
            edge.remove();
        }
    });

    // Add new edges that aren't already present.
    newEdges.forEach(edgeData => {
        if (!currentGraph.getElementById(edgeData.id).length) {
            currentGraph.add({ data: edgeData });
        }
    });

    // Run a smooth layout animation to reposition the graph.
    const layout = currentGraph.layout({
        name: 'cose',
        animate: true,
        animationDuration: 500,
        fit: true,
        padding: 30
    });
    layout.run();
}

// Drag-n-Drop setup
const dropZone = document.getElementById('drop-zone');
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('hover');
});
dropZone.addEventListener('dragleave', (e) => {
    dropZone.classList.remove('hover');
});
dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('hover');
    if (e.dataTransfer.files.length > 0) {
        await handleZipFile(e.dataTransfer.files[0]);
    }
});

// Utility: Read file as text
function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);
        reader.readAsText(file);
    });
}

// Utility: Compress a string using LZMA (from the included library) and return compressed size.
function compressText(text) {
    return new Promise((resolve, reject) => {
        LZMA.compress(text, 9, (result, error) => {
            if (error) {
                reject(error);
            } else {
                // 'result' is an array of bytes.
                resolve(result.length);
            }
        });
    });
}

// Handle the ZIP file drop.
async function handleZipFile(zipFile) {
    // Reset progress display.
    progressDiv.innerText = "Progress: 0%";

    const zip = new JSZip();
    try {
        const zipContent = await zip.loadAsync(zipFile);
        // Filter for files (we no longer restrict to just .txt).
        const files = [];
        zip.forEach((relativePath, zipEntry) => {
            if (!zipEntry.dir && relativePath.indexOf('.') !== -1) {
                files.push(zipEntry);
            }
        });

        if (files.length === 0) {
            alert("No files with an extension found in the ZIP archive.");
            return;
        }

        // Read each file's content, compute its compressed size, and record its extension.
        const fileData = []; // { name, content, compSize, extension }
        for (let entry of files) {
            const content = await entry.async("string");
            const compSize = await compressText(content);
            const ext = entry.name.split('.').pop().toLowerCase();
            fileData.push({
                name: entry.name,
                content,
                compSize,
                extension: ext
            });
        }

        // Immediately render an empty graph with all nodes.
        const nodes = fileData.map(file => ({
            data: { id: file.name, label: file.name }
        }));
        // Initialize lastGraphData with nodes and an empty allEdges array.
        lastGraphData = { nodes, allEdges: [] };
        renderGraph(lastGraphData, true);

        // Start the background worker for pairwise NCD computation.
        const worker = new Worker('worker.js');
        // Post fileData to the worker.
        worker.postMessage({ fileData: fileData });

        worker.onmessage = (e) => {
            const msg = e.data;
            if (msg.type === "batch") {
                // Append received batch of edges to our stored data.
                lastGraphData.allEdges = lastGraphData.allEdges.concat(msg.batchEdges);
                // For each new edge that meets the current threshold, add it to the Cytoscape graph.
                if (currentGraph) {
                    msg.batchEdges.forEach(edge => {
                        if (edge.similarity >= threshold && !currentGraph.getElementById(edge.source + "_" + edge.target).length) {
                            currentGraph.add({
                                data: {
                                    id: edge.source + "_" + edge.target,
                                    source: edge.source,
                                    target: edge.target,
                                    weight: edge.similarity.toFixed(2)
                                }
                            });
                        }
                    });
                }
                // Update progress display.
                progressDiv.innerText = "Progress: " + msg.progress.toFixed(1) + "%";
            } else if (msg.type === "complete") {
                progressDiv.innerText = "Progress: 100% (Completed)";
                worker.terminate();
            }
        };
    } catch (err) {
        console.error("Error processing ZIP file:", err);
        alert("Error processing ZIP file.");
    }
}

// Render the graph using Cytoscape.js.
// If fullRedraw is true, create the graph from scratch (for initial display).
function renderGraph(graphData, fullRedraw = false) {
    // Prepare edges filtered by the current threshold.
    const filteredEdges = graphData.allEdges
        .filter(edge => edge.similarity >= threshold)
        .map(edge => ({
            data: {
                id: edge.source + "_" + edge.target,
                source: edge.source,
                target: edge.target,
                weight: edge.similarity.toFixed(2)
            }
        }));

    // For a full redraw, rebuild the graph completely.
    if (fullRedraw) {
        const elements = [
            ...graphData.nodes,
            ...filteredEdges
        ];
        if (currentGraph) {
            currentGraph.destroy();
        }
        currentGraph = cytoscape({
            container: document.getElementById('graph-container'),
            elements: elements,
            style: [
                {
                    selector: 'node',
                    style: {
                        'label': 'data(label)',
                        'background-color': '#0074D9',
                        'text-valign': 'center',
                        'color': '#fff',
                        'font-size': '10px',
                        'width': '40px',
                        'height': '40px'
                    }
                },
                {
                    selector: 'edge',
                    style: {
                        'width': 2,
                        'line-color': '#aaa',
                        'curve-style': 'bezier',
                        'target-arrow-shape': 'triangle',
                        'target-arrow-color': '#aaa',
                        'label': 'data(weight)',
                        'font-size': '8px',
                        'text-rotation': 'autorotate'
                    }
                }
            ],
            layout: {
                name: 'cose',
                padding: 30,
                animate: true,
                animationDuration: 500
            }
        });
    } else {
        // (This branch is not used for threshold changes since updateGraphEdges() handles it.)
        filteredEdges.forEach(edge => {
            if (!currentGraph.getElementById(edge.data.id).length) {
                currentGraph.add(edge);
            }
        });
    }
}

// Save the current graph data to localStorage.
document.getElementById('save-graph').addEventListener('click', () => {
    if (lastGraphData) {
        localStorage.setItem('plagiarismGraph', JSON.stringify(lastGraphData));
        alert("Graph saved to localStorage.");
    } else {
        alert("No graph data to save.");
    }
});

// Load graph data from localStorage and render it.
document.getElementById('load-graph').addEventListener('click', () => {
    const savedGraph = localStorage.getItem('plagiarismGraph');
    if (savedGraph) {
        lastGraphData = JSON.parse(savedGraph);
        renderGraph(lastGraphData, true);
        alert("Graph loaded from localStorage.");
    } else {
        alert("No saved graph found.");
    }
});
