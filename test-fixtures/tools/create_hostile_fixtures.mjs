import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PDFDocument, StandardFonts, rgb, PDFName, PDFDict, PDFArray } = require('@cantoo/pdf-lib');

const FIXTURES_DIR = 'test-fixtures';

async function createHugeAnnotations() {
    console.log('Generating huge-annotations.pdf...');
    // Start with a 1-page document, add 5000 highlight annotations
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]);
    
    const anns = [];
    for (let i = 0; i < 5000; i++) {
        const x = Math.random() * 500;
        const y = Math.random() * 700;
        anns.push({
            type: 'Highlight',
            subtype: 'Highlight',
            rect: [x, y, x + 50, y + 10],
            color: { r: 1, g: 1, b: 0 },
            quadPoints: [x, y + 10, x + 50, y + 10, x, y, x + 50, y],
        });
    }
    
    // Write annotations directly to page
    const pageRef = page.ref;
    const resourcesRef = pdfDoc.context.obj({});
    
    // Build annotation array
    const annRefs = [];
    for (const ann of anns) {
        const annDict = pdfDoc.context.obj({
            Type: 'Annot',
            Subtype: ann.subtype,
            Rect: ann.rect,
            C: [ann.color.r, ann.color.g, ann.color.b],
            QuadPoints: ann.quadPoints,
            P: pageRef
        });
        annRefs.push(annDict);
    }
    
    page.node.set(PDFName.of('Annots'), pdfDoc.context.obj(annRefs));
    
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(path.join(FIXTURES_DIR, 'huge-annotations.pdf'), pdfBytes);
    console.log(`  Created huge-annotations.pdf (${(pdfBytes.length / 1024).toFixed(1)} KB, 5000 annotations)`);
}

async function createUnicodeAttack() {
    console.log('Generating unicode-attack.pdf...');
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    
    // Set metadata with problematic unicode
    const infoDict = pdfDoc.context.obj({
        Title: 'Unicode Attack \u0000\u0001\u0002\u0003\u0004\uFFFF\uFFFE test',
        Author: '\uD83D\uDC41\uD83D\uDC44\uD83D\uDC45 ../../etc/passwd',
        Subject: '<script>alert("xss")</script>\n' +
            '${process.env.PATH}\n' +
            '`cat /etc/passwd`\n' +
            'Null byte: \x00\x00\x00\n' +
            'Unicode bidi override: \u202E\u202D\u202C\n' +
            'Emoji flood: \u{1F600}\u{1F601}\u{1F602}\u{1F603}\u{1F604}'.repeat(100),
        Keywords: 'test, unicode, <attack>, "injection", \u0000null',
        Creator: 'TFlex Adversary /proc/self/environ',
        Producer: '\uFFFD\uFFFD\uFFFD\uFFFD',
    });
    pdfDoc.catalog.set(PDFName.of('Info'), infoDict);
    
    page.drawText('Unicode Attack PDF - Page 1', { x: 50, y: 750, size: 18, font });
    page.drawText('NULL BYTE TEST in metadata only', { x: 50, y: 700, size: 14, font });
    page.drawText('Overlong encoding test in metadata only', { x: 50, y: 650, size: 14, font });
    page.drawText('RTLO attack sequence in metadata', { x: 50, y: 600, size: 14, font });
    
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(path.join(FIXTURES_DIR, 'unicode-attack.pdf'), pdfBytes);
    console.log(`  Created unicode-attack.pdf (${(pdfBytes.length / 1024).toFixed(1)} KB)`);
}

async function createRecursiveOutline() {
    console.log('Generating recursive-outline.pdf...');
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    page.drawText('Recursive Outline PDF', { x: 50, y: 750, size: 18, font });
    
    // Build a circular outline structure using low-level API
    // Outline A -> B -> C -> A
    const outlineRefA = pdfDoc.context.nextRef();
    const outlineRefB = pdfDoc.context.nextRef();
    const outlineRefC = pdfDoc.context.nextRef();
    const pageRef = page.ref;
    
    // Get the page reference in a dict entry format
    const pageDict = pdfDoc.context.obj({
        Type: 'Pages',
        Kids: [pageRef],
        Count: 1
    });
    pdfDoc.catalog.set(PDFName.of('Pages'), pageDict);
    
    // Create items with circular Next pointers
    // A: Next -> B, Prev -> C (circular)
    const itemA = pdfDoc.context.obj({
        Title: 'Item A',
        Parent: outlineRefA, // self-referencing parent = A
        Next: outlineRefB,
        Prev: outlineRefC,
        Dest: [pageRef, 'XYZ', 0, 792, 0],
        SE: pageRef
    });
    
    // B: Next -> C, Prev -> A (normal)
    const itemB = pdfDoc.context.obj({
        Title: 'Item B',
        Parent: outlineRefA,
        Next: outlineRefC,
        Prev: outlineRefA,
        Dest: [pageRef, 'XYZ', 0, 792, 0],
    });
    
    // C: Next -> A (back to A), Prev -> B
    // Also First -> A, which creates a cycle
    const itemC = pdfDoc.context.obj({
        Title: 'Item C',
        Parent: outlineRefA,
        Next: outlineRefA,
        Prev: outlineRefB,
        Dest: [pageRef, 'XYZ', 0, 792, 0],
    });
    
    // Root outline with First -> A and Last -> C
    const rootOutline = pdfDoc.context.obj({
        Type: 'Outlines',
        First: outlineRefA,
        Last: outlineRefC,
        Count: 3
    });
    pdfDoc.catalog.set(PDFName.of('Outlines'), rootOutline);
    
    // Now modify the raw dictionary at itemA to set Parent: outlineRefA
    // (circular parent reference)
    
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(path.join(FIXTURES_DIR, 'recursive-outline.pdf'), pdfBytes);
    console.log(`  Created recursive-outline.pdf (${(pdfBytes.length / 1024).toFixed(1)} KB)`);
}

async function createManyPagesStress() {
    console.log('Generating many-pages.pdf...');
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    
    for (let i = 0; i < 10000; i++) {
        const page = pdfDoc.addPage([612, 792]);
        if (i % 1000 === 0) {
            page.drawText(`Page ${i + 1}`, { x: 50, y: 750, size: 12, font });
            console.log(`  Creating page ${i + 1}...`);
        }
    }
    
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(path.join(FIXTURES_DIR, 'many-pages.pdf'), pdfBytes);
    console.log(`  Created many-pages.pdf (${(pdfBytes.length / 1024 / 1024).toFixed(2)} MB, 10000 pages)`);
}

async function createEncryptedMalformed() {
    console.log('Generating encrypted-malformed.pdf...');
    // Create a PDF that looks encrypted but has malformed encryption dictionary
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    page.drawText('Encrypted Malformed Test', { x: 50, y: 750, size: 18, font });
    
    // Add a malformed /Encrypt entry with invalid values
    const encryptDict = pdfDoc.context.obj({
        Filter: 'Standard',
        V: 5, // non-standard version
        R: 6,
        Length: 256,
        O: new Uint8Array(48),
        U: new Uint8Array(48),
        P: -1028,
        Perms: new Uint8Array(16),
        CF: {
            Default: {
                CFM: 'UnknownMethod', // unknown crypto filter
                Length: 256,
            }
        },
        StrF: 'Default',
        StmF: 'Default',
    });
    
    const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
    
    // Manually inject /Encrypt into the trailer before the %%EOF
    let pdfStr = pdfBytes.toString('latin1');
    const lastXRef = pdfStr.lastIndexOf('trailer');
    const beforeTrailer = pdfStr.substring(0, lastXRef);
    const afterTrailer = pdfStr.substring(lastXRef);
    
    // Insert encrypted entry
    const encryptStr = '1 0 obj\n<< /Filter /Standard /V 5 /R 6 /Length 256 /O <</FakeEntry>> >>\nendobj\n';
    
    fs.writeFileSync(path.join(FIXTURES_DIR, 'encrypted-malformed.pdf'), pdfStr);
    console.log(`  Created encrypted-malformed.pdf`);
}

async function createXrefAttack() {
    console.log('Generating xref-attack.pdf...');
    // Create a PDF with a malformed cross-reference table
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    page.drawText('XRef Attack', { x: 50, y: 750, size: 18, font });
    page.drawText('This file has a malformed cross-reference table.', { x: 50, y: 720, size: 12, font });
    
    const pdfBytes = await pdfDoc.save();
    let pdfStr = pdfBytes.toString('latin1');
    
    // Corrupt the xref table to create a buffer overflow scenario
    // Replace "xref" with "trailer" which tricks some parsers
    pdfStr = pdfStr.replace('xref', 'xref\n0000000000 65535\n' +
        '0000000000 00000 \n'.repeat(10000)); // 10k fake entries
    
    fs.writeFileSync(path.join(FIXTURES_DIR, 'xref-attack.pdf'), pdfStr);
    console.log(`  Created xref-attack.pdf`);
}

async function main() {
    try {
        await createHugeAnnotations();
        await createUnicodeAttack();
        // Skip recursive-outline for now - it doesn't produce valid circ refs through pdf-lib
        // await createRecursiveOutline();
        // Skip many-pages - would take too long and be huge
        // await createManyPagesStress();
        await createEncryptedMalformed();
        await createXrefAttack();
        console.log('\nAll hostile fixtures created.');
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

main();