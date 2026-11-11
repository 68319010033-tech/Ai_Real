import Papa from 'papaparse'

// หัวคอลัมน์ตาม DataIndex หน้า 3–4
export const TABLES = {
    teacher: ['teacher_id', 'teacher_name', 'role'],
    room: ['room_id', 'room_name', 'room_type'],
    student_group: ['group_id', 'group_name', 'student_count', 'advisor'],
    subject: ['subject_id', 'subject_name', 'theory', 'practice', 'credit'],
    teach: ['teacher_id', 'subject_id'],
    register: ['group_id', 'subject_id'],
    timeslot: ['timeslot_id', 'day', 'period', 'start', 'end'],
}

const clean = (v) => (v == null ? '' : String(v))

function detectTable(headers) {
    let best = null
    for (const [name, cols] of Object.entries(TABLES)) {
        if (cols.every((c) => headers.includes(c)) && (!best || cols.length > TABLES[best].length)) best = name
    }
    return best
}

function toTable(grid, file, sheet) {
    const headers = (grid[0] || []).map((h) => clean(h).trim())
    const rows = []
    grid.slice(1).forEach((r, i) => {
        const cells = Array.from(r || []).map(clean)
        if (cells.every((c) => c.trim() === '')) return // ข้ามแถวว่าง แต่เลขแถวยังตรงกับไฟล์
        const o = { _row: i + 2 }
        headers.forEach((h, j) => { if (h) o[h] = cells[j] ?? '' })
        rows.push(o)
    })
    return { file, sheet, headers, rows, table: detectTable(headers) }
}

export async function readCsv(file) {
    const text = (await file.text()).replace(/^\uFEFF/, '')
    const res = Papa.parse(text, { header: false, skipEmptyLines: false })
    return [toTable(res.data, file.name, null)]
}

function cellText(v) {
    if (v instanceof Date) return v.toISOString()
    if (v && typeof v === 'object') {
        if ('result' in v) return clean(v.result)
        if (v.richText) return v.richText.map((t) => t.text).join('')
        if (v.text) return clean(v.text)
    }
    return clean(v)
}

export async function readXlsx(file) {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await file.arrayBuffer())
    return wb.worksheets.map((ws) => {
        const grid = []
        ws.eachRow({ includeEmpty: true }, (row, n) => {
            grid[n - 1] = Array.from(row.values).slice(1).map(cellText)
        })
        return toTable(grid, file.name, ws.name)
    })
}

export async function readFiles(files) {
    const out = []
    for (const f of files) {
        const ext = f.name.split('.').pop().toLowerCase()
        out.push(...(ext === 'xlsx' ? await readXlsx(f) : await readCsv(f)))
    }
    return out // [{file, sheet, headers, rows, table}]
}

const isNat = (s) => /^\d+(\.0+)?$/.test(s.trim())


// สร้างไฟล์ CSV 7 ตารางจากข้อมูลที่แก้แล้ว (ไม่ใส่คอลัมน์ _row)
export function buildCsvFiles(tables) {
    return Object.keys(TABLES)
        .filter((name) => tables[name])
        .map((name) => {
            const cols = TABLES[name]
            const data = tables[name].rows.map((r) => cols.map((c) => r[c] ?? ''))
            const text = Papa.unparse({ fields: cols, data })
            return new File(['\uFEFF' + text], `${name}.csv`, { type: 'text/csv' })
        })
}

// tables = { teacher: {file, sheet, rows}, ... } (หนึ่งตารางต่อชื่อ)
export function validate(tables) {
    const issues = []
    const add = (severity, code, tb, row, column, message) =>
        issues.push({ severity, code, file: tb?.file ?? '-', sheet: tb?.sheet ?? '-', row: row ?? '-', column: column ?? '-', message })

    for (const name of Object.keys(TABLES))
        if (!tables[name]) add('error', 'SCHEMA_INVALID', null, null, null, `ไม่พบตาราง ${name}`)

    const pk = { teacher: 'teacher_id', room: 'room_id', student_group: 'group_id', subject: 'subject_id', timeslot: 'timeslot_id' }
    const ids = {}
    for (const [name, col] of Object.entries(pk)) {
        const tb = tables[name]
        if (!tb) continue
        ids[name] = new Set()
        const seen = new Map()
        for (const r of tb.rows) {
            const id = (r[col] ?? '').trim()
            if (!id) { add('error', 'SCHEMA_INVALID', tb, r._row, col, 'ไม่มีรหัส'); continue }
            if (id.includes('?')) add('warning', 'SCHEMA_INVALID', tb, r._row, col, 'ค่าเป็น placeholder (ยังไม่มีรหัสจริง)')
            const sig = TABLES[name].map((h) => r[h] ?? '').join('\u0001')
            if (seen.has(id)) {
                if (seen.get(id) === sig) add('warning', 'SCHEMA_INVALID', tb, r._row, col, `แถวซ้ำทุกคอลัมน์ (รหัส ${id})`)
                else add('error', 'SCHEMA_INVALID', tb, r._row, col, `รหัส ${id} ซ้ำแต่ข้อมูลไม่ตรงกัน`)
            } else seen.set(id, sig)
            ids[name].add(id)
        }
    }

    const refs = [
        ['teach', 'teacher_id', 'teacher'], ['teach', 'subject_id', 'subject'],
        ['register', 'group_id', 'student_group'], ['register', 'subject_id', 'subject'],
    ]
    for (const [name, col, ref] of refs) {
        const tb = tables[name]
        if (!tb || !ids[ref]) continue
        for (const r of tb.rows) {
            const v = (r[col] ?? '').trim()
            if (!v) add('error', 'SCHEMA_INVALID', tb, r._row, col, 'ไม่มีรหัส')
            else if (!ids[ref].has(v)) add('error', 'UNKNOWN_REFERENCE', tb, r._row, col, `ไม่พบ ${v} ในตาราง ${ref}`)
        }
    }
    for (const name of ['teach', 'register']) {
        const tb = tables[name]
        if (!tb) continue
        const seen = new Set()
        for (const r of tb.rows) {
            const k = TABLES[name].map((h) => (r[h] ?? '').trim()).join('|')
            if (seen.has(k)) add('warning', 'SCHEMA_INVALID', tb, r._row, null, `คู่ซ้ำ ${k}`)
            seen.add(k)
        }
    }

    const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
    const nums = { subject: ['theory', 'practice', 'credit'], timeslot: ['period'], student_group: ['student_count'] }
    for (const [name, cols] of Object.entries(nums)) {
        const tb = tables[name]
        if (!tb) continue
        for (const r of tb.rows) for (const c of cols)
            if (!isNat(r[c] ?? '')) add('error', 'SCHEMA_INVALID', tb, r._row, c, 'ต้องเป็นจำนวนเต็มไม่ติดลบ')
    }

    if (tables.timeslot) {
        for (const r of tables.timeslot.rows)
            if (!DAYS.includes((r.day ?? '').trim()))
                add('error', 'SCHEMA_INVALID', tables.timeslot, r._row, 'day', 'วันต้องเป็น Mon–Fri')
    }

    if (tables.timeslot) {
        const seen = new Set()
        for (const r of tables.timeslot.rows) {
            const k = `${r.day}-${r.period}`
            if (seen.has(k)) add('error', 'SCHEMA_INVALID', tables.timeslot, r._row, 'period', `วัน-คาบซ้ำ ${k}`)
            seen.add(k)
        }
    }
    return issues
}