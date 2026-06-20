function parseContentDisposition(value) {
  const result = {};
  const pieces = String(value || '').split(';').map((piece) => piece.trim());
  result.type = pieces.shift() || '';
  for (const piece of pieces) {
    const [key, rawValue] = piece.split('=');
    if (!key || rawValue === undefined) continue;
    result[key] = rawValue.replace(/^"|"$/g, '');
  }
  return result;
}

function parseMultipart(buffer, contentType) {
  const match = /boundary=([^;]+)/i.exec(contentType || '');
  if (!match) {
    throw Object.assign(new Error('Multipart boundary is missing.'), { status: 400 });
  }

  const boundary = `--${match[1].replace(/^"|"$/g, '')}`;
  const raw = buffer.toString('latin1');
  const chunks = raw.split(boundary).slice(1, -1);
  const fields = {};
  const files = [];

  for (let chunk of chunks) {
    if (chunk.startsWith('\r\n')) chunk = chunk.slice(2);
    const headerEnd = chunk.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;

    const headerText = chunk.slice(0, headerEnd);
    let content = Buffer.from(chunk.slice(headerEnd + 4), 'latin1');
    if (content.length >= 2 && content.at(-2) === 13 && content.at(-1) === 10) {
      content = content.subarray(0, -2);
    }

    const headers = {};
    for (const line of headerText.split('\r\n')) {
      const separator = line.indexOf(':');
      if (separator === -1) continue;
      headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
    }

    const disposition = parseContentDisposition(headers['content-disposition']);
    if (!disposition.name) continue;
    if (disposition.filename) {
      files.push({
        fieldName: disposition.name,
        filename: disposition.filename,
        mimeType: headers['content-type'] || 'application/octet-stream',
        content
      });
    } else {
      fields[disposition.name] = content.toString('utf8');
    }
  }

  return { fields, files };
}

module.exports = {
  parseMultipart
};
