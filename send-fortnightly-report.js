/**
 * MOAR Account Engagement Tracker — Fortnightly Report
 * Run: node send-fortnightly-report.js
 *
 * Recipients:
 *   REPORT_OVERSEER_1  (Mohith)    → full report
 *   REPORT_OVERSEER_2  (Niveditha) → full report
 *   REPORT_MOHITH_EXTRA            → Mohith's personal email (also gets full)
 *   REPORT_LEADER_*   (7 leaders)  → personalised section only
 *
 * GitHub Secrets required (in addition to existing ones):
 *   REPORT_OVERSEER_1       Mohith's email
 *   REPORT_OVERSEER_2       Niveditha's email
 *   REPORT_MOHITH_EXTRA     Mohith's personal/extra email (gets full report too)
 *   REPORT_LEADER_HARSHA
 *   REPORT_LEADER_GOPAL
 *   REPORT_LEADER_MUKESH
 *   REPORT_LEADER_RAHUL
 *   REPORT_LEADER_ANNEKA
 *   REPORT_LEADER_SONIA
 */

const https = require("https");

// ── Config ──────────────────────────────────────────────────────────────────

const BIN_ID       = null; // unused — kept for reference
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const EMAILJS_SVC  = process.env.EMAILJS_SERVICE_ID  || "service_39ugs0o";
const EMAILJS_TPL  = process.env.EMAILJS_TEMPLATE_ID || "template_ssbfrbn";
const EMAILJS_PUB  = process.env.EMAILJS_PUBLIC_KEY  || "8OH8FJyt_z0ssNAVU";
const EMAILJS_PRIV = process.env.EMAILJS_PRIVATE_KEY;

// Overseers get the full report
const OVERSEERS = [
  process.env.REPORT_OVERSEER_1,
  process.env.REPORT_OVERSEER_2,
  process.env.REPORT_MOHITH_EXTRA,  // Mohith's extra ID also gets full report
].filter(Boolean);

// Leaders mapped by full name → email env var
const LEADER_EMAILS = {
  "Mohith Mohan":      process.env.REPORT_OVERSEER_1,        // also gets personal section
  "Harsha Nandakumar": process.env.REPORT_LEADER_HARSHA,
  "Gopal Shivapuja":   process.env.REPORT_LEADER_GOPAL,
  "Mukesh Kedia":      process.env.REPORT_LEADER_MUKESH,
  "Rahul Virk":        process.env.REPORT_LEADER_RAHUL,
  "Anneka Darashah":   process.env.REPORT_LEADER_ANNEKA,
  "Sonia Sharma":      process.env.REPORT_LEADER_SONIA,
};

const PROSPECT_TARGET = 10; // June 2026 target: 10 prospects per leader

// ── Helpers ─────────────────────────────────────────────────────────────────

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { ...options };
    if (data) opts.headers = { ...opts.headers, "Content-Length": Buffer.byteLength(data) };
    const req = https.request(opts, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end",  () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function monthly(a) { return (a.w1||0)+(a.w2||0)+(a.w3||0)+(a.w4||0); }
function fmt(n)     { return Number(n||0).toLocaleString(); }
function fmtK(n)    { if (!n) return "$0"; if (n>=1000000) return "$"+(Math.round(n/100000)/10)+"M"; if (n>=1000) return "$"+(Math.round(n/100)/10)+"K"; return "$"+n; }
function esc(s)     { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

function isOverdue(p) {
  if (!p.nextActionDue) return false;
  if (p.stage === "✅ Closed Won" || p.stage === "❌ Closed Lost") return false;
  return new Date(p.nextActionDue) < new Date();
}

function needsAttention(p) {
  if (p.stage === "✅ Closed Won" || p.stage === "❌ Closed Lost") return false;
  const staleDays = p.stageEnteredAt ? Math.floor((Date.now() - new Date(p.stageEnteredAt)) / 86400000) : 0;
  const agingDays = p.lastContacted  ? Math.floor((Date.now() - new Date(p.lastContacted))  / 86400000) : 999;
  return isOverdue(p) || staleDays > 14 || agingDays > 14;
}

// ── Colours (burgundy/champagne theme matching app) ──────────────────────────

const C = {
  burg:    "#7B1F3E",
  burg2:   "#A0284F",
  slate:   "#3D4F60",
  champ:   "#9A7228",
  champBg: "#F5E8C4",
  bg:      "#F4EDD8",
  surf:    "#FFFDF7",
  bdr:     "#D6C89A",
  txt:     "#2A1820",
  mut:     "#7A6656",
  green:   "#27624A",
  greenBg: "#E8F5EE",
  red:     "#8B1A1A",
  redBg:   "#FAEAEA",
  amber:   "#7A5800",
  amberBg: "#FFF5D6",
};

// ── Fetch data ───────────────────────────────────────────────────────────────

async function fetchData() {
  const url = new URL(SUPABASE_URL);
  const res = await httpsRequest({
    hostname: url.hostname,
    path:     "/rest/v1/app_data?id=eq.1&select=*",
    method:   "GET",
    headers:  {
      "apikey":        SUPABASE_KEY,
      "Authorization": "Bearer " + SUPABASE_KEY,
    },
  });
  const rows = JSON.parse(res.body);
  const rec  = (rows && rows[0]) || {};
  return {
    accounts:     rec.accounts      || [],
    prospects:    rec.prospects     || [],
    meta:         rec.meta          || {},
    activityLog:  rec.activity_log  || [],
    inputHistory: rec.input_history || [],
  };
}

// ── Email wrapper ────────────────────────────────────────────────────────────

async function sendEmail(toEmail, subject, htmlBody) {
  const payload = {
    service_id:  EMAILJS_SVC,
    template_id: EMAILJS_TPL,
    user_id:     EMAILJS_PUB,
    accessToken: EMAILJS_PRIV,
    template_params: {
      to_email:     toEmail,
      subject:      subject,
      message_html: htmlBody,
      to_name:      toEmail.split("@")[0],
      from_name:    "MOAR Tracker",
      reply_to:     "no-reply@moar.ai",
    },
  };
  const res = await httpsRequest({
    hostname: "api.emailjs.com",
    path:     "/api/v1.0/email/send",
    method:   "POST",
    headers:  { "Content-Type": "application/json", "origin": "http://localhost" },
  }, payload);
  console.log(`   → ${toEmail}: HTTP ${res.status}`);
  if (res.status !== 200) throw new Error(`EmailJS ${res.status}: ${res.body}`);
}

// ── HTML Helpers ─────────────────────────────────────────────────────────────

const emailWrapper = (content, title) => `
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:24px 0;">
<tr><td align="center">
<table width="660" cellpadding="0" cellspacing="0"
  style="background:${C.surf};border-radius:12px;overflow:hidden;border:1px solid ${C.bdr};">

  <!-- Header -->
  <tr><td style="background:${C.burg};padding:24px 28px;">
    <div style="font-family:Georgia,serif;font-size:24px;font-weight:700;color:#F5E8C4;letter-spacing:1px;">MOAR<span style="color:rgba(245,232,196,.35);">.</span></div>
    <div style="font-size:10px;color:rgba(245,232,196,.6);margin-top:3px;text-transform:uppercase;letter-spacing:1px;">Account Engagement Tracker</div>
    <div style="font-size:14px;font-weight:600;color:#F5E8C4;margin-top:8px;">${title}</div>
  </td></tr>

  ${content}

  <!-- Footer -->
  <tr><td style="background:${C.bg};padding:14px 28px;border-top:1px solid ${C.bdr};">
    <div style="font-size:10px;color:${C.mut};">
      Auto-generated by MOAR Account Tracker ·
      ${new Date().toLocaleString("en-GB",{timeZone:"Asia/Kolkata",day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})} IST
    </div>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;

const section = (title, content) => `
  <tr><td style="padding:20px 28px 0;">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;
      color:${C.mut};border-bottom:2px solid ${C.bdr};padding-bottom:8px;margin-bottom:12px;">
      ${title}
    </div>
    ${content}
  </td></tr>`;

const statCard = (val, lbl, col) =>
  `<td width="25%" style="padding:6px;">
    <div style="background:${C.surf};border:1px solid ${C.bdr};border-radius:8px;padding:14px;text-align:center;border-top:3px solid ${col};">
      <div style="font-family:Georgia,serif;font-size:24px;font-weight:700;color:${col};line-height:1;">${val}</div>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.7px;color:${C.mut};margin-top:5px;">${lbl}</div>
    </div>
  </td>`;

const tableHead = (cols) =>
  `<tr style="background:${C.bg};border-bottom:2px solid ${C.bdr};">
    ${cols.map(c => `<th style="padding:8px 10px;text-align:${c.align||"left"};font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:${C.mut};font-weight:700;white-space:nowrap;">${c.label}</th>`).join("")}
  </tr>`;

const pill = (text, bg, col) =>
  `<span style="background:${bg};color:${col};font-size:9px;font-weight:700;padding:2px 7px;border-radius:3px;white-space:nowrap;">${esc(text)}</span>`;

// ── Section builders ─────────────────────────────────────────────────────────

function buildOverallPipeline(prospects, meta) {
  const STAGES = ["⏳ Not Started","🔍 Researching","📧 Email Sent","📞 Call Scheduled","🤝 Intro Done","💬 In Negotiation","✅ Closed Won","❌ Closed Lost"];
  const active  = prospects.filter(p => p.stage !== "✅ Closed Won" && p.stage !== "❌ Closed Lost");
  const won     = prospects.filter(p => p.stage === "✅ Closed Won");
  const lost    = prospects.filter(p => p.stage === "❌ Closed Lost");
  const totalPipe = active.reduce((s,p) => s+(p.dealValue||0), 0);
  const wonVal    = won.reduce((s,p) => s+(p.dealValue||0), 0);

  const stageRows = STAGES.map(s => {
    const ps  = prospects.filter(p => p.stage === s);
    if (!ps.length) return "";
    const val = ps.reduce((sum,p) => sum+(p.dealValue||0), 0);
    const isClosed = s === "✅ Closed Won";
    const isLost   = s === "❌ Closed Lost";
    const rowBg    = isClosed ? C.greenBg : isLost ? C.redBg : C.surf;
    return `<tr style="border-bottom:1px solid ${C.bdr};background:${rowBg};">
      <td style="padding:8px 10px;font-size:12px;">${s}</td>
      <td style="padding:8px 10px;text-align:center;font-weight:700;font-size:13px;color:${C.burg};">${ps.length}</td>
      <td style="padding:8px 10px;text-align:right;font-weight:700;font-size:12px;color:${isClosed?C.green:C.txt};">${fmtK(val)}</td>
    </tr>`;
  }).join("");

  const statsHtml = `<table width="100%" cellpadding="0" cellspacing="0"><tr>
    ${statCard(fmtK(totalPipe), "Active pipeline", C.burg)}
    ${statCard(active.length,   "Active prospects", C.slate)}
    ${statCard(fmtK(wonVal),    "Closed won", C.green)}
    ${statCard(won.length+"/"+prospects.length, "Win rate", C.champ)}
  </tr></table>`;

  const tableHtml = `<table width="100%" cellpadding="0" cellspacing="0"
    style="border:1px solid ${C.bdr};border-radius:8px;overflow:hidden;margin-top:12px;">
    ${tableHead([{label:"Stage"},{label:"Count",align:"center"},{label:"Value",align:"right"}])}
    <tbody>${stageRows}</tbody>
  </table>`;

  return section("📊 Overall Pipeline — " + (meta.month||""), statsHtml + tableHtml);
}

function buildEngagementScores(accounts) {
  const totalTime = accounts.reduce((s,a) => s+monthly(a), 0);
  const totalDeal = accounts.reduce((s,a) => s+(a.dealValue||0), 0);

  const rows = accounts.slice().sort((a,b) => (b.dealValue||0)-(a.dealValue||0)).map(a => {
    const mins      = monthly(a);
    const dealShare = totalDeal > 0 ? (a.dealValue||0)/totalDeal : 0;
    const timeShare = totalTime > 0 ? mins/totalTime : 0;
    const ratio     = dealShare > 0 ? timeShare/dealShare : null;
    let scoreTxt, scoreBg, scoreCol;
    if (ratio === null)    { scoreTxt="—";         scoreBg=C.bg;      scoreCol=C.mut; }
    else if (ratio>=0.85)  { scoreTxt="On Track";  scoreBg=C.greenBg; scoreCol=C.green; }
    else if (ratio>=0.50)  { scoreTxt="Under";     scoreBg=C.amberBg; scoreCol=C.amber; }
    else                   { scoreTxt="Low";       scoreBg=C.redBg;   scoreCol=C.red; }
    const tierBg  = a.tier==="Top 5" ? C.champBg : C.greenBg;
    const tierCol = a.tier==="Top 5" ? C.champ    : C.green;
    return `<tr style="border-bottom:1px solid ${C.bdr};">
      <td style="padding:8px 10px;font-weight:600;font-size:12px;color:${C.txt};">${esc(a.name)}</td>
      <td style="padding:8px 10px;">${pill(a.tier, tierBg, tierCol)}</td>
      <td style="padding:8px 10px;text-align:right;font-size:11px;color:${C.mut};">$${fmt(a.dealValue||0)}</td>
      <td style="padding:8px 10px;text-align:center;font-size:12px;font-weight:600;color:${C.burg};">${mins}m</td>
      <td style="padding:8px 10px;text-align:center;font-size:11px;color:${C.mut};">${Math.round(dealShare*100)}%</td>
      <td style="padding:8px 10px;text-align:center;">${pill(scoreTxt, scoreBg, scoreCol)}</td>
    </tr>`;
  }).join("");

  const tbl = `<table width="100%" cellpadding="0" cellspacing="0"
    style="border:1px solid ${C.bdr};border-radius:8px;overflow:hidden;">
    ${tableHead([
      {label:"Client"},
      {label:"Tier"},
      {label:"Deal Value",align:"right"},
      {label:"Time (mins)",align:"center"},
      {label:"Target %",align:"center"},
      {label:"Score",align:"center"}
    ])}
    <tbody>${rows}</tbody>
  </table>
  <div style="font-size:10px;color:${C.mut};margin-top:6px;">
    Score = actual time share vs expected share based on deal value.
    <span style="background:${C.greenBg};color:${C.green};padding:1px 5px;border-radius:3px;font-weight:700;">On Track</span> ≥85% ·
    <span style="background:${C.amberBg};color:${C.amber};padding:1px 5px;border-radius:3px;font-weight:700;">Under</span> 50–85% ·
    <span style="background:${C.redBg};color:${C.red};padding:1px 5px;border-radius:3px;font-weight:700;">Low</span> &lt;50%
  </div>`;

  return section("📈 Client Engagement Scores", tbl);
}

function buildOverdueSection(prospects) {
  const overdue = prospects.filter(isOverdue).sort((a,b) => new Date(a.nextActionDue)-new Date(b.nextActionDue));
  if (!overdue.length) {
    return section("🔴 Overdue Follow-ups", `<div style="color:${C.green};font-size:12px;padding:8px 0;">✓ No overdue follow-ups — all on track!</div>`);
  }

  // Group by owner
  const byOwner = {};
  overdue.forEach(p => {
    if (!byOwner[p.owner]) byOwner[p.owner] = [];
    byOwner[p.owner].push(p);
  });

  const ownerBlocks = Object.entries(byOwner).map(([owner, ps]) => {
    const firstName = owner.split(" ")[0];
    const rows = ps.map(p => {
      const daysLate = Math.floor((Date.now() - new Date(p.nextActionDue)) / 86400000);
      return `<tr style="border-bottom:1px solid ${C.bdr};">
        <td style="padding:7px 10px;font-weight:600;font-size:12px;">${esc(p.name)}</td>
        <td style="padding:7px 10px;font-size:11px;">${esc(p.stage)}</td>
        <td style="padding:7px 10px;font-size:11px;color:${C.red};font-weight:700;">${daysLate}d late</td>
        <td style="padding:7px 10px;font-size:11px;color:${C.mut};">${esc(p.nextAction||"—")}</td>
      </tr>`;
    }).join("");
    return `<div style="margin-bottom:12px;">
      <div style="font-size:11px;font-weight:700;color:${C.burg};margin-bottom:6px;">${esc(firstName)} — ${ps.length} overdue</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.bdr};border-radius:6px;overflow:hidden;font-size:12px;">
        ${tableHead([{label:"Prospect"},{label:"Stage"},{label:"Days Late"},{label:"Next Action"}])}
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }).join("");

  return section(`🔴 Overdue Follow-ups (${overdue.length} total)`, ownerBlocks);
}

function buildTargetProgress(prospects) {
  const TEAM_OWNERS = [
    "Mohith Mohan","Harsha Nandakumar","Gopal Shivapuja",
    "Mukesh Kedia","Rahul Virk","Anneka Darashah","Sonia Sharma"
  ];

  const rows = TEAM_OWNERS.map(owner => {
    const mine    = prospects.filter(p => p.owner === owner);
    const active  = mine.filter(p => p.stage !== "✅ Closed Won" && p.stage !== "❌ Closed Lost");
    const won     = mine.filter(p => p.stage === "✅ Closed Won").length;
    const overdue = mine.filter(isOverdue).length;
    const attn    = mine.filter(needsAttention).length;
    const count   = active.length;
    const pctDone = Math.min(100, Math.round((count / PROSPECT_TARGET) * 100));
    const barCol  = pctDone >= 80 ? C.green : pctDone >= 50 ? C.champ : C.red;
    const statusTxt = pctDone >= 100 ? "✅ Target hit" : pctDone >= 80 ? "🟡 Nearly there" : "🔴 Behind";
    const firstName = owner.split(" ")[0];

    return `<tr style="border-bottom:1px solid ${C.bdr};">
      <td style="padding:9px 10px;font-weight:700;font-size:12px;color:${C.txt};">${esc(firstName)}</td>
      <td style="padding:9px 10px;text-align:center;font-size:13px;font-weight:700;color:${C.burg};">${count}<span style="font-size:10px;color:${C.mut};font-weight:400;">/${PROSPECT_TARGET}</span></td>
      <td style="padding:9px 10px;" width="140">
        <div style="background:${C.bg};border-radius:4px;height:8px;overflow:hidden;">
          <div style="background:${barCol};width:${pctDone}%;height:8px;border-radius:4px;"></div>
        </div>
        <div style="font-size:9px;color:${C.mut};margin-top:2px;">${pctDone}%</div>
      </td>
      <td style="padding:9px 10px;font-size:11px;">${statusTxt}</td>
      <td style="padding:9px 10px;text-align:center;font-size:12px;color:${overdue>0?C.red:C.green};font-weight:${overdue>0?"700":"400"};">${overdue||"✓"}</td>
      <td style="padding:9px 10px;text-align:center;font-size:12px;color:${C.green};">${won}</td>
    </tr>`;
  }).join("");

  const tbl = `<div style="font-size:11px;color:${C.mut};margin-bottom:10px;">
    Target: each leader reaches <strong style="color:${C.txt};">10 active prospects</strong> by June 2026.
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.bdr};border-radius:8px;overflow:hidden;">
    ${tableHead([
      {label:"Leader"},
      {label:"Active",align:"center"},
      {label:"Progress",align:"center"},
      {label:"Status"},
      {label:"Overdue",align:"center"},
      {label:"Won",align:"center"}
    ])}
    <tbody>${rows}</tbody>
  </table>`;

  return section("🎯 Prospect Target Progress (Goal: 10 by June 2026)", tbl);
}

// ── Personal section for each leader ─────────────────────────────────────────

function buildPersonalSection(owner, prospects, meta) {
  const firstName = owner.split(" ")[0];
  const mine      = prospects.filter(p => p.owner === owner);
  const active    = mine.filter(p => p.stage !== "✅ Closed Won" && p.stage !== "❌ Closed Lost");
  const myOverdue = mine.filter(isOverdue);
  const myAttn    = mine.filter(needsAttention);
  const pipeVal   = active.reduce((s,p) => s+(p.dealValue||0), 0);
  const pctDone   = Math.min(100, Math.round((active.length/PROSPECT_TARGET)*100));
  const barCol    = pctDone>=80 ? C.green : pctDone>=50 ? C.champ : C.red;

  const statsHtml = `<table width="100%" cellpadding="0" cellspacing="0"><tr>
    ${statCard(active.length+"/"+PROSPECT_TARGET, "Prospects vs target", C.burg)}
    ${statCard(fmtK(pipeVal),    "Your pipeline", C.slate)}
    ${statCard(myOverdue.length||"✓", "Overdue",  myOverdue.length>0?C.red:C.green)}
    ${statCard(myAttn.length||"✓",    "Need attention", myAttn.length>0?C.amber:C.green)}
  </tr></table>
  <div style="margin-top:10px;background:${C.bg};border-radius:4px;height:10px;overflow:hidden;">
    <div style="background:${barCol};width:${pctDone}%;height:10px;border-radius:4px;"></div>
  </div>
  <div style="font-size:10px;color:${C.mut};margin-top:4px;">${pctDone}% of 10-prospect target · June 2026</div>`;

  // Prospects table
  const prospectsRows = active.map(p => {
    const od = isOverdue(p);
    const at = needsAttention(p);
    return `<tr style="border-bottom:1px solid ${C.bdr};${od?`background:${C.redBg};`:""}">
      <td style="padding:8px 10px;font-weight:600;font-size:12px;">${esc(p.name)}${od?` <span style="background:${C.redBg};color:${C.red};font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;">OVERDUE</span>`:""}${at&&!od?` <span style="background:${C.amberBg};color:${C.amber};font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;">ATTENTION</span>`:""}</td>
      <td style="padding:8px 10px;font-size:11px;">${esc(p.stage)}</td>
      <td style="padding:8px 10px;font-size:11px;color:${C.mut};">$${fmt(p.dealValue||0)}</td>
      <td style="padding:8px 10px;font-size:11px;color:${C.mut};">${p.nextActionDue||"—"}</td>
      <td style="padding:8px 10px;font-size:11px;color:${C.mut};">${esc(p.nextAction||"—")}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="5" style="padding:12px;text-align:center;color:${C.mut};font-size:12px;">No active prospects yet — add some!</td></tr>`;

  const prospectsTable = `<table width="100%" cellpadding="0" cellspacing="0"
    style="border:1px solid ${C.bdr};border-radius:8px;overflow:hidden;margin-top:12px;">
    ${tableHead([{label:"Prospect"},{label:"Stage"},{label:"Value"},{label:"Due Date"},{label:"Next Action"}])}
    <tbody>${prospectsRows}</tbody>
  </table>`;

  return emailWrapper(
    section(`Hi ${esc(firstName)} — your fortnightly update`, statsHtml + prospectsTable),
    `Your Fortnightly Update — ${meta.month||""}`
  );
}

// ── Build full report for overseers ──────────────────────────────────────────

function buildFullReport(data) {
  const { accounts = [], prospects = [], meta = {} } = data;
  const content =
    buildOverallPipeline(prospects, meta) +
    buildTargetProgress(prospects) +
    buildEngagementScores(accounts) +
    buildOverdueSection(prospects);
  return emailWrapper(content, `Fortnightly Report — ${meta.month||""}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n📊 MOAR Fortnightly Report\n");

  if (!SUPABASE_URL || !SUPABASE_KEY) { console.error("❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY"); process.exit(1); }
  if (!EMAILJS_PRIV)                  { console.error("❌ Missing EMAILJS_PRIVATE_KEY");               process.exit(1); }

  console.log("1️⃣  Fetching data from Supabase...");
  const data = await fetchData();
  const { accounts = [], prospects = [], meta = {} } = data;
  console.log(`   ✅ ${accounts.length} accounts, ${prospects.length} prospects`);

  const month   = meta.month || new Date().toLocaleString("en-GB",{month:"long",year:"numeric"});
  const subject = `MOAR Fortnightly Report — ${month}`;

  // Send full report to overseers
  const fullHtml = buildFullReport(data);
  console.log(`\n2️⃣  Sending full report to ${OVERSEERS.length} overseer(s)...`);
  for (const email of OVERSEERS) {
    await sendEmail(email, subject, fullHtml);
  }

  // Send personalised sections to each leader
  console.log("\n3️⃣  Sending personalised sections to leaders...");
  for (const [owner, email] of Object.entries(LEADER_EMAILS)) {
    if (!email) { console.log(`   ⚠ No email set for ${owner} — skipping`); continue; }
    const personalHtml = buildPersonalSection(owner, prospects, meta);
    const personalSubj = `MOAR — Your Fortnightly Update, ${month}`;
    await sendEmail(email, personalSubj, personalHtml);
  }

  console.log("\n✅ All fortnightly reports sent!\n");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
