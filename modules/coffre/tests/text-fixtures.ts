// v0.47.0: real files for the text tests — a PDF written by hand (pages of
// Helvetica text, WinAnsi: accents included; a page with no text = a scan),
// Word / PowerPoint / Excel (the XML zipped by fflate).
import { strToU8, zipSync } from 'fflate';

/** A PDF whose pages hold these lines (null: a page without any text, as a scan). */
export function makePdf(pages: (string | null)[]): Buffer {
  const objs: string[] = [];
  const add = (s: string) => objs.push(s);
  const font = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  );
  const pagesId = objs.length + pages.length * 2 + 1;
  const enc = (t: string) =>
    Array.from(Buffer.from(t, 'latin1'))
      .map((b) =>
        b < 32 || b > 126 || b === 40 || b === 41 || b === 92
          ? `\\${b.toString(8).padStart(3, '0')}`
          : String.fromCharCode(b),
      )
      .join('');
  const kids: number[] = [];
  for (const p of pages) {
    // A scan: a filled rectangle (drawing, no text).
    const content =
      p === null
        ? '0.5 g 72 72 400 600 re f'
        : p
            .split('\n')
            .map((l, i) => `BT /F1 12 Tf 72 ${720 - i * 16} Td (${enc(l)}) Tj ET`)
            .join('\n');
    const c = add(
      `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    );
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${c} 0 R >>`,
      ),
    );
  }
  const pid = add(
    `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`,
  );
  if (pid !== pagesId) throw new Error('PDF mal numéroté');
  const cat = add(`<< /Type /Catalog /Pages ${pid} 0 R >>`);
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function makeDocx(paragraphs: string[]): Buffer {
  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`)
    .join('');
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
      'word/document.xml': strToU8(
        `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
      ),
    }),
  );
}

export function makePptx(slides: string[]): Buffer {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
  };
  slides.forEach((t, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = strToU8(
      `<?xml version="1.0"?><p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${esc(t)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    );
  });
  return Buffer.from(zipSync(files));
}

export function makeXlsx(strings: string[]): Buffer {
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
      'xl/sharedStrings.xml': strToU8(
        `<?xml version="1.0"?><sst>${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`,
      ),
      'xl/worksheets/sheet1.xml': strToU8(
        '<?xml version="1.0"?><worksheet><sheetData><row><c t="inlineStr"><is><t>Cellule écrite à la main</t></is></c><c><v>42</v></c></row></sheetData></worksheet>',
      ),
    }),
  );
}
