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
    // Use each file's 'path' as the unique identifier.
    return { source: fileA.path, target: fileB.path, similarity };
}

// Listen for messages from the main thread.
onmessage = async function(e) {
    const fileData = e.data.fileData;
    const n = fileData.length;

    // Compute totalPairs only for files sharing the same comparison_key.
    const groupCounts = {};
    fileData.forEach(file => {
        const key = file.comparison_key;
        groupCounts[key] = (groupCounts[key] || 0) + 1;
    });
    let totalPairs = 0;
    for (let key in groupCounts) {
        const count = groupCounts[key];
        totalPairs += (count * (count - 1)) / 2;
    }

    let count = 0;
    let batchEdges = [];

    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            // Only compare files with the same comparison_key.
            if (fileData[i].comparison_key !== fileData[j].comparison_key) {
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
