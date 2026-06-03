import { useState, useCallback } from "react";
import * as XLSX from "xlsx";

// ─── CSV column definitions per type ─────────────────────────────────────────

const STATUS_COLS = [
  "ITEM","FEEDER_NAME","BAY_NAME","SPECIFICATION_POINT_NAME","SPECIFICATION_DESCRIPTOR",
  "STATE_0","STATE_1","STATE_2","STATE_3",
  "DNP3.0_OBJ","DNP3.0_VAR","DNP3.0_QII","DNP3.0_CLASS","DNP3.0_TYPE","DNP3.0_ADDRESS",
  "REMARK","NOTE","BAY_PROT.&BCU_NAME","IEC61850_PROT.&BCU_REFERENCE","BRCB/URCB"
];

const CONTROL_COLS = [
  "ITEM","FEEDER_NAME","BAY_NAME","SPECIFICATION_POINT_NAME","SPECIFICATION_DESCRIPTOR",
  "STATE_CLOSE","STATE_TRIP",
  "DNP3.0_OBJ","DNP3.0_VAR","DNP3.0_QII","DNP3.0_CLASS","DNP3.0_TYPE","DNP3.0_ADDRESS",
  "REMARK","NOTE","BAY_PROT.&BCU_NAME","IEC61850_PROT.&BCU_REFERENCE","BRCB/URCB"
];

const ANALOG_COLS = [
  "ITEM","FEEDER_NAME","BAY_NAME","SPECIFICATION_POINT_NAME","SPECIFICATION_DESCRIPTOR",
  "SPECIFICATION_UNIT","SCALE_ACTUAL_DATA","SCALE_RAW_DATA",
  "DNP3.0_OBJ","DN3.0_VAR","DNP3.0_QII","DNP3.0_CLASS","DNP3.0_TYPE","DNP3.0_ADDRESS",
  "REMARK","NOTE","BAY_PROT.&BCU_NAME","IEC61850_PROT.&BCU_REFERENCE","BRCB/URCB"
];

// ─── Parse helpers ────────────────────────────────────────────────────────────

function isSection(val, keyword) {
  return val && typeof val === "string" && val.trim().toUpperCase().includes(keyword.toUpperCase());
}

function cleanVal(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function csvRow(arr) {
  return arr.map(v => {
    const s = String(v == null ? "" : v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",");
}

function toCsv(cols, rows) {
  return [csvRow(cols), ...rows.map(r => csvRow(r))].join("\r\n");
}

// Extract a section from rows starting after a marker row.
// Returns array of data rows until the next section header or end.
function extractSection(allRows, startIdx, type) {
  // skip 3 header rows after section label
  const dataStart = startIdx + 4;
  const results = [];

  for (let i = dataStart; i < allRows.length; i++) {
    const row = allRows[i];
    const first = row[0];
    // stop at next section or end
    if (first && typeof first === "string" &&
        (isSection(first, "STATUS") || isSection(first, "CONTROL") || isSection(first, "ANALOG") || isSection(first, "ALARM"))) {
      break;
    }
    // skip if not a numbered data row
    if (!first || typeof first !== "number") continue;

    const r = row;
    if (type === "status") {
      results.push([
        r[0], cleanVal(r[1]), cleanVal(r[2]), cleanVal(r[3]), cleanVal(r[4]),
        cleanVal(r[5]), cleanVal(r[6]), cleanVal(r[7]), cleanVal(r[8]),
        cleanVal(r[9]), cleanVal(r[10]), cleanVal(r[11]), cleanVal(r[12]), cleanVal(r[13]), cleanVal(r[14]),
        cleanVal(r[15]), cleanVal(r[17]),
        cleanVal(r[25]), cleanVal(r[26]), cleanVal(r[27])
      ]);
    } else if (type === "control") {
      results.push([
        r[0], cleanVal(r[1]), cleanVal(r[2]), cleanVal(r[3]), cleanVal(r[4]),
        cleanVal(r[5]), cleanVal(r[7]),
        cleanVal(r[9]), cleanVal(r[10]), cleanVal(r[11]), cleanVal(r[12]), cleanVal(r[13]), cleanVal(r[14]),
        cleanVal(r[15]), cleanVal(r[17]),
        cleanVal(r[25]), cleanVal(r[26]), cleanVal(r[27])
      ]);
    } else if (type === "analog") {
      results.push([
        r[0], cleanVal(r[1]), cleanVal(r[2]), cleanVal(r[3]), cleanVal(r[4]),
        cleanVal(r[5]), cleanVal(r[6]), cleanVal(r[7]),
        cleanVal(r[9]), cleanVal(r[10]), cleanVal(r[11]), cleanVal(r[12]), cleanVal(r[13]), cleanVal(r[14]),
        cleanVal(r[15]), cleanVal(r[17]),
        cleanVal(r[25]), cleanVal(r[26]), cleanVal(r[27])
      ]);
    }
  }
  return results;
}

function processSheet(ws, sheetName) {
  const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  const outputs = { status: [], control: [], analog: [] };

  for (let i = 0; i < allRows.length; i++) {
    const first = allRows[i][0];
    if (isSection(first, "STATUS POINT")) {
      outputs.status.push(...extractSection(allRows, i, "status"));
    } else if (isSection(first, "CONTROL OUTPUT")) {
      outputs.control.push(...extractSection(allRows, i, "control"));
    } else if (isSection(first, "ANALOG POINT")) {
      outputs.analog.push(...extractSection(allRows, i, "analog"));
    }
  }
  return outputs;
}

function slugify(name) {
  return name.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

// ─── UI ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [file, setFile] = useState(null);
  const [sheets, setSheets] = useState([]);
  const [selected, setSelected] = useState([]);
  const [results, setResults] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);

  const loadFile = useCallback((f) => {
    setFile(f);
    setResults(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const wb = XLSX.read(e.target.result, { type: "array" });
      const valid = wb.SheetNames.filter(n => n !== "COVER" && n !== "PROJ_DESC" && n !== "IP_ADDRESS");
      setSheets(valid);
      setSelected(valid);
    };
    reader.readAsArrayBuffer(f);
  }, []);

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) loadFile(f);
  };

  const onFileInput = (e) => {
    if (e.target.files[0]) loadFile(e.target.files[0]);
  };

  const toggleSheet = (name) => {
    setSelected(prev =>
      prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name]
    );
  };

  const extract = () => {
    if (!file || selected.length === 0) return;
    setProcessing(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      const wb = XLSX.read(e.target.result, { type: "array" });
      const allStatus = [], allControl = [], allAnalog = [];
      const perSheet = {};

      selected.forEach(name => {
        if (!wb.Sheets[name]) return;
        const out = processSheet(wb.Sheets[name], name);
        allStatus.push(...out.status);
        allControl.push(...out.control);
        allAnalog.push(...out.analog);
        perSheet[name] = out;
      });

      setResults({ allStatus, allControl, allAnalog, perSheet });
      setProcessing(false);
    };
    reader.readAsArrayBuffer(file);
  };

  const downloadCsv = (content, filename) => {
    const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAll = () => {
    if (!results) return;
    if (results.allStatus.length)
      downloadCsv(toCsv(STATUS_COLS, results.allStatus), "ALL_Status_point.csv");
    if (results.allControl.length)
      downloadCsv(toCsv(CONTROL_COLS, results.allControl), "ALL_Control_output.csv");
    if (results.allAnalog.length)
      downloadCsv(toCsv(ANALOG_COLS, results.allAnalog), "ALL_Analog_point.csv");
  };

  const downloadSheet = (name) => {
    if (!results?.perSheet[name]) return;
    const d = results.perSheet[name];
    const slug = slugify(name);
    if (d.status.length)
      downloadCsv(toCsv(STATUS_COLS, d.status), `${slug}_Status_point.csv`);
    if (d.control.length)
      downloadCsv(toCsv(CONTROL_COLS, d.control), `${slug}_Control_output.csv`);
    if (d.analog.length)
      downloadCsv(toCsv(ANALOG_COLS, d.analog), `${slug}_Analog_point.csv`);
  };

  const counts = results ? {
    status: results.allStatus.length,
    control: results.allControl.length,
    analog: results.allAnalog.length,
  } : null;

  return (
    <div style={{
      minHeight: "100vh", background: "#0f1117", color: "#e2e8f0",
      fontFamily: "'DM Mono', 'Courier New', monospace", padding: "32px 24px"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
        * { box-sizing: border-box; }
        .btn { cursor: pointer; border: none; border-radius: 6px; font-family: inherit; font-size: 13px; font-weight: 500; transition: all .15s; }
        .btn:hover { filter: brightness(1.15); }
        .btn:active { transform: scale(.97); }
        .chip { display:inline-flex; align-items:center; gap:6px; padding:5px 12px; border-radius:20px; font-size:12px; cursor:pointer; border:1.5px solid transparent; transition:all .15s; user-select:none; }
        .chip.on { background:#1e3a5f; border-color:#3b82f6; color:#93c5fd; }
        .chip.off { background:#1a1d27; border-color:#2d3148; color:#64748b; }
        .chip:hover { filter:brightness(1.2); }
        .card { background:#161926; border:1px solid #252840; border-radius:12px; padding:20px; }
        .stat-pill { background:#0f2744; border:1px solid #1e4b8a; border-radius:8px; padding:10px 18px; text-align:center; }
        .row-result { display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-radius:8px; background:#1a1e2e; border:1px solid #252840; margin-bottom:8px; }
        .zone-badge { font-size:11px; padding:3px 8px; border-radius:4px; background:#1c2d45; color:#60a5fa; border:1px solid #2563eb33; }
        .download-btn { background:#1e3a5f; color:#60a5fa; padding:6px 14px; border-radius:6px; font-size:12px; }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 26, fontWeight: 800, color: "#f8fafc", letterSpacing: "-0.5px" }}>
          IO POINT EXTRACTOR
        </div>
        <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
          115 kV SCPS H Scheme · Excel → CSV Converter
        </div>
      </div>

      {/* Drop zone */}
      <div
        className="card"
        onDrop={onDrop}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        style={{
          border: dragging ? "2px dashed #3b82f6" : "2px dashed #252840",
          background: dragging ? "#0f1f3d" : "#161926",
          textAlign: "center", padding: "36px 20px", cursor: "pointer", marginBottom: 20,
          transition: "all .2s"
        }}
        onClick={() => document.getElementById("fileInput").click()}
      >
        <input id="fileInput" type="file" accept=".xlsx" style={{ display: "none" }} onChange={onFileInput} />
        <div style={{ fontSize: 32, marginBottom: 10 }}>📊</div>
        <div style={{ color: file ? "#60a5fa" : "#94a3b8", fontSize: 14, fontWeight: 500 }}>
          {file ? `✓ ${file.name}` : "Drop .xlsx file here or click to browse"}
        </div>
        {!file && <div style={{ color: "#475569", fontSize: 12, marginTop: 6 }}>Supports I/O Point List standard format</div>}
      </div>

      {/* Sheet selector */}
      {sheets.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Select Sheets · {selected.length}/{sheets.length} selected
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
            {sheets.map(name => (
              <div key={name} className={`chip ${selected.includes(name) ? "on" : "off"}`} onClick={() => toggleSheet(name)}>
                {selected.includes(name) ? "✓" : "○"} {name}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" style={{ background: "#1e3a5f", color: "#60a5fa", padding: "6px 14px" }}
              onClick={() => setSelected([...sheets])}>Select All</button>
            <button className="btn" style={{ background: "#1a1d27", color: "#64748b", padding: "6px 14px" }}
              onClick={() => setSelected([])}>Clear</button>
          </div>
        </div>
      )}

      {/* Extract button */}
      {sheets.length > 0 && (
        <button className="btn" disabled={processing || selected.length === 0}
          onClick={extract}
          style={{
            width: "100%", padding: "14px", fontSize: 14, fontWeight: 600,
            background: processing ? "#1a2540" : "linear-gradient(135deg, #1d4ed8, #1e40af)",
            color: processing ? "#475569" : "#fff", marginBottom: 24,
            border: "none", borderRadius: 8
          }}>
          {processing ? "⟳  Extracting..." : `⚡  Extract ${selected.length} Sheet${selected.length !== 1 ? "s" : ""}`}
        </button>
      )}

      {/* Results */}
      {results && (
        <div>
          {/* Summary stats */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
            {[
              { label: "Status Points", count: counts.status, color: "#22d3ee" },
              { label: "Control Outputs", count: counts.control, color: "#a78bfa" },
              { label: "Analog Points", count: counts.analog, color: "#34d399" },
            ].map(({ label, count, color }) => (
              <div key={label} className="stat-pill">
                <div style={{ fontSize: 24, fontWeight: 700, color, fontFamily: "'Syne', sans-serif" }}>{count}</div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Download all */}
          <button className="btn" onClick={downloadAll}
            style={{
              width: "100%", padding: "12px", fontSize: 13, fontWeight: 600,
              background: "linear-gradient(135deg, #065f46, #047857)", color: "#6ee7b7",
              border: "1px solid #065f46", borderRadius: 8, marginBottom: 20
            }}>
            ⬇  Download All CSVs (merged across sheets)
          </button>

          {/* Per-sheet downloads */}
          <div className="card">
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 14, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Per-Sheet Downloads
            </div>
            {selected.map(name => {
              const d = results.perSheet[name];
              if (!d) return null;
              const total = d.status.length + d.control.length + d.analog.length;
              return (
                <div key={name} className="row-result">
                  <div>
                    <div style={{ fontSize: 13, color: "#cbd5e1" }}>{name}</div>
                    <div style={{ fontSize: 11, color: "#475569", marginTop: 3 }}>
                      {d.status.length} status · {d.control.length} control · {d.analog.length} analog
                    </div>
                  </div>
                  <button className="btn download-btn" onClick={() => downloadSheet(name)}
                    disabled={total === 0} style={{ opacity: total === 0 ? 0.4 : 1 }}>
                    ⬇ CSV{total > 0 ? `s (${total})` : ""}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
