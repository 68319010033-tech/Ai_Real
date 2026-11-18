function parseCsv(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      if (row.some((x) => String(x).trim())) rows.push(row);
      row = [];
    } else {
      cell += c;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((x) => String(x).trim())) rows.push(row);
  }
  if (!rows.length) return [];

  const headers = rows[0].map((h) => String(h || '').trim());
  return rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = String(r[i] ?? '').trim();
    });
    return obj;
  });
}

function tableNameFromFile(filename) {
  const name = String(filename || '').toLowerCase();
  const known = ['teacher', 'room', 'student_group', 'subject', 'teach', 'register', 'timeslot'];
  return known.find((key) => name.includes(key)) || null;
}

module.exports = { parseCsv, tableNameFromFile };
