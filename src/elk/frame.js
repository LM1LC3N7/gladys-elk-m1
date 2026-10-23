// -----------------------------------------------------------------------------
// The ASCII framing of the ELK M1 protocol, ported from elkm1-lib 2.2.15
// (MIT, see THIRD_PARTY_NOTICES.md), `message.py` and `connection.py`:
//
//   LLMM<data>00CC\r\n
//   LL   length in ASCII hex: every character after LL, the checksum included
//   MM   message code (upper case from the panel, lower case to it)
//   00   two reserved characters
//   CC   checksum: the sum of every character before it, plus CC, is 0 mod 256
//
// The reader cuts the stream into lines in one linear pass, bounded: a line
// longer than LIMITS.maxLine is dropped, never kept growing.
// -----------------------------------------------------------------------------

import { LIMITS } from '../constants.js';

const HEX2 = /^[0-9A-F]{2}$/;

/** The two hex digits that close `body` (elkm1-lib `_write_stream`). */
export function checksum(body) {
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) sum = (sum + body.charCodeAt(i)) & 0xff;
  return ((256 - sum) % 256).toString(16).toUpperCase().padStart(2, '0');
}

/**
 * A request line: `code` (two lower-case letters) and its data; the length,
 * the reserved 00 and the checksum are added. Returns the text without CR LF.
 */
export function makeLine(code, data = '') {
  const rest = `${code}${data}00`;
  const length = (rest.length + 2).toString(16).toUpperCase().padStart(2, '0');
  const body = `${length}${rest}`;
  return `${body}${checksum(body)}`;
}

/**
 * Checks the length and the checksum of a received line (elkm1-lib
 * `_is_valid_length_and_checksum`). Returns { code, line } or undefined.
 */
export function parseLine(line) {
  if (typeof line !== 'string' || line.length < 6 || line.length > LIMITS.maxLine) return undefined;
  const length = line.slice(0, 2);
  const sum = line.slice(-2);
  if (!HEX2.test(length) || !HEX2.test(sum)) return undefined;
  if (Number.parseInt(length, 16) !== line.length - 2) return undefined;
  let total = 0;
  for (let i = 0; i < line.length - 2; i += 1) total = (total + line.charCodeAt(i)) & 0xff;
  if ((total + Number.parseInt(sum, 16)) % 256 !== 0) return undefined;
  return { code: line.slice(2, 4), line };
}

/**
 * Cuts a byte stream into lines (CR LF, or LF alone). Bytes are read as
 * ISO-8859-1, as elkm1-lib does: a name may carry a high bit. A partial line
 * over the limit is dropped (`onDrop('line too long')`) and the rest of it,
 * up to the next line end, is skipped.
 */
export class LineReader {
  constructor({ onLine, onDrop = () => undefined, max = LIMITS.maxLine } = {}) {
    this.onLine = onLine;
    this.onDrop = onDrop;
    this.max = max;
    this.partial = '';
    this.skipping = false;
  }

  push(chunk) {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('latin1') : String(chunk);
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
      if (text.charCodeAt(i) !== 0x0a) continue;
      this.end(text.slice(start, i));
      start = i + 1;
    }
    this.add(text.slice(start));
  }

  /** Text without a line end yet: kept, bounded. */
  add(piece) {
    if (piece === '' || this.skipping) return;
    if (this.partial.length + piece.length > this.max) {
      this.partial = '';
      this.skipping = true;
      this.onDrop('line too long');
      return;
    }
    this.partial += piece;
  }

  end(piece) {
    if (this.skipping) {
      this.skipping = false;
      this.partial = '';
      return;
    }
    if (this.partial.length + piece.length > this.max) {
      this.partial = '';
      this.onDrop('line too long');
      return;
    }
    const line = (this.partial + piece).replace(/\r$/, '');
    this.partial = '';
    if (line !== '') this.onLine(line);
  }

  reset() {
    this.partial = '';
    this.skipping = false;
  }
}
