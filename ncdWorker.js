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
    // Use each file's "path" as the unique identifier.
    return { source: fileA.path, target: fileB.path, similarity };
};

// Compute total pairs among files grouped by their comparison key.
const computeTotalPairs = (fileData) => {
    const groupCounts = {};
    fileData.forEach((file) => {
        const key = file.comparison_key;
        groupCounts[key] = (groupCounts[key] || 0) + 1;
    });
    return Object.keys(groupCounts).reduce(
        (total, key) => total + (groupCounts[key] * (groupCounts[key] - 1)) / 2,
        0
    );
};

// Listen for messages from the main thread.
self.onmessage = async (e) => {
    const fileData = e.data.fileData;
    const n = fileData.length;
    const totalPairs = computeTotalPairs(fileData);

    let count = 0;
    let batchEdges = [];

    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            if (fileData[i].comparison_key !== fileData[j].comparison_key)
                continue;

            try {
                batchEdges.push(await computeEdge(fileData, i, j));
            } catch (error) {}
            count++;

            // Send batch updates every 20 valid pairs or when completed.
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
