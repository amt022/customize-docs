/** Put a JPEG picture inside a one-page PDF or a Word (.docx) file, in the browser, no libraries. */

const enc = new TextEncoder();

function concat(parts: (Uint8Array | string)[]): Uint8Array {
  const bufs = parts.map((p) => (typeof p === "string" ? enc.encode(p) : p));
  const out = new Uint8Array(bufs.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of bufs) { out.set(b, o); o += b.length; }
  return out;
}

/** One page exactly the picture's size (96 px per inch), the JPEG stored as-is (DCTDecode). */
export function jpegToPdf(jpeg: Uint8Array, width: number, height: number): Blob {
  const w = +(width * 0.75).toFixed(2), h = +(height * 0.75).toFixed(2);
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
  const objs: (Uint8Array | string)[][] = [
    ["<< /Type /Catalog /Pages 2 0 R >>"],
    ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
    [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`],
    [`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, "\nendstream"],
    [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`],
  ];
  const parts: (Uint8Array | string)[] = ["%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"];
  const offsets: number[] = [];
  let pos = concat(parts).length;
  objs.forEach((o, i) => {
    offsets.push(pos);
    const chunk = concat([`${i + 1} 0 obj\n`, ...o, "\nendobj\n"]);
    parts.push(chunk);
    pos += chunk.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  parts.push(xref, `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`);
  return new Blob([concat(parts)], { type: "application/pdf" });
}

// ---------------------------------------------------------------- zip (stored)
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files: { name: string; data: Uint8Array | string }[]): Uint8Array {
  const local: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true);
    h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); // 1980-01-01
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
    h.setUint16(26, name.length, true);
    const loc = concat([new Uint8Array(h.buffer), name, data]);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
    c.setUint16(12, 0, true); c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(concat([new Uint8Array(c.buffer), name]));
    local.push(loc);
    offset += loc.length;
  }
  const cd = concat(central);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cd.length, true); e.setUint32(16, offset, true);
  return concat([...local, cd, new Uint8Array(e.buffer)]);
}

/** A Word document holding the picture at its natural size (96 px per inch), at most the text width. */
export function jpegToDocx(jpeg: Uint8Array, width: number, height: number): Blob {
  const EMU = 9525; // per pixel at 96 dpi
  const maxW = 6.5 * 914400;
  let cx = width * EMU, cy = height * EMU;
  if (cx > maxW) { cy = Math.round(cy * maxW / cx); cx = maxW; }
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const doc = X + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    + 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
    + 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    + 'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>'
    + `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Picture"/>`
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>'
    + '<pic:nvPicPr><pic:cNvPr id="1" name="image.jpg"/><pic:cNvPicPr/></pic:nvPicPr>'
    + '<pic:blipFill><a:blip r:embed="img1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
    + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
    + "</w:body></w:document>";
  const data = zip([
    { name: "[Content_Types].xml", data: X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: "_rels/.rels", data: X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: "word/_rels/document.xml.rels", data: X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="img1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image.jpg"/></Relationships>' },
    { name: "word/document.xml", data: doc },
    { name: "word/media/image.jpg", data: jpeg },
  ]);
  return new Blob([data], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}
