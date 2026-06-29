const btnImport = document.getElementById("btnImport");
const fileInputFallback = document.getElementById("fileInputFallback");
const btnCut = document.getElementById("btnCut");
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
    renderFileTable(entry, data.rows);

    let msg = `${data.total_records} เรคคอร์ด`;
    if (data.total_records > data.preview_limit) {
      msg += ` (แสดงตัวอย่าง ${data.preview_limit} แถวแรก)`;
    }
    if (!data.an_field_found) {
      msg += " — ไม่พบฟิลด์ AN ในไฟล์นี้";
      entry.infoEl.className = "file-info error";
    } else {
      entry.infoEl.className = "file-info ok";
    }
    entry.infoEl.textContent = msg;
    entry.exportBtn.disabled = false;
    entry.exportBtn.addEventListener("click", () => exportEntry(entry));
  } catch (err) {
    entry.infoEl.textContent = "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ: " + err;
    entry.infoEl.className = "file-info error";
  }
}

async function importFiles(files) {
  setStatus(`กำลังนำเข้า ${files.length} ไฟล์...`);
  for (const file of files) {
    await importOneFile(file);
  }
  const anyAn = fileEntries.some((e) => e.an_field_found);
  btnCut.disabled = !anyAn;
  setStatus(`นำเข้าไฟล์สำเร็จ ${fileEntries.length} ไฟล์`, "ok");
}

btnImport.addEventListener("click", async () => {
  if (supportsFileSystemAccess) {
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [{ description: "DBF File", accept: { "application/octet-stream": [".dbf"] } }],
      });
      setStatus(`กำลังนำเข้า ${handles.length} ไฟล์...`);
      for (const handle of handles) {
        const file = await handle.getFile();
        await importOneFile(file, handle);
      }
      const anyAn = fileEntries.some((e) => e.an_field_found);
      btnCut.disabled = !anyAn;
      setStatus(`นำเข้าไฟล์สำเร็จ ${fileEntries.length} ไฟล์`, "ok");
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
  await importFiles(files);
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

async function exportEntry(entry) {
  if (!entry.workId) return;

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
        return;
      }
      const blob = await res.blob();
      const writable = await saveHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      setStatus(`บันทึกไฟล์ "${saveHandle.name}" สำเร็จ`, "ok");
    } catch (err) {
      if (err.name !== "AbortError") {
        setStatus(`บันทึกไฟล์ "${entry.fileName}" ไม่สำเร็จ: ` + err, "error");
      }
    }
  } else {
    window.location.href = `/api/export/${entry.workId}`;
  }
}
