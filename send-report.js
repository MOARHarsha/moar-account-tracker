/**
 * MOAR Account Engagement Tracker — Email Report Sender
 * Called by GitHub Actions with: node send-report.js [weekly|monthly]
 *
 * Reads from: SUPABASE_URL, SUPABASE_ANON_KEY, EMAILJS_*  environment variables
 */

const https = require("https");

const TYPE            = process.argv[2] || "weekly"; // "weekly" | "monthly"
const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_ANON_KEY;
const EMAILJS_SVC     = process.env.EMAILJS_SERVICE_ID   || "service_39ugs0o";
const EMAILJS_TPL     = process.env.EMAILJS_TEMPLATE_ID  || "template_ssbfrbn";
const EMAILJS_PUB     = process.env.EMAILJS_PUBLIC_KEY   || "8OH8FJyt_z0ssNAVU";
const EMAILJS_PRIV    = process.env.EMAILJS_PRIVATE_KEY;
const RECIPIENTS      = [
  process.env.REPORT_TO_EMAIL_1,
  process.env.REPORT_TO_EMAIL_2,
].filter(Boolean);

// ── Helpers ────────────────────────────────────────────────────────────────

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    if (data) options.headers["Content-Length"] = Buffer.byteLength(data);
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function monthly(a)      { return (a.w1||0)+(a.w2||0)+(a.w3||0)+(a.w4||0); }
function weeksTouched(a) { return [a.w1,a.w2,a.w3,a.w4].filter(v=>v>0).length; }
function fmt(n)          { return Number(n||0).toLocaleString(); }
function pct(a,b)        { return b>0 ? Math.round((a/b)*100)+"%" : "—"; }

// ── Fetch data from Supabase ─────────────────────────────────────────────────

async function fetchData() {
  const url    = new URL(SUPABASE_URL);
  const res    = await httpsRequest({
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

// ── Build weekly HTML ───────────────────────────────────────────────────────

function buildWeeklyHTML(data) {
  const { accounts = [], prospects = [], meta = {} } = data;
  const now   = new Date();
  const month = meta.month || now.toLocaleString("en-GB",{month:"long",year:"numeric"});

  // Determine current week (1-4) by date
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekNum = Math.min(4, Math.ceil((now.getDate()) / 7));
  const wKey = "w" + weekNum;

  const top5  = accounts.filter(a => a.tier === "Top 5");
  const next5 = accounts.filter(a => a.tier === "Next 5");

  const totalMonthly = accounts.reduce((s,a) => s+monthly(a), 0);
  const top5Total    = top5.reduce((s,a) => s+monthly(a), 0);
  const thisWeekAll  = accounts.reduce((s,a) => s+(a[wKey]||0), 0);

  const prospectsOut = prospects.filter(p => p.reachedOut === "✅ Yes").length;
  const attention    = accounts.filter(a => monthly(a)===0 || weeksTouched(a)<=1);

  const sorted = accounts.slice().sort((a,b) => (b[wKey]||0)-(a[wKey]||0));

  const COLOR = { navy:"#0F1F3D", blue:"#1E56C8", teal:"#0B8A6E", amber:"#C97B0A", red:"#C42B2B", mut:"#6B7A99", bg:"#EEF1F8", bdr:"#DDE3F0" };

  const statBox = (val, lbl, col) => `
    <td width="25%" style="padding:8px;">
      <div style="background:#fff;border:1px solid ${COLOR.bdr};border-radius:8px;padding:16px;text-align:center;">
        <div style="font-family:Georgia,serif;font-size:26px;font-weight:700;color:${col};">${val}</div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:${COLOR.mut};margin-top:4px;">${lbl}</div>
      </div>
    </td>`;

  const accountRows = sorted.map(a => {
    const wkTime  = a[wKey]||0;
    const mTotal  = monthly(a);
    const tierBg  = a.tier==="Top 5" ? "#E8F0FD" : "#E8F5F1";
    const tierCol = a.tier==="Top 5" ? COLOR.blue : COLOR.teal;
    return `<tr style="border-bottom:1px solid ${COLOR.bdr};">
      <td style="padding:9px 12px;font-weight:600;font-size:12px;color:${COLOR.navy};">${a.name}</td>
      <td style="padding:9px 12px;"><span style="background:${tierBg};color:${tierCol};font-size:9px;font-weight:700;padding:2px 7px;border-radius:3px;">${a.tier}</span></td>
      <td style="padding:9px 12px;text-align:center;font-weight:600;font-size:13px;color:${COLOR.blue};">${wkTime}</td>
      <td style="padding:9px 12px;text-align:center;font-size:12px;color:${COLOR.mut};">${mTotal}</td>
      <td style="padding:9px 12px;font-size:11px;color:${COLOR.mut};max-width:200px;">${a.actionPoints||"—"}</td>
    </tr>`;
  }).join("");

  const prospectRows = prospects.map(p => `
    <tr style="border-bottom:1px solid ${COLOR.bdr};">
      <td style="padding:9px 12px;font-weight:600;font-size:12px;color:${COLOR.navy};">${p.name}</td>
      <td style="padding:9px 12px;font-size:12px;color:${COLOR.mut};">$${fmt(p.dealValue)}</td>
      <td style="padding:9px 12px;font-size:12px;">${p.stage}</td>
      <td style="padding:9px 12px;font-size:12px;">${p.reachedOut}</td>
    </tr>`).join("");

  const attentionHTML = attention.length
    ? attention.map(a => `<li style="margin-bottom:6px;font-size:12px;color:${COLOR.navy};"><strong>${a.name}</strong> — ${monthly(a)===0?"no time logged this month":"only touched "+weeksTouched(a)+" week(s)"}</li>`).join("")
    : `<li style="color:${COLOR.teal};font-size:12px;">✓ All accounts engaged consistently</li>`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:${COLOR.bg};font-family:'DM Sans',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.bg};padding:24px 0;">
<tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid ${COLOR.bdr};">

  <!-- Header -->
  <tr><td style="background:${COLOR.navy};padding:24px 28px;">
    <div style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#fff;">MOAR<span style="color:${COLOR.blue};">.</span></div>
    <div style="font-size:11px;color:rgba(255,255,255,.55);margin-top:2px;text-transform:uppercase;letter-spacing:.8px;">Account Engagement — Weekly Report</div>
    <div style="font-size:12px;color:rgba(255,255,255,.7);margin-top:6px;">Week ${weekNum} · ${month}</div>
  </td></tr>

  <!-- Stats -->
  <tr><td style="padding:20px 20px 0;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      ${statBox(thisWeekAll+" mins","This week",COLOR.navy)}
      ${statBox(pct(top5Total,totalMonthly),"Top 5 share",COLOR.blue)}
      ${statBox(prospectsOut+" / "+prospects.length,"Prospects out",COLOR.teal)}
      ${statBox(attention.length,"Need attention",attention.length>0?COLOR.amber:COLOR.teal)}
    </tr></table>
  </td></tr>

  <!-- Account table -->
  <tr><td style="padding:20px 28px 0;">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:${COLOR.mut};margin-bottom:10px;">Account Breakdown — Week ${weekNum}</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${COLOR.bdr};border-radius:8px;overflow:hidden;font-size:12px;">
      <tr style="background:${COLOR.bg};">
        <th style="padding:8px 12px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:${COLOR.mut};font-weight:600;">Account</th>
        <th style="padding:8px 12px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:${COLOR.mut};font-weight:600;">Tier</th>
        <th style="padding:8px 12px;text-align:center;font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:${COLOR.mut};font-weight:600;">Wk ${weekNum} mins</th>
        <th style="padding:8px 12px;text-align:center;font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:${COLOR.mut};font-weight:600;">Month total</th>
        <th style="padding:8px 12px;font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:${COLOR.mut};font-weight:600;">Action Points</th>
      </tr>
      ${accountRows}
    </table>
  </td></tr>

  <!-- Prospects -->
  <tr><td style="padding:20px 28px 0;">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:${COLOR.mut};margin-bottom:10px;">Prospects</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${COLOR.bdr};border-radius:8px;overflow:hidden;font-size:12px;">
      <tr style="background:${COLOR.bg};">
        <th style="padding:8px 12px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:${COLOR.mut};font-weight:600;">Prospect</th>
        <th style="padding:8px 12px;font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:${COLOR.mut};font-weight:600;">Deal Value</th>
        <th style="padding:8px 12px;font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:${COLOR.mut};font-weight:600;">Stage</th>
        <th style="padding:8px 12px;font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:${COLOR.mut};font-weight:600;">Reached Out?</th>
      </tr>
      ${prospectRows}
    </table>
  </td></tr>

  <!-- Attention -->
  <tr><td style="padding:20px 28px;">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:${COLOR.mut};margin-bottom:10px;">⚠ Needs Attention</div>
    <ul style="margin:0;padding-left:18px;">${attentionHTML}</ul>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:${COLOR.bg};padding:14px 28px;border-top:1px solid ${COLOR.bdr};">
    <div style="font-size:10px;color:${COLOR.mut};">Auto-generated by MOAR Account Tracker · ${new Date().toLocaleString("en-GB",{timeZone:"Asia/Kolkata"})}</div>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

// ── Build monthly HTML ──────────────────────────────────────────────────────

function buildMonthlyHTML(data) {
  const { accounts = [], prospects = [], meta = {} } = data;
  const now   = new Date();
  const month = meta.month || now.toLocaleString("en-GB",{month:"long",year:"numeric"});

  const top5  = accounts.filter(a => a.tier === "Top 5");
  const next5 = accounts.filter(a => a.tier === "Next 5");
  const totalAll   = accounts.reduce((s,a) => s+monthly(a), 0);
  const top5Total  = top5.reduce((s,a) => s+monthly(a), 0);
  const next5Total = next5.reduce((s,a) => s+monthly(a), 0);
  const totalPipeline = [...accounts,...prospects].reduce((s,x) => s+(x.dealValue||0), 0);

  const rankedAccounts = accounts.slice().sort((a,b) => monthly(b)-monthly(a));
  const COLOR = { navy:"#0F1F3D", blue:"#1E56C8", teal:"#0B8A6E", amber:"#C97B0A", red:"#C42B2B", mut:"#6B7A99", bg:"#EEF1F8", bdr:"#DDE3F0" };

  const weekStarts = meta.weekStarts || ["Wk1","Wk2","Wk3","Wk4"];

  const fullRows = rankedAccounts.map((a,i) => {
    const tierBg  = a.tier==="Top 5" ? "#E8F0FD" : "#E8F5F1";
    const tierCol = a.tier==="Top 5" ? COLOR.blue : COLOR.teal;
    const rankBg  = i<3 ? COLOR.blue : COLOR.mut;
    const mTot    = monthly(a);
    const wt      = weeksTouched(a);
    const w1=(a.w1||0), w2=(a.w2||0), w3=(a.w3||0), w4=(a.w4||0);
    return `<tr style="border-bottom:1px solid ${COLOR.bdr};">
      <td style="padding:9px 12px;text-align:center;"><span style="background:${rankBg};color:#fff;font-size:10px;font-weight:700;width:22px;height:22px;border-radius:50%;display:inline-block;text-align:center;line-height:22px;">${i+1}</span></td>
      <td style="padding:9px 12px;font-weight:600;font-size:12px;color:${COLOR.navy};">${a.name}</td>
      <td style="padding:9px 12px;"><span style="background:${tierBg};color:${tierCol};font-size:9px;font-weight:700;padding:2px 7px;border-radius:3px;">${a.tier}</span></td>
      <td style="padding:9px 12px;text-align:center;font-size:12px;">${w1}</td>
      <td style="padding:9px 12px;text-align:center;font-size:12px;">${w2}</td>
      <td style="padding:9px 12px;text-align:center;font-size:12px;">${w3}</td>
      <td style="padding:9px 12px;text-align:center;font-size:12px;">${w4}</td>
      <td style="padding:9px 12px;text-align:center;font-weight:700;font-size:13px;color:${COLOR.blue};">${mTot}</td>
      <td style="padding:9px 12px;text-align:center;font-size:12px;color:${COLOR.mut};">${wt}/4</td>
      <td style="padding:9px 12px;font-size:10px;color:${COLOR.mut};">$${fmt(a.dealValue||0)}</td>
    </tr>`;
  }).join("");

  const prospectRows = prospects.map(p => `
    <tr style="border-bottom:1px solid ${COLOR.bdr};">
      <td style="padding:9px 12px;font-weight:600;font-size:12px;color:${COLOR.navy};">${p.name}</td>
      <td style="padding:9px 12px;font-size:12px;color:${COLOR.mut};">$${fmt(p.dealValue)}</td>
      <td style="padding:9px 12px;font-size:12px;">${p.stage}</td>
      <td style="padding:9px 12px;font-size:11px;color:${COLOR.mut};">${p.actionPoints||"—"}</td>
    </tr>`).join("");

  const statBox = (val, lbl, col) => `
    <td width="25%" style="padding:8px;">
      <div style="background:#fff;border:1px solid ${COLOR.bdr};border-radius:8px;padding:16px;text-align:center;">
        <div style="font-family:Georgia,serif;font-size:24px;font-weight:700;color:${col};">${val}</div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:${COLOR.mut};margin-top:4px;">${lbl}</div>
      </div>
    </td>`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:${COLOR.bg};font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.bg};padding:24px 0;">
<tr><td align="center">
<table width="680" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid ${COLOR.bdr};">

  <!-- Header -->
  <tr><td style="background:${COLOR.navy};padding:24px 28px;">
    <div style="font-family:Georgia,serif;font-size:24px;font-weight:700;color:#fff;">MOAR<span style="color:${COLOR.blue};">.</span></div>
    <div style="font-size:11px;color:rgba(255,255,255,.55);margin-top:2px;text-transform:uppercase;letter-spacing:.8px;">Account Engagement — Monthly Recap</div>
    <div style="font-size:13px;color:rgba(255,255,255,.8);margin-top:6px;font-weight:600;">${month}</div>
  </td></tr>

  <!-- Stats -->
  <tr><td style="padding:20px 20px 0;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      ${statBox(totalAll+" mins","Total engagement",COLOR.navy)}
      ${statBox(pct(top5Total,totalAll),"Top 5 share",COLOR.blue)}
      ${statBox("$"+fmt(totalPipeline),"Total pipeline",COLOR.teal)}
      ${statBox(prospects.length,"Prospects",COLOR.teal)}
    </tr></table>
  </td></tr>

  <!-- Secondary stats -->
  <tr><td style="padding:10px 20px 0;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      ${statBox(top5Total+" mins","Top 5 total",COLOR.blue)}
      ${statBox(next5Total+" mins","Next 5 total",COLOR.teal)}
      ${statBox(Math.round(totalAll/60*10)/10+" hrs","Total hours",COLOR.mut)}
      ${statBox(Math.round(totalAll/Math.max(accounts.length,1))+" mins","Avg / account",COLOR.mut)}
    </tr></table>
  </td></tr>

  <!-- Full account table -->
  <tr><td style="padding:20px 28px 0;">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:${COLOR.mut};margin-bottom:10px;">Full Monthly Breakdown — Ranked by Engagement</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${COLOR.bdr};border-radius:8px;overflow:hidden;font-size:12px;">
      <tr style="background:${COLOR.bg};">
        <th style="padding:8px 12px;text-align:center;font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:${COLOR.mut};font-weight:600;">#</th>
        <th style="padding:8px 12px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:${COLOR.mut};font-weight:600;">Account</th>
        <th style="padding:8px 12px;font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:${COLOR.mut};font-weight:600;">Tier</th>
        <th style="padding:8px 12px;text-align:center;font-size:9px;color:${COLOR.mut};font-weight:600;">Wk 1<br><span style="font-weight:400;">${weekStarts[0]||""}</span></th>
        <th style="padding:8px 12px;text-align:center;font-size:9px;color:${COLOR.mut};font-weight:600;">Wk 2<br><span style="font-weight:400;">${weekStarts[1]||""}</span></th>
        <th style="padding:8px 12px;text-align:center;font-size:9px;color:${COLOR.mut};font-weight:600;">Wk 3<br><span style="font-weight:400;">${weekStarts[2]||""}</span></th>
        <th style="padding:8px 12px;text-align:center;font-size:9px;color:${COLOR.mut};font-weight:600;">Wk 4<br><span style="font-weight:400;">${weekStarts[3]||""}</span></th>
        <th style="padding:8px 12px;text-align:center;font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:${COLOR.blue};font-weight:700;">Total</th>
        <th style="padding:8px 12px;text-align:center;font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:${COLOR.mut};font-weight:600;">Wks</th>
        <th style="padding:8px 12px;font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:${COLOR.mut};font-weight:600;">Deal Value</th>
      </tr>
      ${fullRows}
    </table>
  </td></tr>

  <!-- Prospects -->
  <tr><td style="padding:20px 28px 0;">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:${COLOR.mut};margin-bottom:10px;">Prospects Pipeline</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${COLOR.bdr};border-radius:8px;overflow:hidden;font-size:12px;">
      <tr style="background:${COLOR.bg};">
        <th style="padding:8px 12px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:${COLOR.mut};font-weight:600;">Prospect</th>
        <th style="padding:8px 12px;font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:${COLOR.mut};font-weight:600;">Deal Value</th>
        <th style="padding:8px 12px;font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:${COLOR.mut};font-weight:600;">Stage</th>
        <th style="padding:8px 12px;font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:${COLOR.mut};font-weight:600;">Action Points</th>
      </tr>
      ${prospectRows}
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:${COLOR.bg};padding:14px 28px;border-top:1px solid ${COLOR.bdr};margin-top:20px;">
    <div style="font-size:10px;color:${COLOR.mut};">Auto-generated by MOAR Account Tracker · ${new Date().toLocaleString("en-GB",{timeZone:"Asia/Kolkata"})}</div>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

// ── Send via EmailJS REST API ───────────────────────────────────────────────

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
      // Common template variable names — adjust to match your EmailJS template
      to_name:      toEmail.split("@")[0],
      from_name:    "MOAR Tracker",
      reply_to:     "no-reply@moar.ai",
    },
  };

  const body = JSON.stringify(payload);
  const res = await httpsRequest({
    hostname: "api.emailjs.com",
    path:     "/api/v1.0/email/send",
    method:   "POST",
    headers:  { "Content-Type": "application/json", "origin": "http://localhost" },
  }, payload);

  console.log(`   → ${toEmail}: HTTP ${res.status} — ${res.body}`);
  if (res.status !== 200) throw new Error(`EmailJS error ${res.status}: ${res.body}`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n📊 MOAR Account Tracker — ${TYPE.toUpperCase()} Report\n`);

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars");
    process.exit(1);
  }
  if (!EMAILJS_PRIV) {
    console.error("❌ Missing EMAILJS_PRIVATE_KEY env var");
    process.exit(1);
  }
  if (!RECIPIENTS.length) {
    console.error("❌ No recipients configured (REPORT_TO_EMAIL_1 / REPORT_TO_EMAIL_2)");
    process.exit(1);
  }

  console.log("1️⃣  Fetching data from Supabase...");
  const data = await fetchData();
  console.log(`   ✅ ${data.accounts?.length||0} accounts, ${data.prospects?.length||0} prospects`);

  const now   = new Date();
  const month = data.meta?.month || now.toLocaleString("en-GB",{month:"long",year:"numeric"});
  const weekNum = Math.min(4, Math.ceil(now.getDate() / 7));

  let subject, html;
  if (TYPE === "monthly") {
    subject = `MOAR Monthly Report — ${month}`;
    html    = buildMonthlyHTML(data);
  } else {
    subject = `MOAR Weekly Report — Week ${weekNum}, ${month}`;
    html    = buildWeeklyHTML(data);
  }

  console.log(`2️⃣  Sending to ${RECIPIENTS.length} recipient(s)...`);
  for (const email of RECIPIENTS) {
    await sendEmail(email, subject, html);
  }

  console.log("\n✅ Report sent successfully!\n");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
