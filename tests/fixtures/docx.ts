import archiver from 'archiver';

/**
 * Builds a minimal, valid DOCX in memory containing a paragraph, one inline
 * PNG image (relationship rId1), and a closing paragraph — the fixture for
 * image-extraction tests (specs/005 FR-008).
 */
export async function buildDocxWithImage(png: Buffer): Promise<Buffer> {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    <w:p><w:r><w:t>Chapter one with an image below. This opening paragraph introduces the worked example and explains why the figure matters for the rest of the chapter, giving the learner enough context to read it.</w:t></w:r></w:p>
    <w:p><w:r><w:drawing>
      <wp:inline>
        <wp:extent cx="952500" cy="952500"/>
        <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:pic>
            <pic:nvPicPr><pic:cNvPr id="1" name="image1"/><pic:cNvPicPr/></pic:nvPicPr>
            <pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
            <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="952500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
          </pic:pic>
        </a:graphicData></a:graphic>
      </wp:inline>
    </w:drawing></w:r></w:p>
    <w:p><w:r><w:t>Closing paragraph after the image. It restates the main takeaway, connects the figure back to the theory, and transitions into the next section of the lesson material.</w:t></w:r></w:p>
  </w:body>
</w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`;

  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { store: true });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    archive.append(contentTypes, { name: '[Content_Types].xml' });
    archive.append(rootRels, { name: '_rels/.rels' });
    archive.append(documentRels, { name: 'word/_rels/document.xml.rels' });
    archive.append(document, { name: 'word/document.xml' });
    archive.append(png, { name: 'word/media/image1.png' });
    void archive.finalize();
  });
}
