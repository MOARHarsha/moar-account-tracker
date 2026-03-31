/**
 * MOAR — Weekly Leader Briefing
 * Runs every Monday 8am IST via GitHub Actions.
 *
 * SETUP: Replace PLACEHOLDER_ addresses below with real emails.
 *        Any address starting with PLACEHOLDER_ is automatically skipped.
 *        Current live: Harsha, Niveditha.
 */

const SUPABASE_URL    = process.env.SUPABASE_URL    || "https://capbtrnnjpcwguoaeagg.supabase.co";
const SUPABASE_KEY    = process.env.SUPABASE_ANON_KEY || "sb_publishable_umIXcIKxrSKZeFk8sJiQ_w_mg9wT4_R";
const EMAILJS_SVC     = process.env.EMAILJS_SERVICE_ID  || "service_39ugs0o";
const EMAILJS_PUBKEY  = process.env.EMAILJS_PUBLIC_KEY   || "8OH8FJyt_z0ssNAVU";
const EMAILJS_PRIVKEY = process.env.EMAILJS_PRIVATE_KEY  || "";
const EMAILJS_TPL     = process.env.EMAILJS_TEMPLATE_ID  || "template_ssbfrbn";

// ── EMAIL ADDRESSES ────────────────────────────────────────────────────────
// Replace PLACEHOLDER_ prefix with real address to activate.
// Scripts skip any address starting with PLACEHOLDER_ (safe for testing).
const LEADER_EMAILS = {
  "Mohith Mohan":      "PLACEHOLDER_mohith@moaradvisory.com",
  "Harsha Nandakumar": "harsha.nandakumar@moaradvisory.com",   // ← live
  "Gopal Shivapuja":   "PLACEHOLDER_gopal@moaradvisory.com",
  "Mukesh Kedia":      "PLACEHOLDER_mukesh@moaradvisory.com",
  "Rahul Virk":        "PLACEHOLDER_rahul@moaradvisory.com",
  "Anneka Darashah":   "PLACEHOLDER_anneka@moaradvisory.com",
  "Sonia Sharma":      "PLACEHOLDER_sonia@moaradvisory.com"
};
// ──────────────────────────────────────────────────────────────────────────

function isLiveEmail(addr) {
  return addr && !addr.startsWith("PLACEHOLDER_");
}

async function fetchData() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/app_data?id=eq.1&select=*`, {
    headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` }
  });
  if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`);
  const rows = await res.json();
  return rows[0] || {};
}

function fmt(n) {
  if (!n) return "$0";
  if (n >= 1000000) return "$" + (n/1000000).toFixed(1) + "M";
  if (n >= 1000) return "$" + Math.round(n/1000) + "K";
  return "$" + n;
}

function isOverdue(p) {
  if (!p.nextActionDue || p.stage === "✅ Closed Won" || p.stage === "❌ Closed Lost") return false;
  const d = new Date(p.nextActionDue); d.setHours(0,0,0,0);
  const t = new Date(); t.setHours(0,0,0,0);
  return d < t;
}

function daysSince(dateStr) {
  if (!dateStr) return 999;
  return Math.floor((new Date() - new Date(dateStr)) / 86400000);
}

function currentWeek() {
  return Math.min(Math.ceil(new Date().getDate() / 7), 4);
}

function buildEmail(owner, prospects, accounts) {
  const fn    = owner.split(" ")[0];
  const myP   = prospects.filter(p => p.owner === owner);
  const myA   = accounts.filter(a => !a.owner || a.owner === owner);
  const active= myP.filter(p => p.stage !== "✅ Closed Won" && p.stage !== "❌ Closed Lost");
  const od    = active.filter(isOverdue);
  const won   = myP.filter(p => p.stage === "✅ Closed Won");
  const lost  = myP.filter(p => p.stage === "❌ Closed Lost");
  const allCl = won.length + lost.length;
  const winPct= allCl > 0 ? Math.round(won.length / allCl * 100) : 0;
  const pipeline = active.reduce((s,p) => s+(p.dealValue||0), 0);
  const wonVal   = won.reduce((s,p) => s+(p.dealValue||0), 0);
  const wk       = currentWeek();
  const timeWk   = myA.reduce((s,a) => s+(a[`w${wk}`]||0), 0);
  const today    = new Date().toLocaleDateString("en-GB",{weekday:"long",day:"2-digit",month:"long",year:"numeric"});

  // Peer rank by pipeline
  const allOwners = ["Mohith Mohan","Harsha Nandakumar","Gopal Shivapuja","Mukesh Kedia","Rahul Virk","Anneka Darashah","Sonia Sharma"];
  const ranked = allOwners
    .map(o => ({ name: o, pipe: prospects.filter(p => p.owner===o && p.stage!=="✅ Closed Won" && p.stage!=="❌ Closed Lost").reduce((s,p)=>s+(p.dealValue||0),0) }))
    .sort((a,b) => b.pipe - a.pipe);
  const myRank = ranked.findIndex(r => r.name === owner) + 1;
  const leader = ranked[0];
  const gapToTop = owner === leader.name ? 0 : leader.pipe - (ranked.find(r=>r.name===owner)||{pipe:0}).pipe;

  let priorities = [];
  od.slice(0,3).forEach(p => {
    const days = daysSince(p.nextActionDue);
    const lastC = p.lastContacted ? daysSince(p.lastContacted) : null;
    priorities.push(`🔴 URGENT: ${p.name} (${fmt(p.dealValue||0)}) — overdue ${days}d${lastC!==null?`, last contact ${lastC}d ago`:""}\n   Action: ${p.nextAction||"not set — update now"}`);
  });
  active.filter(p=>{const d=Math.floor((new Date(p.nextActionDue)-new Date())/86400000); return !isOverdue(p)&&d>=0&&d<=3&&p.nextActionDue;}).slice(0,2).forEach(p=>{
    const d=Math.floor((new Date(p.nextActionDue)-new Date())/86400000);
    priorities.push(`🟡 TODAY: ${p.name} (${fmt(p.dealValue||0)}) — due ${d===0?"today":d===1?"tomorrow":`in ${d}d`}\n   Action: ${p.nextAction||"no action set"}`);
  });
  active.filter(p=>p.stageEnteredAt&&Math.floor((new Date()-new Date(p.stageEnteredAt))/86400000)>=14&&!isOverdue(p)).slice(0,2).forEach(p=>{
    const d=Math.floor((new Date()-new Date(p.stageEnteredAt))/86400000);
    priorities.push(`🟠 STALLED: ${p.name} — ${d}d in ${p.stage.replace(/[^\x20-\x7E]/g,"").trim()}\n   Best practice: schedule a direct call or mark lost.`);
  });
  active.filter(p=>p.lastContacted&&daysSince(p.lastContacted)>=14&&!isOverdue(p)&&!active.find(q=>q.stageEnteredAt&&Math.floor((new Date()-new Date(q.stageEnteredAt))/86400000)>=14&&q===p)).slice(0,2).forEach(p=>{
    priorities.push(`🔵 CHECK IN: ${p.name} — ${daysSince(p.lastContacted)}d since contact. Send a quick email today.`);
  });

  const body = `Hi ${fn},

Here is your MOAR weekly briefing — ${today}.

━━━ YOUR NUMBERS ━━━
Active Pipeline:  ${fmt(pipeline)} (${active.length} deals)
Closed Won:       ${fmt(wonVal)} (${won.length} deals)
Win Rate:         ${winPct}% (${allCl} total closed)
Time logged Wk${wk}: ${timeWk}m
Overdue:          ${od.length||"None ✓"}

━━━ WHERE YOU STAND ━━━
You are ranked #${myRank} of 7 leaders by active pipeline.
${gapToTop > 0 ? `Gap to #1 (${leader.name.split(" ")[0]}): ${fmt(gapToTop)} in pipeline.` : "You are the pipeline leader this week. Keep going!"}
June 2026 target: ${myP.length}/10 prospects${myP.length>=10?" — ON TRACK ✅":""}

━━━ PRIORITIES THIS WEEK ━━━
${priorities.length ? priorities.join("\n\n") : "✅ All clear — great week ahead!"}

━━━ QUICK LINKS ━━━
Dashboard: https://moarharsha.github.io/moar-account-tracker/
(Select your name from the View dropdown to open your personal briefing)

— MOAR Tracker (automated Monday briefing)`;

  return { fn, email: LEADER_EMAILS[owner], subject: `MOAR Weekly — ${fn} — ${today}`, body };
}

async function sendEmail(to, subject, body) {
  const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_id: EMAILJS_SVC, template_id: EMAILJS_TPL,
      user_id: EMAILJS_PUBKEY, accessToken: EMAILJS_PRIVKEY,
      template_params: { to_email: to, subject, message: body, reply_to: "noreply@moaradvisory.com" }
    })
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`${res.status}: ${t}`); }
}

async function main() {
  console.log("MOAR Weekly Leader Briefing — starting...\n");
  const data = await fetchData();
  const { prospects=[], accounts=[] } = data;
  let sent=0, skipped=0, failed=0;

  for (const [owner, email] of Object.entries(LEADER_EMAILS)) {
    if (!isLiveEmail(email)) {
      console.log(`⏭  Skipped ${owner} — placeholder address (${email})`);
      skipped++; continue;
    }
    try {
      const e = buildEmail(owner, prospects, accounts);
      await sendEmail(email, e.subject, e.body);
      console.log(`✅ Sent to ${owner} (${email})`);
      sent++;
      await new Promise(r => setTimeout(r, 1200));
    } catch(err) {
      console.error(`❌ Failed for ${owner}: ${err.message}`);
      failed++;
    }
  }
  console.log(`\nDone — ${sent} sent, ${skipped} skipped (placeholder), ${failed} failed.`);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
