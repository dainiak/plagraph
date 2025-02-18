const isInDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
document.body && document.body.setAttribute("data-bs-theme", isInDarkMode ? "dark" : "light");

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
async function convertZipToFileObjects(zipFile) {
    const zip = new JSZip();
    const zipContent = await zip.loadAsync(zipFile);
    const entries = [];
    zip.forEach((relativePath, zipEntry) => {
        if (!zipEntry.dir && relativePath.indexOf('.') !== -1) {
            entries.push(zipEntry);
        }
    });
    if (entries.length === 0) return [];
    const results = [];
    for (let entry of entries) {
        const content = await entry.async("string");
        const compSize = await compressText(content);
        const parts = entry.name.split('/');
        const fileName = parts[parts.length - 1];
        let comparison_key = "";
        if (fileName.indexOf('.') !== -1) {
            comparison_key = fileName.split('.').pop().toLowerCase();
        }
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
let diffSelection = [];

// Ensure there's a progress element.
let progressDiv = document.getElementById('progress');
if (!progressDiv) {
    progressDiv = document.createElement('div');
    progressDiv.id = 'progress';
    progressDiv.className = "alert alert-info mt-3";
    document.body.insertBefore(progressDiv, document.getElementById('graph-container'));
}
progressDiv.innerText = "Progress: 0%";

// Debounced function to update graph edges.
const debouncedUpdateGraphEdges = debounce(() => {
    if (lastGraphData && currentGraph) updateGraphEdges();
}, 500);

const thresholdSlider = document.getElementById('threshold');
thresholdSlider.addEventListener('input', (e) => {
    threshold = parseFloat(e.target.value);
    document.getElementById('threshold-value').innerText = threshold.toFixed(2);
    debouncedUpdateGraphEdges();
});
thresholdSlider.addEventListener('change', (e) => {
    debouncedUpdateGraphEdges.cancel();
    if (lastGraphData && currentGraph) updateGraphEdges();
});

function updateGraphEdges() {
    const newEdges = lastGraphData.allEdges
        .filter(edge => edge.similarity >= threshold)
        .map(edge => ({
            id: edge.source + "_" + edge.target,
            source: edge.source,
            target: edge.target,
            weight: edge.similarity.toFixed(2)
        }));
    const newEdgeIds = newEdges.map(edge => edge.id);
    currentGraph.edges().forEach(edge => {
        if (!newEdgeIds.includes(edge.id())) {
            edge.remove();
        }
    });
    newEdges.forEach(edgeData => {
        if (!currentGraph.getElementById(edgeData.id).length) {
            currentGraph.add({ data: edgeData });
        }
    });
    const layout = currentGraph.layout({
        name: "cola",
        fit: true,
        padding: 30
    });
    layout.run();
}

// Drag-n-Drop setup.
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
    if (e.dataTransfer.files.length > 0) await handleZipFile(e.dataTransfer.files[0]);
});

function compressText(text) {
    return new Promise((resolve, reject) => {
        LZMA.compress(text, 9, (result, error) => {
            if (error) reject(error);
            else resolve(result.length);
        });
    });
}

async function handleZipFile(zipFile) {
    progressDiv.innerText = "Progress: 0%";
    try {
        const fileData = await convertZipToFileObjects(zipFile);
        if (fileData.length === 0) {
            alert("No files with an extension found in the ZIP archive.");
            return;
        }
        const nodes = fileData.map(file => ({
            data: {
                id: file.path,
                label: file.fileName,
                tooltip: file.tooltip,
                content: file.content
            }
        }));
        lastGraphData = { nodes, allEdges: [] };
        renderGraph(lastGraphData, true);
        const worker = new Worker('ncdWorker.js');
        worker.postMessage({ fileData: fileData });
        worker.onmessage = (e) => {
            const msg = e.data;
            if (msg.type === "batch") {
                lastGraphData.allEdges = lastGraphData.allEdges.concat(msg.batchEdges);
                if (currentGraph) {
                    msg.batchEdges.forEach(edge => {
                        if (edge.similarity >= threshold &&
                            !currentGraph.getElementById(edge.source + "_" + edge.target).length) {
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

function renderGraph(graphData, fullRedraw = false) {
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
    if (fullRedraw) {
        const elements = [
            ...graphData.nodes,
            ...filteredEdges
        ];
        if (currentGraph) currentGraph.destroy();
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
                        'color': isInDarkMode ? "#eee" : "#555",
                        'font-size': '10px',
                        'width': '40px',
                        'height': '40px'
                    }
                },
                {
                    selector: 'node.selected-diff',
                    style: {
                        'border-width': '2px',
                        'border-color': 'red'
                    }
                },
                {
                    selector: 'edge',
                    style: {
                        'width': 0.5,
                        'line-color': '#aaa',
                        'curve-style': 'bezier',
                        'label': 'data(weight)',
                        'font-size': '8px',
                        'color': isInDarkMode ? "#eee" : "#555",
                        'text-rotation': 'autorotate'
                    }
                }
            ],
            layout: {
                name: 'cola',
                padding: 30,
                fit: true
            }
        });

        function makeDiv(text) {
            let div = document.createElement('div');
            div.classList.add('popover', 'bs-popover-top', 'p-2');
            div.innerHTML = text;
            document.body.appendChild(div);
            return div;
        }

        currentGraph.nodes().forEach(function(node) {
            if (node.data('tooltip')) {
                node.on('mouseover', function(e) {
                    if (modalIsOpen) return;
                    let popperInstance = node.popper({
                        content: function(){
                            return makeDiv(node.data('tooltip'));
                        },
                        popper: { placement: 'top' }
                    });
                    node.scratch('popper', popperInstance);
                    let updateFn = function(){ popperInstance.update(); };
                    node.scratch('popperUpdate', updateFn);
                    node.on('position', updateFn);
                    currentGraph.on('pan zoom resize', updateFn);
                });
                node.on('mouseout', function(e) {
                    let popperInstance = node.scratch('popper');
                    let updateFn = node.scratch('popperUpdate');
                    if (popperInstance) {
                        let popperDiv = popperInstance.state.elements.popper;
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
            node.on('click', function(e) {
                if (e.originalEvent.ctrlKey) {
                    if (!node.selectedForDiff) {
                        node.selectedForDiff = true;
                        node.addClass('selected-diff');
                        diffSelection.push(node);
                    } else {
                        node.selectedForDiff = false;
                        node.removeClass('selected-diff');
                        diffSelection = diffSelection.filter(n => n.id() !== node.id());
                    }
                    if (diffSelection.length === 2) {
                        showDiffModal(diffSelection[0], diffSelection[1]);
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
        filteredEdges.forEach(edge => {
            if (!currentGraph.getElementById(edge.data.id).length) {
                currentGraph.add(edge);
            }
        });
    }
}

/*
  Editable Diff Modal with ACE Editor in LaTeX mode.
  (Ensure your modal HTML has two <div> elements with IDs "editorA" and "editorB",
  diff setting controls with IDs "diffWrap" and "diffOutputFormat", and a container with ID "diffOutput".)
*/
function showDiffModal(nodeA, nodeB) {
    // Clear any active tooltips.
    if (currentGraph) {
        currentGraph.nodes().forEach(node => node.trigger('mouseout'));
    }
    const fileNameA = nodeA.data('label');
    const fileNameB = nodeB.data('label');
    const contentA = nodeA.data('content') || "";
    const contentB = nodeB.data('content') || "";

    // Initialize ACE editors in the divs.
    let aceOptions = {
        theme: "ace/theme/" + (isInDarkMode ? "monokai" : "chrome"),
        showGutter: true,
        fadeFoldWidgets: false,
        showFoldWidgets: true,
        wrap: true,
        showPrintMargin: false,
        // maxLines: Infinity
    };

    let editorA = ace.edit("editorA", aceOptions);
    editorA.session.setMode("ace/mode/latex");
    editorA.setValue(contentA, -1); // -1 moves cursor to start without selecting text

    let editorB = ace.edit("editorB", aceOptions);
    editorB.session.setMode("ace/mode/latex");
    editorB.setValue(contentB, -1);

    // Function to update the diff output based on the current editor values and diff controls.
    function updateEditableDiff() {
        const newContentA = editorA.getValue();
        const newContentB = editorB.getValue();
        const wrap = document.getElementById("diffWrap").value;
        const outputFormat = document.getElementById("diffOutputFormat").value;
        // Generate a unified diff string.
        let diffString = Diff.createTwoFilesPatch(fileNameA, fileNameB, newContentA, newContentB);
        const diffHtml = Diff2Html.html(diffString, {
            drawFileList: false,
            matching: "lines",
            wrap: wrap === "yes",
            outputFormat: outputFormat,
            colorScheme: isInDarkMode ? "dark" : "light"
        });
        document.getElementById("diffOutput").innerHTML = diffHtml;
    }

    // Debounce the update function.
    const debouncedUpdate = debounce(updateEditableDiff, 300);
    // Attach change listeners to the ACE sessions.
    editorA.session.on('change', debouncedUpdate);
    editorB.session.on('change', debouncedUpdate);

    // Also update diff when the user changes the diff setting controls.
    document.getElementById("diffWrap").onchange = updateEditableDiff;
    document.getElementById("diffOutputFormat").onchange = updateEditableDiff;

    // Initial diff render.
    updateEditableDiff();

    // Show the modal.
    const diffModalEl = document.getElementById('diffModal');
    const diffModal = new bootstrap.Modal(diffModalEl, {});
    modalIsOpen = true;
    diffModalEl.addEventListener('hidden.bs.modal', () => {
        modalIsOpen = false;
        // Destroy ACE editors to avoid duplicates.
        editorA.destroy();
        editorB.destroy();
        // Optionally clear the div contents.
        document.getElementById("editorA").innerHTML = "";
        document.getElementById("editorB").innerHTML = "";
    }, { once: true });
    diffModal.show();
}

document.getElementById('save-graph').addEventListener('click', () => {
    if (lastGraphData) {
        localStorage.setItem('plagiarismGraph', JSON.stringify(lastGraphData));
        alert("Graph saved to localStorage.");
    } else {
        alert("No graph data to save.");
    }
});

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
