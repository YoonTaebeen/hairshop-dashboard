// =============================================
// 헤어샵 대시보드 앱 - app.js (기간별 조회 추가)
// =============================================

const SUPABASE_URL = 'https://xpdtgmytotifewnznqvf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhwZHRnbXl0b3RpZmV3bnpucXZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNjgxMDMsImV4cCI6MjA4OTc0NDEwM30.SLc727NOuRnYtRsXdsnJq42MHNl9KIF2KDOwwIDUk_0';

const DAYS = ['일','월','화','수','목','금','토'];
const now = new Date();

// 날짜 헤더
document.getElementById('headerDate').textContent =
  `${now.getFullYear()}년 ${now.getMonth()+1}월 ${now.getDate()}일 ${DAYS[now.getDay()]}요일`;

// 탭 전환
let currentPage = 'today';
function switchPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === name));
  document.querySelectorAll('.tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', ['today','week','month','range','stats'][i] === name);
  });
  currentPage = name;
  if (name === 'today')  loadToday();
  if (name === 'week')   loadWeek();
  if (name === 'month')  loadMonth();
  if (name === 'range')  initRange();
  if (name === 'stats')  loadStats();
}

// DB 조회
async function sbGet(table, params = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k,v));
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const won = n => Number(n||0).toLocaleString('ko-KR');
const toDateStr = d => d.toISOString().slice(0,10);
function timeToMin(t) { if(!t) return 0; const [h,m]=t.split(':').map(Number); return h*60+m; }
function minToTime(m) { const h=Math.floor(m/60)%24,min=m%60; return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`; }

// ── 오늘 ──────────────────────────────────
async function loadToday() {
  const today = toDateStr(new Date());
  try {
    const bookings = await sbGet('bookings', { booking_date:`eq.${today}`, order:'booking_time.asc', select:'*' });
    const active = bookings.filter(b=>b.status!=='cancelled');
    const cancelled = bookings.filter(b=>b.status==='cancelled');
    const revenue = active.reduce((s,b)=>s+(b.service_price||0),0);
    document.getElementById('todayCount').textContent = active.length+'건';
    document.getElementById('todayCancelCount').textContent = cancelled.length?`취소 ${cancelled.length}건`:'취소 없음';
    document.getElementById('todayCancelCount').className = 'stat-sub '+(cancelled.length?'down':'up');
    document.getElementById('todayRevenue').textContent = won(revenue);
    renderBookings(bookings, 'todayBookings');
  } catch(e) {
    document.getElementById('todayBookings').innerHTML = `<div class="empty">데이터를 불러오지 못했어요<br><small>${e.message}</small></div>`;
  }
}

function renderBookings(bookings, elId) {
  const el = document.getElementById(elId);
  if (!bookings.length) { el.innerHTML = '<div class="empty">예약이 없어요</div>'; return; }
  el.innerHTML = bookings.map(b => {
    const endMin = timeToMin(b.booking_time)+(b.duration_min||60);
    const endStr = minToTime(endMin);
    const cls = b.status==='cancelled'?'cancelled':b.is_new_customer?'new-customer':'';
    const tagCls = b.status==='confirmed'?'tag-confirmed':b.status==='completed'?'tag-completed':'tag-cancelled';
    const tagTxt = b.status==='confirmed'?'예약확정':b.status==='completed'?'시술완료':'취소됨';
    const priceCls = b.status==='cancelled'?'booking-price cancelled':'booking-price';
    return `<div class="booking-card ${cls}">
      <div class="time-col"><div class="time-main">${b.booking_time?.slice(0,5)||''}</div><div class="time-end">~${endStr}</div></div>
      <div class="vline"></div>
      <div class="booking-info">
        <div class="booking-name">${b.customer_name}</div>
        <div class="booking-service">${b.service_name}</div>
        <div class="booking-tags">
          <span class="tag ${tagCls}">${tagTxt}</span>
          ${b.is_new_customer?'<span class="tag tag-new">신규</span>':''}
        </div>
      </div>
      <div class="${priceCls}">${won(b.service_price)}원</div>
    </div>`;
  }).join('');
}

// ── 주간 ──────────────────────────────────
async function loadWeek() {
  const n=new Date(), mon=new Date(n); mon.setDate(n.getDate()-((n.getDay()+6)%7));
  const sun=new Date(mon); sun.setDate(mon.getDate()+6);
  try {
    const bookings = await sbGet('bookings', {
      booking_date:`gte.${toDateStr(mon)}`, and:`(booking_date.lte.${toDateStr(sun)})`,
      select:'booking_date,booking_time,service_price,status'
    });
    const active=bookings.filter(b=>b.status!=='cancelled');
    const cancelled=bookings.filter(b=>b.status==='cancelled');
    const revenue=active.reduce((s,b)=>s+(b.service_price||0),0);
    const cancelRate=bookings.length?Math.round(cancelled.length/bookings.length*100):0;
    document.getElementById('weekCount').textContent=active.length+'건';
    document.getElementById('weekRevenue').textContent=won(revenue);
    document.getElementById('weekCancelRate').textContent=`취소율 ${cancelRate}%`;
    document.getElementById('weekCancelRate').className='stat-sub '+(cancelRate>10?'down':'up');
    const dayMap={일:0,월:0,화:0,수:0,목:0,금:0,토:0};
    active.forEach(b=>{ const d=new Date(b.booking_date); dayMap[DAYS[d.getDay()]]+=(b.service_price||0); });
    const maxVal=Math.max(...Object.values(dayMap),1);
    const today=DAYS[new Date().getDay()];
    document.getElementById('weeklyBars').innerHTML=Object.entries(dayMap).map(([day,val])=>{
      const pct=Math.round(val/maxVal*100);
      const cls=day===today?'best':'primary';
      return `<div class="bar-item"><div class="bar-item-label">${day}요일</div><div class="bar-track"><div class="bar-fill ${cls}" style="width:${pct}%">${pct>20?pct+'%':''}</div></div><div class="bar-item-val">${won(val)}원</div></div>`;
    }).join('');
  } catch(e) { document.getElementById('weeklyBars').innerHTML=`<div class="empty">오류: ${e.message}</div>`; }
}

// ── 월간 ──────────────────────────────────
async function loadMonth() {
  const y=now.getFullYear(),m=now.getMonth();
  const first=toDateStr(new Date(y,m,1)), last=toDateStr(new Date(y,m+1,0));
  try {
    const bookings=await sbGet('bookings',{booking_date:`gte.${first}`,and:`(booking_date.lte.${last})`,select:'service_name,service_price,status'});
    const completed=bookings.filter(b=>b.status==='completed');
    const cancelled=bookings.filter(b=>b.status==='cancelled');
    const revenue=completed.reduce((s,b)=>s+(b.service_price||0),0);
    const cancelRate=bookings.length?Math.round(cancelled.length/bookings.length*100*10)/10:0;
    document.getElementById('monthCount').textContent=(bookings.length-cancelled.length)+'건';
    document.getElementById('monthRevenue').textContent=won(revenue);
    document.getElementById('monthCancelRate').textContent=`취소율 ${cancelRate}%`;
    const svcMap={};
    completed.forEach(b=>{ svcMap[b.service_name]=(svcMap[b.service_name]||0)+(b.service_price||0); });
    const sorted=Object.entries(svcMap).sort((a,b)=>b[1]-a[1]);
    const maxVal=sorted[0]?.[1]||1;
    document.getElementById('monthlyServiceBars').innerHTML=sorted.map(([name,val],i)=>{
      const pct=Math.round(val/maxVal*100);
      const cls=i===0?'best':'green';
      return `<div class="bar-item"><div class="bar-item-label">${name}</div><div class="bar-track"><div class="bar-fill ${cls}" style="width:${pct}%">${pct>15?pct+'%':''}</div></div><div class="bar-item-val">${won(val)}원</div></div>`;
    }).join('')||'<div class="empty">완료된 시술 없음</div>';
  } catch(e) { document.getElementById('monthlyServiceBars').innerHTML=`<div class="empty">오류: ${e.message}</div>`; }
}

// ── 기간별 조회 (신규) ──────────────────────
function initRange() {
  // 기본값: 이번달 1일 ~ 오늘
  const y=now.getFullYear(), m=now.getMonth();
  if (!document.getElementById('dateFrom').value) {
    document.getElementById('dateFrom').value = toDateStr(new Date(y,m,1));
    document.getElementById('dateTo').value   = toDateStr(now);
  }
}

async function loadRange() {
  const from = document.getElementById('dateFrom').value;
  const to   = document.getElementById('dateTo').value;
  if (!from || !to) { alert('날짜를 선택해주세요'); return; }
  if (from > to) { alert('시작일이 종료일보다 늦습니다'); return; }

  const resultEl = document.getElementById('rangeResult');
  resultEl.innerHTML = '<div class="loading">조회 중...</div>';

  try {
    const bookings = await sbGet('bookings', {
      booking_date: `gte.${from}`,
      and: `(booking_date.lte.${to})`,
      order: 'booking_date.asc,booking_time.asc',
      select: '*'
    });

    const active    = bookings.filter(b=>b.status!=='cancelled');
    const cancelled = bookings.filter(b=>b.status==='cancelled');
    const completed = bookings.filter(b=>b.status==='completed');
    const revenue   = active.reduce((s,b)=>s+(b.service_price||0),0);
    const cancelRate= bookings.length?Math.round(cancelled.length/bookings.length*100*10)/10:0;
    const avgPrice  = active.length?Math.round(revenue/active.length):0;

    // 시술별 집계
    const svcMap={};
    active.forEach(b=>{ if(!svcMap[b.service_name]){svcMap[b.service_name]={count:0,revenue:0};} svcMap[b.service_name].count++; svcMap[b.service_name].revenue+=(b.service_price||0); });
    const svcSorted=Object.entries(svcMap).sort((a,b)=>b[1].revenue-a[1].revenue);

    resultEl.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">총 예약</div><div class="stat-value">${active.length}건</div><div class="stat-sub down">취소 ${cancelled.length}건</div></div>
        <div class="stat-card"><div class="stat-label">총 매출</div><div class="stat-value">${won(revenue)}</div><div class="stat-sub">원</div></div>
        <div class="stat-card"><div class="stat-label">평균 객단가</div><div class="stat-value">${won(avgPrice)}</div><div class="stat-sub">원</div></div>
        <div class="stat-card"><div class="stat-label">취소율</div><div class="stat-value">${cancelRate}%</div></div>
      </div>
      <div class="section-title">시술별 매출</div>
      <div class="bar-list">
        ${svcSorted.map(([name,d],i)=>{
          const maxV=svcSorted[0][1].revenue||1;
          const pct=Math.round(d.revenue/maxV*100);
          return `<div class="bar-item"><div class="bar-item-label">${name}</div><div class="bar-track"><div class="bar-fill ${i===0?'best':'green'}" style="width:${pct}%">${d.count}건</div></div><div class="bar-item-val">${won(d.revenue)}원</div></div>`;
        }).join('')||'<div class="empty">데이터 없음</div>'}
      </div>
      <div class="section-title" style="margin-top:16px">예약 목록 (${bookings.length}건)</div>
      <div class="booking-list" id="rangeBookings"></div>
    `;
    renderBookings(bookings, 'rangeBookings');
  } catch(e) {
    resultEl.innerHTML = `<div class="empty">오류: ${e.message}</div>`;
  }
}

// 빠른 선택 버튼
function setRange(type) {
  const y=now.getFullYear(), m=now.getMonth(), d=now.getDate();
  let from, to = toDateStr(now);
  if (type==='today')     { from=toDateStr(now); }
  else if (type==='week') { const mon=new Date(now); mon.setDate(d-((now.getDay()+6)%7)); from=toDateStr(mon); }
  else if (type==='month'){ from=toDateStr(new Date(y,m,1)); }
  else if (type==='3month'){from=toDateStr(new Date(y,m-2,1)); }
  else if (type==='year') { from=`${y}-01-01`; }
  document.getElementById('dateFrom').value=from;
  document.getElementById('dateTo').value=to;
  loadRange();
}

// ── 분석 ──────────────────────────────────
async function loadStats() {
  const y=now.getFullYear();
  try {
    const all=await sbGet('bookings',{booking_date:`gte.${y}-01-01`,select:'service_name,service_price,status,is_new_customer'});
    const completed=all.filter(b=>b.status==='completed');
    const cancelled=all.filter(b=>b.status==='cancelled');
    const revenue=completed.reduce((s,b)=>s+(b.service_price||0),0);
    const avgPrice=completed.length?Math.round(revenue/completed.length):0;
    const cancelRate=all.length?Math.round(cancelled.length/all.length*100*10)/10:0;
    const newCust=all.filter(b=>b.is_new_customer).length;
    const newRate=all.length?Math.round(newCust/all.length*100*10)/10:0;
    document.getElementById('yearRevenue').textContent=won(revenue);
    document.getElementById('avgPrice').textContent=won(avgPrice);
    document.getElementById('cancelRate').textContent=cancelRate+'%';
    document.getElementById('newCustRate').textContent=newRate+'%';
    const svcMap={};
    all.filter(b=>b.status!=='cancelled').forEach(b=>{ if(!svcMap[b.service_name]){svcMap[b.service_name]={count:0,revenue:0};} svcMap[b.service_name].count++; svcMap[b.service_name].revenue+=(b.service_price||0); });
    const sorted=Object.entries(svcMap).sort((a,b)=>b[1].revenue-a[1].revenue);
    const maxVal=sorted[0]?.[1].revenue||1;
    document.getElementById('serviceRankBars').innerHTML=sorted.slice(0,5).map(([name,d],i)=>{
      const pct=Math.round(d.revenue/maxVal*100);
      const cls=i===0?'best':'purple';
      return `<div class="bar-item"><div class="bar-item-label">${i+1}위 ${name}</div><div class="bar-track"><div class="bar-fill ${cls}" style="width:${pct}%">${d.count}건</div></div><div class="bar-item-val">${won(d.revenue)}원</div></div>`;
    }).join('')||'<div class="empty">데이터 없음</div>';
  } catch(e) { document.getElementById('serviceRankBars').innerHTML=`<div class="empty">오류: ${e.message}</div>`; }
}

// 초기 로드
loadToday();
setInterval(()=>{ if(currentPage==='today') loadToday(); }, 5*60*1000);
