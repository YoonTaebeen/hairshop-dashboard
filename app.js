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
    btn.classList.toggle('active', ['today','schedule','week','month','walkin','stats'][i] === name);
  });
  currentPage = name;
  if (name==='today')    loadToday();
  if (name==='schedule') initSchedule();
  if (name==='week')     loadWeek();
  if (name==='month')    loadMonth();
  if (name==='walkin')   initWalkin();
  if (name==='stats')    loadStats();
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

// ── 분석 ───────────────────────────────────────
async function loadStats() {
  const y=now.getFullYear();
  try {
    const all=await sbGet('bookings',{booking_date:`gte.${y}-01-01`,select:'booking_date,service_name,service_price,status,is_new_customer'});
    const active=all.filter(b=>b.status!=='cancelled'), cancelled=all.filter(b=>b.status==='cancelled');
    const revenue=active.reduce((s,b)=>s+(b.service_price||0),0);
    const avgPrice=active.length?Math.round(revenue/active.length):0;
    const cancelRate=all.length?Math.round(cancelled.length/all.length*100*10)/10:0;
    const newRate=all.length?Math.round(all.filter(b=>b.is_new_customer).length/all.length*100*10)/10:0;
    document.getElementById('yearRevenue').textContent=won(revenue);
    document.getElementById('avgPrice').textContent=won(avgPrice);
    document.getElementById('cancelRate').textContent=cancelRate+'%';
    document.getElementById('newCustRate').textContent=newRate+'%';

    const monthMap={}; for(let i=1;i<=12;i++) monthMap[i]=0;
    active.forEach(b=>{const mo=new Date(b.booking_date).getMonth()+1; monthMap[mo]+=(b.service_price||0);});
    const curMonth=now.getMonth()+1;

    destroyChart('yearLineChart');
    charts['yearLineChart']=new Chart(document.getElementById('yearLineChart'),{
      type:'line',
      data:{labels:['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'],
        datasets:[{label:'월 매출',data:Object.values(monthMap),borderColor:'#1a73e8',backgroundColor:'rgba(26,115,232,.1)',fill:true,tension:.4,
          pointRadius:Array.from({length:12},(_,i)=>i+1===curMonth?7:4),
          pointBackgroundColor:Array.from({length:12},(_,i)=>i+1===curMonth?'#ea4335':'#1a73e8')}]},
      options:{plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:'rgba(0,0,0,.05)'}},x:{grid:{display:false}}},maintainAspectRatio:true}
    });

    const svcMap={};
    active.forEach(b=>{if(!svcMap[b.service_name]){svcMap[b.service_name]={count:0,revenue:0};} svcMap[b.service_name].count++;svcMap[b.service_name].revenue+=(b.service_price||0);});
    const svcEntries=Object.entries(svcMap).sort((a,b)=>b[1].revenue-a[1].revenue).slice(0,5);
    const svcColors=svcEntries.map((_,i)=>COLORS[i%COLORS.length]);

    destroyChart('serviceBarChart');
    charts['serviceBarChart']=new Chart(document.getElementById('serviceBarChart'),{
      type:'bar',
      data:{labels:svcEntries.map(([k])=>k),datasets:[
        {label:'매출',data:svcEntries.map(([,v])=>v.revenue),backgroundColor:svcColors,borderRadius:8,borderSkipped:false},
        {label:'건수',data:svcEntries.map(([,v])=>v.count),backgroundColor:svcColors.map(c=>c+'55'),borderRadius:8,borderSkipped:false}
      ]},
      options:{indexAxis:'y',plugins:{legend:{position:'top',labels:{boxWidth:10,padding:10}}},scales:{x:{beginAtZero:true,grid:{display:false}},y:{grid:{display:false}}},maintainAspectRatio:true}
    });

    destroyChart('servicePieChart');
    charts['servicePieChart']=new Chart(document.getElementById('servicePieChart'),{
      type:'doughnut',
      data:{labels:svcEntries.map(([k])=>k),datasets:[{data:svcEntries.map(([,v])=>v.revenue),backgroundColor:svcColors,borderWidth:0,hoverOffset:6}]},
      options:{plugins:{legend:{display:false}},cutout:'65%',maintainAspectRatio:true}
    });
    makeLegend('serviceLegend',svcEntries.map(([k])=>k),svcColors);
  } catch(e){ console.error(e); }
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

  if (!date || !name || !svcRaw) {
    alert('날짜, 이름, 시술명은 필수예요!');
    return;
  }

  const service = matchService(svcRaw);
  const booking = {
    customer_name:  name,
    service_name:   service,
    service_price:  price,
    booking_date:   date,
    booking_time:   time ? time + ':00' : '00:00:00',
    status:         'confirmed',
    memo:           memo || null,
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

  if (!date || !name || !svcRaw) { alert('날짜, 이름, 시술명은 필수예요!'); return; }

  const service = matchService(svcRaw);
  const booking = {
    customer_name:   name,
    service_name:    service,
    service_price:   price,
    booking_date:    date,
    booking_time:    time ? time+':00' : '00:00:00',
    status:          'confirmed',
    memo:            memo || null,
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

// ── 스케줄 탭 하단 분석 차트 ───────────────────────────
function renderScheduleStats(bookings, from, to) {
  const el = document.getElementById('scheduleStats');
  if (!el) return;

  const active    = bookings.filter(b=>b.status!=='cancelled');
  const cancelled = bookings.filter(b=>b.status==='cancelled');
  const changed   = bookings.filter(b=>b.status==='changed');
  const revenue   = active.reduce((s,b)=>s+(b.service_price||0),0);
  const cancelRate= bookings.length ? Math.round(cancelled.length/bookings.length*100*10)/10 : 0;
  const avgPrice  = active.length ? Math.round(revenue/active.length) : 0;

  // 날짜별 매출
  const dateMap={};
  active.forEach(b=>{ dateMap[b.booking_date]=(dateMap[b.booking_date]||0)+(b.service_price||0); });
  const dateKeys=Object.keys(dateMap).sort();

  // 시술별 매출
  const svcMap={};
  active.forEach(b=>{ if(!svcMap[b.service_name]){svcMap[b.service_name]={count:0,revenue:0};} svcMap[b.service_name].count++; svcMap[b.service_name].revenue+=(b.service_price||0); });
  const svcEntries=Object.entries(svcMap).sort((a,b)=>b[1].revenue-a[1].revenue).slice(0,8);
  const svcColors=svcEntries.map((_,i)=>COLORS[i%COLORS.length]);

  // 요일별 매출
  const dayRevMap={0:0,1:0,2:0,3:0,4:0,5:0,6:0}, dayCntMap={0:0,1:0,2:0,3:0,4:0,5:0,6:0};
  active.forEach(b=>{ const idx=(new Date(b.booking_date).getDay()+6)%7; dayRevMap[idx]+=(b.service_price||0); dayCntMap[idx]++; });

  el.innerHTML = `
    <!-- 요약 통계 -->
    <div class="stat-grid" style="margin-top:14px">
      <div class="stat-card"><div class="stat-label">총 매출</div><div class="stat-value green">${won(revenue)}</div><div class="stat-sub">원</div></div>
      <div class="stat-card"><div class="stat-label">평균 객단가</div><div class="stat-value purple">${won(avgPrice)}</div><div class="stat-sub">원</div></div>
      <div class="stat-card"><div class="stat-label">취소율</div><div class="stat-value red">${cancelRate}%</div><div class="stat-sub">취소 ${cancelled.length}건</div></div>
      <div class="stat-card"><div class="stat-label">현장고객</div><div class="stat-value orange">${bookings.filter(b=>!b.booking_no).length}건</div></div>
    </div>

    <!-- 매출 추이 -->
    <div class="card" style="margin-top:14px">
      <div class="card-title">📈 기간 매출 추이</div>
      <div class="chart-wrap"><canvas id="schLineChart"></canvas></div>
    </div>

    <!-- 요일별 + 시술별 -->
    <div class="card" style="margin-top:14px">
      <div class="card-title">📅 요일별 예약</div>
      <div class="chart-wrap"><canvas id="schDayChart"></canvas></div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="card-title">✂️ 시술별 매출</div>
      <div class="chart-wrap"><canvas id="schSvcChart"></canvas></div>
      <div id="schSvcLegend" class="legend" style="margin-top:8px"></div>
    </div>

    <!-- 예약 vs 취소 도넛 -->
    <div class="card" style="margin-top:14px">
      <div class="card-title">🔵 예약 현황 비율</div>
      <div style="display:flex;align-items:center;gap:16px">
        <div style="width:140px;height:140px;flex-shrink:0"><canvas id="schDonutChart"></canvas></div>
        <div id="schDonutLegend" class="legend" style="flex-direction:column;gap:8px"></div>
      </div>
    </div>
  `;

  // 매출 추이 라인차트
  destroyChart('schLineChart');
  charts['schLineChart']=new Chart(document.getElementById('schLineChart'),{
    type:'line',
    data:{labels:dateKeys.map(d=>d.slice(5)),datasets:[{
      label:'매출',data:dateKeys.map(k=>dateMap[k]),
      borderColor:'#1a73e8',backgroundColor:'rgba(26,115,232,.1)',
      fill:true,tension:.4,pointRadius:3,pointBackgroundColor:'#1a73e8'
    }]},
    options:{plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:'rgba(0,0,0,.05)'}},x:{ticks:{maxTicksLimit:10},grid:{display:false}}},maintainAspectRatio:true}
  });

  // 요일별 바+라인 차트
  destroyChart('schDayChart');
  charts['schDayChart']=new Chart(document.getElementById('schDayChart'),{
    type:'bar',
    data:{labels:['월','화','수','목','금','토','일'],datasets:[
      {label:'매출(원)',data:Object.values(dayRevMap),backgroundColor:'rgba(26,115,232,0.6)',borderRadius:6,yAxisID:'y'},
      {label:'예약건',data:Object.values(dayCntMap),type:'line',borderColor:'#34a853',backgroundColor:'rgba(52,168,83,.1)',pointBackgroundColor:'#34a853',pointRadius:4,fill:true,tension:.4,yAxisID:'y1'}
    ]},
    options:{plugins:{legend:{position:'top',labels:{boxWidth:10,padding:10}}},scales:{y:{beginAtZero:true,position:'left',grid:{display:false}},y1:{beginAtZero:true,position:'right',grid:{display:false},ticks:{stepSize:1}}},maintainAspectRatio:true}
  });

  // 시술별 가로 바차트
  destroyChart('schSvcChart');
  charts['schSvcChart']=new Chart(document.getElementById('schSvcChart'),{
    type:'bar',
    data:{labels:svcEntries.map(([k])=>k.length>10?k.slice(0,10)+'…':k),datasets:[
      {label:'매출',data:svcEntries.map(([,v])=>v.revenue),backgroundColor:svcColors,borderRadius:4},
      {label:'건수',data:svcEntries.map(([,v])=>v.count),type:'line',borderColor:'#fbbc04',pointBackgroundColor:'#fbbc04',pointRadius:4,fill:false,yAxisID:'y1'}
    ]},
    options:{indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{beginAtZero:true,grid:{display:false}},y1:{beginAtZero:true,position:'right',grid:{display:false},ticks:{stepSize:1}}},maintainAspectRatio:false,responsive:true}
  });
  document.getElementById('schSvcChart').style.height='220px';
  makeLegend('schSvcLegend', svcEntries.map(([k])=>k), svcColors);

  // 도넛차트
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
}
