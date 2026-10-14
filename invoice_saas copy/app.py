import os, json, random, sqlite3
from datetime import datetime, timedelta
from flask import Flask, render_template, request, send_file, redirect, url_for, jsonify
from werkzeug.utils import secure_filename
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable, Image as RLImage
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_RIGHT

app = Flask(__name__)
app.secret_key = "muthoinc_2026"

BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
DB_PATH    = os.path.join(BASE_DIR, "muthoinc.db")
INV_DIR    = os.path.join(BASE_DIR, "invoices")
UPLOAD_DIR = os.path.join(BASE_DIR, "static", "uploads")

os.makedirs(INV_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_EXT = {"png", "jpg", "jpeg", "webp"}


# ── Database ──────────────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS invoices (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                client_name     TEXT NOT NULL,
                amount          REAL NOT NULL,
                transaction_id  TEXT NOT NULL,
                invoice_number  TEXT NOT NULL,
                date_created    TEXT NOT NULL,
                filename        TEXT NOT NULL,
                campaigns       TEXT DEFAULT '[]'
            );
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT
            );
            INSERT OR IGNORE INTO settings VALUES ('company_name',    'Muthoinc');
            INSERT OR IGNORE INTO settings VALUES ('company_address', 'Dhaka, Bangladesh');
            INSERT OR IGNORE INTO settings VALUES ('company_vat',     '509067890');
            INSERT OR IGNORE INTO settings VALUES ('account_id',      '409728473039033');
            INSERT OR IGNORE INTO settings VALUES ('logo_path',       '');
        """)

def get_settings():
    with get_db() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    return {r["key"]: r["value"] for r in rows}


# ── PDF helpers ───────────────────────────────────────────────────────────────

def txn_id():
    return "-".join("".join(str(random.randint(0, 9)) for _ in range(17)) for _ in range(2))

def inv_num(prefix):
    p = "".join(c for c in prefix.upper() if c.isalpha())[:6] or "MTHINC"
    return f"{p}-{random.randint(100,999)}-{random.randint(100000000,999999999)}"

def no_pad():
    return TableStyle([
        ("LEFTPADDING",  (0,0),(-1,-1), 0), ("RIGHTPADDING",(0,0),(-1,-1), 0),
        ("TOPPADDING",   (0,0),(-1,-1), 0), ("BOTTOMPADDING",(0,0),(-1,-1), 0),
        ("VALIGN",       (0,0),(-1,-1), "TOP"),
    ])

def format_from(raw):
    try:    return datetime.strptime(raw, "%Y-%m-%d").strftime("%d %b %Y")
    except: return (datetime.now() - timedelta(days=1)).strftime("%d %b %Y")

def format_to(raw):
    for fmt in ("%Y-%m-%dT%H:%M", "%Y-%m-%dT%H:%M:%S"):
        try: return datetime.strptime(raw, fmt).strftime("%d %b %Y, %H:%M")
        except: pass
    return datetime.now().strftime("%d %b %Y, %H:%M")


# ── PDF Builder ───────────────────────────────────────────────────────────────

def build_pdf(client_name, billing_amount, campaigns, cfg,
              from_raw="", to_raw="",
              account_id_override="", payment_method="Prepaid balance", product_type="Meta ads"):
    now       = datetime.now()
    date_str  = now.strftime("%d %b %Y, %H:%M")
    from_date = format_from(from_raw) if from_raw else (now - timedelta(days=1)).strftime("%d %b %Y")
    to_time   = format_to(to_raw)    if to_raw   else date_str

    tid  = txn_id()
    inum = inv_num(cfg.get("company_name", "MTHINC"))

    co_name    = cfg.get("company_name",    "Muthoinc")
    co_address = cfg.get("company_address", "Dhaka, Bangladesh")
    co_vat     = cfg.get("company_vat",     "509067890")
    account_id = account_id_override or cfg.get("account_id", "409728473039033")
    logo_path  = cfg.get("logo_path",       "")

    safe     = client_name.replace(" ", "_").replace("/", "_")
    filename = f"Invoice_{safe}_{now.strftime('%Y%m%d_%H%M%S')}.pdf"
    out_path = os.path.join(INV_DIR, filename)

    doc = SimpleDocTemplate(out_path, pagesize=A4,
                            rightMargin=20*mm, leftMargin=20*mm,
                            topMargin=15*mm,   bottomMargin=15*mm)

    base = getSampleStyleSheet()
    def S(name, **kw): return ParagraphStyle(name, parent=base["Normal"], **kw)

    sTitle  = S("ti", fontSize=14, fontName="Helvetica",      textColor=colors.HexColor("#1a1a1a"))
    sAcctId = S("ac", fontSize=8,                             textColor=colors.HexColor("#777777"))
    sCoR    = S("cr", fontSize=16, fontName="Helvetica-Bold", textColor=colors.HexColor("#1a1a1a"), alignment=TA_RIGHT)
    sLbl    = S("lb", fontSize=8,                             textColor=colors.HexColor("#555555"), spaceAfter=2)
    sVal    = S("vl", fontSize=9,  fontName="Helvetica-Bold", textColor=colors.HexColor("#1a1a1a"))
    sPaid   = S("pd", fontSize=9,                             textColor=colors.HexColor("#555555"), alignment=TA_RIGHT)
    sAmt    = S("am", fontSize=28, fontName="Helvetica-Bold", textColor=colors.HexColor("#1a1a1a"), alignment=TA_RIGHT, leading=32)
    sSub    = S("su", fontSize=8,                             textColor=colors.HexColor("#777777"), alignment=TA_RIGHT)
    sCHdr   = S("ch", fontSize=11, fontName="Helvetica-Bold", textColor=colors.HexColor("#1a1a1a"))
    sCN     = S("cn", fontSize=9,  fontName="Helvetica-Bold", textColor=colors.HexColor("#1a1a1a"))
    sCA     = S("ca", fontSize=9,  fontName="Helvetica-Bold", textColor=colors.HexColor("#1a1a1a"), alignment=TA_RIGHT)
    sCD     = S("cd", fontSize=8,                             textColor=colors.HexColor("#888888"))
    sAN     = S("an", fontSize=8,                             textColor=colors.HexColor("#333333"))
    sAI     = S("ai", fontSize=8,                             textColor=colors.HexColor("#888888"))
    sAA     = S("aa", fontSize=8,                             textColor=colors.HexColor("#333333"), alignment=TA_RIGHT)
    sFtL    = S("fl", fontSize=7,                             textColor=colors.HexColor("#888888"), leading=11)
    sFtR    = S("fr", fontSize=7,                             textColor=colors.HexColor("#888888"), alignment=TA_RIGHT, leading=11)
    sNote   = S("nt", fontSize=7,  fontName="Helvetica-Oblique", textColor=colors.HexColor("#aaaaaa"))

    c = []

    # Header
    if logo_path and os.path.exists(logo_path):
        logo_el = RLImage(logo_path, width=45*mm, height=18*mm, kind="proportional")
        logo_el.hAlign = "RIGHT"
        right_cell = logo_el
    else:
        right_cell = Paragraph(co_name, sCoR)

    hdr = Table([[
        Table([[Paragraph(f"Tax invoice for {client_name}", sTitle)],
               [Spacer(1,1.5*mm)],
               [Paragraph(f"Account ID: {account_id}", sAcctId)],
               [Spacer(1,1*mm)],
               [Paragraph("Meta", sAcctId)]],
              colWidths=[100*mm], style=no_pad()),
        right_cell,
    ]], colWidths=[100*mm, 70*mm])
    hdr.setStyle(TableStyle([
        ("LEFTPADDING",(0,0),(-1,-1),0), ("RIGHTPADDING",(0,0),(-1,-1),0),
        ("TOPPADDING",(0,0),(-1,-1),0),  ("BOTTOMPADDING",(0,0),(-1,-1),0),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"), ("ALIGN",(1,0),(1,0),"RIGHT"),
    ]))
    c += [hdr, Spacer(1,6*mm),
          HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#dddddd")),
          Spacer(1,6*mm)]

    # Details + Paid
    def detail_block(items):
        rows = []
        for label, value in items:
            rows += [[Paragraph(label, sLbl)], [Paragraph(value, sVal)], [Spacer(1,4*mm)]]
        t = Table(rows, colWidths=[95*mm]); t.setStyle(no_pad()); return t

    left  = detail_block([("Invoice/payment date", date_str),
                           ("Payment method", payment_method),
                           ("Transaction ID", tid),
                           ("Product type", product_type)])
    right = Table([[Paragraph("Paid", sPaid)],
                   [Paragraph(f"${billing_amount:,.2f}", sAmt)],
                   [Spacer(1,1*mm)],
                   [Paragraph("Ad costs since your last bill.", sSub)]],
                  colWidths=[75*mm]); right.setStyle(no_pad())
    mid = Table([[left, right]], colWidths=[95*mm,75*mm]); mid.setStyle(no_pad())
    c += [mid, Spacer(1,6*mm),
          HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#dddddd")),
          Spacer(1,6*mm)]

    # Campaigns
    if campaigns:
        c.append(Paragraph("Campaigns", sCHdr))
        c.append(Spacer(1,4*mm))
        for camp in campaigns:
            ch = Table([
                [Paragraph(camp["name"], sCN), Paragraph(f"${camp['total']:,.2f}", sCA)],
                [Paragraph(f"From {from_date}, 00:00 to {to_time}", sCD), Paragraph("")]
            ], colWidths=[130*mm,40*mm])
            ch.setStyle(TableStyle([("LEFTPADDING",(0,0),(-1,-1),0),("RIGHTPADDING",(0,0),(-1,-1),0),
                                     ("TOPPADDING",(0,0),(-1,-1),1),("BOTTOMPADDING",(0,0),(-1,-1),1)]))
            c += [ch, HRFlowable(width="100%",thickness=0.5,color=colors.HexColor("#bbbbbb"),
                                  dash=(3,4), spaceAfter=2*mm)]
            for ad in camp["ad_sets"]:
                ar = Table([[Paragraph("",sAN), Paragraph(ad["name"],sAN),
                             Paragraph(f"{ad['impressions']:,} Impressions",sAI),
                             Paragraph(f"${ad['amount']:,.2f}",sAA)]],
                           colWidths=[8*mm,80*mm,52*mm,30*mm])
                ar.setStyle(TableStyle([("LEFTPADDING",(0,0),(-1,-1),0),("RIGHTPADDING",(0,0),(-1,-1),0),
                                         ("TOPPADDING",(0,0),(-1,-1),3),("BOTTOMPADDING",(0,0),(-1,-1),3)]))
                c.append(ar)
            c.append(Spacer(1,5*mm))
        c += [HRFlowable(width="100%",thickness=0.5,color=colors.HexColor("#dddddd")), Spacer(1,6*mm)]

    # Footer
    ft = Table([[Paragraph(f"{co_name}<br/>{co_address}<br/>VAT Reg. No. {co_vat}", sFtL),
                 Paragraph(f"Bangladesh<br/>BIN: {co_vat}<br/>Invoice no. {inum}", sFtR)]],
               colWidths=[90*mm,80*mm])
    ft.setStyle(TableStyle([("LEFTPADDING",(0,0),(-1,-1),0),("RIGHTPADDING",(0,0),(-1,-1),0),
                             ("VALIGN",(0,0),(-1,-1),"BOTTOM")]))
    c += [ft, Spacer(1,5*mm),
          Paragraph("Customers to account for any VAT arising on this supply in accordance with VAT laws of Bangladesh.", sNote)]

    doc.build(c)
    return filename, tid, inum


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html", settings=get_settings())

@app.route("/generate", methods=["POST"])
def generate():
    data   = request.get_json()
    name   = (data.get("client_name") or "").strip()
    amount = float(data.get("amount") or 0)
    if not name or amount <= 0:
        return jsonify({"error": "Invalid input"}), 400

    campaigns = []
    for camp in (data.get("campaigns") or []):
        ad_sets = [{"name": a["name"], "impressions": int(a.get("impressions",0)),
                    "amount": float(a.get("amount",0))}
                   for a in camp.get("ad_sets",[]) if a.get("name")]
        if ad_sets:
            campaigns.append({"name": camp["name"],
                               "total": sum(a["amount"] for a in ad_sets),
                               "ad_sets": ad_sets})

    cfg = get_settings()
    filename, tid, inum = build_pdf(
        name, amount, campaigns, cfg,
        from_raw            = data.get("from_date",""),
        to_raw              = data.get("to_date",""),
        account_id_override = data.get("account_id",""),
        payment_method      = data.get("payment_method","Prepaid balance"),
        product_type        = data.get("product_type","Meta ads"),
    )

    used_account_id = data.get("account_id", "")
    with get_db() as conn:
        conn.execute(
            "INSERT INTO invoices (client_name,amount,transaction_id,invoice_number,date_created,filename,campaigns)"
            " VALUES (?,?,?,?,?,?,?)",
            (name, amount, tid, inum,
             datetime.now().strftime("%d %b %Y, %H:%M"), filename, json.dumps(campaigns))
        )
        if used_account_id:
            conn.execute("INSERT OR REPLACE INTO settings VALUES ('account_id',?)", (used_account_id,))
    return jsonify({"success": True, "filename": filename, "invoice_number": inum})

@app.route("/view/<path:filename>")
def view_pdf(filename):
    return send_file(os.path.join(INV_DIR, filename), mimetype="application/pdf")

@app.route("/download/<path:filename>")
def download(filename):
    path = os.path.join(INV_DIR, filename)
    return send_file(path, as_attachment=True, download_name=filename)

@app.route("/history")
def history():
    with get_db() as conn:
        invoices = conn.execute("SELECT * FROM invoices ORDER BY id DESC").fetchall()
    return render_template("history.html", invoices=invoices, settings=get_settings())

@app.route("/history/delete/<int:iid>", methods=["POST"])
def delete_invoice(iid):
    with get_db() as conn:
        row = conn.execute("SELECT filename FROM invoices WHERE id=?", (iid,)).fetchone()
        if row:
            p = os.path.join(INV_DIR, row["filename"])
            if os.path.exists(p): os.remove(p)
            conn.execute("DELETE FROM invoices WHERE id=?", (iid,))
    return redirect(url_for("history"))

@app.route("/settings")
def settings_page():
    return render_template("settings.html", settings=get_settings())

@app.route("/settings/save", methods=["POST"])
def save_settings():
    with get_db() as conn:
        for field in ["company_name","company_address","company_vat","account_id"]:
            conn.execute("INSERT OR REPLACE INTO settings VALUES (?,?)",
                         (field, request.form.get(field,"")))
    return redirect(url_for("settings_page"))

@app.route("/settings/logo", methods=["POST"])
def upload_logo():
    f = request.files.get("logo")
    if f and f.filename:
        ext = f.filename.rsplit(".",1)[-1].lower()
        if ext in ALLOWED_EXT:
            fname = secure_filename(f.filename)
            path  = os.path.join(UPLOAD_DIR, fname)
            f.save(path)
            with get_db() as conn:
                conn.execute("INSERT OR REPLACE INTO settings VALUES ('logo_path',?)", (path,))
    return redirect(url_for("settings_page"))


if __name__ == "__main__":
    init_db()
    print("\n  Muthoinc Invoice SaaS → http://localhost:5050\n")
    app.run(debug=True, port=5050)
