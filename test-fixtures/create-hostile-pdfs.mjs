// Create hostile PDFs for TFL-1566 adversarial testing
import { writeFileSync } from 'fs';
import { join } from 'path';

const FIXTURE_DIR = 'C:/Users/tanzi/OneDrive/App Development/TFlex/test-fixtures';

// 1. Extreme aspect ratio - very tall page (A4-like but exaggerated)
const tallPDF = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 1200] /Contents 4 0 R /Resources << >> >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 24 Tf 100 600 Td (TALL PAGE TEST) Tj ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000117 00000 n 
0000000224 00000 n 
0000000317 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
385
%%EOF`;

// 2. Extreme aspect ratio - very wide page
const widePDF = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1200 300] /Contents 4 0 R /Resources << >> >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 24 Tf 100 150 Td (WIDE PAGE TEST) Tj ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000117 00000 n 
0000000224 00000 n 
0000000317 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
385
%%EOF`;

// 3. Square page (edge case for rotation)
const squarePDF = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Contents 4 0 R /Resources << >> >>
endobj
4 0 obj
<< /Length 40 >>
stream
BT /F1 24 Tf 100 300 Td (SQUARE TEST) Tj ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000117 00000 n 
0000000224 00000 n 
0000000317 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
385
%%EOF`;

// 4. Zero-byte file
const zeroByte = Buffer.alloc(0);

// 5. Not a PDF at all
const notPDF = `This is not a PDF file at all.
It's just plain text pretending to be a document.
Line 3 for good measure.`;

// 6. Truncated PDF (starts valid but cuts off mid-xref)
const truncatedPDF = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>
endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
`;

writeFileSync(join(FIXTURE_DIR, 'hostile-tall.pdf'), tallPDF);
writeFileSync(join(FIXTURE_DIR, 'hostile-wide.pdf'), widePDF);
writeFileSync(join(FIXTURE_DIR, 'hostile-square.pdf'), squarePDF);
writeFileSync(join(FIXTURE_DIR, 'hostile-zero.pdf'), zeroByte);
writeFileSync(join(FIXTURE_DIR, 'hostile-notpdf.pdf'), notPDF);
writeFileSync(join(FIXTURE_DIR, 'hostile-truncated.pdf'), truncatedPDF);

console.log('Created hostile PDF fixtures:');
console.log('  - hostile-tall.pdf (300x1200, 1:4 aspect ratio)');
console.log('  - hostile-wide.pdf (1200x300, 4:1 aspect ratio)');
console.log('  - hostile-square.pdf (600x600, 1:1 aspect ratio)');
console.log('  - hostile-zero.pdf (0 bytes)');
console.log('  - hostile-notpdf.pdf (plain text)');
console.log('  - hostile-truncated.pdf (incomplete xref)');
