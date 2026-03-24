// =============================================
// 헤어샵 대시보드 app.js
// 네이버 예약 메일 정확 파싱 버전
// =============================================

const SUPABASE_URL = 'https://xpdtgmytotifewnznqvf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhwZHRnbXl0b3RpZmV3bnpucXZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNjgxMDMsImV4cCI6MjA4OTc0NDEwM30.SLc727NOuRnYtRsXdsnJq42MHNl9KIF2KDOwwIDUk_0';

const DAYS = ['일','월','화','수','목','금','토'];
const COLORS = ['#1a73e8','#34a853','#fbbc04','#ea4335','#9c27b0','#00bcd4','#ff9800','#795548'];
const now = new Date();
const charts = {};
let scheduleData = [];
let currentPage = 'today';

Chart.defaults.font.family = "-apple-system,'Apple SD Gothic Neo','Noto Sans KR',sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.color = '#9e9e9e';

document.getElementById('headerDate').textContent =
  `${now.getFullYear()}년 ${now.getMonth()+1}월 ${now.getDate()}일 ${DAYS[now.getDay()]}요일`;

// ── 완전 새로고침 ──────────────────────────────
function hardRefresh() {
  Object.keys(charts).forEach(k => { if(charts[k]) { charts[k].destroy(); delete charts[k]; } });
  scheduleData = [];
  if (currentPage==='today')    loadToday();
  else if (currentPage==='schedule') loadSchedule();
  else if (currentPage==='week')  loadWeek();
  else if (currentPage==='month') loadMonth();
  else if (currentPage==='stats') loadStats();
  const btn = document.querySelector('.refresh-top-btn');
  if(btn){ btn.style.transform='rotate(360deg)'; btn.style.transition='transform 0.5s'; setTimeout(()=>{btn.style.transform='';btn.style.transition='';},500); }
}

// ── 탭 전환 ────────────────────────────────────
function switchPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === name));
  document.querySelectorAll('.tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', ['today','schedule','week','month','walkin','stats','color'][i] === name);
  });
  currentPage = name;
  if (name==='today')    loadToday();
  if (name==='schedule') initSchedule();
  if (name==='week')     loadWeek();
  if (name==='month')    loadMonth();
  if (name==='walkin')   initWalkin();
  if (name==='stats')    loadStats();
  if (name==='color')    loadColor();
}

// ── DB 조회 ────────────────────────────────────
async function sbGet(table, params={}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k,v));
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
               'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const won = n => Number(n||0).toLocaleString('ko-KR');
const toDateStr = d => d.toISOString().slice(0,10);
function timeToMin(t) { if(!t) return 0; const[h,m]=t.split(':').map(Number); return h*60+m; }
function minToTime(m) { const h=Math.floor(m/60)%24,mn=m%60; return `${String(h).padStart(2,'0')}:${String(mn).padStart(2,'0')}`; }
function destroyChart(id) { if(charts[id]) { charts[id].destroy(); delete charts[id]; } }
function makeLegend(elId, labels, colors) {
  const el=document.getElementById(elId);
  if(el) el.innerHTML=labels.map((l,i)=>`<div class="legend-item"><div class="legend-dot" style="background:${colors[i]}"></div>${l}</div>`).join('');
}

// ── 네이버 시간 파싱 ────────────────────────────
// "2026.03.21.(토) 오후 4:00" → {date:"2026-03-21", time:"16:00:00"}
// "2026.03.20. 17:51:38"     → {date:"2026-03-20", time:"17:51:38"}
function parseNaverDateTime(str) {
  if (!str) return null;
  str = str.trim();

  // 형식1: "2026.03.21.(토) 오후 4:00" 또는 "2026.03.21.(토) 오전 11:30"
  let m = str.match(/(\d{4})\.(\d{2})\.(\d{2})\.[^오]*([오전후]+)\s+(\d{1,2}):(\d{2})/);
  if (m) {
    let h = parseInt(m[5]);
    const min = m[6];
    if (m[4] === '오후' && h < 12) h += 12;
    if (m[4] === '오전' && h === 12) h = 0;
    return {
      date: `${m[1]}-${m[2]}-${m[3]}`,
      time: `${String(h).padStart(2,'0')}:${min}:00`
    };
  }

  // 형식2: "2026.03.20. 17:51:38" (신청/취소 일시)
  m = str.match(/(\d{4})\.(\d{2})\.(\d{2})\.\s*(\d{2}):(\d{2}):(\d{2})/);
  if (m) {
    return {
      date: `${m[1]}-${m[2]}-${m[3]}`,
      time: `${m[4]}:${m[5]}:${m[6]}`
    };
  }

  return null;
}

// ── 예약 카드 HTML ──────────────────────────────
function bookingCardHtml(b) {
  const endStr  = minToTime(timeToMin(b.booking_time) + (b.duration_min||60));
  const statusMap  = { confirmed:'예약확정', completed:'시술완료', cancelled:'취소됨', changed:'예약변경' };
  const tagClsMap  = { confirmed:'tag-confirmed', completed:'tag-completed', cancelled:'tag-cancelled', changed:'tag-changed' };
  const cardCls = b.status + (b.is_new_customer?' new-customer':'');
  const priceCls = b.status==='cancelled' ? 'cancelled' : '';

  // 부가 날짜 정보
  let dateInfo = '';
  if (b.status==='cancelled' && b.cancel_datetime) {
    dateInfo = `<div class="booking-meta">🚫 취소: ${b.cancel_datetime}</div>`;
  } else if (b.status==='changed' && b.request_datetime) {
    dateInfo = `<div class="booking-meta">🔄 변경: ${b.request_datetime}</div>`;
  }

  // 요청사항
  const memoHtml = b.memo
    ? `<div class="booking-memo">💬 ${b.memo}</div>`
    : '';

  return `<div class="booking-card ${cardCls}">
    ${!b.booking_no ? `<button class="delete-x" onclick="deleteBooking(${b.id})" title="삭제">✕</button>` : ''}
    <div class="time-col">
      <div class="time-main">${b.booking_time?.slice(0,5)||'--:--'}</div>
      <div class="time-end">~${endStr}</div>
    </div>
    <div class="vline"></div>
    <div class="booking-body">
      <div class="booking-top">
        <div class="booking-info">
          <div class="booking-name">${b.customer_name}</div>
          <div class="booking-service">${b.service_name}</div>
          <div class="booking-tags">
            <span class="tag ${tagClsMap[b.status]||'tag-confirmed'}">${statusMap[b.status]||b.status}</span>
            ${b.is_changed?'<span class="tag tag-changed">🔄변경</span>':''}
            ${!b.booking_no?'<span class="tag tag-walkin">현장</span>':''}
            ${b.is_new_customer?'<span class="tag tag-new">신규</span>':''}
          </div>
          ${dateInfo}
        </div>
        <div class="booking-price ${priceCls}">${won(b.service_price)}원</div>
      </div>
      ${memoHtml}
    </div>
  </div>`;
}

function renderBookings(bookings, elId) {
  const el = document.getElementById(elId);
  if (!bookings.length) { el.innerHTML='<div class="empty">예약이 없어요</div>'; return; }
  el.innerHTML = bookings.map(b => bookingCardHtml(b)).join('');
}

// ── 오늘 ───────────────────────────────────────
async function loadToday() {
  document.getElementById('todayBookings').innerHTML = '<div class="loading">불러오는 중...</div>';
  const today = toDateStr(now);
  try {
    const bookings = await sbGet('bookings', { booking_date:`eq.${today}`, order:'booking_time.asc', select:'*' });
    const active    = bookings.filter(b => b.status !== 'cancelled');
    const cancelled = bookings.filter(b => b.status === 'cancelled');
    const changed   = bookings.filter(b => b.status === 'changed');
    const revenue   = active.reduce((s,b) => s+(b.service_price||0), 0);

    document.getElementById('todayCount').textContent = active.length+'건';
    document.getElementById('todayCancelCount').textContent =
      (cancelled.length||changed.length) ? `취소 ${cancelled.length}건 / 변경 ${changed.length}건` : '취소·변경 없음';
    document.getElementById('todayCancelCount').className = 'stat-sub '+((cancelled.length||changed.length)?'down':'up');
    document.getElementById('todayRevenue').textContent = won(revenue);

    const hours = Array.from({length:12},(_,i)=>i+9);
    const hourMap = {}; hours.forEach(h => hourMap[h]=0);
    active.forEach(b => { if(b.booking_time){ const h=parseInt(b.booking_time.split(':')[0]); if(hourMap[h]!==undefined) hourMap[h]++; } });

    destroyChart('todayTimeChart');
    charts['todayTimeChart'] = new Chart(document.getElementById('todayTimeChart'), {
      type:'bar',
      data:{ labels:hours.map(h=>`${h}시`), datasets:[{ label:'예약',
        data:hours.map(h=>hourMap[h]),
        backgroundColor:hours.map(h=>hourMap[h]>0?'rgba(26,115,232,0.85)':'rgba(26,115,232,0.12)'),
        borderRadius:6, borderSkipped:false }]},
      options:{ plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true,ticks:{stepSize:1}},x:{grid:{display:false}}}, maintainAspectRatio:true }
    });

    renderBookings(bookings, 'todayBookings');
  } catch(e) {
    document.getElementById('todayBookings').innerHTML = `<div class="empty">오류: ${e.message}</div>`;
  }
}

// ── 스케줄 ─────────────────────────────────────
function initSchedule() {
  if (!document.getElementById('schFrom').value) {
    const yesterday = new Date(now); yesterday.setDate(now.getDate()-1);
    const nextWeek  = new Date(now); nextWeek.setDate(now.getDate()+7);
    document.getElementById('schFrom').value = toDateStr(yesterday);
    document.getElementById('schTo').value   = toDateStr(nextWeek);
  }
  loadSchedule();
}

function setSchRange(type) {
  const d = now.getDate(), y=now.getFullYear(), m=now.getMonth();
  let from, to;
  if (type==='today') { from=toDateStr(now); to=toDateStr(now); }
  else if (type==='3days') { const f=new Date(now); f.setDate(d-1); from=toDateStr(f); const t=new Date(now); t.setDate(d+1); to=toDateStr(t); }
  else if (type==='week') { const mn=new Date(now); mn.setDate(d-((now.getDay()+6)%7)); from=toDateStr(mn); const su=new Date(mn); su.setDate(mn.getDate()+6); to=toDateStr(su); }
  else if (type==='month') { from=toDateStr(new Date(y,m,1)); to=toDateStr(new Date(y,m+1,0)); }
  document.getElementById('schFrom').value=from;
  document.getElementById('schTo').value=to;
  loadSchedule();
}

async function loadSchedule() {
  const from=document.getElementById('schFrom').value, to=document.getElementById('schTo').value;
  if (!from||!to) return;
  document.getElementById('scheduleList').innerHTML='<div class="loading">스케줄 불러오는 중...</div>';
  try {
    const bookings = await sbGet('bookings', {
      booking_date:`gte.${from}`, and:`(booking_date.lte.${to})`,
      order:'booking_date.asc,booking_time.asc', select:'*'
    });
    scheduleData = bookings;

    const confirmed = bookings.filter(b=>b.status==='confirmed'||b.status==='completed');
    const cancelled = bookings.filter(b=>b.status==='cancelled');
    const walkin    = bookings.filter(b=>!b.booking_no); // 예약번호 없음 = 현장고객

    document.getElementById('schTotal').textContent     = bookings.length+'건';
    document.getElementById('schCancel').textContent    = cancelled.length+'건';
    document.getElementById('schWalkin').textContent    = walkin.length+'건';
    document.getElementById('schConfirmed').textContent = confirmed.length+'건';

    renderSchedule(bookings);
    renderScheduleStats(bookings, from, to);
  } catch(e) {
    document.getElementById('scheduleList').innerHTML=`<div class="empty">오류: ${e.message}</div>`;
  }
}

function filterSchedule(type, btn) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const filtered = type==='all' ? scheduleData : scheduleData.filter(b=>b.status===type);
  renderSchedule(filtered);
}

function renderSchedule(bookings) {
  const el = document.getElementById('scheduleList');
  if (!bookings.length) { el.innerHTML='<div class="empty">해당 기간 예약이 없어요</div>'; return; }

  const todayStr = toDateStr(now);
  const tomorrowStr = toDateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate()+1));

  // 날짜별 그룹핑
  const grouped = {};
  bookings.forEach(b => { if(!grouped[b.booking_date]) grouped[b.booking_date]=[]; grouped[b.booking_date].push(b); });

  el.innerHTML = Object.entries(grouped).map(([date, list]) => {
    const d = new Date(date);
    const isToday    = date === todayStr;
    const isTomorrow = date === tomorrowStr;
    const dayLabel   = isToday ? '오늘' : isTomorrow ? '내일' : `${d.getMonth()+1}월 ${d.getDate()}일 (${DAYS[d.getDay()]})`;
    const confirmedCnt = list.filter(b=>b.status==='confirmed'||b.status==='completed').length;
    const cancelledCnt = list.filter(b=>b.status==='cancelled').length;
    const changedCnt   = list.filter(b=>b.status==='changed').length;

    const badge = isToday
      ? `<span class="today-badge">TODAY</span>`
      : `<span class="date-badge">${confirmedCnt}확정${cancelledCnt?` / ${cancelledCnt}취소`:''}${changedCnt?` / ${changedCnt}변경`:''}</span>`;

    return `<div class="date-section">
      <div class="date-header">${dayLabel} ${badge}</div>
      <div class="booking-list">${list.map(b=>bookingCardHtml(b)).join('')}</div>
    </div>`;
  }).join('');
}

// ── 주간 ───────────────────────────────────────
async function loadWeek() {
  const n=new Date(), mon=new Date(n); mon.setDate(n.getDate()-((n.getDay()+6)%7));
  const sun=new Date(mon); sun.setDate(mon.getDate()+6);
  try {
    const bk=await sbGet('bookings',{booking_date:`gte.${toDateStr(mon)}`,and:`(booking_date.lte.${toDateStr(sun)})`,select:'booking_date,service_price,status'});
    const active=bk.filter(b=>b.status!=='cancelled'), cancelled=bk.filter(b=>b.status==='cancelled');
    const revenue=active.reduce((s,b)=>s+(b.service_price||0),0);
    const cancelRate=bk.length?Math.round(cancelled.length/bk.length*100):0;
    document.getElementById('weekCount').textContent=active.length+'건';
    document.getElementById('weekRevenue').textContent=won(revenue);
    document.getElementById('weekCancelRate').textContent=`취소율 ${cancelRate}%`;
    document.getElementById('weekCancelRate').className='stat-sub '+(cancelRate>10?'down':'up');

    const dayRevMap={0:0,1:0,2:0,3:0,4:0,5:0,6:0}, dayCntMap={0:0,1:0,2:0,3:0,4:0,5:0,6:0};
    active.forEach(b=>{ const idx=(new Date(b.booking_date).getDay()+6)%7; dayRevMap[idx]+=(b.service_price||0); dayCntMap[idx]++; });
    const todayIdx=(now.getDay()+6)%7;

    destroyChart('weekBarChart');
    charts['weekBarChart']=new Chart(document.getElementById('weekBarChart'),{
      type:'bar',
      data:{labels:['월','화','수','목','금','토','일'],datasets:[
        {label:'매출(원)',data:Object.values(dayRevMap),backgroundColor:['월','화','수','목','금','토','일'].map((_,i)=>i===todayIdx?'rgba(26,115,232,0.9)':'rgba(26,115,232,0.3)'),borderRadius:8,borderSkipped:false,yAxisID:'y'},
        {label:'예약건',data:Object.values(dayCntMap),type:'line',borderColor:'#34a853',backgroundColor:'rgba(52,168,83,.1)',pointBackgroundColor:'#34a853',pointRadius:4,fill:true,tension:.4,yAxisID:'y1'}
      ]},
      options:{plugins:{legend:{position:'top',labels:{boxWidth:10,padding:12}}},scales:{y:{beginAtZero:true,position:'left',grid:{display:false}},y1:{beginAtZero:true,position:'right',grid:{display:false},ticks:{stepSize:1}}},maintainAspectRatio:true}
    });

    destroyChart('weekDonutChart');
    charts['weekDonutChart']=new Chart(document.getElementById('weekDonutChart'),{
      type:'doughnut',
      data:{labels:['예약','취소','변경'],datasets:[{
        data:[active.filter(b=>b.status==='confirmed'||b.status==='completed').length, cancelled.length, bk.filter(b=>b.status==='changed').length],
        backgroundColor:['#1a73e8','#ea4335','#ff9800'],borderWidth:0,hoverOffset:4}]},
      options:{plugins:{legend:{display:false}},cutout:'70%',maintainAspectRatio:true}
    });
    makeLegend('weekLegend',['예약','취소','변경'],['#1a73e8','#ea4335','#ff9800']);
  } catch(e){ console.error(e); }
}

// ── 월간 ───────────────────────────────────────
async function loadMonth() {
  const y=now.getFullYear(),m=now.getMonth();
  const first=toDateStr(new Date(y,m,1)), last=toDateStr(new Date(y,m+1,0));
  try {
    const bk=await sbGet('bookings',{booking_date:`gte.${first}`,and:`(booking_date.lte.${last})`,select:'booking_date,service_name,service_price,status'});
    const active=bk.filter(b=>b.status!=='cancelled'), cancelled=bk.filter(b=>b.status==='cancelled');
    const revenue=active.reduce((s,b)=>s+(b.service_price||0),0);
    const cancelRate=bk.length?Math.round(cancelled.length/bk.length*100*10)/10:0;
    document.getElementById('monthCount').textContent=active.length+'건';
    document.getElementById('monthRevenue').textContent=won(revenue);
    document.getElementById('monthCancelRate').textContent=`취소율 ${cancelRate}%`;

    const daysInMonth=new Date(y,m+1,0).getDate();
    const dayRevMap={}; for(let i=1;i<=daysInMonth;i++) dayRevMap[i]=0;
    active.forEach(b=>{const d=new Date(b.booking_date).getDate(); dayRevMap[d]+=(b.service_price||0);});

    destroyChart('monthLineChart');
    charts['monthLineChart']=new Chart(document.getElementById('monthLineChart'),{
      type:'line',
      data:{labels:Array.from({length:daysInMonth},(_,i)=>`${i+1}일`),datasets:[{label:'일별 매출',data:Object.values(dayRevMap),borderColor:'#1a73e8',backgroundColor:'rgba(26,115,232,.1)',fill:true,tension:.4,pointRadius:3,pointBackgroundColor:'#1a73e8'}]},
      options:{plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:'rgba(0,0,0,.05)'}},x:{ticks:{maxTicksLimit:10},grid:{display:false}}},maintainAspectRatio:true}
    });

    const svcMap={};
    active.forEach(b=>{svcMap[b.service_name]=(svcMap[b.service_name]||0)+(b.service_price||0);});
    const svcEntries=Object.entries(svcMap).sort((a,b)=>b[1]-a[1]);
    const svcColors=svcEntries.map((_,i)=>COLORS[i%COLORS.length]);

    destroyChart('monthPieChart');
    charts['monthPieChart']=new Chart(document.getElementById('monthPieChart'),{
      type:'doughnut',
      data:{labels:svcEntries.map(([k])=>k),datasets:[{data:svcEntries.map(([,v])=>v),backgroundColor:svcColors,borderWidth:0,hoverOffset:4}]},
      options:{plugins:{legend:{display:false}},cutout:'65%',maintainAspectRatio:true}
    });
    makeLegend('monthLegend',svcEntries.map(([k])=>k),svcColors);
  } catch(e){ console.error(e); }
}

// ── 기간별 ─────────────────────────────────────
function initRange() {
  if (!document.getElementById('dateFrom').value) {
    document.getElementById('dateFrom').value = toDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
    document.getElementById('dateTo').value   = toDateStr(now);
  }
}

async function loadRange() {
  const from=document.getElementById('dateFrom').value, to=document.getElementById('dateTo').value;
  if (!from||!to) { alert('날짜를 선택해주세요'); return; }
  const resultEl=document.getElementById('rangeResult');
  resultEl.innerHTML='<div class="loading">조회 중...</div>';
  try {
    const bk=await sbGet('bookings',{booking_date:`gte.${from}`,and:`(booking_date.lte.${to})`,order:'booking_date.asc,booking_time.asc',select:'*'});
    const active=bk.filter(b=>b.status!=='cancelled'), cancelled=bk.filter(b=>b.status==='cancelled');
    const changed=bk.filter(b=>b.status==='changed');
    const revenue=active.reduce((s,b)=>s+(b.service_price||0),0);
    const cancelRate=bk.length?Math.round(cancelled.length/bk.length*100*10)/10:0;
    const avgPrice=active.length?Math.round(revenue/active.length):0;

    const svcMap={};
    active.forEach(b=>{if(!svcMap[b.service_name]){svcMap[b.service_name]={count:0,revenue:0};} svcMap[b.service_name].count++;svcMap[b.service_name].revenue+=(b.service_price||0);});
    const svcEntries=Object.entries(svcMap).sort((a,b)=>b[1].revenue-a[1].revenue);

    resultEl.innerHTML=`
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">총 예약</div><div class="stat-value blue">${active.length}건</div><div class="stat-sub down">취소 ${cancelled.length} / 변경 ${changed.length}건</div></div>
        <div class="stat-card"><div class="stat-label">총 매출</div><div class="stat-value green">${won(revenue)}</div><div class="stat-sub">원</div></div>
        <div class="stat-card"><div class="stat-label">평균 객단가</div><div class="stat-value purple">${won(avgPrice)}</div><div class="stat-sub">원</div></div>
        <div class="stat-card"><div class="stat-label">취소율</div><div class="stat-value red">${cancelRate}%</div></div>
      </div>
      <div class="card">
        <div class="card-title">기간 내 매출 추이</div>
        <div class="chart-wrap tall"><canvas id="rangeLineChart"></canvas></div>
      </div>
      <div class="card">
        <div class="card-title">시술별 매출</div>
        <div class="chart-wrap tall"><canvas id="rangeSvcChart"></canvas></div>
      </div>
      <div class="card">
        <div class="card-title">예약 목록 (${bk.length}건)</div>
        <div class="booking-list" id="rangeBookings"></div>
      </div>`;

    const dateMap={};
    active.forEach(b=>{dateMap[b.booking_date]=(dateMap[b.booking_date]||0)+(b.service_price||0);});
    const dateKeys=Object.keys(dateMap).sort();

    destroyChart('rangeLineChart');
    charts['rangeLineChart']=new Chart(document.getElementById('rangeLineChart'),{
      type:'line',
      data:{labels:dateKeys.map(d=>d.slice(5)),datasets:[{label:'매출',data:dateKeys.map(k=>dateMap[k]),borderColor:'#1a73e8',backgroundColor:'rgba(26,115,232,.1)',fill:true,tension:.4,pointRadius:3,pointBackgroundColor:'#1a73e8'}]},
      options:{plugins:{legend:{display:false}},scales:{y:{beginAtZero:true},x:{ticks:{maxTicksLimit:10},grid:{display:false}}},maintainAspectRatio:true}
    });

    const svcColors=svcEntries.map((_,i)=>COLORS[i%COLORS.length]);
    destroyChart('rangeSvcChart');
    charts['rangeSvcChart']=new Chart(document.getElementById('rangeSvcChart'),{
      type:'bar',
      data:{labels:svcEntries.map(([k])=>k),datasets:[{label:'매출',data:svcEntries.map(([,v])=>v.revenue),backgroundColor:svcColors,borderRadius:8,borderSkipped:false}]},
      options:{indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{beginAtZero:true},y:{grid:{display:false}}},maintainAspectRatio:true}
    });

    renderBookings(bk,'rangeBookings');
  } catch(e){ resultEl.innerHTML=`<div class="empty">오류: ${e.message}</div>`; }
}

function setRange(type) {
  const y=now.getFullYear(),m=now.getMonth(),d=now.getDate();
  let from, to=toDateStr(now);
  if(type==='today') from=toDateStr(now);
  else if(type==='week'){const mn=new Date(now);mn.setDate(d-((now.getDay()+6)%7));from=toDateStr(mn);}
  else if(type==='month') from=toDateStr(new Date(y,m,1));
  else if(type==='3month') from=toDateStr(new Date(y,m-2,1));
  else if(type==='year') from=`${y}-01-01`;
  document.getElementById('dateFrom').value=from;
  document.getElementById('dateTo').value=to;
  loadRange();
}

// ── 분석 (올해 전체 강화버전) ──────────────────────────
async function loadStats() {
  const y = now.getFullYear();
  try {
    const all = await sbGet('bookings', {
      booking_date: `gte.${y}-01-01`, 
      select: 'booking_date,booking_time,service_name,service_price,status,is_new_customer,booking_no'
    });
    
    const active = all.filter(b => b.status !== 'cancelled');
    const cancelled = all.filter(b => b.status === 'cancelled');
    const changed = all.filter(b => b.status === 'changed');
    const walkin = all.filter(b => !b.booking_no);
    const newCust = all.filter(b => b.is_new_customer);
    
    const revenue = active.reduce((s, b) => s + (b.service_price || 0), 0);
    const avgPrice = active.length ? Math.round(revenue / active.length) : 0;
    const cancelRate = all.length ? Math.round(cancelled.length / all.length * 100 * 10) / 10 : 0;
    const newRate = all.length ? Math.round(newCust.length / all.length * 100 * 10) / 10 : 0;
    const walkinRate = all.length ? Math.round(walkin.length / all.length * 100 * 10) / 10 : 0;
    
    // 월별 매출+건수
    const monthMap = {}, monthCntMap = {};
    for (let i = 1; i <= 12; i++) { monthMap[i] = 0; monthCntMap[i] = 0; }
    active.forEach(b => {
      const mo = new Date(b.booking_date).getMonth() + 1;
      monthMap[mo] += (b.service_price || 0);
      monthCntMap[mo]++;
    });
    const curMonth = now.getMonth() + 1;
    const monthLabels = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
    const peakMonth = monthLabels[Object.keys(monthMap).reduce((a, b) => monthMap[a] > monthMap[b] ? a : b) - 1];

    // 요일별 매출+건수
    const dayRevMap = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    const dayCntMap = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    active.forEach(b => {
      const idx = (new Date(b.booking_date).getDay() + 6) % 7;
      dayRevMap[idx] += (b.service_price || 0);
      dayCntMap[idx]++;
    });
    const dayLabels = ['월', '화', '수', '목', '금', '토', '일'];
    const peakDay = dayLabels[Object.keys(dayCntMap).reduce((a, b) => dayCntMap[a] > dayCntMap[b] ? a : b)];

    // 시간대별 분포
    const timeMap = { 9: 0, 10: 0, 11: 0, 12: 0, 13: 0, 14: 0, 15: 0, 16: 0, 17: 0, 18: 0, 19: 0, 20: 0 };
    active.forEach(b => {
      if (b.booking_time) {
        const hour = parseInt(b.booking_time.split(':')[0]);
        if (timeMap.hasOwnProperty(hour)) timeMap[hour]++;
      }
    });
    const peakHour = Object.keys(timeMap).reduce((a, b) => timeMap[a] > timeMap[b] ? a : b);
    const timeLabels = Object.keys(timeMap).map(h => h + '시');

    // 시술별 매출+건수
    const svcMap = {};
    active.forEach(b => {
      if (!svcMap[b.service_name]) { svcMap[b.service_name] = { count: 0, revenue: 0 }; }
      svcMap[b.service_name].count++;
      svcMap[b.service_name].revenue += (b.service_price || 0);
    });
    const svcEntries = Object.entries(svcMap).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 8);
    const svcColors = svcEntries.map((_, i) => COLORS[i % COLORS.length]);

    // 일평균 계산 (올해 지난 일수)
    const startOfYear = new Date(y, 0, 1);
    const daysPassed = Math.ceil((now - startOfYear) / (1000 * 60 * 60 * 24)) + 1;
    const avgDailyRev = Math.round(revenue / daysPassed);
    const avgDailyBookings = Math.round(active.length / daysPassed * 10) / 10;
    const yearProgress = Math.round((now - startOfYear) / (1000 * 60 * 60 * 24 * 365) * 100);

    // UI 업데이트
    document.getElementById('yearRevenue').textContent = won(revenue);
    document.getElementById('avgPrice').textContent = won(avgPrice);
    document.getElementById('cancelRate').textContent = cancelRate + '%';
    document.getElementById('newCustRate').textContent = newRate + '%';

    // 추가 통계 업데이트 (기존 HTML에 없는 경우를 위한 안전장치)
    const updateIfExists = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    updateIfExists('totalBookings', active.length + '건');
    updateIfExists('walkinRate', walkinRate + '%');
    updateIfExists('avgDailyRev', won(avgDailyRev));
    updateIfExists('avgDailyBookings', avgDailyBookings + '건');
    updateIfExists('peakMonth', peakMonth);
    updateIfExists('peakDay', peakDay + '요일');
    updateIfExists('peakHour', peakHour + '시');
    updateIfExists('yearProgress', yearProgress + '%');
    updateIfExists('daysPassed', daysPassed + '일');

    // 월별 매출+건수 차트
    destroyChart('yearLineChart');
    charts['yearLineChart'] = new Chart(document.getElementById('yearLineChart'), {
      type: 'bar',
      data: {
        labels: monthLabels,
        datasets: [
          {
            label: '매출(원)', data: Object.values(monthMap),
            backgroundColor: monthLabels.map((_, i) => i + 1 === curMonth ? 'rgba(26,115,232,0.9)' : 'rgba(26,115,232,0.6)'),
            borderRadius: 6, yAxisID: 'y'
          },
          {
            label: '예약건', data: Object.values(monthCntMap), type: 'line',
            borderColor: '#34a853', backgroundColor: 'rgba(52,168,83,.2)',
            pointBackgroundColor: monthLabels.map((_, i) => i + 1 === curMonth ? '#ff6b35' : '#34a853'),
            pointRadius: 5, fill: true, tension: .4, yAxisID: 'y1'
          }
        ]
      },
      options: {
        plugins: { legend: { position: 'top', labels: { boxWidth: 10, padding: 12 } } },
        scales: {
          y: { beginAtZero: true, position: 'left', grid: { color: 'rgba(0,0,0,.05)' } },
          y1: { beginAtZero: true, position: 'right', grid: { display: false }, ticks: { stepSize: 1 } }
        },
        maintainAspectRatio: true
      }
    });

    // 요일별 매출+건수 차트 추가
    if (document.getElementById('dayChart')) {
      destroyChart('dayChart');
      charts['dayChart'] = new Chart(document.getElementById('dayChart'), {
        type: 'bar',
        data: {
          labels: dayLabels,
          datasets: [
            {
              label: '매출(원)', data: Object.values(dayRevMap),
              backgroundColor: dayLabels.map(d => d === peakDay ? 'rgba(26,115,232,0.9)' : 'rgba(26,115,232,0.5)'),
              borderRadius: 6, yAxisID: 'y'
            },
            {
              label: '예약건', data: Object.values(dayCntMap), type: 'line',
              borderColor: '#34a853', backgroundColor: 'rgba(52,168,83,.2)',
              pointBackgroundColor: dayLabels.map(d => d === peakDay ? '#ff6b35' : '#34a853'),
              pointRadius: 5, fill: true, tension: .4, yAxisID: 'y1'
            }
          ]
        },
        options: {
          plugins: { legend: { position: 'top', labels: { boxWidth: 10, padding: 10 } } },
          scales: {
            y: { beginAtZero: true, position: 'left', grid: { display: false } },
            y1: { beginAtZero: true, position: 'right', grid: { display: false }, ticks: { stepSize: 1 } }
          },
          maintainAspectRatio: true
        }
      });
    }

    // 시간대별 차트 추가
    if (document.getElementById('timeChart')) {
      destroyChart('timeChart');
      charts['timeChart'] = new Chart(document.getElementById('timeChart'), {
        type: 'bar',
        data: {
          labels: timeLabels,
          datasets: [{
            label: '예약건수', data: Object.values(timeMap),
            backgroundColor: Object.keys(timeMap).map(h => h == peakHour ? 'rgba(255,107,53,0.9)' : 'rgba(26,115,232,0.6)'),
            borderRadius: 6
          }]
        },
        options: {
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: 'rgba(0,0,0,.05)' } },
            x: { grid: { display: false } }
          },
          maintainAspectRatio: true
        }
      });
    }

    // 시술별 가로 바차트 (기존 개선)
    destroyChart('serviceBarChart');
    charts['serviceBarChart'] = new Chart(document.getElementById('serviceBarChart'), {
      type: 'bar',
      data: {
        labels: svcEntries.map(([k]) => k.length > 12 ? k.slice(0, 12) + '…' : k),
        datasets: [
          { label: '매출(원)', data: svcEntries.map(([, v]) => v.revenue), backgroundColor: svcColors, borderRadius: 6, yAxisID: 'y' },
          { label: '건수', data: svcEntries.map(([, v]) => v.count), type: 'line', borderColor: '#fbbc04', pointBackgroundColor: '#fbbc04', pointRadius: 4, fill: false, yAxisID: 'y1' }
        ]
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { position: 'top', labels: { boxWidth: 10, padding: 10 } } },
        scales: {
          x: { beginAtZero: true, grid: { display: false } },
          y1: { beginAtZero: true, position: 'right', grid: { display: false }, ticks: { stepSize: 1 } }
        },
        maintainAspectRatio: false, responsive: true
      }
    });
    document.getElementById('serviceBarChart').style.height = '200px';

    // 기존 시술별 도넛차트
    destroyChart('servicePieChart');
    charts['servicePieChart'] = new Chart(document.getElementById('servicePieChart'), {
      type: 'doughnut',
      data: { labels: svcEntries.map(([k]) => k), datasets: [{ data: svcEntries.map(([, v]) => v.revenue), backgroundColor: svcColors, borderWidth: 0, hoverOffset: 6 }] },
      options: { plugins: { legend: { display: false } }, cutout: '65%', maintainAspectRatio: true }
    });
    makeLegend('serviceLegend', svcEntries.map(([k]) => k), svcColors);

    // 고객 유형별 도넛차트 추가
    if (document.getElementById('customerChart')) {
      const regularCust = all.length - walkin.length - newCust.length;
      destroyChart('customerChart');
      charts['customerChart'] = new Chart(document.getElementById('customerChart'), {
        type: 'doughnut',
        data: {
          labels: ['기존고객', '현장고객', '신규고객'],
          datasets: [{
            data: [regularCust, walkin.length, newCust.length],
            backgroundColor: ['#34a853', '#fbbc04', '#9c27b0'], borderWidth: 0, hoverOffset: 4
          }]
        },
        options: { plugins: { legend: { display: false } }, cutout: '70%', maintainAspectRatio: true }
      });
      if (document.getElementById('customerLegend')) {
        makeLegend('customerLegend',
          [`기존 ${regularCust}건`, `현장 ${walkin.length}건`, `신규 ${newCust.length}건`],
          ['#34a853', '#fbbc04', '#9c27b0']
        );
      }
    }

    // 예약 현황 도넛차트 추가
    if (document.getElementById('statusChart')) {
      const confirmedCnt = active.filter(b => b.status === 'confirmed' || b.status === 'completed').length;
      destroyChart('statusChart');
      charts['statusChart'] = new Chart(document.getElementById('statusChart'), {
        type: 'doughnut',
        data: {
          labels: ['확정', '취소', '변경'],
          datasets: [{
            data: [confirmedCnt, cancelled.length, changed.length],
            backgroundColor: ['#1a73e8', '#ea4335', '#ff9800'], borderWidth: 0, hoverOffset: 4
          }]
        },
        options: { plugins: { legend: { display: false } }, cutout: '70%', maintainAspectRatio: true }
      });
      if (document.getElementById('statusLegend')) {
        makeLegend('statusLegend',
          [`확정 ${confirmedCnt}건`, `취소 ${cancelled.length}건`, `변경 ${changed.length}건`],
          ['#1a73e8', '#ea4335', '#ff9800']
        );
      }
    }

  } catch (e) { console.error(e); }
}

loadToday();
setInterval(()=>{ if(currentPage==='today') loadToday(); }, 5*60*1000);

// ══════════════════════════════════════════════════
// ── 현장고객 탭 ─────────────────────────────────
// ══════════════════════════════════════════════════

// 시술명 목록 (DB 기반)
const SERVICE_LIST = [
  '남성컷(눈썹/라인정리)',
  '남성컷+라인다운펌(눈썹/라인정리)',
  '남성컷+디자인펌+클리닉',
  '남성컷+남성부분펌',
  '남성컷+블랙염색',
  '남성컷+남자밝은염색',
  '남성디자인펌',
  '라인다운펌(커트시술X)',
  '여성컷(눈썹정리)',
  '여성셋팅펌+클리닉',
  '여성컷+클리닉',
  '여자뿌리염색',
  '여자밝은염색',
  '인모붙임머리(커트서비스)',
  '붙임머리리터치(반단)',
  '붙임머리제거',
  '주니어컷(남자)',
  '주니어컷(남자,초등)',
  '현장방문',
];

// 시술명 자동매칭 (키워드 기반 유사도)
function matchService(input) {
  if (!input || !input.trim()) return '';
  const q = input.trim().toLowerCase();

  // 1단계: 완전 포함 매칭
  const exact = SERVICE_LIST.find(s => s.toLowerCase().includes(q) || q.includes(s.toLowerCase().substring(0, 4)));
  if (exact) return exact;

  // 2단계: 키워드 매칭
  const keywords = {
    '남성컷': '남성컷(눈썹/라인정리)',
    '남컷':   '남성컷(눈썹/라인정리)',
    '라인펌': '남성컷+라인다운펌(눈썹/라인정리)',
    '라인다운': '남성컷+라인다운펌(눈썹/라인정리)',
    '디자인펌': '남성컷+디자인펌+클리닉',
    '부분펌': '남성컷+남성부분펌',
    '블랙':   '남성컷+블랙염색',
    '밝은염색': '남성컷+남자밝은염색',
    '여성컷': '여성컷(눈썹정리)',
    '여컷':   '여성컷(눈썹정리)',
    '셋팅':   '여성셋팅펌+클리닉',
    '뿌리':   '여자뿌리염색',
    '붙임머리': '인모붙임머리(커트서비스)',
    '리터치': '붙임머리리터치(반단)',
    '제거':   '붙임머리제거',
    '주니어': '주니어컷(남자)',
    '어린이': '주니어컷(남자,초등)',
    '초등':   '주니어컷(남자,초등)',
    '현장':   '현장방문',
  };
  for (const [kw, svc] of Object.entries(keywords)) {
    if (q.includes(kw)) return svc;
  }

  // 3단계: 입력값 그대로 사용
  return input.trim();
}

function initWalkin() {
  // 날짜 기본값: 오늘
  const dateEl = document.getElementById('walkinDate');
  if (!dateEl.value) dateEl.value = toDateStr(now);
  loadWalkinList();
  setupServiceAutocomplete();
}

// 서비스 자동완성 설정
function setupServiceAutocomplete() {
  const input = document.getElementById('walkinService');
  const dropdown = document.getElementById('serviceDropdown');
  if (!input || !dropdown) return;

  input.addEventListener('input', function() {
    const q = this.value.trim().toLowerCase();
    if (!q) { dropdown.style.display='none'; return; }
    const filtered = SERVICE_LIST.filter(s => s.toLowerCase().includes(q));
    if (!filtered.length) { dropdown.style.display='none'; return; }
    dropdown.innerHTML = filtered.map(s =>
      `<div class="svc-option" onclick="selectService('${s}')">${s}</div>`
    ).join('');
    dropdown.style.display = 'block';
  });

  input.addEventListener('blur', function() {
    setTimeout(() => { dropdown.style.display='none'; }, 200);
  });
}

function selectService(name) {
  document.getElementById('walkinService').value = name;
  // 금액 자동 채우기
  const priceMap = {
    '남성컷(눈썹/라인정리)': 17000,
    '남성컷+라인다운펌(눈썹/라인정리)': 30000,
    '남성컷+디자인펌+클리닉': 50000,
    '남성컷+남성부분펌': 35000,
    '남성컷+블랙염색': 35000,
    '남성컷+남자밝은염색': 45000,
    '남성디자인펌': 40000,
    '라인다운펌(커트시술X)': 25000,
    '여성컷(눈썹정리)': 20000,
    '여성셋팅펌+클리닉': 60000,
    '여성컷+클리닉': 45000,
    '여자뿌리염색': 35000,
    '여자밝은염색': 55000,
    '인모붙임머리(커트서비스)': 210000,
    '붙임머리리터치(반단)': 80000,
    '붙임머리제거': 35000,
    '주니어컷(남자)': 12000,
    '주니어컷(남자,초등)': 12000,
  };
  const priceEl = document.getElementById('walkinPrice');
  if (priceMap[name] && !priceEl.value) {
    priceEl.value = priceMap[name];
  }
  document.getElementById('serviceDropdown').style.display = 'none';
}

// 현장고객 저장
async function saveWalkin() {
  const date    = document.getElementById('walkinDate').value;
  const time    = document.getElementById('walkinTime').value;
  const name    = document.getElementById('walkinName').value.trim();
  const svcRaw  = document.getElementById('walkinService').value.trim();
  const price   = parseInt(document.getElementById('walkinPrice').value) || 0;
  const memo    = document.getElementById('walkinMemo').value.trim();
  const colorReq = document.getElementById('walkinColorReq').value.trim();

  if (!date || !name || !svcRaw) {
    alert('날짜, 이름, 시술명은 필수예요!');
    return;
  }

  const service = matchService(svcRaw);
  // 메모와 색상 요청사항 합치기
  let finalMemo = memo;
  if (colorReq) {
    finalMemo = finalMemo ? `${memo} / 희망색상: ${colorReq}` : `희망색상: ${colorReq}`;
  }
  
  const booking = {
    customer_name:  name,
    service_name:   service,
    service_price:  price,
    booking_date:   date,
    booking_time:   time ? time + ':00' : '00:00:00',
    status:         'confirmed',
    memo:           finalMemo || null,
    is_new_customer: false,
    customer_phone: null,
    booking_no: null,
  };

  const btn = document.getElementById('walkinSaveBtn');
  btn.textContent = '저장 중...';
  btn.disabled = true;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(booking)
    });
    if (!res.ok) throw new Error(await res.text());

    // 폼 초기화
    document.getElementById('walkinName').value    = '';
    document.getElementById('walkinService').value = '';
    document.getElementById('walkinPrice').value   = '';
    document.getElementById('walkinTime').value    = '';
    document.getElementById('walkinMemo').value    = '';
    if (document.getElementById('walkinColorReq')) {
      document.getElementById('walkinColorReq').value = '';
      document.getElementById('walkinColorRow').style.display = 'none';
    }
    btn.textContent = '✅ 저장됐어요!';
    setTimeout(() => { btn.textContent = '+ 현장고객 추가'; btn.disabled = false; }, 1500);
    // 관련 탭 새로고침
    loadToday();
    if (currentPage === 'schedule') loadSchedule();
  } catch(e) {
    btn.textContent = '저장 실패';
    btn.disabled = false;
    alert('저장 실패: ' + e.message);
  }
}

// 해당일 현장고객 목록
async function loadWalkinList() {
  const dateEl = document.getElementById('walkinDate');
  if (!dateEl) return;
  const date = dateEl.value;
  if (!date) return;
  const el = document.getElementById('walkinList');
  if (!el) return; // walkin 목록 영역 없으면 스킵
  el.innerHTML = '<div class="loading">불러오는 중...</div>';
  try {
    const list = await sbGet('bookings', {
      booking_date: `eq.${date}`,
      order: 'booking_time.asc',
      select: '*'
    });
    const summaryEl = document.getElementById('walkinDateSummary');
    if (summaryEl) summaryEl.textContent =
      `${date.slice(5).replace('-','월 ')}일 — 총 ${list.length}건 / ${won(list.reduce((s,b)=>s+(b.service_price||0),0))}원`;
    if (!list.length) { el.innerHTML='<div class="empty">예약이 없어요</div>'; return; }
    el.innerHTML = list.map(b => bookingCardHtml(b)).join('');
  } catch(e) {
    el.innerHTML = `<div class="empty">오류: ${e.message}</div>`;
  }
}

// 현장고객 삭제
async function deleteBooking(id) {
  if (!confirm('이 예약을 삭제할까요?')) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${id}`, {
      method: 'DELETE',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    if (!res.ok) throw new Error(await res.text());
    // 현재 탭 즉시 새로고침
    if (currentPage==='today')    loadToday();
    if (currentPage==='schedule') loadSchedule();
    if (currentPage==='walkin')   loadWalkinList();
    if (currentPage==='week')     loadWeek();
    if (currentPage==='month')    loadMonth();
  } catch(e) { alert('삭제 실패: ' + e.message); }
}

// ── 빠른입력 모달 (오늘/스케줄 탭에서 사용) ────────────
function openQuickWalkin(date) {
  const modal = document.getElementById('quickModal');
  modal.classList.remove('hidden');
  const d = date || toDateStr(now);
  document.getElementById('qDate').value = d;
  const h = String(now.getHours()).padStart(2,'0');
  const m = String(now.getMinutes()).padStart(2,'0');
  document.getElementById('qTime').value = `${h}:${m}`;
  document.getElementById('qName').value    = '';
  document.getElementById('qService').value = '';
  document.getElementById('qPrice').value   = '';
  document.getElementById('qMemo').value    = '';
  document.getElementById('qSaveBtn').textContent = '+ 현장고객 추가';
  document.getElementById('qSaveBtn').disabled    = false;
  // 날짜 요약 로드
  loadQDateSummary(d);
  setupQuickAutocomplete();
  // 날짜 변경 시 요약 갱신
  document.getElementById('qDate').onchange = function() { loadQDateSummary(this.value); };
  setTimeout(() => document.getElementById('qName').focus(), 300);
}

async function loadQDateSummary(date) {
  if (!date) return;
  const el = document.getElementById('qDateSummary');
  if (!el) return;
  try {
    const list = await sbGet('bookings', { booking_date:`eq.${date}`, select:'id,service_price,status' });
    const active = list.filter(b=>b.status!=='cancelled');
    el.textContent = `📅 ${date.slice(5).replace('-','월 ')}일 현재 ${active.length}건 / ${won(active.reduce((s,b)=>s+(b.service_price||0),0))}원`;
  } catch(e) { el.textContent = ''; }
}

function closeQuickWalkin() {
  document.getElementById('quickModal').classList.add('hidden');
}

function closeQuickModal(e) {
  if (e.target === document.getElementById('quickModal')) closeQuickWalkin();
}

function setupQuickAutocomplete() {
  const input = document.getElementById('qService');
  const dropdown = document.getElementById('qServiceDropdown');
  if (!input || !dropdown) return;
  // 기존 이벤트 제거 후 재등록
  const newInput = input.cloneNode(true);
  input.parentNode.replaceChild(newInput, input);
  newInput.addEventListener('input', function() {
    const q = this.value.trim().toLowerCase();
    if (!q) { dropdown.style.display='none'; return; }
    const filtered = SERVICE_LIST.filter(s => s.toLowerCase().includes(q));
    if (!filtered.length) { dropdown.style.display='none'; return; }
    dropdown.innerHTML = filtered.map(s =>
      `<div class="svc-option" onclick="selectQuickService('${s}')">${s}</div>`
    ).join('');
    dropdown.style.display = 'block';
  });
  newInput.addEventListener('blur', () => setTimeout(()=>{ dropdown.style.display='none'; }, 200));
}

function selectQuickService(name) {
  document.getElementById('qService').value = name;
  const priceMap = {
    '남성컷(눈썹/라인정리)': 17000,
    '남성컷+라인다운펌(눈썹/라인정리)': 30000,
    '남성컷+디자인펌+클리닉': 50000,
    '남성컷+남성부분펌': 35000,
    '남성컷+블랙염색': 35000,
    '남성컷+남자밝은염색': 45000,
    '남성디자인펌': 40000,
    '라인다운펌(커트시술X)': 25000,
    '여성컷(눈썹정리)': 20000,
    '여성셋팅펌+클리닉': 60000,
    '여성컷+클리닉': 45000,
    '여자뿌리염색': 35000,
    '여자밝은염색': 55000,
    '인모붙임머리(커트서비스)': 210000,
    '붙임머리리터치(반단)': 80000,
    '붙임머리제거': 35000,
    '주니어컷(남자)': 12000,
    '주니어컷(남자,초등)': 12000,
  };
  const priceEl = document.getElementById('qPrice');
  if (priceMap[name] && !priceEl.value) priceEl.value = priceMap[name];
  document.getElementById('qServiceDropdown').style.display = 'none';
}

async function saveQuickWalkin() {
  const date    = document.getElementById('qDate').value;
  const time    = document.getElementById('qTime').value;
  const name    = document.getElementById('qName').value.trim();
  const svcRaw  = document.getElementById('qService').value.trim();
  const price   = parseInt(document.getElementById('qPrice').value) || 0;
  const memo    = document.getElementById('qMemo').value.trim();
  const colorReq = document.getElementById('qColorReq').value.trim();

  if (!date || !name || !svcRaw) { alert('날짜, 이름, 시술명은 필수예요!'); return; }

  const service = matchService(svcRaw);
  // 메모와 색상 요청사항 합치기
  let finalMemo = memo;
  if (colorReq) {
    finalMemo = finalMemo ? `${memo} / 희망색상: ${colorReq}` : `희망색상: ${colorReq}`;
  }
  
  const booking = {
    customer_name:   name,
    service_name:    service,
    service_price:   price,
    booking_date:    date,
    booking_time:    time ? time+':00' : '00:00:00',
    status:          'confirmed',
    memo:            finalMemo || null,
    is_new_customer: false,
    customer_phone:  null,
    booking_no:      null,
  };

  const btn = document.getElementById('qSaveBtn');
  btn.textContent = '저장 중...'; btn.disabled = true;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/bookings`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', apikey:SUPABASE_KEY,
                 Authorization:`Bearer ${SUPABASE_KEY}`, Prefer:'return=minimal' },
      body: JSON.stringify(booking)
    });
    if (!res.ok) throw new Error(await res.text());
    btn.textContent = '✅ 저장됐어요!';
    setTimeout(() => closeQuickWalkin(), 800);
    // 현재 탭 새로고침
    if (currentPage==='today')    loadToday();
    if (currentPage==='schedule') loadSchedule();
    if (currentPage==='walkin')   loadWalkinList();
  } catch(e) {
    btn.textContent = '저장 실패'; btn.disabled = false;
    alert('저장 실패: '+e.message);
  }
}

// ── 스케줄 탭 하단 분석 차트 (강화버전) ───────────────────────────
function renderScheduleStats(bookings, from, to) {
  const el = document.getElementById('scheduleStats');
  if (!el) return;

  const active    = bookings.filter(b=>b.status!=='cancelled');
  const cancelled = bookings.filter(b=>b.status==='cancelled');
  const changed   = bookings.filter(b=>b.status==='changed');
  const walkin    = bookings.filter(b=>!b.booking_no);
  const newCust   = bookings.filter(b=>b.is_new_customer);
  const revenue   = active.reduce((s,b)=>s+(b.service_price||0),0);
  const cancelRate= bookings.length ? Math.round(cancelled.length/bookings.length*100*10)/10 : 0;
  const avgPrice  = active.length ? Math.round(revenue/active.length) : 0;

  // 날짜별 매출 + 건수
  const dateMap={}, dateCntMap={};
  active.forEach(b=>{ 
    dateMap[b.booking_date]=(dateMap[b.booking_date]||0)+(b.service_price||0);
    dateCntMap[b.booking_date]=(dateCntMap[b.booking_date]||0)+1;
  });
  const dateKeys=Object.keys(dateMap).sort();

  // 시술별 매출 + 건수
  const svcMap={};
  active.forEach(b=>{ 
    if(!svcMap[b.service_name]){svcMap[b.service_name]={count:0,revenue:0};}
    svcMap[b.service_name].count++; 
    svcMap[b.service_name].revenue+=(b.service_price||0); 
  });
  const svcEntries=Object.entries(svcMap).sort((a,b)=>b[1].revenue-a[1].revenue).slice(0,8);
  const svcColors=svcEntries.map((_,i)=>COLORS[i%COLORS.length]);

  // 요일별 매출 + 건수
  const dayRevMap={0:0,1:0,2:0,3:0,4:0,5:0,6:0}, dayCntMap={0:0,1:0,2:0,3:0,4:0,5:0,6:0};
  active.forEach(b=>{ 
    const idx=(new Date(b.booking_date).getDay()+6)%7; 
    dayRevMap[idx]+=(b.service_price||0); 
    dayCntMap[idx]++; 
  });
  const dayLabels=['월','화','수','목','금','토','일'];
  const peakDay = dayLabels[Object.keys(dayCntMap).reduce((a,b)=>dayCntMap[a]>dayCntMap[b]?a:b)];

  // 시간대별 분석 (booking_time 기준)
  const timeMap = {9:0,10:0,11:0,12:0,13:0,14:0,15:0,16:0,17:0,18:0,19:0,20:0};
  active.forEach(b=>{ 
    if(b.booking_time) {
      const hour = parseInt(b.booking_time.split(':')[0]); 
      if(timeMap.hasOwnProperty(hour)) timeMap[hour]++;
    }
  });
  const peakHour = Object.keys(timeMap).reduce((a,b)=>timeMap[a]>timeMap[b]?a:b);
  const timeLabels = Object.keys(timeMap).map(h=>h+'시');

  // 기간 일수 계산
  const daysDiff = Math.ceil((new Date(to) - new Date(from)) / (1000*60*60*24)) + 1;
  const avgDailyRev = Math.round(revenue / daysDiff);

  el.innerHTML = `
    <!-- 핵심 요약 통계 -->
    <div class="stat-grid" style="margin-top:14px">
      <div class="stat-card"><div class="stat-label">총 매출</div><div class="stat-value green">${won(revenue)}</div><div class="stat-sub">${daysDiff}일간</div></div>
      <div class="stat-card"><div class="stat-label">일평균 매출</div><div class="stat-value blue">${won(avgDailyRev)}</div><div class="stat-sub">원/일</div></div>
      <div class="stat-card"><div class="stat-label">평균 객단가</div><div class="stat-value purple">${won(avgPrice)}</div><div class="stat-sub">원</div></div>
      <div class="stat-card"><div class="stat-label">총 예약건</div><div class="stat-value orange">${active.length}건</div><div class="stat-sub">취소 ${cancelled.length}건</div></div>
    </div>

    <div class="stat-grid" style="margin-top:8px">
      <div class="stat-card"><div class="stat-label">현장고객</div><div class="stat-value cyan">${walkin.length}건</div><div class="stat-sub">${Math.round(walkin.length/bookings.length*100)}%</div></div>
      <div class="stat-card"><div class="stat-label">신규고객</div><div class="stat-value mint">${newCust.length}건</div><div class="stat-sub">${Math.round(newCust.length/bookings.length*100)}%</div></div>
      <div class="stat-card"><div class="stat-label">취소율</div><div class="stat-value ${cancelRate>15?'red':'red'}">${cancelRate}%</div><div class="stat-sub">${cancelRate>15?'높음':'적정'}</div></div>
      <div class="stat-card"><div class="stat-label">성수요일</div><div class="stat-value indigo">${peakDay}요일</div><div class="stat-sub">${dayCntMap[Object.keys(dayCntMap).reduce((a,b)=>dayCntMap[a]>dayCntMap[b]?a:b)]}건</div></div>
    </div>

    <!-- 매출 추이 (매출+건수 듀얼) -->
    <div class="card" style="margin-top:14px">
      <div class="card-title">📈 기간별 매출 & 예약 추이</div>
      <div class="chart-wrap"><canvas id="schLineChart"></canvas></div>
    </div>

    <!-- 요일별 성과 -->
    <div class="card" style="margin-top:14px">
      <div class="card-title">📅 요일별 매출 & 예약건수</div>
      <div class="chart-wrap"><canvas id="schDayChart"></canvas></div>
      <div style="margin-top:8px;font-size:13px;color:#666;text-align:center">
        🏆 성수요일: <strong>${peakDay}요일 ${dayCntMap[Object.keys(dayCntMap).reduce((a,b)=>dayCntMap[a]>dayCntMap[b]?a:b)]}건</strong> | 
        성수시간: <strong>${peakHour}시 ${timeMap[peakHour]}건</strong>
      </div>
    </div>

    <!-- 시간대별 분포 -->
    <div class="card" style="margin-top:14px">
      <div class="card-title">⏰ 시간대별 예약 분포</div>
      <div class="chart-wrap"><canvas id="schTimeChart"></canvas></div>
    </div>

    <!-- 시술별 매출 -->
    <div class="card" style="margin-top:14px">
      <div class="card-title">✂️ 시술별 매출 & 건수</div>
      <div class="chart-wrap"><canvas id="schSvcChart"></canvas></div>
      <div id="schSvcLegend" class="legend" style="margin-top:8px"></div>
    </div>

    <!-- 고객 유형별 현황 -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px">
      <div class="card">
        <div class="card-title">🔵 예약 현황 비율</div>
        <div style="display:flex;align-items:center;gap:16px">
          <div style="width:120px;height:120px;flex-shrink:0"><canvas id="schDonutChart"></canvas></div>
          <div id="schDonutLegend" class="legend" style="flex-direction:column;gap:6px"></div>
        </div>
      </div>
      
      <div class="card">
        <div class="card-title">👥 고객 유형별 비율</div>
        <div style="display:flex;align-items:center;gap:16px">
          <div style="width:120px;height:120px;flex-shrink:0"><canvas id="schCustomerChart"></canvas></div>
          <div id="schCustomerLegend" class="legend" style="flex-direction:column;gap:6px"></div>
        </div>
      </div>
    </div>
  `;

  // 매출+건수 추이 차트
  destroyChart('schLineChart');
  charts['schLineChart']=new Chart(document.getElementById('schLineChart'),{
    type:'bar',
    data:{labels:dateKeys.map(d=>d.slice(5)),datasets:[
      {label:'매출(원)',data:dateKeys.map(k=>dateMap[k]),backgroundColor:'rgba(26,115,232,0.7)',borderRadius:6,yAxisID:'y'},
      {label:'예약건',data:dateKeys.map(k=>dateCntMap[k]||0),type:'line',borderColor:'#34a853',backgroundColor:'rgba(52,168,83,.2)',pointBackgroundColor:'#34a853',pointRadius:4,fill:true,tension:.4,yAxisID:'y1'}
    ]},
    options:{plugins:{legend:{position:'top',labels:{boxWidth:10,padding:12}}},scales:{y:{beginAtZero:true,position:'left',grid:{color:'rgba(0,0,0,.05)'}},y1:{beginAtZero:true,position:'right',grid:{display:false},ticks:{stepSize:1}}},maintainAspectRatio:true}
  });

  // 요일별 매출+건수 차트
  destroyChart('schDayChart');
  charts['schDayChart']=new Chart(document.getElementById('schDayChart'),{
    type:'bar',
    data:{labels:dayLabels,datasets:[
      {label:'매출(원)',data:Object.values(dayRevMap),backgroundColor:dayLabels.map(d=>d===peakDay?'rgba(26,115,232,0.9)':'rgba(26,115,232,0.5)'),borderRadius:6,yAxisID:'y'},
      {label:'예약건',data:Object.values(dayCntMap),type:'line',borderColor:'#34a853',backgroundColor:'rgba(52,168,83,.2)',pointBackgroundColor:dayLabels.map(d=>d===peakDay?'#ff6b35':'#34a853'),pointRadius:5,fill:true,tension:.4,yAxisID:'y1'}
    ]},
    options:{plugins:{legend:{position:'top',labels:{boxWidth:10,padding:10}}},scales:{y:{beginAtZero:true,position:'left',grid:{display:false}},y1:{beginAtZero:true,position:'right',grid:{display:false},ticks:{stepSize:1}}},maintainAspectRatio:true}
  });

  // 시간대별 바차트
  destroyChart('schTimeChart');
  charts['schTimeChart']=new Chart(document.getElementById('schTimeChart'),{
    type:'bar',
    data:{labels:timeLabels,datasets:[{
      label:'예약건수',
      data:Object.values(timeMap),
      backgroundColor:Object.keys(timeMap).map(h=>h==peakHour?'rgba(255,107,53,0.9)':'rgba(26,115,232,0.6)'),
      borderRadius:6
    }]},
    options:{plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{stepSize:1},grid:{color:'rgba(0,0,0,.05)'}},x:{grid:{display:false}}},maintainAspectRatio:true}
  });

  // 시술별 가로 바차트
  destroyChart('schSvcChart');
  charts['schSvcChart']=new Chart(document.getElementById('schSvcChart'),{
    type:'bar',
    data:{labels:svcEntries.map(([k])=>k.length>12?k.slice(0,12)+'…':k),datasets:[
      {label:'매출(원)',data:svcEntries.map(([,v])=>v.revenue),backgroundColor:svcColors,borderRadius:4,yAxisID:'y'},
      {label:'건수',data:svcEntries.map(([,v])=>v.count),type:'line',borderColor:'#fbbc04',pointBackgroundColor:'#fbbc04',pointRadius:4,fill:false,yAxisID:'y1'}
    ]},
    options:{indexAxis:'y',plugins:{legend:{position:'top',labels:{boxWidth:10,padding:10}}},scales:{x:{beginAtZero:true,grid:{display:false}},y1:{beginAtZero:true,position:'right',grid:{display:false},ticks:{stepSize:1}}},maintainAspectRatio:false,responsive:true}
  });
  document.getElementById('schSvcChart').style.height='200px';
  makeLegend('schSvcLegend', svcEntries.map(([k])=>k), svcColors);

  // 예약현황 도넛차트
  const confirmedCnt = active.filter(b=>b.status==='confirmed'||b.status==='completed').length;
  const changedCnt   = changed.length;
  destroyChart('schDonutChart');
  charts['schDonutChart']=new Chart(document.getElementById('schDonutChart'),{
    type:'doughnut',
    data:{labels:['확정','취소','변경'],datasets:[{
      data:[confirmedCnt, cancelled.length, changedCnt],
      backgroundColor:['#1a73e8','#ea4335','#ff9800'],borderWidth:0,hoverOffset:4
    }]},
    options:{plugins:{legend:{display:false}},cutout:'70%',maintainAspectRatio:true}
  });
  makeLegend('schDonutLegend',
    [`확정 ${confirmedCnt}건`, `취소 ${cancelled.length}건`, `변경 ${changedCnt}건`],
    ['#1a73e8','#ea4335','#ff9800']
  );

  // 고객유형 도넛차트
  const regularCust = bookings.length - walkin.length - newCust.length;
  destroyChart('schCustomerChart');
  charts['schCustomerChart']=new Chart(document.getElementById('schCustomerChart'),{
    type:'doughnut',
    data:{labels:['기존고객','현장고객','신규고객'],datasets:[{
      data:[regularCust, walkin.length, newCust.length],
      backgroundColor:['#34a853','#fbbc04','#9c27b0'],borderWidth:0,hoverOffset:4
    }]},
    options:{plugins:{legend:{display:false}},cutout:'70%',maintainAspectRatio:true}
  });
  makeLegend('schCustomerLegend',
    [`기존 ${regularCust}건`, `현장 ${walkin.length}건`, `신규 ${newCust.length}건`],
    ['#34a853','#fbbc04','#9c27b0']
  );
}

// ── 색상분석 탭 ─────────────────────────────────────────
function loadColor() {
  // 탭 로드 시 초기화
  document.getElementById('colorResult').classList.add('hidden');
}

// 헤어 색상표 (실제 업로드된 이미지 기반 정확한 RGB)
const HAIR_COLORS = {
  // 자연색 계열 (Natural)
  '1': { name: '1레벨 (블랙)', rgb: [20, 18, 15] },
  'NA': { name: 'NA (내추럴블랙)', rgb: [35, 28, 22] },
  '1B': { name: '1B (소프트블랙)', rgb: [45, 35, 25] },
  '2': { name: '2레벨 (다크브라운)', rgb: [65, 50, 35] },
  '3': { name: '3레벨 (브라운)', rgb: [85, 65, 45] },
  '4': { name: '4레벨 (미디엄브라운)', rgb: [120, 85, 55] },
  '5': { name: '5레벨 (라이트브라운)', rgb: [145, 110, 75] },
  '6': { name: '6레벨 (다크블론드)', rgb: [165, 135, 95] },
  '8': { name: '8레벨 (블론드)', rgb: [190, 160, 120] },

  // 애쉬 계열 (Ash)
  'SL': { name: 'SL (실버)', rgb: [180, 175, 170] },
  'SG': { name: 'SG (실버그레이)', rgb: [155, 150, 145] },
  'AG': { name: 'AG (애쉬골드)', rgb: [175, 155, 125] },
  'GA': { name: 'GA (골든애쉬)', rgb: [185, 165, 135] },
  'AM': { name: 'AM (애쉬민트)', rgb: [160, 170, 150] },

  // 웜톤 계열 (Warm)
  'WB': { name: 'WB (웜베이지)', rgb: [200, 185, 160] },
  'DK': { name: 'DK (다크쿠퍼)', rgb: [95, 70, 50] },
  '6K': { name: '6K (쿠퍼브라운)', rgb: [140, 100, 70] },
  '5K': { name: '5K (골든브라운)', rgb: [130, 95, 65] },
  '4/30': { name: '4/30 (골든쿠퍼)', rgb: [125, 90, 60] },
  'OB': { name: 'OB (오렌지브라운)', rgb: [150, 100, 60] },
  'RB': { name: 'RB (레드브라운)', rgb: [115, 70, 50] },
  'BW': { name: 'BW (브라운웜)', rgb: [110, 80, 55] },

  // 블리치/하이톤 계열 
  '613': { name: '613 (플래티넘블론드)', rgb: [240, 230, 195] },
  
  // 컬러 계열 (Fashion Colors)
  'BLUE': { name: 'BLUE (블루)', rgb: [65, 130, 200] },
  'DB': { name: 'DB (다크블루)', rgb: [45, 85, 140] },
  'EB': { name: 'EB (에메랄드블루)', rgb: [55, 140, 125] },
  
  'DV': { name: 'DV (다크바이올렛)', rgb: [85, 55, 115] },
  'AV': { name: 'AV (애쉬바이올렛)', rgb: [125, 100, 140] },
  'RV': { name: 'RV (레드바이올렛)', rgb: [140, 75, 115] },
  'VM': { name: 'VM (바이올렛마젠타)', rgb: [155, 85, 125] },
  
  'RED': { name: 'RED (레드)', rgb: [180, 65, 75] },
  'CP': { name: 'CP (코퍼)', rgb: [165, 95, 65] },
  'VP': { name: 'VP (바이올렛핑크)', rgb: [180, 125, 155] },
  'RP': { name: 'RP (레드핑크)', rgb: [195, 115, 140] },
  'PN': { name: 'PN (핑크)', rgb: [215, 155, 175] },
  'AP': { name: 'AP (애쉬핑크)', rgb: [185, 165, 170] },
  'MB': { name: 'MB (마젠타브라운)', rgb: [125, 85, 95] }
};

// 전문가 분석 개선 - 빛 반사/조명 변화 고려한 헤어컬러 판별
function analyzeProfessionally(extractedColors) {
  console.log('🔬 빛 반사 고려 전문가 색상 분석 시작...', extractedColors);
  
  if (!extractedColors || extractedColors.length === 0) {
    throw new Error('분석할 색상 데이터가 없습니다.');
  }
  
  // 1단계: 조명 영향 보정 - 하이라이트와 섀도우 영역 분리
  const colorAnalysis = extractedColors.map((color, index) => {
    const brightness = (color[0] * 0.299 + color[1] * 0.587 + color[2] * 0.114);
    const saturation = calculateSaturation(color[0], color[1], color[2]);
    
    // 조명 타입 분류
    let lightingType = '';
    if (brightness > 180) lightingType = 'highlight'; // 하이라이트 (빛 반사)
    else if (brightness < 60) lightingType = 'shadow'; // 섀도우
    else lightingType = 'midtone'; // 중간톤 (가장 정확)
    
    return {
      rgb: color,
      brightness,
      saturation,
      lightingType,
      weight: lightingType === 'midtone' ? 5.0 : lightingType === 'shadow' ? 3.0 : 1.0
    };
  });
  
  console.log('조명 분석:', colorAnalysis.map(c => `${c.lightingType}(${Math.round(c.brightness)})`));
  
  // 2단계: 언더톤 분석 (빛 반사 보정)
  const undertonAnalysis = analyzeUndertone(colorAnalysis);
  
  // 3단계: 조명 보정된 가중평균 계산
  let totalWeight = 0;
  let weightedR = 0, weightedG = 0, weightedB = 0;
  
  colorAnalysis.forEach(analysis => {
    totalWeight += analysis.weight;
    weightedR += analysis.rgb[0] * analysis.weight;
    weightedG += analysis.rgb[1] * analysis.weight;
    weightedB += analysis.rgb[2] * analysis.weight;
  });
  
  const avgR = Math.round(weightedR / totalWeight);
  const avgG = Math.round(weightedG / totalWeight);
  const avgB = Math.round(weightedB / totalWeight);
  
  console.log(`✅ 조명 보정 평균 색상: RGB(${avgR}, ${avgG}, ${avgB})`);
  
  // 4단계: 실제 헤어컬러 예측 (조명 보정)
  const correctedColor = correctForLighting(avgR, avgG, avgB, colorAnalysis);
  
  // 5단계: 전문가 수준 색상 분류
  const professionalClassification = classifyHairColor(correctedColor, undertonAnalysis);
  
  // 6단계: 빛 반사 특성 분석
  const reflectionAnalysis = analyzeReflectionCharacteristics(colorAnalysis);
  
  return {
    averageColor: [avgR, avgG, avgB],
    correctedColor: correctedColor,
    realBrightness: Math.round((correctedColor[0] * 0.299 + correctedColor[1] * 0.587 + correctedColor[2] * 0.114)),
    level: professionalClassification.level,
    baseNeed: professionalClassification.baseNeed,
    toneFamily: professionalClassification.toneFamily,
    undertone: undertonAnalysis,
    intensity: professionalClassification.intensity,
    saturationValue: Math.round(calculateSaturation(...correctedColor) * 100),
    lightingCondition: reflectionAnalysis.condition,
    reflectionType: reflectionAnalysis.type,
    colorStability: reflectionAnalysis.stability,
    professionalNotes: generateProfessionalNotes(colorAnalysis, reflectionAnalysis),
    confidence: calculateConfidence(colorAnalysis, reflectionAnalysis),
    extractedCount: extractedColors.length,
    warning: generateWarnings(professionalClassification, reflectionAnalysis)
  };
}

// 언더톤 분석 (조명에 영향받지 않는 기본 색조)
function analyzeUndertone(colorAnalysis) {
  // 중간톤 색상들만 사용 (가장 정확)
  const midtones = colorAnalysis.filter(c => c.lightingType === 'midtone');
  if (midtones.length === 0) return '분석 불가';
  
  let totalR = 0, totalG = 0, totalB = 0;
  midtones.forEach(c => {
    totalR += c.rgb[0];
    totalG += c.rgb[1]; 
    totalB += c.rgb[2];
  });
  
  const avgR = totalR / midtones.length;
  const avgG = totalG / midtones.length;
  const avgB = totalB / midtones.length;
  
  // 언더톤 분류 (전문가 기준)
  const redDominance = avgR - Math.max(avgG, avgB);
  const blueDominance = avgB - Math.max(avgR, avgG);
  const greenDominance = avgG - Math.max(avgR, avgB);
  
  if (redDominance > 10) return '웜 언더톤 (골든/쿠퍼)';
  else if (blueDominance > 10) return '쿨 언더톤 (애쉬/매트)';
  else if (greenDominance > 8) return '올리브 언더톤';
  else if (Math.abs(redDominance) < 5 && Math.abs(blueDominance) < 5) return '뉴트럴 언더톤';
  else return '믹스 언더톤';
}

// 조명 보정 (하이라이트/섀도우 영향 제거)
function correctForLighting(avgR, avgG, avgB, colorAnalysis) {
  const highlights = colorAnalysis.filter(c => c.lightingType === 'highlight');
  const shadows = colorAnalysis.filter(c => c.lightingType === 'shadow');
  const midtones = colorAnalysis.filter(c => c.lightingType === 'midtone');
  
  // 조명 상황 판별
  if (highlights.length > shadows.length * 2) {
    // 강한 조명 - 하이라이트가 많음
    console.log('🔆 강한 조명 감지 - 색상 어둡게 보정');
    return [
      Math.max(20, avgR - 15),
      Math.max(20, avgG - 15), 
      Math.max(20, avgB - 15)
    ];
  } else if (shadows.length > highlights.length * 2) {
    // 어두운 조명 - 섀도우가 많음
    console.log('🌙 어두운 조명 감지 - 색상 밝게 보정');
    return [
      Math.min(235, avgR + 20),
      Math.min(235, avgG + 20),
      Math.min(235, avgB + 20)
    ];
  } else {
    // 자연광/균일한 조명
    console.log('☀️ 자연광 감지 - 최소 보정');
    return [avgR, avgG, avgB];
  }
}

// 전문가 수준 헤어컬러 분류
function classifyHairColor(correctedColor, undertone) {
  const [r, g, b] = correctedColor;
  const brightness = r * 0.299 + g * 0.587 + b * 0.114;
  
  // 레벨 분류 (더 정확한 기준)
  let level = '';
  let baseNeed = '';
  
  if (brightness <= 20) {
    level = '1레벨'; baseNeed = '천연 흑발 (강력 탈색 필수)';
  } else if (brightness <= 35) {
    level = '2레벨'; baseNeed = '다크 블랙브라운 (탈색 필수)';
  } else if (brightness <= 50) {
    level = '3레벨'; baseNeed = '다크브라운 (탈색 권장)';
  } else if (brightness <= 70) {
    level = '4-5레벨'; baseNeed = '미디엄브라운 (염색 가능)';
  } else if (brightness <= 90) {
    level = '6레벨'; baseNeed = '라이트브라운 (쉬운 시술)';
  } else if (brightness <= 120) {
    level = '7-8레벨'; baseNeed = '다크블론드 (직접 염색)';
  } else if (brightness <= 150) {
    level = '9레벨'; baseNeed = '미디엄블론드 (토닝 가능)';
  } else {
    level = '10+레벨'; baseNeed = '라이트블론드/블리치베이스';
  }
  
  // 색상계열 + 언더톤 조합
  let toneFamily = undertone;
  if (undertone.includes('웜')) {
    if (r > g && r > b) toneFamily = '웜톤 골든계열';
    else if (r > b) toneFamily = '웜톤 쿠퍼계열';
    else toneFamily = '웜톤 카라멜계열';
  } else if (undertone.includes('쿨')) {
    if (b > r) toneFamily = '쿨톤 애쉬계열';
    else if (g > r) toneFamily = '쿨톤 매트계열';
    else toneFamily = '쿨톤 베이지계열';
  }
  
  // 채도 분석
  const saturation = calculateSaturation(r, g, b);
  let intensity = '';
  if (saturation < 0.1) intensity = '무채색 (애쉬)';
  else if (saturation < 0.25) intensity = '저채도 (내추럴)';
  else if (saturation < 0.5) intensity = '중채도 (소프트)';
  else intensity = '고채도 (비비드)';
  
  return { level, baseNeed, toneFamily, intensity };
}

// 빛 반사 특성 분석
function analyzeReflectionCharacteristics(colorAnalysis) {
  const brightnessRange = Math.max(...colorAnalysis.map(c => c.brightness)) - 
                         Math.min(...colorAnalysis.map(c => c.brightness));
  
  let condition = '';
  let type = '';
  let stability = '';
  
  if (brightnessRange > 100) {
    condition = '강한 대비 조명';
    type = '반사율 높음 (건강한 모발)';
    stability = '조명에 따라 크게 변함';
  } else if (brightnessRange > 50) {
    condition = '일반 실내조명';
    type = '보통 반사율';
    stability = '조명에 따라 약간 변함';
  } else {
    condition = '균일한 조명';
    type = '낮은 반사율 (손상 모발 가능성)';
    stability = '조명 변화에 안정적';
  }
  
  return { condition, type, stability };
}

// 전문가 노트 생성
function generateProfessionalNotes(colorAnalysis, reflectionAnalysis) {
  const midtoneCount = colorAnalysis.filter(c => c.lightingType === 'midtone').length;
  const highlightCount = colorAnalysis.filter(c => c.lightingType === 'highlight').length;
  
  let notes = [];
  
  if (reflectionAnalysis.condition === '강한 대비 조명') {
    notes.push('사진이 강한 조명에서 촬영됨 - 실제 색상은 더 어둘 수 있음');
  }
  
  if (midtoneCount < 2) {
    notes.push('중간톤 색상 부족 - 더 균일한 조명에서 재촬영 권장');
  }
  
  if (highlightCount > midtoneCount) {
    notes.push('하이라이트 과다 - 실제 시술 시 더 어두운 결과 예상');
  }
  
  notes.push(`분석된 조명 타입: ${reflectionAnalysis.condition}`);
  
  return notes.join(' / ');
}

// 신뢰도 계산 (조명 조건 고려)
function calculateConfidence(colorAnalysis, reflectionAnalysis) {
  const midtoneCount = colorAnalysis.filter(c => c.lightingType === 'midtone').length;
  const totalCount = colorAnalysis.length;
  
  let confidence = '보통';
  
  if (midtoneCount >= 3 && reflectionAnalysis.stability === '조명 변화에 안정적') {
    confidence = '높음';
  } else if (midtoneCount < 1 || reflectionAnalysis.condition === '강한 대비 조명') {
    confidence = '낮음';
  }
  
  return confidence;
}

// 경고 메시지 생성
function generateWarnings(classification, reflectionAnalysis) {
  let warnings = [];
  
  if (reflectionAnalysis.condition === '강한 대비 조명') {
    warnings.push('⚠️ 강한 조명으로 색상 왜곡 가능성 - 자연광에서 재확인 필요');
  }
  
  if (classification.level.includes('1') || classification.level.includes('2')) {
    warnings.push('⚠️ 매우 어두운 베이스 - 희망 색상 구현 시 강력 탈색 필요');
  }
  
  if (reflectionAnalysis.type.includes('손상')) {
    warnings.push('⚠️ 모발 손상 징후 감지 - 시술 전 모발 케어 필요');
  }
  
  return warnings.join(' ');
}

// 채도 계산 헬퍼 함수
function calculateSaturation(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

// RGB 거리 계산
function colorDistance(rgb1, rgb2) {
  return Math.sqrt(
    Math.pow(rgb1[0] - rgb2[0], 2) +
    Math.pow(rgb1[1] - rgb2[1], 2) +
    Math.pow(rgb1[2] - rgb2[2], 2)
  );
}

// RGB → HSV 변환 (색상 분석용)
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const diff = max - min;
  
  let h = 0;
  if (diff !== 0) {
    if (max === r) h = ((g - b) / diff) % 6;
    else if (max === g) h = (b - r) / diff + 2;
    else h = (r - g) / diff + 4;
  }
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  
  const s = max === 0 ? 0 : diff / max;
  const v = max;
  
  return {h, s, v};
}

// 나노바나나 수준: 머리색상만 정밀 추출 (배경색 완전 제거)
function extractHairColors(canvas, ctx) {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const hairPixels = [];
  
  // 1단계: 고급 피부톤 및 배경 색상 범위 정의
  const excludeRanges = [
    // 밝은 피부톤 (백인/동양인 밝은 톤)
    {rMin: 200, rMax: 255, gMin: 170, gMax: 230, bMin: 140, bMax: 200},
    {rMin: 220, rMax: 255, gMin: 190, gMax: 240, bMin: 160, bMax: 210},
    
    // 중간 피부톤 (일반적인 동양인/중동)  
    {rMin: 150, rMax: 210, gMin: 120, gMax: 180, bMin: 90, bMax: 150},
    {rMin: 170, rMax: 220, gMin: 140, gMax: 190, bMin: 110, bMax: 160},
    
    // 어두운 피부톤 (남아시아/아프리카)
    {rMin: 80, rMax: 160, gMin: 60, gMax: 130, bMin: 40, bMax: 100},
    {rMin: 100, rMax: 180, gMin: 80, gMax: 140, bMin: 50, bMax: 110},
    
    // 배경색 범위 (흰색/회색/검은색)
    {rMin: 240, rMax: 255, gMin: 240, gMax: 255, bMin: 240, bMax: 255}, // 흰색 배경
    {rMin: 200, rMax: 240, gMin: 200, gMax: 240, bMin: 200, bMax: 240}, // 밝은 회색
    {rMin: 100, rMax: 150, gMin: 100, gMax: 150, bMin: 100, bMax: 150}, // 중간 회색
    {rMin: 0, rMax: 50, gMin: 0, gMax: 50, bMin: 0, bMax: 50},         // 어두운 배경
    
    // 의류 색상 (일반적인 옷 색상들)
    {rMin: 0, rMax: 50, gMin: 0, gMax: 100, bMin: 100, bMax: 200},     // 네이비/청색 의류
    {rMin: 0, rMax: 50, gMin: 0, gMax: 50, bMin: 0, bMax: 50},         // 검은색 의류
    {rMin: 200, rMax: 255, gMin: 200, gMax: 255, bMin: 200, bMax: 255} // 흰색 의류
  ];
  
  // 2단계: 픽셀별 분석 (고밀도 샘플링)
  for (let i = 0; i < data.length; i += 4 * 5) { // 5픽셀마다 (높은 정밀도)
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    
    if (a < 200) continue; // 투명 픽셀 제외
    
    // 피부톤/배경색 제외 검사
    let isSkinOrBackground = false;
    for (const range of excludeRanges) {
      if (r >= range.rMin && r <= range.rMax &&
          g >= range.gMin && g <= range.gMax &&
          b >= range.bMin && b <= range.bMax) {
        isSkinOrBackground = true;
        break;
      }
    }
    
    if (!isSkinOrBackground) {
      // 3단계: HSV 변환으로 머리색상 특성 확인
      const hsv = rgbToHsv(r, g, b);
      
      // 머리색상 특성 필터링
      const isValidHairColor = (
        // 채도가 너무 높지 않음 (형광색 제외)
        hsv.s <= 0.9 &&
        // 명도가 극단적이지 않음
        hsv.v >= 0.05 && hsv.v <= 0.95 &&
        // 색조가 머리색상 범위 내 (모든 범위 허용, 특별한 컬러 포함)
        (hsv.h >= 0 && hsv.h <= 360)
      );
      
      if (isValidHairColor) {
        hairPixels.push({
          r, g, b, 
          h: hsv.h, 
          s: hsv.s, 
          v: hsv.v,
          // 픽셀 위치 정보 (클러스터링용)
          x: Math.floor((i / 4) % canvas.width),
          y: Math.floor((i / 4) / canvas.width)
        });
      }
    }
  }
  
  if (hairPixels.length < 200) {
    throw new Error('🚫 머리색상을 충분히 감지할 수 없어요.\n\n✅ 다음을 확인해주세요:\n• 머리 부분이 선명하게 보이는 사진\n• 조명이 밝고 균일한 사진\n• 배경이 단순한 사진\n• 얼굴보다 머리가 더 많이 보이는 사진');
  }
  
  // 4단계: 나노바나나 수준 색상 클러스터링
  return advancedHairColorClustering(hairPixels);
}

// 고급 머리색상 클러스터링 (나노바나나 기법)
function advancedHairColorClustering(hairPixels) {
  console.log(`🔬 머리색상 픽셀 ${hairPixels.length}개 분석 중...`);
  
  const clusters = [];
  const clusterThreshold = 25; // RGB 유사도 기준
  const minClusterSize = 50;   // 최소 클러스터 크기
  
  // K-means 스타일 클러스터링
  hairPixels.forEach(pixel => {
    let addedToCluster = false;
    
    // 기존 클러스터와 비교
    for (const cluster of clusters) {
      const distance = colorDistance(
        [pixel.r, pixel.g, pixel.b], 
        [cluster.centroidR, cluster.centroidG, cluster.centroidB]
      );
      
      if (distance < clusterThreshold) {
        // 기존 클러스터에 추가
        cluster.pixels.push(pixel);
        cluster.count++;
        
        // 중심점 업데이트 (가중평균)
        cluster.totalR += pixel.r;
        cluster.totalG += pixel.g;
        cluster.totalB += pixel.b;
        cluster.centroidR = cluster.totalR / cluster.count;
        cluster.centroidG = cluster.totalG / cluster.count;
        cluster.centroidB = cluster.totalB / cluster.count;
        
        addedToCluster = true;
        break;
      }
    }
    
    // 새 클러스터 생성
    if (!addedToCluster) {
      clusters.push({
        pixels: [pixel],
        count: 1,
        totalR: pixel.r, totalG: pixel.g, totalB: pixel.b,
        centroidR: pixel.r, centroidG: pixel.g, centroidB: pixel.b
      });
    }
  });
  
  // 5단계: 클러스터 필터링 및 정제
  const validClusters = clusters
    .filter(cluster => cluster.count >= minClusterSize) // 최소 크기 이상
    .sort((a, b) => b.count - a.count)                  // 픽셀 수 내림차순
    .slice(0, 5);                                       // 상위 5개만
  
  if (validClusters.length === 0) {
    throw new Error('🚫 유효한 머리색상 클러스터를 찾을 수 없어요.\n\n📸 더 선명한 머리 사진을 업로드해주세요.');
  }
  
  // 6단계: 각 클러스터의 대표 색상 계산
  const representativeColors = validClusters.map(cluster => {
    // 클러스터 내 색상들의 중앙값 계산 (노이즈 제거)
    const sortedR = cluster.pixels.map(p => p.r).sort((a,b) => a-b);
    const sortedG = cluster.pixels.map(p => p.g).sort((a,b) => a-b);
    const sortedB = cluster.pixels.map(p => p.b).sort((a,b) => a-b);
    
    const medianR = sortedR[Math.floor(sortedR.length / 2)];
    const medianG = sortedG[Math.floor(sortedG.length / 2)];
    const medianB = sortedB[Math.floor(sortedB.length / 2)];
    
    console.log(`🎨 클러스터 ${cluster.count}픽셀: RGB(${medianR}, ${medianG}, ${medianB})`);
    
    return [Math.round(medianR), Math.round(medianG), Math.round(medianB)];
  });
  
  console.log(`✅ 총 ${representativeColors.length}개 대표 색상 추출 완료`);
  return representativeColors;
}

// 색상 분석 메인 함수
function analyzeColor(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      // 캔버스에 이미지 그리기
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      // 업로드된 이미지 표시
      document.getElementById('uploadedImage').src = e.target.result;
      
      // 머리색상만 추출 (배경색 제거)
      const extractedColors = extractHairColors(canvas, ctx);
      
      // 전문가 색상 분석
      const professionalAnalysis = analyzeProfessionally(extractedColors);
      
      // 각 추출된 색상에 대해 가장 가까운 헤어 색상 찾기
      const matches = extractedColors.map(rgb => {
        let bestMatch = null;
        let minDistance = Infinity;
        
        Object.entries(HAIR_COLORS).forEach(([code, info]) => {
          const distance = colorDistance(rgb, info.rgb);
          if (distance < minDistance) {
            minDistance = distance;
            bestMatch = { code, ...info, distance, extractedRgb: rgb };
          }
        });
        
        return bestMatch;
      });
      
      // 중복 제거 (같은 코드면 거리 짧은 것만)
      const uniqueMatches = [];
      matches.forEach(match => {
        const existing = uniqueMatches.find(m => m.code === match.code);
        if (!existing || match.distance < existing.distance) {
          if (existing) {
            uniqueMatches.splice(uniqueMatches.indexOf(existing), 1);
          }
          uniqueMatches.push(match);
        }
      });
      
      // 결과 표시 (전문가 분석 포함)
      window.lastProfessionalAnalysis = professionalAnalysis; // 전역 저장
      displayColorResults(uniqueMatches.slice(0, 3), professionalAnalysis);
      document.getElementById('colorResult').classList.remove('hidden');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// 색상 결과 표시 (전문가 분석 포함)
function displayColorResults(matches, professionalAnalysis) {
  const container = document.getElementById('matchedColors');
  const infoContainer = document.getElementById('colorInfo');
  
  container.innerHTML = '';
  
  // 전문가 분석 - 평균 색상 표시 (나노바나나 수준)
  const avgColorBox = document.createElement('div');
  avgColorBox.style.cssText = `
    width: 90px; height: 80px; border-radius: 8px; margin-right: 12px;
    background: linear-gradient(135deg, rgb(${professionalAnalysis.averageColor.join(',')}), rgb(${professionalAnalysis.averageColor.map(c => Math.max(0, c-20)).join(',')}));
    border: 3px solid #1a73e8; position: relative; flex-shrink: 0;
    box-shadow: 0 4px 12px rgba(26,115,232,0.3);
  `;
  const avgLabel = document.createElement('div');
  avgLabel.style.cssText = `
    position: absolute; bottom: -24px; left: 50%; transform: translateX(-50%);
    font-size: 11px; font-weight: 700; color: #1a73e8; white-space: nowrap;
    background: white; padding: 2px 6px; border-radius: 4px; border: 1px solid #1a73e8;
  `;
  avgLabel.textContent = '평균색상';
  avgColorBox.appendChild(avgLabel);
  container.appendChild(avgColorBox);
  
  matches.forEach((match, index) => {
    // 색상 사각형
    const colorBox = document.createElement('div');
    colorBox.style.cssText = `
      width: 60px; height: 60px; border-radius: 6px;
      background: rgb(${match.rgb.join(',')}); 
      border: 2px solid #ddd; position: relative;
      flex-shrink: 0; cursor: pointer; margin-right: 8px;
    `;
    
    // 클릭 시 예시 사진 생성
    colorBox.addEventListener('click', () => generateColorExample(match));
    
    // 색상 코드 라벨
    const label = document.createElement('div');
    label.style.cssText = `
      position: absolute; bottom: -20px; left: 50%; transform: translateX(-50%);
      font-size: 11px; font-weight: 600; color: #333; white-space: nowrap;
    `;
    label.textContent = match.code;
    colorBox.appendChild(label);
    
    container.appendChild(colorBox);
  });
  
  // 상세 정보 (전문가 분석 포함)
  const topMatch = matches[0];
  const accuracy = Math.max(0, 100 - Math.round(topMatch.distance / 4.4));
  
  infoContainer.innerHTML = `
    <!-- 추천 색상 (신중한 표현으로 변경) -->
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding: 12px; background: #f0f8ff; border-radius: 8px; border-left: 4px solid #1a73e8;">
      <div style="flex: 1;">
        <div style="font-size: 16px; font-weight: 600; color: #1a73e8; margin-bottom: 4px;">🔍 참고 색상: ${topMatch.code} (${topMatch.name})</div>
        <div style="font-size: 12px; color: #666;">이미지 분석 기반 유사 색상 (실제 시술 결과와 다를 수 있음)</div>
      </div>
      <span style="color: #34a853; font-weight: 600; font-size: 14px; background: #e8f5e8; padding: 4px 8px; border-radius: 12px;">${accuracy}% 매칭</span>
    </div>
    
    <!-- 분석 신뢰도 경고 -->
    <div style="background: #fff8e1; padding: 12px; border-radius: 8px; margin-bottom: 12px; border-left: 4px solid #ffa726;">
      <div style="font-size: 13px; font-weight: 600; color: #ef6c00; margin-bottom: 4px;">⚠️ 분석 신뢰도: ${professionalAnalysis.confidence}</div>
      <div style="font-size: 11px; color: #bf6000; line-height: 1.4;">
        • 모니터/조명/사진품질에 따라 색상이 달라질 수 있습니다<br>
        • 실제 모발 상태, 이전 시술 이력을 고려하지 않은 분석입니다<br>
        • 최종 색상 결정은 반드시 전문가 상담 후 진행하세요
      </div>
    </div>
    
    <!-- 이미지 기반 색상 정보 + 조명 분석 -->
    <div style="background: #f8f9fa; padding: 12px; border-radius: 8px; margin-bottom: 12px;">
      <h4 style="margin: 0 0 8px 0; color: #1a73e8; font-size: 14px;">📊 전문가 색상 분석 (조명 보정)</h4>
      <div style="font-size: 12px; line-height: 1.5; color: #555;">
        <div style="margin-bottom: 4px;"><strong>• 분석 레벨:</strong> ${professionalAnalysis.level} (보정 밝기: ${professionalAnalysis.realBrightness})</div>
        <div style="margin-bottom: 4px;"><strong>• 베이스 상태:</strong> ${professionalAnalysis.baseNeed}</div>
        <div style="margin-bottom: 4px;"><strong>• 언더톤:</strong> ${professionalAnalysis.undertone || professionalAnalysis.toneFamily}</div>
        <div style="margin-bottom: 4px;"><strong>• 채도 특성:</strong> ${professionalAnalysis.intensity} (${professionalAnalysis.saturationValue}%)</div>
        <div style="margin-bottom: 6px; padding-top: 6px; border-top: 1px solid #ddd;">
          <strong>🔆 조명 분석:</strong> ${professionalAnalysis.lightingCondition || '일반 조명'}
        </div>
        <div style="margin-bottom: 4px;"><strong>✨ 반사 특성:</strong> ${professionalAnalysis.reflectionType || '보통 반사율'}</div>
        <div style="margin-bottom: 4px;"><strong>🎨 색상 안정성:</strong> ${professionalAnalysis.colorStability || '안정적'}</div>
        <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #ddd; color: #999; font-size: 11px;">
          ※ 빛 반사/조명 변화를 고려한 전문가 수준 분석
        </div>
      </div>
    </div>
    
    <!-- 전문가 상담 권장 + 조명 노트 -->
    <div style="background: #fff3e0; padding: 12px; border-radius: 8px; margin-bottom: 12px; border-left: 4px solid #ff9800;">
      <h4 style="margin: 0 0 6px 0; color: #f57c00; font-size: 13px;">👨‍🎨 전문가 상담 필수 사항</h4>
      <div style="font-size: 11px; line-height: 1.4; color: #e65100;">
        <div style="margin-bottom: 3px;">✓ 현재 모발 상태 및 손상도 진단</div>
        <div style="margin-bottom: 3px;">✓ 이전 시술 이력 (염색/펌/매직 등) 확인</div>
        <div style="margin-bottom: 3px;">✓ 모발 타입 및 자연 색소 분석</div>
        <div style="margin-bottom: 3px;">✓ 희망 색상 구현 가능성 검토</div>
        <div style="margin-bottom: 3px;">✓ 다양한 조명에서 색상 변화 확인</div>
        ${professionalAnalysis.professionalNotes ? `
        <div style="margin-top: 8px; padding-top: 6px; border-top: 1px solid #ffcc80; background: #fff8e1; padding: 6px; border-radius: 4px;">
          <div style="font-weight: 600; margin-bottom: 3px;">📝 분석 노트:</div>
          <div style="font-size: 10px;">${professionalAnalysis.professionalNotes}</div>
        </div>
        ` : ''}
        <div style="color: #d84315; font-weight: 600; margin-top: 6px;">
          ※ 이 분석은 참고용이며, 정확한 시술 계획은 전문가와 상담 후 수립하시기 바랍니다
        </div>
      </div>
    </div>
    
    <!-- 참고용 기술 데이터 -->
    <details style="margin-bottom: 12px;">
      <summary style="font-size: 12px; color: #666; cursor: pointer; padding: 4px 0;">🔬 기술 분석 데이터 (참고용)</summary>
      <div style="font-size: 11px; color: #666; margin-top: 8px; padding: 8px; background: #f9f9f9; border-radius: 4px;">
        <div><strong>원본 평균 RGB:</strong> rgb(${professionalAnalysis.averageColor.join(', ')})</div>
        ${professionalAnalysis.correctedColor ? `<div><strong>조명 보정 RGB:</strong> rgb(${professionalAnalysis.correctedColor.join(', ')})</div>` : ''}
        <div><strong>보정 밝기 값:</strong> ${professionalAnalysis.realBrightness} (인간 시각 가중치 적용)</div>
        <div><strong>채도 정밀도:</strong> ${professionalAnalysis.saturationValue}%</div>
        <div><strong>분석 신뢰도:</strong> ${professionalAnalysis.confidence} (조명 조건 고려)</div>
        <div><strong>추출 색상 수:</strong> ${professionalAnalysis.extractedCount}개 클러스터</div>
        ${matches.length > 1 ? `<div><strong>유사 색상:</strong> ${matches.slice(1).map(m => m.code).join(', ')}</div>` : ''}
        <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid #ddd; font-size: 10px; color: #999; line-height: 1.3;">
          ※ RGB 값은 디스플레이 환경에 따라 다르게 보일 수 있으며, 실제 헤어 컬러와는 차이가 있을 수 있습니다.<br>
          ※ 이 분석은 이미지 기반 색상 정보 제공 목적이며, 시술 가이드가 아닙니다.
        </div>
      </div>
    </details>
    
    <!-- 고객 상담용 가이드 생성 -->
    <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #eee;">
      <button onclick="generateAllExamples([${matches.map(m => `{code:'${m.code}',name:'${m.name}',rgb:[${m.rgb.join(',')}]}`).join(',')}])" style="
        width: 100%; padding: 12px; background: #1a73e8; color: white; border: none; 
        border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;
        display: flex; align-items: center; justify-content: center; gap: 6px;
      ">📋 상담용 색상 참고 자료 생성</button>
      <div style="font-size: 11px; color: #999; text-align: center; margin-top: 8px; line-height: 1.3;">
        💡 생성되는 자료는 고객과의 색상 커뮤니케이션을 위한 <strong>참고 목적</strong>이며<br>
        실제 시술은 전문가의 모발 진단과 상담을 통해 결정됩니다
      </div>
    </div>
  `;
}

// ── 색상 요청사항 관리 ─────────────────────────────────────
function checkColorField() {
  // 시술명에 염색 관련 키워드가 있는지 확인
  const colorKeywords = ['염색', '컬러', '블리치', '탈색', '하이라이트', '옴브레', '발레야주', '투톤'];
  
  // 현장고객 탭
  const walkinService = document.getElementById('walkinService').value;
  const walkinColorRow = document.getElementById('walkinColorRow');
  if (walkinColorRow) {
    const showWalkinColor = colorKeywords.some(keyword => walkinService.includes(keyword));
    walkinColorRow.style.display = showWalkinColor ? 'flex' : 'none';
  }
  
  // 빠른입력 모달
  const qService = document.getElementById('qService').value;
  const qColorRow = document.getElementById('qColorRow');
  if (qColorRow) {
    const showQColor = colorKeywords.some(keyword => qService.includes(keyword));
    qColorRow.style.display = showQColor ? 'flex' : 'none';
  }
}

// 색상분석 탭으로 이동
function openColorAnalysis() {
  switchPage('color');
  // 모달이 열려있으면 닫기
  const modal = document.getElementById('quickModal');
  if (modal && !modal.classList.contains('hidden')) {
    closeQuickWalkin();
  }
}

// 시술명 입력 시 색상 필드 자동 표시/숨김
document.addEventListener('DOMContentLoaded', () => {
  const walkinService = document.getElementById('walkinService');
  const qService = document.getElementById('qService');
  
  if (walkinService) {
    walkinService.addEventListener('input', checkColorField);
  }
  
  if (qService) {
    qService.addEventListener('input', checkColorField);
  }
});

// ── 고객 전송용 예시 사진 생성 ─────────────────────────────
function generateColorExample(colorMatch) {
  generateExampleImage([colorMatch]);
}

function generateAllExamples(matches) {
  generateExampleImage(matches);
}

function generateExampleImage(colorMatches) {
  // 캔버스 생성 (고해상도)
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 800;
  canvas.height = 1000;
  
  // 배경 그라디언트
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#f8f9fa');
  gradient.addColorStop(1, '#e9ecef');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // 헤더
  ctx.fillStyle = '#1a73e8';
  ctx.fillRect(0, 0, canvas.width, 120);
  
  // 헤더 텍스트
  ctx.fillStyle = 'white';
  ctx.font = 'bold 32px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('✂️ 더에이치헤어 색상 가이드', canvas.width / 2, 45);
  ctx.font = '18px -apple-system, sans-serif';
  ctx.fillText('색상 참고 자료 (전문가 상담 필수)', canvas.width / 2, 80);
  
  // 메인 색상 표시
  let yPos = 160;
  const mainColor = colorMatches[0];
  
  // 큰 색상 사각형 (메인)
  const mainSize = 280;
  const mainX = (canvas.width - mainSize) / 2;
  
  // 색상 박스
  ctx.fillStyle = `rgb(${mainColor.rgb.join(',')})`;
  ctx.fillRect(mainX, yPos, mainSize, mainSize);
  
  // 색상 박스 테두리
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 3;
  ctx.strokeRect(mainX, yPos, mainSize, mainSize);
  
  yPos += mainSize + 30;
  
  // 메인 색상 정보
  ctx.fillStyle = '#333';
  ctx.font = 'bold 36px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${mainColor.code}`, canvas.width / 2, yPos);
  
  yPos += 40;
  ctx.font = '24px -apple-system, sans-serif';
  ctx.fillText(`${mainColor.name}`, canvas.width / 2, yPos);
  
  yPos += 50;
  
  // 전문가 분석 정보 (조명 보정 포함)
  if (window.lastProfessionalAnalysis) {
    const analysis = window.lastProfessionalAnalysis;
    
    ctx.fillStyle = '#1a73e8';
    ctx.font = 'bold 22px -apple-system, sans-serif';
    ctx.fillText('📋 전문가 분석 (조명 보정)', canvas.width / 2, yPos);
    yPos += 40;
    
    ctx.font = '18px -apple-system, sans-serif';
    ctx.textAlign = 'left';
    const leftMargin = 60;
    
    // 좌측 컬럼 - 기본 정보
    ctx.fillStyle = '#333';
    ctx.fillText(`🎨 레벨: ${analysis.level}`, leftMargin, yPos);
    yPos += 30;
    ctx.fillText(`🎯 베이스: ${analysis.baseNeed.split(' ')[0]}${analysis.baseNeed.split(' ')[1]}`, leftMargin, yPos);
    yPos += 30;
    ctx.fillText(`💫 언더톤: ${(analysis.undertone || analysis.toneFamily).split(' ')[0]}`, leftMargin, yPos);
    yPos += 30;
    ctx.fillText(`✨ 강도: ${analysis.intensity}`, leftMargin, yPos);
    yPos += 35;
    
    // 조명 분석 정보
    if (analysis.lightingCondition) {
      ctx.fillStyle = '#f57c00';
      ctx.font = 'bold 18px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🔆 조명 분석', canvas.width / 2, yPos);
      yPos += 30;
      
      ctx.fillStyle = '#555';
      ctx.font = '16px -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`조명 상태: ${analysis.lightingCondition}`, leftMargin, yPos);
      yPos += 25;
      ctx.fillText(`반사 특성: ${analysis.reflectionType || '보통'}`, leftMargin, yPos);
      yPos += 25;
      ctx.fillText(`색상 안정성: ${analysis.colorStability || '안정적'}`, leftMargin, yPos);
      yPos += 35;
    }
    
    // 주의사항
    if (analysis.warning) {
      ctx.fillStyle = '#ea4335';
      ctx.font = 'bold 16px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(analysis.warning.split(' - ')[0], canvas.width / 2, yPos);
      yPos += 30;
    }
  }
  
  ctx.textAlign = 'center';
  
  // 대안 색상들 (2개 이상인 경우)
  if (colorMatches.length > 1) {
    ctx.fillStyle = '#666';
    ctx.font = 'bold 20px -apple-system, sans-serif';
    ctx.fillText('대안 색상', canvas.width / 2, yPos);
    yPos += 40;
    
    const altColors = colorMatches.slice(1, 3); // 최대 2개
    const altSize = 120;
    const spacing = 40;
    const totalWidth = altColors.length * altSize + (altColors.length - 1) * spacing;
    let altX = (canvas.width - totalWidth) / 2;
    
    altColors.forEach((color, index) => {
      // 색상 박스
      ctx.fillStyle = `rgb(${color.rgb.join(',')})`;
      ctx.fillRect(altX, yPos, altSize, altSize);
      
      // 테두리
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth = 2;
      ctx.strokeRect(altX, yPos, altSize, altSize);
      
      // 색상 코드
      ctx.fillStyle = '#333';
      ctx.font = 'bold 16px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(color.code, altX + altSize/2, yPos + altSize + 25);
      
      // 색상명
      ctx.font = '12px -apple-system, sans-serif';
      ctx.fillText(color.name.length > 8 ? color.name.slice(0,8)+'...' : color.name, 
                   altX + altSize/2, yPos + altSize + 45);
      
      altX += altSize + spacing;
    });
    
    yPos += altSize + 80;
  }
  
  // 하단 주의사항 (전문가 수준 안전장치)
  ctx.fillStyle = '#ea4335';
  ctx.font = 'bold 16px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('⚠️ 참고용 색상 정보입니다', canvas.width / 2, yPos);
  yPos += 25;
  
  ctx.fillStyle = '#666';
  ctx.font = '14px -apple-system, sans-serif';
  ctx.fillText('실제 시술 전 전문가 상담이 반드시 필요합니다', canvas.width / 2, yPos);
  yPos += 20;
  ctx.fillText('모발 상태, 이전 시술 이력에 따라 결과가 달라질 수 있습니다', canvas.width / 2, yPos);
  yPos += 30;
  
  ctx.fillStyle = '#1a73e8';
  ctx.font = 'bold 16px -apple-system, sans-serif';
  ctx.fillText('📞 예약 상담: 더에이치헤어', canvas.width / 2, yPos);
  yPos += 30;
  
  const today = new Date();
  ctx.fillStyle = '#999';
  ctx.font = '12px -apple-system, sans-serif';
  ctx.fillText(`생성일: ${today.getFullYear()}.${(today.getMonth()+1).toString().padStart(2,'0')}.${today.getDate().toString().padStart(2,'0')}`, 
               canvas.width / 2, yPos);
  
  // 이미지 다운로드 링크 생성
  canvas.toBlob(function(blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `헤어색상가이드_${mainColor.code}_${today.getFullYear()}${(today.getMonth()+1).toString().padStart(2,'0')}${today.getDate().toString().padStart(2,'0')}.png`;
    link.style.display = 'none';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    // 성공 메시지
    const infoContainer = document.getElementById('colorInfo');
    const successDiv = document.createElement('div');
    successDiv.style.cssText = `
      margin-top: 12px; padding: 10px; background: #e8f5e8; border: 1px solid #4caf50;
      border-radius: 6px; text-align: center; font-size: 13px; color: #2e7d32;
    `;
    successDiv.innerHTML = `✅ 고객 전송용 색상 가이드 이미지가 다운로드됐어요!<br><small>카카오톡, 문자 등으로 고객에게 전송해주세요</small>`;
    infoContainer.appendChild(successDiv);
    
    // 3초 후 제거
    setTimeout(() => {
      if (successDiv.parentNode) {
        successDiv.parentNode.removeChild(successDiv);
      }
    }, 3000);
  }, 'image/png', 1.0);
}

// ── 전문가 시점 색상 분석 ─────────────────────────────
// (위에 analyzeProfessionally 함수로 통합됨)
