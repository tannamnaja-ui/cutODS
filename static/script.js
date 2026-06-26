const btnImport = document.getElementById("btnImport");
const fileInputFallback = document.getElementById("fileInputFallback");
const fileLabel = document.getElementById("fileLabel");
const btnCut = document.getElementById("btnCut");
const btnExport = document.getElementById("btnExport");
const statusEl = document.getElementById("status");
const tableHead = document.getElementById("tableHead");
const tableBody = document.getElementById("tableBody");

const supportsFileSystemAccess = "showOpenFilePicker" in window;

let workId = null;
let fields = [];
let importFileName = null;
let importFileHandle = null; // ใช้เปิด save dialog ใน folder เดิมของไฟล์นำเข้า

function setStatus(msg, cls) {
  statusEl.textContent = msg;
  statusEl.className = "status" + (cls ? " " + cls : "");
}

function renderTable(rows) {
  tableHead.innerHTML = "";
  fields.forEach((f) => {
    const th = document.createElement("th");
    th.textContent = f;
    if (f.toUpperCase() === "AN") th.classList.add("an-col");
    tableHead.appendChild(th);
  });

  tableBody.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    fields.forEach((f) => {
      const td = document.createElement("td");
      td.textContent = row[f] ?? "";
      if (f.toUpperCase() === "AN") td.classList.add("an-col");
      tr.appendChild(td);
    });
    tableBody.appendChild(tr);
  });
}

async function handleImportedFile(file) {
  fileLabel.textContent = file.name;
  setStatus("กำลังนำเข้าไฟล์...");
  btnCut.disabled = true;
  btnExport.disabled = true;

  const formData = new FormData();
  formData.append("file", file);

  try {
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) {
      setStatus(data.error || "เกิดข้อผิดพลาด", "error");
      return;
    }

    workId = data.work_id;
    fields = data.fields;
    importFileName = data.filename;
    renderTable(data.rows);

    let msg = `นำเข้าไฟล์ "${data.filename}" สำเร็จ — ทั้งหมด ${data.total_records} เรคคอร์ด`;
    if (data.total_records > data.preview_limit) {
      msg += ` (แสดงตัวอย่าง ${data.preview_limit} แถวแรก ส่วนการตัด ODS/ส่งออกจะทำกับข้อมูลทั้งหมด)`;
    }
    if (!data.an_field_found) {
      msg += "\nคำเตือน: ไม่พบฟิลด์ AN ในไฟล์นี้";
      setStatus(msg, "error");
      btnCut.disabled = true;
    } else {
      setStatus(msg, "ok");
      btnCut.disabled = false;
    }
    btnExport.disabled = false;
  } catch (err) {
    setStatus("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ: " + err, "error");
  }
}

btnImport.addEventListener("click", async () => {
  if (supportsFileSystemAccess) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: "DBF File", accept: { "application/octet-stream": [".dbf"] } }],
      });
      importFileHandle = handle;
      const file = await handle.getFile();
      await handleImportedFile(file);
    } catch (err) {
      if (err.name !== "AbortError") {
        setStatus("เลือกไฟล์ไม่สำเร็จ: " + err, "error");
      }
    }
  } else {
    fileInputFallback.click();
  }
});

fileInputFallback.addEventListener("change", async () => {
  const file = fileInputFallback.files[0];
  if (!file) return;
  importFileHandle = null; // ไม่สามารถจดจำ folder เดิมได้ในเบราว์เซอร์นี้
  await handleImportedFile(file);
});

btnCut.addEventListener("click", async () => {
  if (!workId) return;
  setStatus("กำลังตัดคำว่า ODS ...");
  try {
    const res = await fetch(`/api/cut/${workId}`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setStatus(data.error || "เกิดข้อผิดพลาด", "error");
      return;
    }
    renderTable(data.rows);
    setStatus(`ตัดคำว่า ODS สำเร็จ แก้ไขแล้ว ${data.changed_count} เรคคอร์ด จากทั้งหมด ${data.total_records} เรคคอร์ด`, "ok");
  } catch (err) {
    setStatus("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ: " + err, "error");
  }
});

btnExport.addEventListener("click", async () => {
  if (!workId) return;

  if (supportsFileSystemAccess) {
    try {
      const pickerOpts = {
        suggestedName: importFileName,
        types: [{ description: "DBF File", accept: { "application/octet-stream": [".dbf"] } }],
      };
      if (importFileHandle) pickerOpts.startIn = importFileHandle;

      const saveHandle = await window.showSaveFilePicker(pickerOpts);
      const res = await fetch(`/api/export/${workId}`);
      if (!res.ok) {
        setStatus("ส่งออกไฟล์ไม่สำเร็จ", "error");
        return;
      }
      const blob = await res.blob();
      const writable = await saveHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      setStatus(`บันทึกไฟล์ "${saveHandle.name}" สำเร็จ`, "ok");
    } catch (err) {
      if (err.name !== "AbortError") {
        setStatus("บันทึกไฟล์ไม่สำเร็จ: " + err, "error");
      }
    }
  } else {
    window.location.href = `/api/export/${workId}`;
  }
});
