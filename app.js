// =============================================
// 헤어샵 대시보드 app.js
// - 새로고침 완전 리셋
// - 스케줄 탭 (예약확정/취소/변경 날짜별 정리)
// =============================================

const SUPABASE_URL = 'https://xpdtgmytotifewnznqvf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhwZHRnbXl0b3RpZmV3bnpucXZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNjgxMDMsImV4cCI6MjA4OTc0NDEwM30.SLc727NOuRnYtRsXdsnJq42MHNl9KIF2KDOwwIDUk_0';

const DAYS = ['일','월','화','수','목','금','토'];
const COLORS = ['#1a73e8','#34a853','#fbbc04','#ea4335','#9c27b0','#00bcd4','#ff9800','#795548'];
const now = new Date();
const charts = {};
let scheduleData = []; // 스케줄 전체 데이터 캐시
let currentPage = 'today';

Chart.defaults.font.family = "-apple-system,'Apple SD Gothic Neo','Noto Sans KR',sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.color = '#9e9e9e';

document.getElementById('headerDate').textContent =
  `${now.getFullYear()}년 ${now.getMonth()+1}월 ${now.getDate()}일 ${DAYS[now.getDay()]}요일`;

// ── 완전 새로고침 (캐시 없이 리셋) ──────────────
function hardRefresh() {
  // 모든 차트 삭제
  Object.keys(charts).forEach(k => { if(charts[k]) { charts[k].destroy(); delete charts[k]; } });
  scheduleData = [];

  // 현재 탭 다시 로드
  if (currentPage === 'today')    loadToday();
  else if (currentPage === 'schedule') loadSchedule();
  else if (currentPage === 'week')     loadWeek();
  else if (currentPage === 'month')    loadMonth();
  else if (currentPage === 'stats')    loadStats();

  // 버튼 회전 애니메이션
  const btn = document.querySelector('.refresh-top-btn');
  if (btn) { btn.style.transform = 'rotate(360deg)'; btn.style.transition = 'transform 0.5s'; setTimeout(()=>{btn.style.transform='';btn.style.transition='';},500); }
}

// ── 탭 전환 ──────────────────────────────────
function switchPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === name));
  document.querySelectorAll('.tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', ['today','schedule','week','month','range','stats'][i] === name);
  });
  currentPage = name;
  if (name==='today')    loadToday();
  if (name==='schedule') initSchedule();
  if (name==='week')     loadWeek();
  if (name==='month')    loadMonth();
  if (name==='range')    initRange();
  if (name==='stats')    loadStats();
}

// ── DB 조회 ──────────────────────────────────
async function sbGet(table, params={}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k,v));
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
               'Cache-Control': 'no-cache, no-store, must-revalidate',
               'Pragma': 'no-cache', 'Expires': '0' },
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const won = n => Number(n||0).toLocaleString('ko-KR');
const toDateStr = d => d.toISOString().slice(0,10);
function timeToMin(t) { if(!t) return 0; const[h,m]=t.split(':').map(Number); return h*60+m; }
function minToTime(m) { const h=Math.floor(m/60)%24,min=m%60; return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`; }
function destroyChart(id) { if(charts[id]) { charts[id].destroy(); delete charts[id]; } }
function makeLegend(elId, labels, colors) {
  const el = document.getElementById(elId);
  if(el) el.innerHTML = labels.map((l,i)=>`<div class="legend-item"><div class="legend-dot" style="background:${colors[i]}"></div>${l}</div>`).join('');
}

// ── 오늘 ──────────────────────────────────────
async function loadToday() {
  document.getElementById('todayBookings').innerHTML = '<div class="loading">불러오는 중...</div>';
  const today = toDateStr(now);
  try {
    const bookings = await sbGet('bookings', { booking_date:`eq.${today}`, order:'booking_time.asc', select:'*' });
    const active    = bookings.filter(b => b.status !== 'cancelled');
    const cancelled = bookings.filter(b => b.status === 'cancelled');
    const changed   = bookings.filter(b => b.status === 'changed');
    const revenue   = active.reduce((s,b) => s+(b.service_price||0), 0);

    document.getElementById('todayCount').textContent   = active.length + '건';
    document.getElementById('todayCancelCount').textContent =
      cancelled.length ? `취소 ${cancelled.length}건 / 변경 ${changed.length}건` : '취소·변경 없음';
    document.getElementById('todayCancelCount').className = 'stat-sub ' + (cancelled.length ? 'down' : 'up');
    document.getElementById('todayRevenue').textContent = won(revenue);

    // 시간대별 차트
    const hours = Array.from({length:12},(_,i)=>i+9);
    const hourMap = {}; hours.forEach(h => hourMap[h]=0);
    active.forEach(b => {
      if(b.booking_time) { const h=parseInt(b.booking_time.split(':')[0]); if(hourMap[h]!==undefined) hourMap[h]++; }
    });
    destroyChart('todayTimeChart');
    charts['todayTimeChart'] = new Chart(document.getElementById('todayTimeChart'), {
      type:'bar',
      data:{ labels:hours.map(h=>`${h}시`),
        datasets:[{ label:'예약', data:hours.map(h=>hourMap[h]),
          backgroundColor:hours.map(h=>hourMap[h]>0?'rgba(26,115,232,0.8)':'rgba(26,115,232,0.15)'),
          borderRadius:6, borderSkipped:false }]},
      options:{ plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true,ticks:{stepSize:1}},x:{grid:{display:false}}}, maintainAspectRatio:true }
    });

    renderBookings(bookings, 'todayBookings');
  } catch(e) {
    document.getElementById('todayBookings').innerHTML = `<div class="empty">오류: ${e.message}</div>`;
  }
}

// ── 스케줄 탭 ─────────────────────────────────
function initSchedule() {
  if (!document.getElementById('schFrom').value) {
    // 기본: 어제 ~ 내일 (어제 예약도 보이도록)
    const yesterday = new Date(now); yesterday.setDate(now.getDate()-1);
    const tomorrow  = new Date(now); tomorrow.setDate(now.getDate()+7);
    document.getElementById('schFrom').value = toDateStr(yesterday);
    document.getElementById('schTo').value   = toDateStr(tomorrow);
  }
  loadSchedule();
}

function setSchRange(type) {
  const y=now.getFullYear(), m=now.getMonth(), d=now.getDate();
  let from, to = toDateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate()+7));
  if (type==='today')  { from=toDateStr(now); to=toDateStr(now); }
  else if (type==='3days') { const f=new Date(now); f.setDate(d-1); from=toDateStr(f); const t=new Date(now); t.setDate(d+1); to=toDateStr(t); }
  else if (type==='week')  { const mn=new Date(now); mn.setDate(d-((now.getDay()+6)%7)); from=toDateStr(mn); const su=new Date(mn); su.setDate(mn.getDate()+6); to=toDateStr(su); }
  else if (type==='month') { from=toDateStr(new Date(y,m,1)); to=toDateStr(new Date(y,m+1,0)); }
  document.getElementById('schFrom').value = from;
  document.getElementById('schTo').value   = to;
  loadSchedule();
}

async function loadSchedule() {
  const from = document.getElementById('schFrom').value;
  const to   = document.getElementById('schTo').value;
  if (!from || !to) return;

  document.getElementById('scheduleList').innerHTML = '<div class="loading">스케줄 불러오는 중...</div>';

  try {
    const bookings = await sbGet('bookings', {
      booking_date: `gte.${from}`,
      and: `(booking_date.lte.${to})`,
      order: 'booking_date.asc,booking_time.asc',
      select: '*'
    });

    scheduleData = bookings;

    // 통계 업데이트
    document.getElementById('schTotal').textContent     = bookings.length + '건';
    document.getElementById('schCancel').textContent    = bookings.filter(b=>b.status==='cancelled').length + '건';
    document.getElementById('schChanged').textContent   = bookings.filter(b=>b.status==='changed').length + '건';
    document.getElementById('schConfirmed').textContent = bookings.filter(b=>b.status==='confirmed'||b.status==='completed').length + '건';

    renderSchedule(bookings);
  } catch(e) {
    document.getElementById('scheduleList').innerHTML = `<div class="empty">오류: ${e.message}</div>`;
  }
}

function filterSchedule(type, btn) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const filtered = type === 'all' ? scheduleData : scheduleData.filter(b => b.status === type);
  renderSchedule(filtered);
}

function renderSchedule(bookings) {
  const el = document.getElementById('scheduleList');
  if (!bookings.length) { el.innerHTML = '<div class="empty">해당 기간 예약이 없어요</div>'; return; }

  // 날짜별 그룹핑
  const grouped = {};
  bookings.forEach(b => {
    if (!grouped[b.booking_date]) grouped[b.booking_date] = [];
    grouped[b.booking_date].push(b);
  });

  const todayStr = toDateStr(now);
  el.innerHTML = Object.entries(grouped).map(([date, list]) => {
    const d     = new Date(date);
    const isToday  = date === todayStr;
    const isTomorrow = date === toDateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate()+1));
    const label = isToday ? '오늘' : isTomorrow ? '내일' : `${d.getMonth()+1}월 ${d.getDate()}일 (${DAYS[d.getDay()]})`;
    const badge = isToday ? `<span class="today-badge">TODAY</span>` : `<span class="date-badge">${list.length}건</span>`;
    const cards = list.map(b => bookingCardHtml(b)).join('');
    return `<div class="date-section">
      <div class="date-header">${label} ${badge}</div>
      <div class="booking-list">${cards}</div>
    </div>`;
  }).join('');
}

function bookingCardHtml(b) {
  const endStr = minToTime(timeToMin(b.booking_time) + (b.duration_min||60));
  const statusMap = { confirmed:'예약확정', completed:'시술완료', cancelled:'취소됨', changed:'예약변경' };
  const tagClsMap = { confirmed:'tag-confirmed', completed:'tag-completed', cancelled:'tag-cancelled', changed:'tag-changed' };
  const cardCls   = b.status + (b.is_new_customer ? ' new-customer' : '');
  return `<div class="booking-card ${cardCls}">
    <div class="time-col">
      <div class="time-main">${b.booking_time?.slice(0,5)||'--:--'}</div>
      <div class="time-end">~${endStr}</div>
    </div>
    <div class="vline"></div>
    <div class="booking-info">
      <div class="booking-name">${b.customer_name}</div>
      <div class="booking-service">${b.service_name}</div>
      <div class="booking-tags">
        <span class="tag ${tagClsMap[b.status]||'tag-confirmed'}">${statusMap[b.status]||b.status}</span>
        ${b.is_new_customer ? '<span class="tag tag-new">신규</span>' : ''}
      </div>
    </div>
    <div class="booking-price ${b.status==='cancelled'?'cancelled':''}">${won(b.service_price)}원</div>
  </div>`;
}

function renderBookings(bookings, elId) {
  const el = document.getElementById(elId);
  if (!bookings.length) { el.innerHTML='<div class="empty">예약이 없어요</div>'; return; }
  el.innerHTML = bookings.map(b => bookingCardHtml(b)).join('');
}

// ── 주간 ──────────────────────────────────────
async function loadWeek() {
  const n=new Date(), mon=new Date(n); mon.setDate(n.getDate()-((n.getDay()+6)%7));
  const sun=new Date(mon); sun.setDate(mon.getDate()+6);
  try {
    const bk = await sbGet('bookings',{booking_date:`gte.${toDateStr(mon)}`,and:`(booking_date.lte.${toDateStr(sun)})`,select:'booking_date,service_price,status'});
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
    const bgColors=['월','화','수','목','금','토','일'].map((_,i)=>i===todayIdx?'rgba(26,115,232,0.9)':'rgba(26,115,232,0.35)');

    destroyChart('weekBarChart');
    charts['weekBarChart']=new Chart(document.getElementById('weekBarChart'),{
      type:'bar',
      data:{labels:['월','화','수','목','금','토','일'],datasets:[
        {label:'매출(원)',data:Object.values(dayRevMap),backgroundColor:bgColors,borderRadius:8,borderSkipped:false,yAxisID:'y'},
        {label:'예약건',data:Object.values(dayCntMap),type:'line',borderColor:'#34a853',backgroundColor:'rgba(52,168,83,.1)',pointBackgroundColor:'#34a853',pointRadius:4,fill:true,tension:.4,yAxisID:'y1'}
      ]},
      options:{plugins:{legend:{position:'top',labels:{boxWidth:10,padding:12}}},scales:{y:{beginAtZero:true,position:'left',grid:{display:false}},y1:{beginAtZero:true,position:'right',grid:{display:false},ticks:{stepSize:1}}},maintainAspectRatio:true}
    });

    destroyChart('weekDonutChart');
    charts['weekDonutChart']=new Chart(document.getElementById('weekDonutChart'),{
      type:'doughnut',
      data:{labels:['예약완료','취소'],datasets:[{data:[active.length,cancelled.length],backgroundColor:['#1a73e8','#ea4335'],borderWidth:0,hoverOffset:4}]},
      options:{plugins:{legend:{display:false}},cutout:'70%',maintainAspectRatio:true}
    });
    makeLegend('weekLegend',['예약완료','취소'],['#1a73e8','#ea4335']);
  } catch(e){ console.error(e); }
}

// ── 월간 ──────────────────────────────────────
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

// ── 기간별 ──────────────────────────────────────
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
    const revenue=active.reduce((s,b)=>s+(b.service_price||0),0);
    const cancelRate=bk.length?Math.round(cancelled.length/bk.length*100*10)/10:0;
    const avgPrice=active.length?Math.round(revenue/active.length):0;

    const svcMap={};
    active.forEach(b=>{if(!svcMap[b.service_name]){svcMap[b.service_name]={count:0,revenue:0};} svcMap[b.service_name].count++;svcMap[b.service_name].revenue+=(b.service_price||0);});
    const svcEntries=Object.entries(svcMap).sort((a,b)=>b[1].revenue-a[1].revenue);

    resultEl.innerHTML=`
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">총 예약</div><div class="stat-value blue">${active.length}건</div><div class="stat-sub down">취소 ${cancelled.length}건</div></div>
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

// ── 분석 ──────────────────────────────────────
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
          pointRadius:Array.from({length:12},(_,i)=>i+1===curMonth?6:4),
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
        {label:'건수',data:svcEntries.map(([,v])=>v.count),backgroundColor:svcColors.map(c=>c+'66'),borderRadius:8,borderSkipped:false}
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

// ── 초기 로드 ──────────────────────────────────
loadToday();
setInterval(()=>{ if(currentPage==='today') loadToday(); }, 5*60*1000);
