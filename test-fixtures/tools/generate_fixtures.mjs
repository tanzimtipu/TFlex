import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { PDFDocument as LibPDFDocument, PDFName, PDFDict, PDFArray } from '@cantoo/pdf-lib';

const require = createRequire(import.meta.url);
const PDFDocument = require('pdfkit');
const { PNG } = require('pngjs');

const FIXTURES_DIR = 'test-fixtures';

function generatePNG(width, height) {
    const png = new PNG({ width, height });
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (width * y + x) << 2;
            const val = Math.random() > 0.8 ? 200 : 255;
            png.data[idx] = val; // R
            png.data[idx + 1] = val; // G
            png.data[idx + 2] = val; // B
            png.data[idx + 3] = 255; // A
        }
    }
    for (let i = 0; i < 15; i++) {
        const ry = Math.floor(Math.random() * (height - 20));
        const rx = Math.floor(Math.random() * (width - 100));
        const rw = 50 + Math.floor(Math.random() * 50);
        const rh = 8;
        for (let y = ry; y < ry + rh; y++) {
            for (let x = rx; x < rx + rw; x++) {
                const idx = (width * y + x) << 2;
                png.data[idx] = 180;
                png.data[idx + 1] = 180;
                png.data[idx + 2] = 180;
            }
        }
    }
    return PNG.sync.write(png);
}

async function createReport() {
    console.log('Generating report.pdf...');
    const doc = new PDFDocument({ bufferPages: true });
    const stream = fs.createWriteStream(path.join(FIXTURES_DIR, 'report.pdf'));
    doc.pipe(stream);

    doc.fontSize(24).text('TFlex Technical Report', { align: 'center' });
    doc.moveDown(2);
    doc.fontSize(14).text('A study in PDF orchestration and performance.', { align: 'center' });
    doc.addPage();

    // 8 Chapters, each taking ~4 pages -> ~33 pages total
    for (let i = 1; i <= 8; i++) {
        const chapterTitle = `Chapter ${i}: The Art of Orchestration`;
        doc.outline.addItem(chapterTitle);
        
        doc.fontSize(18).text(chapterTitle);
        doc.moveDown();
        
        for (let p = 0; p < 8; p++) {
            doc.fontSize(12).text(
                "This document serves as a test fixture for TFlex. The orchestration of complex PDF " +
                "structures requires careful management of internal objects. We must ensure that the " +
                "orchestration layer correctly handles multiple page streams. " +
                "Strategic orchestration is key to maintaining document integrity. " +
                "Orchestration of elements within the file structure is a primary concern. " +
                "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor " +
                "incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud " +
                "exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. " +
                "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu " +
                "fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident."
            );
            doc.moveDown();
        }
        if (i < 8) doc.addPage();
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(10).text(`Page ${i + 1}`, 50, doc.page.height - 50, { align: 'center' });
    }

    doc.end();
    return new Promise((resolve) => stream.on('finish', resolve));
}

async function createLong() {
    console.log('Generating long.pdf...');
    const doc = new PDFDocument({ margin: 30, autoFirstPage: false });
    const stream = fs.createWriteStream(path.join(FIXTURES_DIR, 'long.pdf'));
    doc.pipe(stream);

    for (let i = 1; i <= 520; i++) {
        doc.addPage();
        doc.fontSize(10).text(`Page ${i} of 520`, { align: 'right' });
        doc.moveDown();
        doc.fontSize(12).text(`This is page ${i} of the long test document.`);
        doc.moveDown(0.5);
        doc.text("Performance testing requires a significant number of pages.");
        
        if (i % 7 === 0) {
            const freshImg = generatePNG(200, 100);
            doc.image(freshImg, { width: 150 });
        }
    }

    doc.end();
    return new Promise((resolve) => stream.on('finish', resolve));
}

async function createForm() {
    console.log('Generating form.pdf...');
    const pdfDoc = await LibPDFDocument.create();
    const page = pdfDoc.addPage([600, 800]);
    const form = pdfDoc.getForm();

    page.drawText('TFlex Application Form', { x: 50, y: 750, size: 20 });

    const nameField = form.createTextField('applicant_name');
    nameField.setText('John Doe');
    nameField.addToPage(page, { x: 150, y: 695, width: 200, height: 20 });

    const addressField = form.createTextField('applicant_address');
    addressField.addToPage(page, { x: 150, y: 665, width: 400, height: 20 });

    const dateField = form.createTextField('application_date');
    dateField.addToPage(page, { x: 150, y: 635, width: 100, height: 20 });

    const termsCheck = form.createCheckBox('terms_agreed');
    termsCheck.check();
    termsCheck.addToPage(page, { x: 150, y: 605, width: 20, height: 20 });

    const newsCheck = form.createCheckBox('newsletter_optin');
    newsCheck.addToPage(page, { x: 350, y: 605, width: 20, height: 20 });

    const expRadio = form.createRadioGroup('experience_level');
    expRadio.addOptionToPage('Junior', page, { x: 150, y: 575, width: 20, height: 20 });
    expRadio.addOptionToPage('Mid', page, { x: 250, y: 575, width: 20, height: 20 });
    expRadio.addOptionToPage('Senior', page, { x: 350, y: 575, width: 20, height: 20 });
    expRadio.select('Mid');

    const deptDropdown = form.createDropdown('department');
    deptDropdown.addOptions(['Engineering', 'Marketing', 'Sales', 'Support']);
    deptDropdown.select('Engineering');
    deptDropdown.addToPage(page, { x: 150, y: 535, width: 150, height: 20 });

    const skillsList = form.createOptionList('skills');
    skillsList.addOptions(['JavaScript', 'TypeScript', 'Node.js', 'React', 'PDF Spec']);
    skillsList.select('JavaScript');
    skillsList.addToPage(page, { x: 150, y: 450, width: 150, height: 70 });

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(path.join(FIXTURES_DIR, 'form.pdf'), pdfBytes);
}

async function createScanned() {
    console.log('Generating scanned.pdf...');
    const doc = new PDFDocument({ autoFirstPage: false });
    const stream = fs.createWriteStream(path.join(FIXTURES_DIR, 'scanned.pdf'));
    doc.pipe(stream);

    for (let i = 0; i < 6; i++) {
        const img = generatePNG(600, 800);
        doc.addPage();
        doc.image(img, 0, 0, { width: doc.page.width, height: doc.page.height });
    }

    doc.end();
    return new Promise((resolve) => stream.on('finish', resolve));
}

async function verify() {
    console.log('\n--- VERIFICATION ---');
    const files = ['report.pdf', 'long.pdf', 'form.pdf', 'scanned.pdf'];
    
    for (const file of files) {
        const filePath = path.join(FIXTURES_DIR, file);
        const bytes = fs.readFileSync(filePath);
        const pdfDoc = await LibPDFDocument.load(bytes);
        const stats = fs.statSync(filePath);
        const pageCount = pdfDoc.getPageCount();

        console.log(`File: ${file}`);
        console.log(`- Size: ${(stats.size / 1024).toFixed(2)} KB`);
        console.log(`- Pages: ${pageCount}`);

        if (file === 'form.pdf') {
            const form = pdfDoc.getForm();
            const fields = form.getFields();
            console.log(`- Form Fields: ${fields.length}`);
        }

        if (file === 'report.pdf') {
            const catalog = pdfDoc.catalog;
            const hasOutline = catalog.has(PDFName.of('Outlines'));
            console.log(`- Has Outline: ${hasOutline}`);
        }
        console.log('');
    }
}

async function main() {
    try {
        await createReport();
        await createLong();
        await createForm();
        await createScanned();
        await verify();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

main();
