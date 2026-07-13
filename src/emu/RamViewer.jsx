import React, { useEffect, useRef, useState } from "react";

const ROWS = 16, COLS = 16;   // 256 bytes visible per page

/**
 * Live RAM hex view for the debugger. Polls the host's system RAM (~10Hz while
 * running) and renders a 256-byte page as hex + ASCII. Click a byte to edit it
 * (writes straight into the running machine's RAM). `host` is a GameTankHost or
 * null.
 */
export function RamViewer({ host }) {
  const [base, setBase] = useState(0);
  const [bytes, setBytes] = useState(new Uint8Array(0));
  const [size, setSize] = useState(0);
  const [edit, setEdit] = useState(null);    // { addr, value } while editing
  const editRef = useRef(null);

  // poll RAM while a host is attached
  useEffect(() => {
    if (!host) { setBytes(new Uint8Array(0)); setSize(0); return; }
    setSize(host.ramSize());
    let raf = 0;
    const tick = () => {
      const page = host.readRam(base, ROWS * COLS);
      setBytes(page);
      raf = requestAnimationFrame(() => setTimeout(tick, 100));   // ~10Hz
    };
    tick();
    return () => { cancelAnimationFrame(raf); };
  }, [host, base]);

  useEffect(() => { if (edit && editRef.current) editRef.current.select(); }, [edit]);

  if (!host) return <div className="ram-empty">run a game to inspect its RAM</div>;

  const pages = Math.max(1, Math.ceil(size / (ROWS * COLS)));
  const pageIndex = Math.floor(base / (ROWS * COLS));

  const commitEdit = () => {
    if (!edit) return;
    const v = parseInt(edit.value, 16);
    if (!Number.isNaN(v)) host.writeRam(edit.addr, v & 0xff);
    setEdit(null);
  };

  return (
    <div className="ram">
      <div className="ram-nav">
        <button onClick={() => setBase(Math.max(0, base - ROWS * COLS))} disabled={base === 0}>◀</button>
        <span className="ram-addr">${base.toString(16).padStart(4, "0").toUpperCase()}</span>
        <button onClick={() => setBase(Math.min((pages - 1) * ROWS * COLS, base + ROWS * COLS))} disabled={pageIndex >= pages - 1}>▶</button>
        <span className="ram-size">{size ? `${size} B RAM` : "no RAM"}</span>
      </div>
      <div className="ram-grid">
        {Array.from({ length: ROWS }, (_, r) => {
          const rowAddr = base + r * COLS;
          return (
            <div key={r} className="ram-row">
              <span className="ram-rowaddr">{rowAddr.toString(16).padStart(4, "0").toUpperCase()}</span>
              <span className="ram-hex">
                {Array.from({ length: COLS }, (_, c) => {
                  const addr = rowAddr + c;
                  const b = bytes[r * COLS + c];
                  if (b === undefined) return <span key={c} className="ram-byte dim">··</span>;
                  if (edit && edit.addr === addr) {
                    return <input key={c} ref={editRef} className="ram-edit" value={edit.value}
                      maxLength={2} onChange={(e) => setEdit({ addr, value: e.target.value.replace(/[^0-9a-fA-F]/g, "") })}
                      onBlur={commitEdit} onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEdit(null); }} />;
                  }
                  return <span key={c} className={"ram-byte" + (b ? "" : " zero")}
                    onClick={() => setEdit({ addr, value: b.toString(16).padStart(2, "0") })}
                    title={`$${addr.toString(16).padStart(4, "0")} = ${b} (click to edit)`}>
                    {b.toString(16).padStart(2, "0").toUpperCase()}
                  </span>;
                })}
              </span>
              <span className="ram-ascii">
                {Array.from({ length: COLS }, (_, c) => {
                  const b = bytes[r * COLS + c];
                  const ch = b >= 32 && b < 127 ? String.fromCharCode(b) : ".";
                  return <span key={c} className={b ? "" : "dim"}>{b === undefined ? " " : ch}</span>;
                })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
