/**
 * MOAR — Monday Team Pulse
 * Sends full team summary to Mohith + Niveditha every Monday.
 *
 * SETUP: Replace PLACEHOLDER_ addresses with real emails to activate.
 *        Any address starting with PLACEHOLDER_ is skipped safely.
 *        Current live: Niveditha.
 */

const SUPABASE_URL    = process.env.SUPABASE_URL    || "https://capbtrnnjpcwguoaeagg.supabase.co";
const SUPABASE_KEY    = process.env.SUPABASE_ANON_KEY || "sb_publishable_umIXcIKxrSKZeFk8sJiQ_w_mg9wT4_R";
const EMAILJS_SVC     = process.env.EMAILJS_SERVICE_ID  || "service_39ugs0o";
const EMAILJS_PUBKEY  = process.env.EMAILJS_PUBLIC_KEY   || "8OH8FJyt_z0ssNAVU";
const EMAILJS_PRIVKEY = process.env.EMAILJS_PRIVATE_KEY  || "";
const EMAILJS_TPL     = process.env.EMAILJS_TEMPLATE_ID  || "template_ssbfrbn";

// ── ADMIN EMAIL ADDRESSES ──────────────────────────────────────────────────
const ADMIN_EMAILS = [
  { name: "Mohith",    email: "PLACEHOLDER_mohith@moaradvisory.com" },
  { name: "Niveditha", email: "niveditha.harish@moaradvisory.com" }   // ← live
];
// ──────────────────────────────────────────────────────────────────────────

const TEAM_OWNERS = ["Mohith Mohan","Harsha Nandakumar","Gopal Shivapuja","Mukesh Kedia","Rahul Virk","Anneka Darashah","Sonia Sharma"];

function isLiveEmail(addr) { return addr && !addr.startsWith("PLACEHOLDER_"); }

async function fetchData() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/app_data?id=eq.1&select=*`, {
    headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` }
  });
  if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`);
  const rows = await res.json(); return rows[0] || {};
}

function fmt(n) {
  if (!n) return "$0";
  if (n >= 1000000) return "$"+(n/1000000).toFixed(1)+"M";
  if (n >= 1000) return "$"+Math.round(n/1000)+"K";
  return "$"+n;
}
function isOverdue(p) {
  if (!p.nextActionDue||p.stage==="✅ Closed Won"||p.stage==="❌ Closed Lost") return false;
  const d=new Date(p.nextActionDue); d.setHours(0,0,0,0);
  const t=new Date(); t.setHours(0,0,0,0); return d<t;
}
function currentWeek() { return Math.min(Math.ceil(new Date().getDate()/7),4); }

function buildPulse(prospects, accounts) {
  const wk    = currentWeek();
  const today = new Date().toLocaleDateString("en-GB",{weekday:"long",day:"2-digit",month:"long",year:"numeric"});
  const active= prospects.filter(p=>p.stage!=="✅ Closed Won"&&p.stage!=="❌ Closed Lost");
  const won   = prospects.filter(p=>p.stage==="✅ Closed Won");
  const lost  = prospects.filter(p=>p.stage==="❌ Closed Lost");
  const allCl = won.length+lost.length;
  const winPct= allCl>0?Math.round(won.length/allCl*100):0;
  const pipe  = active.reduce((s,p)=>s+(p.dealValue||0),0);
  const wonVal= won.reduce((s,p)=>s+(p.dealValue||0),0);
  const fc    = Math.round(pipe*(allCl>0?won.length/allCl:0.25));
  const time  = accounts.reduce((s,a)=>s+(a[`w${wk}`]||0),0);
  const overdue=active.filter(isOverdue).length;

  const leaderRows = TEAM_OWNERS.map(o => {
    const fn  = o.split(" ")[0];
    const myP = prospects.filter(p=>p.owner===o);
    const myAc= myP.filter(p=>p.stage!=="✅ Closed Won"&&p.stage!=="❌ Closed Lost");
    const myA = accounts.filter(a=>a.owner===o);
    const od  = myAc.filter(isOverdue).length;
    const stall=myAc.filter(p=>p.stageEnteredAt&&Math.floor((new Date()-new Date(p.stageEnteredAt))/86400000)>=14).length;
    const myW = myA.reduce((s,a)=>s+(a[`w${wk}`]||0),0);
    const myPipe=myAc.reduce((s,p)=>s+(p.dealValue||0),0);
    const status=od>0?`⚠ ${od} overdue`:stall>0?`⏸ ${stall} stalled`:"✓ On track";
    return `  ${fn.padEnd(10)} | ${fmt(myPipe).padStart(6)} pipeline | ${String(myAc.length).padStart(2)} active | ${String(myW).padStart(4)}m Wk${wk} | ${status} | June: ${myP.length}/10`;
  });

  const nudges = TEAM_OWNERS
    .map(o => {
      const fn=o.split(" ")[0];
      const myP=prospects.filter(p=>p.owner===o);
      const myAc=myP.filter(p=>p.stage!=="✅ Closed Won"&&p.stage!=="❌ Closed Lost");
      const od=myAc.filter(isOverdue).length;
      const stall=myAc.filter(p=>p.stageEnteredAt&&Math.floor((new Date()-new Date(p.stageEnteredAt))/86400000)>=14).length;
      const score=od*3+stall*2+(myP.length===0?5:0);
      const r=[];
      if(myP.length===0) r.push("no prospects");
      if(od>0) r.push(`${od} overdue`);
      if(stall>0) r.push(`${stall} stalled`);
      return score>0?{fn,score,r}:null;
    })
    .filter(Boolean).sort((a,b)=>b.score-a.score).slice(0,4)
    .map(l=>`  → ${l.fn}: ${l.r.join(", ")}`);

  return `Team Pulse — ${today}

━━━ TEAM TOTALS ━━━
Active Pipeline:  ${fmt(pipe)} (${active.length} deals across ${TEAM_OWNERS.length} leaders)
Closed Won:       ${fmt(wonVal)} | ${won.length} deals | Win Rate: ${winPct}%
Revenue Forecast: ${fmt(fc)} (pipeline × ${winPct||25}% close rate)
Client Time Wk${wk}: ${time}m total
Overdue Actions:  ${overdue||"None ✓"}

━━━ LEADER PERFORMANCE ━━━
${leaderRows.join("\n")}

━━━ WHO TO CHECK IN WITH ━━━
${nudges.length?nudges.join("\n"):"  Team on track — no urgent check-ins."}

━━━ REMINDERS ━━━
• Run Month End on the last working day of each month.
• Leaders should have 10 prospects each by June 2026.
• Encourage Wk${wk} time logs before Friday.

Dashboard: https://moarharsha.github.io/moar-account-tracker/

— MOAR Tracker (automated)`;
}

async function sendEmail(to, subject, body) {
  const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ service_id:EMAILJS_SVC, template_id:EMAILJS_TPL,
      user_id:EMAILJS_PUBKEY, accessToken:EMAILJS_PRIVKEY,
      template_params:{to_email:to,subject,message:body,reply_to:"noreply@moaradvisory.com"} })
  });
  if(!res.ok){const t=await res.text();throw new Error(`${res.status}: ${t}`);}
}

async function main() {
  console.log("MOAR Team Pulse — starting...\n");
  const data = await fetchData();
  const { prospects=[], accounts=[] } = data;
  const subject = `MOAR Team Pulse — ${new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})}`;
  const body = buildPulse(prospects, accounts);
  let sent=0, skipped=0;
  for (const admin of ADMIN_EMAILS) {
    if (!isLiveEmail(admin.email)) {
      console.log(`⏭  Skipped ${admin.name} — placeholder (${admin.email})`);
      skipped++; continue;
    }
    try {
      await sendEmail(admin.email, subject, body);
      console.log(`✅ Team pulse sent to ${admin.name} (${admin.email})`);
      sent++;
      await new Promise(r=>setTimeout(r,1200));
    } catch(err) { console.error(`❌ Failed for ${admin.name}: ${err.message}`); }
  }
  console.log(`\nDone — ${sent} sent, ${skipped} skipped.`);
}

main().catch(e=>{console.error("Fatal:",e.message);process.exit(1);});
