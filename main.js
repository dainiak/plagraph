const isInDarkMode = window.matchMedia("(prefers-color-scheme: dark)").matches;
if (document.body) {
    document.body.setAttribute("data-bs-theme", isInDarkMode ? "dark" : "light");
}

const wrapControl = document.getElementById("diffWrap");
const diffOutputFormatEl = document.getElementById("diffOutputFormat");
const graphContainer = document.getElementById("graph-container");
const thresholdSlider = document.getElementById("threshold");
const thresholdValueDisplay = document.getElementById("threshold-value");

// Register cytoscape-popper with popper@2 if available.
if (typeof Popper !== "undefined" && typeof cytoscapePopper !== "undefined") {
    cytoscape.use(cytoscapePopper(Popper.createPopper));
}
if (typeof cytoscape === "undefined") {
    cytoscape.use(cytoscapeCola);
}

// Global flags and variables.
let modalIsOpen = false;
let maxSimilarity = 0;
let currentGraph = null;
let threshold = parseFloat(thresholdSlider.value);
let lastGraphData = null;
let diffSelection = [];

// Use the Bootstrap progress bar element.
const progressBar = document.getElementById("progress-bar");
updateProgress(0);

function updateProgress(progress) {
    progressBar.style.width = progress + '%';
    progressBar.setAttribute('aria-valuenow', progress);
    progressBar.innerText = progress + '%';
}

// Debounce utility: calls func after delay ms of inactivity.
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
async function convertZipToFileObjects(zipFile) {
    const zip = new JSZip();
    await zip.loadAsync(zipFile);
    const entries = [];
    zip.forEach((relativePath, zipEntry) => {
        if (!zipEntry.dir && relativePath.indexOf(".") !== -1) {
            entries.push(zipEntry);
        }
    });
    if (entries.length === 0) return [];
    const results = [];
    for (const entry of entries) {
        const content = await entry.async("string");
        const compSize = await compressText(content);
        const parts = entry.name.split("/");
        const fileName = parts[parts.length - 1];
        let comparison_key = "";
        if (fileName.indexOf(".") !== -1) {
            comparison_key = fileName.split(".").pop().toLowerCase();
        }
        results.push({
            fileName: fileName,
            path: entry.name,
            content: content,
            compSize: compSize,
            comparison_key: comparison_key,
            tooltip: fileName,
        });
    }
    return results;
}

thresholdSlider.addEventListener("input", (e) => {
    threshold = parseFloat(e.target.value);
    thresholdValueDisplay.innerText = `${threshold.toFixed(2)} / ${maxSimilarity.toFixed(2)}`;
    debouncedUpdateGraphEdges();
});
thresholdSlider.addEventListener("change", () => {
    debouncedUpdateGraphEdges.cancel();
    if (lastGraphData && currentGraph) updateGraphEdges();
});

// Update graph edges based on the current threshold.
function updateGraphEdges() {
    const newEdges = lastGraphData.allEdges
        .filter((edge) => edge.similarity >= threshold)
        .map((edge) => ({
            id: `${edge.source}_${edge.target}`,
            source: edge.source,
            target: edge.target,
            weight: edge.similarity.toFixed(2),
        }));
    const newEdgeIds = newEdges.map((edge) => edge.id);
    currentGraph.edges().forEach((edge) => {
        if (!newEdgeIds.includes(edge.id())) {
            edge.remove();
        }
    });
    newEdges.forEach((edgeData) => {
        if (!currentGraph.getElementById(edgeData.id).length) {
            currentGraph.add({ data: edgeData });
        }
    });
    const layout = currentGraph.layout({
        name: "cola",
        fit: true,
        padding: 30,
    });
    layout.run();
}

const debouncedUpdateGraphEdges = debounce(() => {
    if (lastGraphData && currentGraph) updateGraphEdges();
}, 300);

// Drag-n-Drop setup.
const dropZone = document.getElementById("drop-zone");
dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("hover");
});
dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("hover");
});
dropZone.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropZone.classList.remove("hover");
    if (e.dataTransfer.files.length > 0) await handleZipFile(e.dataTransfer.files[0]);
});

// Compress text using LZMA.
function compressText(text) {
    return new Promise((resolve, reject) => {
        LZMA.compress(text, 9, (result, error) => {
            if (error) reject(error);
            else resolve(result.length);
        });
    });
}

// Process the ZIP file and render the graph.
async function handleZipFile(zipFile) {
    updateProgress(0);
    try {
        const fileData = await convertZipToFileObjects(zipFile);
        if (fileData.length === 0) {
            alert("No files with an extension found in the ZIP archive.");
            return;
        }
        const nodes = fileData.map((file) => ({
            data: {
                id: file.path,
                label: file.fileName,
                tooltip: file.tooltip,
                content: file.content,
            },
        }));
        lastGraphData = { nodes, allEdges: [] };
        renderGraph(lastGraphData, true);
        const worker = new Worker("ncdWorker.js");
        worker.postMessage({ fileData });
        worker.onmessage = (e) => {
            const msg = e.data;
            if (msg.type === "batch") {
                // Append batch edges.
                lastGraphData.allEdges = lastGraphData.allEdges.concat(msg.batchEdges);
                // Update maxSimilarity based on newly received edges.
                msg.batchEdges.forEach((edge) => {
                    if (edge.similarity > maxSimilarity) {
                        maxSimilarity = edge.similarity;
                    }
                });
                // Update the slider's max and step.
                thresholdSlider.max = maxSimilarity;
                thresholdSlider.step = (maxSimilarity / 100).toFixed(3);
                if (threshold > maxSimilarity) {
                    threshold = maxSimilarity;
                    thresholdSlider.value = threshold;
                }
                thresholdValueDisplay.innerText = `${threshold.toFixed(2)} / ${maxSimilarity.toFixed(2)}`;
                // Add new edges that meet current threshold.
                if (currentGraph) {
                    msg.batchEdges.forEach((edge) => {
                        if (
                            edge.similarity >= threshold &&
                            !currentGraph.getElementById(`${edge.source}_${edge.target}`).length
                        ) {
                            currentGraph.add({
                                data: {
                                    id: `${edge.source}_${edge.target}`,
                                    source: edge.source,
                                    target: edge.target,
                                    weight: edge.similarity.toFixed(2),
                                },
                            });
                        }
                    });
                }
                updateProgress(msg.progress.toFixed(1));
            } else if (msg.type === "complete") {
                updateProgress(100);
                worker.terminate();
            }
        };
    } catch (err) {
        console.error("Error processing ZIP file:", err);
        alert("Error processing ZIP file.");
    }
}

// Render the cytoscape graph.
function renderGraph(graphData, fullRedraw = false) {
    const filteredEdges = graphData.allEdges
        .filter((edge) => edge.similarity >= threshold)
        .map((edge) => ({
            data: {
                id: `${edge.source}_${edge.target}`,
                source: edge.source,
                target: edge.target,
                weight: edge.similarity.toFixed(2),
            },
        }));
    if (fullRedraw) {
        const elements = [...graphData.nodes, ...filteredEdges];
        if (currentGraph) currentGraph.destroy();
        currentGraph = cytoscape({
            container: graphContainer,
            elements: elements,
            style: [
                {
                    selector: "node",
                    style: {
                        label: "data(label)",
                        "background-color": "rgb(13, 110, 253)",
                        "text-valign": "center",
                        color: isInDarkMode ? "#eee" : "#555",
                        "font-size": "10px",
                        width: "20px",
                        height: "20px",
                    },
                },
                {
                    selector: "node.selected-diff",
                    style: {
                        "border-width": "1px",
                        "border-color": "red",
                    },
                },
                {
                    selector: "edge",
                    style: {
                        width: 0.5,
                        "line-color": "#aaa",
                        "curve-style": "bezier",
                        label: "data(weight)",
                        "font-size": "8px",
                        color: isInDarkMode ? "#eee" : "#555",
                        "text-rotation": "autorotate",
                    },
                },
            ],
            layout: {
                name: "cola",
                padding: 30,
                fit: true,
            },
        });

        // Helper to create a popover div.
        const makeDiv = (text) => {
            const div = document.createElement("div");
            div.classList.add("popover", "bs-popover-top", "p-2");
            div.innerHTML = text;
            document.body.appendChild(div);
            return div;
        };

        currentGraph.nodes().forEach((node) => {
            if (node.data("tooltip")) {
                node.on("mouseover", () => {
                    if (modalIsOpen) return;
                    const popperInstance = node.popper({
                        content: () => makeDiv(node.data("tooltip")),
                        popper: { placement: "top" },
                    });
                    node.scratch("popper", popperInstance);
                    const updateFn = () => popperInstance.update();
                    node.scratch("popperUpdate", updateFn);
                    node.on("position", updateFn);
                    currentGraph.on("pan zoom resize", updateFn);
                });
                node.on("mouseout", () => {
                    const popperInstance = node.scratch("popper");
                    const updateFn = node.scratch("popperUpdate");
                    if (popperInstance) {
                        const popperDiv = popperInstance.state.elements.popper;
                        if (popperDiv && popperDiv.parentNode) {
                            popperDiv.parentNode.removeChild(popperDiv);
                        }
                        node.removeScratch("popper");
                    }
                    if (updateFn) {
                        node.off("position", updateFn);
                        currentGraph.off("pan zoom resize", updateFn);
                        node.removeScratch("popperUpdate");
                    }
                });
            }
            node.on("click", (e) => {
                if (!e.originalEvent.ctrlKey && !e.originalEvent.shiftKey) return;
                if (!node.selectedForDiff) {
                    node.selectedForDiff = true;
                    node.addClass("selected-diff");
                    diffSelection.push(node);
                } else {
                    node.selectedForDiff = false;
                    node.removeClass("selected-diff");
                    diffSelection = diffSelection.filter((n) => n.id() !== node.id());
                }
                if (diffSelection.length === 2) {
                    showDiffModal(diffSelection[0], diffSelection[1]);
                    diffSelection.forEach((n) => {
                        n.selectedForDiff = false;
                        n.removeClass("selected-diff");
                    });
                    diffSelection = [];
                }
            });
        });
    } else {
        filteredEdges.forEach((edge) => {
            if (!currentGraph.getElementById(edge.data.id).length) {
                currentGraph.add(edge);
            }
        });
    }
}

// Helper: Return the ACE editor mode based on the file extension.
function getAceMode(fileName) {
    const ext = fileName.split(".").pop().toLowerCase();
    const modeMapping = {
        c: "ace/mode/c_cpp",
        cpp: "ace/mode/c_cpp",
        py: "ace/mode/python",
        java: "ace/mode/java",
        js: "ace/mode/javascript",
        md: "ace/mode/markdown",
        tex: "ace/mode/latex",
        json: "ace/mode/json",
        yaml: "ace/mode/yaml",
        yml: "ace/mode/yaml",
    };
    return modeMapping[ext] || "ace/mode/text";
}

// Show the diff modal with two ACE editors.
function showDiffModal(nodeA, nodeB) {
    // Clear any active tooltips.
    if (currentGraph) {
        currentGraph.nodes().forEach((node) => node.trigger("mouseout"));
    }
    const fileNameA = nodeA.data("label");
    const fileNameB = nodeB.data("label");
    const contentA = nodeA.data("content") || "";
    const contentB = nodeB.data("content") || "";

    const aceOptions = {
        theme: `ace/theme/${isInDarkMode ? "monokai" : "chrome"}`,
        showGutter: true,
        fadeFoldWidgets: false,
        showFoldWidgets: true,
        wrap: wrapControl.value === "yes",
        showPrintMargin: false,
    };

    const modeA = getAceMode(fileNameA);
    const editorA = ace.edit("editorA", aceOptions);
    editorA.session.setMode(modeA);
    editorA.setValue(contentA, -1);

    const modeB = getAceMode(fileNameB);
    const editorB = ace.edit("editorB", aceOptions);
    editorB.session.setMode(modeB);
    editorB.setValue(contentB, -1);

    wrapControl.onchange = () => {
        const wrap = wrapControl.value === "yes";
        editorA.setOption("wrap", wrap);
        editorB.setOption("wrap", wrap);
    };

    function updateEditableDiff() {
        const newContentA = editorA.getValue();
        const newContentB = editorB.getValue();
        const outputFormat = diffOutputFormatEl.value;
        const diffString = Diff.createTwoFilesPatch(fileNameA, fileNameB, newContentA, newContentB);
        document.getElementById("diffOutput").innerHTML = Diff2Html.html(diffString, {
            drawFileList: false,
            matching: "lines",
            outputFormat: outputFormat,
            colorScheme: isInDarkMode ? "dark" : "light",
        });
    }

    const debouncedUpdate = debounce(updateEditableDiff, 100);
    editorA.session.on("change", debouncedUpdate);
    editorB.session.on("change", debouncedUpdate);
    document.getElementById("diffOutputFormat").onchange = updateEditableDiff;

    updateEditableDiff();

    const diffModalEl = document.getElementById("diffModal");
    const diffModal = new bootstrap.Modal(diffModalEl, {});
    modalIsOpen = true;
    diffModalEl.addEventListener(
        "hidden.bs.modal",
        () => {
            modalIsOpen = false;
            editorA.destroy();
            editorB.destroy();
            document.getElementById("editorA").innerHTML = "";
            document.getElementById("editorB").innerHTML = "";
        },
        { once: true }
    );
    diffModal.show();
}

const saveGraphButton = document.getElementById("save-graph");
saveGraphButton.addEventListener("click", () => {
    if (lastGraphData) {
        localStorage.setItem("plagiarismGraph", JSON.stringify(lastGraphData));
        alert("Graph saved to localStorage.");
    } else {
        alert("No graph data to save.");
    }
});

const loadGraphButton = document.getElementById("load-graph");
loadGraphButton.addEventListener("click", () => {
    const savedGraph = localStorage.getItem("plagiarismGraph");
    if (savedGraph) {
        lastGraphData = JSON.parse(savedGraph);
        renderGraph(lastGraphData, true);
        alert("Graph loaded from localStorage.");
    } else {
        alert("No saved graph found.");
    }
});

function showTour() {
    const tg = new tourguide.TourGuideClient();
    tg.start();
    setTimeout(() => {
        document.querySelectorAll(".tg-dialog-btn").forEach((el) => {
            el.classList.remove("tg-dialog-btn");
            el.classList.add("btn");
            el.classList.add("btn-sm");
            el.classList.add("btn-outline-secondary");
        });
    }, 50);
}

showTour()
