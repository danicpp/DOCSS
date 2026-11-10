const { marked } = require('marked');
const mammoth = require('mammoth');

const SUPPORTED = ['.txt', '.md', '.docx'];

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function extOf(name = '') {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i).toLowerCase();
}

/** Convert an uploaded file buffer into (unsanitized) HTML. Caller must sanitize. */
async function fileToHtml(originalname, buffer) {
  const ext = extOf(originalname);
  if (!SUPPORTED.includes(ext)) {
    const err = new Error(`Unsupported file type "${ext || 'unknown'}". Supported: ${SUPPORTED.join(', ')}`);
    err.status = 400;
    throw err;
  }
  if (ext === '.docx') {
    try {
      const { value } = await mammoth.convertToHtml({ buffer });
      return value;
    } catch {
      const err = new Error('Could not read this .docx file');
      err.status = 400;
      throw err;
    }
  }
  const text = buffer.toString('utf8');
  if (ext === '.md') return marked.parse(text);
  // .txt: blank-line separated paragraphs, single newlines become <br>
  return text
    .split(/\r?\n\s*\r?\n/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\r?\n/g, '<br>')}</p>`)
    .join('');
}

const titleFromFilename = (name) =>
  (name || 'Imported document').replace(/\.[^.]+$/, '').slice(0, 200) || 'Imported document';

module.exports = { fileToHtml, titleFromFilename, SUPPORTED };
