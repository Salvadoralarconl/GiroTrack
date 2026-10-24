import {mkdirSync,copyFileSync,cpSync,readdirSync,readFileSync} from 'node:fs';import {createRequire} from 'node:module';import path from 'node:path';
const require=createRequire(import.meta.url),out=path.resolve('public/invoice-tools');mkdirSync(out,{recursive:true});
const pdf=path.dirname(require.resolve('pdfjs-dist/package.json'));copyFileSync(path.join(pdf,'build/pdf.worker.min.mjs'),path.join(out,'pdf.worker.min.mjs'));for(const folder of ['standard_fonts','cmaps','wasm'])cpSync(path.join(pdf,folder),path.join(out,folder),{recursive:true});copyFileSync(path.join(pdf,'LICENSE'),path.join(out,'PDFJS-LICENSE'));
const tess=path.dirname(require.resolve('tesseract.js/package.json'));copyFileSync(path.join(tess,'dist/worker.min.js'),path.join(out,'ocr-worker.min.js'));copyFileSync(path.join(tess,'LICENSE.md'),path.join(out,'TESSERACT-LICENSE'));
const core=path.dirname(createRequire(path.join(tess,'package.json')).resolve('tesseract.js-core/package.json'));mkdirSync(path.join(out,'core'),{recursive:true});for(const f of readdirSync(core))if(/\.wasm(?:\.js)?$/.test(f))copyFileSync(path.join(core,f),path.join(out,'core',f));
const eng=path.dirname(require.resolve('@tesseract.js-data/eng/package.json'));copyFileSync(path.join(eng,'4.0.0_best_int/eng.traineddata.gz'),path.join(out,'eng.traineddata.gz'));
console.log('Local PDF and OCR assets prepared.');
