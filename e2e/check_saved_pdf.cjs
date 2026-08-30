const { PDFDocument } = require('pdf-lib');
const fs = require('fs');

async function checkPdf(filePath) {
  const bytes = fs.readFileSync(filePath);
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  console.log(`PDF has ${pages.length} pages.`);
  
  // Check for text content / annotations / something that indicates a text layer
  // TFlex adds invisible text. In pdf-lib, these are usually text runs.
  // But pdf-lib is better at writing.
}

// Actually, I'll just use a search tool or something.
// Wait, I can't easily "search" inside a PDF file with my tools without an external tool.
