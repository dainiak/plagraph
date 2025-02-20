# PlaGraph: discover similarities between a collection of text files

A web application for detecting similarities between text files by computing the normalized compression distance (NCD) between them. Drop a ZIP file or individual files onto the page, and the app builds an interactive graph of file similarities. You can adjust the edge threshold, explore file differences with an integrated diff viewer, and even save/load your graph.

## Features

- **Drag-and-Drop Interface:**  
  Easily drop a ZIP file (with text files) or individual files onto the drop zone.

- **Incremental Graph Augmentation:**  
  Augment an existing graph with new files without recomputing previously calculated distances.

- **Graph Visualization:**  
  Files are represented as nodes and similarities as weighted edges in a graph layout powered by Cytoscape.js and Cola.

- **Interactive Diff Viewer:**  
  Compare two files side-by-side using an embedded diff viewer based on Ace Editor and Diff2Html.

- **Adjustable Edge Threshold:**  
  Use a slider to filter graph edges based on the computed similarity.

- **Local Storage Support:**  
  Save and load your graph state directly from your browser.

- **Onboarding Tour:**  
  A built-in tour guides new users through the app’s main features.

## Demo

If you have a live demo, include a link here. For example:  
[Live Demo](https://dainiak.github.io/plagraph/)


## How to Use

1. **Drop Files:**  
   Drag and drop a ZIP file (containing text files) or individual text files onto the drop zone.

2. **View the Graph:**  
   The app creates a node for each file. Edges are drawn between nodes that share a file extension, with the weight showing the similarity score.

3. **Adjust the Threshold:**  
   Use the slider to hide or show edges based on the similarity score.

4. **Compare Files:**  
   Hold Ctrl or Shift and click on two nodes to open a modal with a side-by-side diff of the two files.

5. **Save and Load:**  
   Use the "Save Graph" button to store the current graph in your browser’s local storage, and "Load Graph" to retrieve it later.

## Dependencies

This app uses the following libraries:

- **Bootstrap:** For responsive UI components.
- **Cytoscape.js:** For graph visualization.
- **Cytoscape Cola:** For the graph layout.
- **Diff2Html and Diff:** For generating and displaying file diffs.
- **Ace Editor:** For editing and viewing file differences.
- **JSZip:** For reading ZIP files.
- **LZMA-JS:** For compressing text to compute NCD.
- **TourGuideJS:** For the guided tour on first use.

## License

This project is distributed under the MIT License. See the [LICENSE](LICENSE) file for details.
