// =============================================
// 헤어샵 대시보드 앱 - app.js
// Supabase와 직접 통신
// =============================================

const SUPABASE_URL = 'https://xpdtgmytotifewnznqvf.supabase.co';   // ← 실제 URL로 교체
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhwZHRnbXl0b3RpZmV3bnpucXZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNjgxMDMsImV4cCI6MjA4OTc0NDEwM30.SLc727NOuRnYtRsXdsnJq42MHNl9KIF2KDOwwIDUk_0';   // ← 실제 KEY로 교체

// ── 날짜 헤더 ─────────────────────────────────
const DAYS = ['일','월','화','수','목','금','토'];
const now  = new Date();
document.getElementById('headerDate').textContent =
  `${now.getFullYear()}년 ${now.getMonth()+1}월 ${now.getDate()}일 ${DAYS[now.getDay()]}요일`;

// ── 탭 전환 ───────────────────────────────────
let currentPage = 'today';
function switchPage(name) {
  document.querySelectorAll('.page').forEach(p =>
    p.classList.toggle('active', p.id === name)
  );
  document.querySelectorAll('.tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', ['today','week','month','stats'][i] === name);
  });
  currentPage = name;

  if (name === 'today')  loadToday();
  if (name === 'week')   loadWeek();
  if (name === 'month')  loadMonth();
  if (name === 'stats')  loadStats();
}

// ── DB 조회 헬퍼 ──────────────────────────────
async function sbGet(table, params = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k,v));
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── 숫자 포맷 ─────────────────────────────────
const won = n => Number(n||0).toLocaleString('ko-KR');

// ── 오늘 페이지 ──────────────────────────────
async function loadToday() {
  const today = toDateStr(new Date());
  try {
    const bookings = await sbGet('bookings', {
      booking_date: `eq.${today}`,
      order: 'booking_time.asc',
      select: '*',
    });

    const active    = bookings.filter(b => b.status !== 'cancelled');
    const cancelled = bookings.filter(b => b.status === 'cancelled');
    const revenue   = active.reduce((s,b) => s+(b.service_price||0), 0);

    document.getElementById('todayCount').textContent   = active.length + '건';
    document.getElementById('todayCancelCount').textContent =
      cancelled.length ? `취소 ${cancelled.length}건 포함` : '취소 없음';
    document.getElementById('todayCancelCount').className =
      'stat-sub ' + (cancelled.length ? 'down' : 'up');
    document.getElementById('todayRevenue').textContent = won(revenue);

    renderBookings(bookings);
  } catch(e) {
    document.getElementById('todayBookings').innerHTML =
      `<div class="empty">데이터를 불러오지 못했어요<br><small>${e.message}</small></div>`;
  }
}

function renderBookings(bookings) {
  const el = document.getElementById('todayBookings');
  if (!bookings.length) {
    el.innerHTML = '<div class="empty">오늘 예약이 없어요</div>';
    return;
  }

  el.innerHTML = bookings.map(b => {
    const endMin = timeToMin(b.booking_time) + (b.duration_min||60);
    const endStr = minToTime(endMin);
    const cls    = b.status === 'cancelled' ? 'cancelled'
                 : b.is_new_customer        ? 'new-customer' : '';
    const tagCls = b.status === 'confirmed' ? 'tag-confirmed'
                 : b.status === 'completed' ? 'tag-completed' : 'tag-cancelled';
    const tagTxt = b.status === 'confirmed' ? '예약확정'
                 : b.status === 'completed' ? '시술완료' : '취소됨';
    const priceCls = b.status === 'cancelled' ? 'booking-price cancelled' : 'booking-price';

    return `
      <div class="booking-card ${cls}">
        <div class="time-col">
          <div class="time-main">${b.booking_time?.slice(0,5)||''}</div>
          <div class="time-end">~${endStr}</div>
        </div>
        <div class="vline"></div>
        <div class="booking-info">
          <div class="booking-name">${b.customer_name}</div>
          <div class="booking-service">${b.service_name}</div>
          <div class="booking-tags">
            <span class="tag ${tagCls}">${tagTxt}</span>
            ${b.is_new_customer ? '<span class="tag tag-new">신규</span>' : ''}
          </div>
        </div>
        <div class="${priceCls}">${won(b.service_price)}원</div>
      </div>`;
  }).join('');
}

// ── 주간 페이지 ──────────────────────────────
async function loadWeek() {
  const [mon, sun] = getWeekRange();
  try {
    const bookings = await sbGet('bookings', {
      booking_date: `gte.${toDateStr(mon)}`,
      and: `(booking_date.lte.${toDateStr(sun)})`,
      select: 'booking_date,booking_time,service_price,status',
    });

    const active   = bookings.filter(b => b.status !== 'cancelled');
    const cancelled= bookings.filter(b => b.status === 'cancelled');
    const revenue  = active.reduce((s,b) => s+(b.service_price||0), 0);
    const cancelRate = bookings.length
      ? Math.round(cancelled.length/bookings.length*100) : 0;

    document.getElementById('weekCount').textContent   = active.length + '건';
    document.getElementById('weekRevenue').textContent = won(revenue);
    document.getElementById('weekCancelRate').textContent = `취소율 ${cancelRate}%`;
    document.getElementById('weekCancelRate').className =
      'stat-sub ' + (cancelRate > 10 ? 'down' : 'up');

    // 요일별 집계
    const dayMap = {일:0,월:0,화:0,수:0,목:0,금:0,토:0};
    active.forEach(b => {
      const d = new Date(b.booking_date);
      dayMap[DAYS[d.getDay()]] += (b.service_price||0);
    });

    const maxVal = Math.max(...Object.values(dayMap), 1);
    const today  = DAYS[new Date().getDay()];
    document.getElementById('weeklyBars').innerHTML =
      Object.entries(dayMap).map(([day, val]) => {
        const pct = Math.round(val/maxVal*100);
        const cls = day === today ? 'best' : 'primary';
        return `
          <div class="bar-item">
            <div class="bar-item-label">${day}요일</div>
            <div class="bar-track">
              <div class="bar-fill ${cls}" style="width:${pct}%">${pct > 20 ? pct+'%' : ''}</div>
            </div>
            <div class="bar-item-val">${won(val)}원</div>
          </div>`;
      }).join('');
  } catch(e) {
    document.getElementById('weeklyBars').innerHTML =
      `<div class="empty">오류: ${e.message}</div>`;
  }
}

// ── 월간 페이지 ──────────────────────────────
async function loadMonth() {
  const y = now.getFullYear(), m = now.getMonth();
  const first = toDateStr(new Date(y, m, 1));
  const last  = toDateStr(new Date(y, m+1, 0));
  try {
    const bookings = await sbGet('bookings', {
      booking_date: `gte.${first}`,
      and: `(booking_date.lte.${last})`,
      select: 'service_name,service_price,status',
    });

    const completed = bookings.filter(b => b.status === 'completed');
    const cancelled = bookings.filter(b => b.status === 'cancelled');
    const revenue   = completed.reduce((s,b) => s+(b.service_price||0), 0);
    const cancelRate= bookings.length
      ? Math.round(cancelled.length/bookings.length*100*10)/10 : 0;

    document.getElementById('monthCount').textContent   = (bookings.length - cancelled.length) + '건';
    document.getElementById('monthRevenue').textContent = won(revenue);
    document.getElementById('monthCancelRate').textContent = `취소율 ${cancelRate}%`;

    // 시술별 집계
    const svcMap = {};
    completed.forEach(b => {
      svcMap[b.service_name] = (svcMap[b.service_name]||0) + (b.service_price||0);
    });
    const sorted = Object.entries(svcMap).sort((a,b) => b[1]-a[1]);
    const maxVal = sorted[0]?.[1] || 1;

    document.getElementById('monthlyServiceBars').innerHTML =
      sorted.map(([name, val], i) => {
        const pct = Math.round(val/maxVal*100);
        const cls = i === 0 ? 'best' : 'green';
        return `
          <div class="bar-item">
            <div class="bar-item-label">${name}</div>
            <div class="bar-track">
              <div class="bar-fill ${cls}" style="width:${pct}%">${pct > 15 ? pct+'%' : ''}</div>
            </div>
            <div class="bar-item-val">${won(val)}원</div>
          </div>`;
      }).join('') || '<div class="empty">완료된 시술 없음</div>';
  } catch(e) {
    document.getElementById('monthlyServiceBars').innerHTML =
      `<div class="empty">오류: ${e.message}</div>`;
  }
}

// ── 분석 페이지 ──────────────────────────────
async function loadStats() {
  const y = now.getFullYear();
  try {
    const all = await sbGet('bookings', {
      booking_date: `gte.${y}-01-01`,
      select: 'service_name,service_price,status,is_new_customer',
    });

    const completed = all.filter(b => b.status === 'completed');
    const cancelled = all.filter(b => b.status === 'cancelled');
    const revenue   = completed.reduce((s,b)=>s+(b.service_price||0),0);
    const avgPrice  = completed.length ? Math.round(revenue/completed.length) : 0;
    const cancelRate= all.length
      ? Math.round(cancelled.length/all.length*100*10)/10 : 0;
    const newCust   = all.filter(b=>b.is_new_customer).length;
    const newRate   = all.length ? Math.round(newCust/all.length*100*10)/10 : 0;

    document.getElementById('yearRevenue').textContent = won(revenue);
    document.getElementById('avgPrice').textContent    = won(avgPrice);
    document.getElementById('cancelRate').textContent  = cancelRate + '%';
    document.getElementById('newCustRate').textContent = newRate + '%';

    // 시술 순위
    const svcMap = {};
    all.filter(b=>b.status!=='cancelled').forEach(b=>{
      if (!svcMap[b.service_name]) svcMap[b.service_name] = {count:0, revenue:0};
      svcMap[b.service_name].count++;
      svcMap[b.service_name].revenue += (b.service_price||0);
    });
    const sorted = Object.entries(svcMap).sort((a,b)=>b[1].revenue-a[1].revenue);
    const maxVal = sorted[0]?.[1].revenue || 1;

    document.getElementById('serviceRankBars').innerHTML =
      sorted.slice(0,5).map(([name, d], i) => {
        const pct = Math.round(d.revenue/maxVal*100);
        const cls = i === 0 ? 'best' : 'purple';
        return `
          <div class="bar-item">
            <div class="bar-item-label">${i+1}위 ${name}</div>
            <div class="bar-track">
              <div class="bar-fill ${cls}" style="width:${pct}%">${d.count}건</div>
            </div>
            <div class="bar-item-val">${won(d.revenue)}원</div>
          </div>`;
      }).join('') || '<div class="empty">데이터 없음</div>';
  } catch(e) {
    document.getElementById('serviceRankBars').innerHTML =
      `<div class="empty">오류: ${e.message}</div>`;
  }
}

// ── 유틸 ─────────────────────────────────────
function toDateStr(d) { return d.toISOString().slice(0,10); }

function timeToMin(t) {
  if (!t) return 0;
  const [h,m] = t.split(':').map(Number);
  return h*60+m;
}

function minToTime(m) {
  const h = Math.floor(m/60)%24;
  const min = m%60;
  return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
}

function getWeekRange() {
  const n   = new Date();
  const mon = new Date(n);
  mon.setDate(n.getDate() - ((n.getDay()+6)%7));
  const sun = new Date(mon);
  sun.setDate(mon.getDate()+6);
  return [mon, sun];
}

// ── 초기 로드 ─────────────────────────────────
loadToday();

// 5분마다 자동 새로고침
setInterval(() => {
  if (currentPage === 'today') loadToday();
}, 5 * 60 * 1000);
