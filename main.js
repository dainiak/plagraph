// Register cytoscape-popper with popper@2 if available
if (typeof Popper !== 'undefined' && typeof cytoscapePopper !== 'undefined') {
    cytoscape.use(cytoscapePopper(Popper.createPopper));
}
if (typeof cytoscape === 'undefined') {
    cytoscape.use(cytoscapeCola);
}

// Global flag to indicate if the diff modal is open.
let modalIsOpen = false;

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

// Convert a ZIP file into an array of file objects.
// Each object contains: fileName, path, content, compSize, comparison_key, tooltip.
// By default, comparison_key is set to the file extension.
async function convertZipToFileObjects(zipFile) {
    const zip = new JSZip();
    const zipContent = await zip.loadAsync(zipFile);
    const entries = [];
    zip.forEach((relativePath, zipEntry) => {
        // Consider only files that have a dot in their name.
        if (!zipEntry.dir && relativePath.indexOf('.') !== -1) {
            entries.push(zipEntry);
        }
    });
    if (entries.length === 0) {
        return [];
    }
    const results = [];
    for (let entry of entries) {
        const content = await entry.async("string");
        const compSize = await compressText(content);
        // Extract base file name (ignoring any folder paths)
        const parts = entry.name.split('/');
        const fileName = parts[parts.length - 1];
        // Set comparison_key to file extension (if any) in lowercase.
        let comparison_key = "";
        if (fileName.indexOf('.') !== -1) {
            comparison_key = fileName.split('.').pop().toLowerCase();
        }
        // For now, set tooltip equal to the file name.
        const tooltip = fileName;
        results.push({
            fileName: fileName,
            path: entry.name,
            content: content,
            compSize: compSize,
            comparison_key: comparison_key,
            tooltip: tooltip
        });
    }
    return results;
}

// Global variables
let currentGraph = null;
let threshold = parseFloat(document.getElementById('threshold').value);
let lastGraphData = null;
// Global diff selection (for storing two nodes selected with Ctrl)
let diffSelection = [];

// Ensure there's a progress element; if not, create one.
let progressDiv = document.getElementById('progress');
if (!progressDiv) {
    progressDiv = document.createElement('div');
    progressDiv.id = 'progress';
    progressDiv.className = "alert alert-info mt-3";
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

    try {
        // Use the new conversion function.
        const fileData = await convertZipToFileObjects(zipFile);
        if (fileData.length === 0) {
            alert("No files with an extension found in the ZIP archive.");
            return;
        }

        // Immediately render an empty graph with all nodes.
        // NOTE: we now also include the file 'content' so that we can later show diffs.
        const nodes = fileData.map(file => ({
            data: {
                id: file.path,
                label: file.fileName,
                tooltip: file.tooltip,  // stored tooltip property
                content: file.content   // store the file content for diffing
            }
        }));
        // Initialize lastGraphData with nodes and an empty allEdges array.
        lastGraphData = { nodes, allEdges: [] };
        renderGraph(lastGraphData, true);

        // Start the background worker for pairwise NCD computation.
        const worker = new Worker('ncdWorker.js');
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
                // Cytoscape style for diff-selected nodes (using canvas properties)
                {
                    selector: 'node.selected-diff',
                    style: {
                        'border-width': '4px',
                        'border-color': 'red'
                    }
                },
                {
                    selector: 'edge',
                    style: {
                        'width': 2,
                        'line-color': '#aaa',
                        'curve-style': 'bezier',
                        'label': 'data(weight)',
                        'font-size': '8px',
                        'text-rotation': 'autorotate'
                    }
                }
            ],
            layout: {
                // name: 'cose',
                name: 'cola',
                padding: 30,
                // animate: true,
                // animationDuration: 500
            }
        });

        // Helper to create a tooltip div with Bootstrap styling.
        function makeDiv(text) {
            var div = document.createElement('div');
            div.classList.add('popover', 'bs-popover-top', 'p-2');
            div.innerHTML = text;
            document.body.appendChild(div);
            return div;
        }

        // Attach event listeners to show tooltips only on mouseover.
        currentGraph.nodes().forEach(function(node) {
            if (node.data('tooltip')) {
                node.on('mouseover', function(e) {
                    // Do not create a tooltip if the modal is open.
                    if (modalIsOpen) return;

                    // Create the popper instance on mouseover.
                    var popperInstance = node.popper({
                        content: function(){
                            return makeDiv(node.data('tooltip'));
                        },
                        popper: {
                            placement: 'top'
                        }
                    });
                    node.scratch('popper', popperInstance);
                    // Create an update function to reposition the tooltip.
                    var updateFn = function(){ popperInstance.update(); };
                    node.scratch('popperUpdate', updateFn);
                    node.on('position', updateFn);
                    currentGraph.on('pan zoom resize', updateFn);
                });
                node.on('mouseout', function(e) {
                    // Remove the popper instance on mouseout.
                    var popperInstance = node.scratch('popper');
                    var updateFn = node.scratch('popperUpdate');
                    if (popperInstance) {
                        var popperDiv = popperInstance.state.elements.popper;
                        if (popperDiv && popperDiv.parentNode) {
                            popperDiv.parentNode.removeChild(popperDiv);
                        }
                        node.removeScratch('popper');
                    }
                    if (updateFn) {
                        node.off('position', updateFn);
                        currentGraph.off('pan zoom resize', updateFn);
                        node.removeScratch('popperUpdate');
                    }
                });
            }

            // Attach a click handler for diff selection (only if Ctrl key is held).
            node.on('click', function(e) {
                if (e.originalEvent.ctrlKey) {
                    // Toggle selection state.
                    if (!node.selectedForDiff) {
                        node.selectedForDiff = true;
                        node.addClass('selected-diff');
                        diffSelection.push(node);
                    } else {
                        node.selectedForDiff = false;
                        node.removeClass('selected-diff');
                        diffSelection = diffSelection.filter(n => n.id() !== node.id());
                    }
                    // When exactly two nodes are selected, show the diff modal.
                    if (diffSelection.length === 2) {
                        showDiffModal(diffSelection[0], diffSelection[1]);
                        // Clear diff selection highlighting.
                        diffSelection.forEach(n => {
                            n.selectedForDiff = false;
                            n.removeClass('selected-diff');
                        });
                        diffSelection = [];
                    }
                }
            });
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

// Show a modal with the diff of two files.
// Uses jsdiff to create a unified diff string and diff2html to render the diff.
function showDiffModal(nodeA, nodeB) {
    // Before showing the modal, trigger 'mouseout' on all nodes to clear any active tooltips.
    if (currentGraph) {
        currentGraph.nodes().forEach(node => node.trigger('mouseout'));
    }

    const fileNameA = nodeA.data('label');
    const fileNameB = nodeB.data('label');
    const contentA = nodeA.data('content') || "";
    const contentB = nodeB.data('content') || "";

    // Create a unified diff string using jsdiff.
    const diffString = Diff.createTwoFilesPatch(fileNameA, fileNameB, contentA, contentB);

    // Generate HTML from the diff string using diff2html.
    const diffHtml = Diff2Html.html(diffString, {
        drawFileList: true,
        // matching: 'lines',
        matching: 'words',
        outputFormat: 'side-by-side'
    });

    // Inject the diff HTML into the modal body.
    document.getElementById('diffModalBody').innerHTML = diffHtml;

    // Show the modal using Bootstrap's modal API.
    const diffModalEl = document.getElementById('diffModal');
    const diffModal = new bootstrap.Modal(diffModalEl, {});

    // Set the modal flag to true.
    modalIsOpen = true;

    // When the modal is hidden, reset the flag.
    diffModalEl.addEventListener('hidden.bs.modal', () => {
        modalIsOpen = false;
    }, { once: true });

    diffModal.show();
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
