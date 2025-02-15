// Import the LZMA library into the worker.
importScripts('https://cdn.jsdelivr.net/npm/lzma@2.3.2/src/lzma_worker.min.js');

// Utility: Compress text and return the length of the compressed result.
function compressText(text) {
    return new Promise((resolve, reject) => {
        LZMA.compress(text, 9, function(result, error) {
            if (error) reject(error);
            else resolve(result.length);
        });
    });
}

// Compute NCD-based similarity for a given pair of files.
async function computeEdge(fileData, i, j) {
    const fileA = fileData[i];
    const fileB = fileData[j];
    const concatenated = fileA.content + fileB.content;
    const compConcatSize = await compressText(concatenated);
    const minSize = Math.min(fileA.compSize, fileB.compSize);
    const maxSize = Math.max(fileA.compSize, fileB.compSize);
    const ncd = (compConcatSize - minSize) / maxSize;
    const similarity = 1 - ncd;
    return { source: fileA.name, target: fileB.name, similarity };
}

// Listen for messages from the main thread.
onmessage = async function(e) {
    const fileData = e.data.fileData;
    const n = fileData.length;

    // Compute totalPairs only for files sharing the same extension.
    const extGroups = {};
    fileData.forEach(file => {
        const ext = file.extension;
        extGroups[ext] = (extGroups[ext] || 0) + 1;
    });
    let totalPairs = 0;
    for (let ext in extGroups) {
        const count = extGroups[ext];
        totalPairs += (count * (count - 1)) / 2;
    }

    let count = 0;
    let batchEdges = [];

    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            // Only compare files with the same extension.
            if (fileData[i].extension !== fileData[j].extension) {
                continue;
            }
            try {
                const edge = await computeEdge(fileData, i, j);
                batchEdges.push(edge);
            } catch (error) {
                // Skip this pair on error.
            }
            count++;

            // Send batch updates every 10 valid pairs or on completion.
            if (batchEdges.length >= 10 || count === totalPairs) {
                postMessage({
                    type: "batch",
                    batchEdges: batchEdges,
                    progress: (count / totalPairs) * 100
                });
                batchEdges = [];
            }
        }
    }
    postMessage({ type: "complete" });
};
