const btnImport = document.getElementById("btnImport");
const fileInputFallback = document.getElementById("fileInputFallback");
const btnCut = document.getElementById("btnCut");
const btnExportAll = document.getElementById("btnExportAll");
const statusEl = document.getElementById("status");
const filesContainer = document.getElementById("filesContainer");

const supportsFileSystemAccess = "showOpenFilePicker" in window;

// แต่ละไฟล์ที่นำเข้า: { workId, fileName, fileHandle, fields, an_field_found, card, infoEl, tableHead, tableBody, exportBtn }
let fileEntries = [];

function setStatus(msg, cls) {
  statusEl.textContent = msg;
  statusEl.className = "status" + (cls ? " " + cls : "");
}

function renderFileTable(entry, rows) {
  entry.tableHead.innerHTML = "";
  entry.fields.forEach((f) => {
    const th = document.createElement("th");
    th.textContent = f;
    if (f.toUpperCase() === "AN") th.classList.add("an-col");
    entry.tableHead.appendChild(th);
  });

  entry.tableBody.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    entry.fields.forEach((f) => {
      const td = document.createElement("td");
      td.textContent = row[f] ?? "";
      if (f.toUpperCase() === "AN") td.classList.add("an-col");
      tr.appendChild(td);
    });
    entry.tableBody.appendChild(tr);
  });
}

function createFileCard(fileName) {
  const card = document.createElement("section");
  card.className = "file-card";

  const header = document.createElement("div");
  header.className = "file-card-header";

  const nameEl = document.createElement("span");
  nameEl.className = "file-name";
  nameEl.textContent = fileName;

  const infoEl = document.createElement("span");
  infoEl.className = "file-info";
  infoEl.textContent = "กำลังนำเข้า...";

  const exportBtn = document.createElement("button");
  exportBtn.textContent = "ส่งออกเป็น DBF";
  exportBtn.disabled = true;

  header.appendChild(nameEl);
  header.appendChild(infoEl);
  header.appendChild(exportBtn);

  const tableWrap = document.createElement("div");
  tableWrap.className = "table-wrap";
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  thead.appendChild(headRow);
  const tbody = document.createElement("tbody");
  table.appendChild(thead);
  table.appendChild(tbody);
  tableWrap.appendChild(table);

  card.appendChild(header);
  card.appendChild(tableWrap);
  filesContainer.appendChild(card);

  return { card, infoEl, exportBtn, tableHead: headRow, tableBody: tbody };
}

async function importOneFile(file, fileHandle) {
  const ui = createFileCard(file.name);
  const entry = {
    workId: null,
    fileName: file.name,
    fileHandle: fileHandle || null,
    fields: [],
    an_field_found: false,
    ...ui,
  };
  fileEntries.push(entry);

  const formData = new FormData();
  formData.append("file", file);

  try {
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) {
      entry.infoEl.textContent = data.error || "เกิดข้อผิดพลาด";
      entry.infoEl.className = "file-info error";
      return;
    }

    entry.workId = data.work_id;
    entry.fields = data.fields;
    entry.an_field_found = data.an_field_found;

    if (!data.an_field_found) {
      // ไม่มีฟิลด์ AN ในไฟล์นี้ — ไม่ต้องแสดงไฟล์นี้ในรายการ
      entry.card.remove();
      const idx = fileEntries.indexOf(entry);
      if (idx !== -1) fileEntries.splice(idx, 1);
      return false;
    }

    renderFileTable(entry, data.rows);
    let msg = `${data.total_records} เรคคอร์ด`;
    if (data.total_records > data.preview_limit) {
      msg += ` (แสดงตัวอย่าง ${data.preview_limit} แถวแรก)`;
    }
    entry.infoEl.textContent = msg;
    entry.infoEl.className = "file-info ok";
    entry.exportBtn.disabled = false;
    entry.exportBtn.addEventListener("click", () => exportEntry(entry));
    return true;
  } catch (err) {
    entry.infoEl.textContent = "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ: " + err;
    entry.infoEl.className = "file-info error";
    return true;
  }
}

function finishImport(totalSelected, kept) {
  const skipped = totalSelected - kept;
  let msg = `นำเข้าไฟล์ที่มีฟิลด์ AN สำเร็จ ${kept} ไฟล์`;
  if (skipped > 0) {
    msg += ` (ข้าม ${skipped} ไฟล์ที่ไม่มีฟิลด์ AN)`;
  }
  btnCut.disabled = !fileEntries.some((e) => e.an_field_found);
  btnExportAll.disabled = fileEntries.length === 0;
  setStatus(msg, kept > 0 ? "ok" : "error");
}

btnImport.addEventListener("click", async () => {
  if (supportsFileSystemAccess) {
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [{ description: "DBF File", accept: { "application/octet-stream": [".dbf"] } }],
      });
      setStatus(`กำลังนำเข้า ${handles.length} ไฟล์...`);
      let kept = 0;
      for (const handle of handles) {
        const file = await handle.getFile();
        if (await importOneFile(file, handle)) kept++;
      }
      finishImport(handles.length, kept);
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
  const files = Array.from(fileInputFallback.files || []);
  if (!files.length) return;
  setStatus(`กำลังนำเข้า ${files.length} ไฟล์...`);
  let kept = 0;
  for (const file of files) {
    if (await importOneFile(file)) kept++;
  }
  finishImport(files.length, kept);
  fileInputFallback.value = "";
});

btnCut.addEventListener("click", async () => {
  const targets = fileEntries.filter((e) => e.workId && e.an_field_found);
  if (!targets.length) return;
  setStatus(`กำลังตัดคำว่า ODS ใน ${targets.length} ไฟล์...`);
  let totalChanged = 0;
  for (const entry of targets) {
    try {
      const res = await fetch(`/api/cut/${entry.workId}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        entry.infoEl.textContent = data.error || "เกิดข้อผิดพลาด";
        entry.infoEl.className = "file-info error";
        continue;
      }
      renderFileTable(entry, data.rows);
      totalChanged += data.changed_count;
      entry.infoEl.textContent = `${data.total_records} เรคคอร์ด — ตัด ODS แล้ว ${data.changed_count} รายการ`;
      entry.infoEl.className = "file-info ok";
    } catch (err) {
      entry.infoEl.textContent = "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ: " + err;
      entry.infoEl.className = "file-info error";
    }
  }
  setStatus(`ตัดคำว่า ODS เสร็จสิ้น — แก้ไขรวม ${totalChanged} เรคคอร์ด จาก ${targets.length} ไฟล์`, "ok");
});

function timestampFolderName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `cutODS_export_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function uniqueName(name, usedNames) {
  if (!usedNames.has(name)) {
    usedNames.add(name);
    return name;
  }
  const dotIdx = name.lastIndexOf(".");
  const base = dotIdx === -1 ? name : name.slice(0, dotIdx);
  const ext = dotIdx === -1 ? "" : name.slice(dotIdx);
  let i = 2;
  let candidate = `${base}_${i}${ext}`;
  while (usedNames.has(candidate)) {
    i++;
    candidate = `${base}_${i}${ext}`;
  }
  usedNames.add(candidate);
  return candidate;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

btnExportAll.addEventListener("click", async () => {
  const targets = fileEntries.filter((e) => e.workId);
  if (!targets.length) return;

  if ("showDirectoryPicker" in window) {
    let parentDirHandle;
    try {
      parentDirHandle = await window.showDirectoryPicker();
    } catch (err) {
      if (err.name !== "AbortError") {
        setStatus("เลือกโฟลเดอร์ไม่สำเร็จ: " + err, "error");
      }
      return;
    }

    const folderName = timestampFolderName();
    let exportDirHandle;
    try {
      exportDirHandle = await parentDirHandle.getDirectoryHandle(folderName, { create: true });
    } catch (err) {
      setStatus("สร้างโฟลเดอร์สำหรับส่งออกไม่สำเร็จ: " + err, "error");
      return;
    }

    setStatus(`กำลังส่งออก ${targets.length} ไฟล์ ไปที่โฟลเดอร์ "${folderName}"...`);
    const usedNames = new Set();
    let savedCount = 0;
    for (const entry of targets) {
      try {
        const res = await fetch(`/api/export/${entry.workId}`);
        if (!res.ok) {
          entry.infoEl.textContent = `ส่งออกไฟล์ "${entry.fileName}" ไม่สำเร็จ`;
          entry.infoEl.className = "file-info error";
          continue;
        }
        const blob = await res.blob();
        const name = uniqueName(entry.fileName, usedNames);
        const fileHandle = await exportDirHandle.getFileHandle(name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        savedCount++;
      } catch (err) {
        entry.infoEl.textContent = `ส่งออกไฟล์ "${entry.fileName}" ไม่สำเร็จ: ` + err;
        entry.infoEl.className = "file-info error";
      }
    }
    setStatus(`ส่งออกไฟล์เสร็จสิ้น — บันทึกสำเร็จ ${savedCount} จาก ${targets.length} ไฟล์ ไปที่โฟลเดอร์ "${folderName}"`, "ok");
  } else {
    // เบราว์เซอร์ไม่รองรับการเลือกโฟลเดอร์ (เช่น Firefox) — ดาวน์โหลดทีละไฟล์ไปที่โฟลเดอร์ดาวน์โหลดเริ่มต้น
    setStatus(`กำลังส่งออก ${targets.length} ไฟล์ ไปที่โฟลเดอร์ดาวน์โหลดเริ่มต้นของเบราว์เซอร์...`);
    let savedCount = 0;
    for (const entry of targets) {
      try {
        const res = await fetch(`/api/export/${entry.workId}`);
        if (!res.ok) {
          entry.infoEl.textContent = `ส่งออกไฟล์ "${entry.fileName}" ไม่สำเร็จ`;
          entry.infoEl.className = "file-info error";
          continue;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = entry.fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        savedCount++;
        await sleep(300);
      } catch (err) {
        entry.infoEl.textContent = `ส่งออกไฟล์ "${entry.fileName}" ไม่สำเร็จ: ` + err;
        entry.infoEl.className = "file-info error";
      }
    }
    setStatus(`ส่งออกไฟล์เสร็จสิ้น — บันทึกสำเร็จ ${savedCount} จาก ${targets.length} ไฟล์ (ไปที่โฟลเดอร์ดาวน์โหลดเริ่มต้น)`, "ok");
  }
});

async function exportEntry(entry) {
  if (!entry.workId) return false;

  if (supportsFileSystemAccess) {
    try {
      const pickerOpts = {
        suggestedName: entry.fileName,
        types: [{ description: "DBF File", accept: { "application/octet-stream": [".dbf"] } }],
      };
      if (entry.fileHandle) pickerOpts.startIn = entry.fileHandle;

      const saveHandle = await window.showSaveFilePicker(pickerOpts);
      const res = await fetch(`/api/export/${entry.workId}`);
      if (!res.ok) {
        setStatus(`ส่งออกไฟล์ "${entry.fileName}" ไม่สำเร็จ`, "error");
        return false;
      }
      const blob = await res.blob();
      const writable = await saveHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      setStatus(`บันทึกไฟล์ "${saveHandle.name}" สำเร็จ`, "ok");
      return true;
    } catch (err) {
      if (err.name !== "AbortError") {
        setStatus(`บันทึกไฟล์ "${entry.fileName}" ไม่สำเร็จ: ` + err, "error");
      }
      return false;
    }
  } else {
    window.location.href = `/api/export/${entry.workId}`;
    return true;
  }
}
