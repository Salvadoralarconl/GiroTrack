import {mkdirSync,copyFileSync,cpSync} from 'node:fs';import {createRequire} from 'node:module';import path from 'node:path';
const require=createRequire(import.meta.url),out=path.resolve('public/invoice-tools');mkdirSync(out,{recursive:true});
const pdf=path.dirname(require.resolve('pdfjs-dist/package.json'));copyFileSync(path.join(pdf,'build/pdf.worker.min.mjs'),path.join(out,'pdf.worker.min.mjs'));for(const folder of ['standard_fonts','cmaps','wasm'])cpSync(path.join(pdf,folder),path.join(out,folder),{recursive:true});copyFileSync(path.join(pdf,'LICENSE'),path.join(out,'PDFJS-LICENSE'));
console.log('Local PDF assets prepared.');
