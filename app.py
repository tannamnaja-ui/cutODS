import os
import struct
import sys
import tempfile
import uuid

# เมื่อ build ด้วย PyInstaller --noconsole, sys.stdout/stderr เป็น None
# ทำให้ logging ของ Flask/Werkzeug พังตอนเขียน log ต้องกันไว้ก่อน import flask
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

from flask import Flask, jsonify, render_template, request, send_file, abort

if getattr(sys, "frozen", False):
    BASE_DIR = sys._MEIPASS
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# เก็บไฟล์ทำงานชั่วคราวไว้ใน temp ของระบบ เพื่อให้เขียนได้แน่นอนไม่ว่าจะติดตั้งโปรแกรมไว้ที่ใด
WORK_DIR = os.path.join(tempfile.gettempdir(), "CUTODSAN_FOR_DRG", "work")
os.makedirs(WORK_DIR, exist_ok=True)

app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, "templates"),
    static_folder=os.path.join(BASE_DIR, "static"),
)
app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024  # 200MB

# work_id -> {"path": str, "filename": str, "header": dict}
WORKS = {}

PREVIEW_LIMIT = 1000

LANG_CODEC_MAP = {
    0x01: "cp437",
    0x02: "cp850",
    0x03: "cp1252",
    0x57: "cp1252",
    0x58: "cp1252",
    0x59: "cp1252",
    0x50: "cp874",
    0x7C: "cp874",
}
DEFAULT_CODEC = "cp874"  # ใช้ค่าเริ่มต้นเป็นไทยเนื่องจากไฟล์ส่วนใหญ่เป็นข้อมูลโรงพยาบาล


def parse_header(data: bytes) -> dict:
    if len(data) < 32:
        raise ValueError("ไฟล์ไม่ใช่ DBF ที่ถูกต้อง")

    num_records = struct.unpack_from("<I", data, 4)[0]
    header_len = struct.unpack_from("<H", data, 8)[0]
    record_len = struct.unpack_from("<H", data, 10)[0]
    lang_id = data[29]
    codec = LANG_CODEC_MAP.get(lang_id, DEFAULT_CODEC)

    fields = []
    offset = 1  # ไบต์แรกของแต่ละ record คือ delete flag
    pos = 32
    while pos < header_len - 1:
        descriptor = data[pos:pos + 32]
        if not descriptor or descriptor[0] == 0x0D:
            break
        name = descriptor[0:11].split(b"\x00")[0].decode("ascii", errors="replace")
        ftype = chr(descriptor[11])
        flen = descriptor[16]
        decimals = descriptor[17]
        fields.append({
            "name": name,
            "type": ftype,
            "length": flen,
            "decimals": decimals,
            "offset": offset,
        })
        offset += flen
        pos += 32

    return {
        "num_records": num_records,
        "header_len": header_len,
        "record_len": record_len,
        "lang_id": lang_id,
        "codec": codec,
        "fields": fields,
    }


def decode_field(ftype: str, raw: bytes, codec: str) -> str:
    if ftype == "D":
        s = raw.decode("ascii", errors="replace").strip()
        if len(s) == 8 and s.isdigit():
            return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
        return s
    if ftype == "M":
        return "[memo]"
    if ftype == "C":
        try:
            return raw.decode(codec, errors="replace").rstrip()
        except LookupError:
            return raw.decode("latin1", errors="replace").rstrip()
    return raw.decode("ascii", errors="replace").strip()


def find_an_field(header: dict):
    for f in header["fields"]:
        if f["name"].strip().upper() == "AN":
            return f
    return None


def build_rows(data: bytes, header: dict, limit=None):
    rows = []
    n = header["num_records"]
    if limit is not None:
        n = min(n, limit)
    for i in range(n):
        rec_start = header["header_len"] + i * header["record_len"]
        record = data[rec_start:rec_start + header["record_len"]]
        if not record:
            break
        row = {"_deleted": record[0:1] == b"*"}
        for f in header["fields"]:
            raw = record[f["offset"]:f["offset"] + f["length"]]
            row[f["name"]] = decode_field(f["type"], raw, header["codec"])
        rows.append(row)
    return rows


def cut_ods(data: bytearray, header: dict, an_field: dict) -> int:
    changed = 0
    n = header["num_records"]
    flen = an_field["length"]
    foffset = an_field["offset"]
    for i in range(n):
        rec_start = header["header_len"] + i * header["record_len"]
        abs_pos = rec_start + foffset
        raw = bytes(data[abs_pos:abs_pos + flen])
        text = raw.decode("ascii", errors="ignore").strip()
        if text.upper().startswith("ODS"):
            new_text = text[3:].strip()
            new_bytes = new_text.encode("ascii", errors="ignore")[:flen].ljust(flen, b" ")
            data[abs_pos:abs_pos + flen] = new_bytes
            changed += 1
    return changed


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/upload", methods=["POST"])
def upload():
    file = request.files.get("file")
    if not file or not file.filename:
        return jsonify({"error": "ไม่พบไฟล์ที่อัปโหลด"}), 400

    raw = file.read()
    try:
        header = parse_header(raw)
    except Exception as exc:
        return jsonify({"error": f"ไม่สามารถอ่านไฟล์ DBF ได้: {exc}"}), 400

    work_id = uuid.uuid4().hex
    path = os.path.join(WORK_DIR, f"{work_id}.dbf")
    with open(path, "wb") as fh:
        fh.write(raw)

    WORKS[work_id] = {"path": path, "filename": file.filename, "header": header}

    an_field = find_an_field(header)
    rows = build_rows(raw, header, limit=PREVIEW_LIMIT)

    return jsonify({
        "work_id": work_id,
        "filename": file.filename,
        "fields": [f["name"] for f in header["fields"]],
        "rows": rows,
        "total_records": header["num_records"],
        "preview_limit": PREVIEW_LIMIT,
        "an_field_found": an_field is not None,
        "codec": header["codec"],
    })


@app.route("/api/cut/<work_id>", methods=["POST"])
def cut(work_id):
    work = WORKS.get(work_id)
    if not work:
        return jsonify({"error": "ไม่พบงานนี้ กรุณานำเข้าไฟล์ใหม่"}), 404

    header = work["header"]
    an_field = find_an_field(header)
    if not an_field:
        return jsonify({"error": "ไม่พบฟิลด์ AN ในไฟล์นี้"}), 400

    with open(work["path"], "rb") as fh:
        data = bytearray(fh.read())

    changed = cut_ods(data, header, an_field)

    with open(work["path"], "wb") as fh:
        fh.write(data)

    rows = build_rows(data, header, limit=PREVIEW_LIMIT)
    return jsonify({
        "changed_count": changed,
        "rows": rows,
        "total_records": header["num_records"],
    })


@app.route("/api/export/<work_id>", methods=["GET"])
def export(work_id):
    work = WORKS.get(work_id)
    if not work:
        abort(404)

    return send_file(work["path"], as_attachment=True, download_name=work["filename"])


HOST = "127.0.0.1"
PORT = 5008


def _port_in_use(host: str, port: int) -> bool:
    import socket

    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind((host, port))
        return False
    except OSError:
        return True
    finally:
        s.close()


def _open_browser_when_ready():
    import time
    import urllib.request
    import webbrowser

    url = f"http://{HOST}:{PORT}/"
    for _ in range(50):
        try:
            urllib.request.urlopen(url, timeout=0.3)
            break
        except Exception:
            time.sleep(0.2)
    webbrowser.open(url)


if __name__ == "__main__":
    if _port_in_use(HOST, PORT):
        # โปรแกรมรันอยู่แล้ว (เปิดซ้ำ) แค่เปิดเบราว์เซอร์ไปที่หน้าเดิม
        import webbrowser

        webbrowser.open(f"http://{HOST}:{PORT}/")
    else:
        import threading

        threading.Thread(target=_open_browser_when_ready, daemon=True).start()
        app.run(host=HOST, port=PORT, debug=False, use_reloader=False)
