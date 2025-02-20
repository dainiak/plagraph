// Import the LZMA library into the worker.
importScripts("https://cdn.jsdelivr.net/npm/lzma@2.3.2/src/lzma_worker.min.js");

// Utility: Compress text and return the length of the compressed result.
const compressText = (text) =>
    new Promise((resolve, reject) => {
        LZMA.compress(text, 9, (result, error) => {
            if (error) {
                reject(error);
            } else {
                resolve(result.length);
            }
        });
    });

// Compute NCD-based similarity for a given pair of files.
const computeEdge = async (fileData, i, j) => {
    const fileA = fileData[i];
    const fileB = fileData[j];
    const concatenated = fileA.content + fileB.content;
    const compConcatSize = await compressText(concatenated);
    const minSize = Math.min(fileA.compSize, fileB.compSize);
    const maxSize = Math.max(fileA.compSize, fileB.compSize);
    const ncd = (compConcatSize - minSize) / maxSize;
    const similarity = 1 - ncd;
    return { source: fileA.id, target: fileB.id, similarity };
};

// Listen for messages from the main thread.
self.onmessage = async (e) => {
    const fileData = e.data.fileData;
    // startIndex indicates that files [0, startIndex-1] have been processed already.
    const startIndex = e.data.startIndex || 0;
    const n = fileData.length;
    const n_new = n - startIndex;
    // Total pairs to process: (old vs. new) plus (new vs. new)
    const totalPairs = (startIndex * n_new) + ((n_new * (n_new - 1)) / 2);
    let count = 0;
    let batchEdges = [];

    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            // Skip pairs where both files are from the old set.
            if (i < startIndex && j < startIndex) continue;
            if (fileData[i].comparison_key !== fileData[j].comparison_key) continue;

            try {
                batchEdges.push(await computeEdge(fileData, i, j));
            } catch (error) {
                // Ignore errors on a per-edge basis.
            }
            count++;

            if (batchEdges.length >= 20 || count === totalPairs) {
                self.postMessage({
                    type: "batch",
                    batchEdges,
                    progress: (count / totalPairs) * 100,
                });
                batchEdges = [];
            }
        }
    }
    if (batchEdges.length) {
        self.postMessage({
            type: "batch",
            batchEdges,
            progress: (count / totalPairs) * 100,
        });
    }
    self.postMessage({ type: "complete" });
};
