import { API } from './api.js';
import { formatCurrency, formatDateISO } from './utils.js';

let STATE = { categories: [], transactions: [], accounts: [], charts: {} };
let CHART_DATA = { dayOfWeekMap: [], dayOfMonthMap: [] };
let CURRENT_TODO_FILTER = 'urgent';

document.addEventListener('DOMContentLoaded', async () => {
    setupEventListeners();
    initSnowToggle();
    await initData();
});

function setupEventListeners() {
    // Табы
    document.querySelectorAll('.js-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => switchTab(e.target.dataset.tab));
    });
    // Перезагрузка
    document.getElementById('btn-reload')?.addEventListener('click', () => location.reload());
    // Фильтры
    document.getElementById('btn-apply-filter')?.addEventListener('click', applyFilters);
    document.getElementById('btn-reset-filter')?.addEventListener('click', resetFilters);
    
    // Модалки
    document.getElementById('btn-open-add-tx')?.addEventListener('click', () => openTxModal());
    document.getElementById('form-tx')?.addEventListener('submit', handleTxSubmit);
    document.querySelectorAll('.btn-close-modal').forEach(btn => btn.addEventListener('click', closeAllModals));
    window.onclick = (e) => { if(e.target.id.startsWith('modal-')) closeAllModals(); };

    // Дела
    document.getElementById('form-todo')?.addEventListener('submit', handleTodoSubmit);
    document.getElementById('todo-list')?.addEventListener('click', handleTodoClick);
    
    // Покупки
    document.getElementById('form-shopping')?.addEventListener('submit', handleShoppingSubmit);
    ['list-buy', 'list-market', 'list-wish'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', handleShoppingClick);
    });

    // Транзакции (Редактирование)
    document.getElementById('table-body')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.js-edit-tx');
        if (btn) {
            const tx = STATE.transactions.find(t => t.id === parseInt(btn.dataset.id));
            if (tx) openTxModal(tx);
        }
    });

    // Коммуналка
    document.getElementById('utility-bulk-form')?.addEventListener('submit', handleUtilitySubmit);
    document.getElementById('utility-bulk-form')?.addEventListener('input', calculateUtilityTotal);
    const hotInput = document.getElementById('val-water-hot');
    if (hotInput) hotInput.addEventListener('input', (e) => { document.getElementById('val-heat-hot').value = e.target.value; });

    // Ученики
    document.getElementById('form-student')?.addEventListener('submit', handleStudentSubmit);
    document.getElementById('btn-delete-student')?.addEventListener('click', deleteStudent);

    // Корзина
    document.getElementById('btn-open-trash')?.addEventListener('click', openTrash);
    document.getElementById('trash-list')?.addEventListener('click', handleTrashClick);
}

// --- INIT ---
async function initData() {
    try {
        const me = await API.system.getMe();
        applyModules(me.modules, me.role);

        const [cats, txs, bal] = await Promise.all([
            API.finance.getCategories(),
            API.finance.getTransactions(),
            API.finance.getBalances()
        ]);
        
        STATE.categories = cats;
        STATE.transactions = txs;
        STATE.accounts = bal.accountsList;

        renderBalances(bal.balances);
        fillCategorySelects();
        
        // Даты фильтра (Текущий месяц)
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        document.getElementById('filter-date-start').value = formatDateISO(startOfMonth);
        document.getElementById('filter-date-end').value = formatDateISO(now);

        applyFilters(); 
        
        loadTodos();
        loadShopping();
        loadDebts();
        loadStudents();
        loadUtilities();
        initCalendar();

        document.getElementById('loading').classList.add('hidden');
    } catch (e) {
        console.error(e);
        document.getElementById('loading').textContent = 'Ошибка загрузки данных';
    }
}

// --- ANALYTICS ---
function applyFilters() {
    const start = new Date(document.getElementById('filter-date-start').value);
    const end = new Date(document.getElementById('filter-date-end').value);
    end.setHours(23, 59, 59);
    const cat = document.getElementById('filter-category').value;
    
    const filtered = STATE.transactions.filter(t => {
        const d = new Date(t.date);
        return d >= start && d <= end && (cat === 'ALL' || t.category === cat);
    });
    
    renderAnalytics(filtered);
    renderTable(filtered);
    renderDepositStats(filtered);
}

function renderAnalytics(data) {
    let inc = 0, exp = 0;
    const catMap = {}, incMap = {}, monthMap = {};
    const dayOfMonthMap = new Array(32).fill(0);

    data.forEach(t => {
        if (t.type === 'transfer') return;
        const amount = t.amount;
        const d = new Date(t.date);
        const mKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        
        if (!monthMap[mKey]) monthMap[mKey] = { inc: 0, exp: 0 };

        if (t.type === 'income') {
            if(t.category !== 'Депозит') {
                inc += amount;
                monthMap[mKey].inc += amount;
                incMap[t.category] = (incMap[t.category] || 0) + amount;
            }
        }
        if (t.type === 'expense') {
            exp += amount;
            monthMap[mKey].exp += amount;
            catMap[t.category] = (catMap[t.category] || 0) + amount;
            dayOfMonthMap[d.getDate()]++;
        }
    });

    // Stats Cards
    document.getElementById('stat-income').textContent = formatCurrency(inc);
    document.getElementById('stat-expense').textContent = formatCurrency(exp);
    const bal = inc - exp;
    const balEl = document.getElementById('stat-balance');
    balEl.textContent = formatCurrency(bal);
    balEl.className = `text-2xl font-extrabold ${bal >= 0 ? 'text-gray-900' : 'text-red-500'}`;

    // Charts
    renderDoughnut('chartCategories', catMap, 'cat');
    renderDoughnut('chartIncome', incMap, 'inc');
    
    // Monthly Bar
    const sortedMonths = Object.keys(monthMap).sort();
    renderBarChart('chartMonthly', sortedMonths, 
        sortedMonths.map(m => monthMap[m].inc), 
        sortedMonths.map(m => monthMap[m].exp)
    );
}

function renderDoughnut(id, dataMap, key) {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    if (STATE.charts[key]) STATE.charts[key].destroy();
    
    const sorted = Object.entries(dataMap).sort((a,b) => b[1]-a[1]);
    STATE.charts[key] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: sorted.map(i => i[0]),
            datasets: [{ 
                data: sorted.map(i => i[1]), 
                backgroundColor: ['#3b82f6','#ef4444','#10b981','#f59e0b','#8b5cf6'],
                borderWidth: 0
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 10 } } } }
    });
}

function renderBarChart(id, labels, data1, data2) {
    const ctx = document.getElementById(id);
    if(!ctx) return;
    if(STATE.charts.month) STATE.charts.month.destroy();
    STATE.charts.month = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Доход', data: data1, backgroundColor: '#10b981', borderRadius: 4 },
                { label: 'Расход', data: data2, backgroundColor: '#ef4444', borderRadius: 4 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false } } } }
    });
}

function renderDepositStats(data) {
    const depositNames = STATE.accounts.filter(a => a.is_deposit).map(a => a.name);
    let saved = 0, withdrawn = 0;

    data.forEach(t => {
        if (t.type === 'transfer' && depositNames.includes(t.target_account)) saved += t.amount;
        if (t.type === 'income' && depositNames.includes(t.target_account) && t.category !== 'Проценты') saved += t.amount;
        if (t.type === 'transfer' && depositNames.includes(t.source_account)) withdrawn += t.amount;
    });

    document.getElementById('stat-savings-in').textContent = `+${formatCurrency(saved)}`;
    document.getElementById('stat-savings-out').textContent = `-${formatCurrency(withdrawn)}`;
    const net = saved - withdrawn;
    const netEl = document.getElementById('stat-savings-net');
    netEl.textContent = (net > 0 ? '+' : '') + formatCurrency(net);
    netEl.className = `font-bold ${net > 0 ? 'text-green-600' : 'text-gray-800'}`;
    
    const max = Math.max(saved, withdrawn, 1);
    document.getElementById('bar-savings-in').style.width = `${(saved/max)*100}%`;
    document.getElementById('bar-savings-out').style.width = `${(withdrawn/max)*100}%`;
}

// --- UTILITIES ---
async function loadUtilities() {
    const list = await API.utilities.getAll();
    renderUtilityTable(list);
    // Предзаполнение
    const defaults = {};
    list.forEach(i => { if (!defaults[i.service]) defaults[i.service] = i.amount; });
    document.querySelectorAll('.util-amount-input').forEach(inp => {
        if(!inp.value && defaults[inp.dataset.service]) inp.value = defaults[inp.dataset.service];
    });
    calculateUtilityTotal();
    
    // Установка текущего месяца
    const now = new Date();
    document.getElementById('util-month').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
}

function renderUtilityTable(list) {
    const tbody = document.getElementById('utility-list');
    tbody.innerHTML = list.map(i => `
        <tr class="border-b hover:bg-gray-50">
            <td class="px-4 py-3 text-xs text-gray-500">${i.date}</td>
            <td class="px-4 py-3 font-medium text-gray-800">${i.service} ${i.reading ? `(${i.reading})` : ''}</td>
            <td class="px-4 py-3 font-bold text-gray-900 text-right">${formatCurrency(i.amount)}</td>
            <td class="px-4 py-3 text-right"><button onclick="deleteUtility(${i.id})" class="text-red-300 hover:text-red-500">×</button></td>
        </tr>
    `).join('');
}

function calculateUtilityTotal() {
    let total = 0;
    document.querySelectorAll('.util-amount-input').forEach(inp => total += parseFloat(inp.value) || 0);
    document.getElementById('total-util-sum').textContent = formatCurrency(total);
}

async function handleUtilitySubmit(e) {
    e.preventDefault();
    const date = document.getElementById('util-month').value;
    const reqs = [];
    document.querySelectorAll('.util-amount-input').forEach(inp => {
        const amount = parseFloat(inp.value);
        if (amount > 0) {
            let reading = 0, comment = '';
            if (inp.dataset.service === 'СК РЭК') reading = parseFloat(document.getElementById('val-light-read').value) || 0;
            reqs.push(API.utilities.action({ action: 'add', date, service: inp.dataset.service, amount, reading, comment }));
        }
    });
    await Promise.all(reqs);
    loadUtilities();
    alert('Сохранено');
}
window.deleteUtility = async (id) => {
    if(confirm('Удалить?')) { await API.utilities.action({ action: 'delete', id }); loadUtilities(); }
};

// --- TODOS ---
window.setTodoFilter = (filter) => {
    CURRENT_TODO_FILTER = filter;
    ['urgent', 'medium', 'later'].forEach(f => {
        const btn = document.getElementById(`tf-${f}`);
        if(f === filter) btn.className = "flex-1 py-1 text-xs font-bold rounded-lg bg-white shadow-sm text-blue-600";
        else btn.className = "flex-1 py-1 text-xs font-bold text-gray-500 hover:bg-white";
    });
    loadTodos();
};

async function loadTodos() {
    const list = await API.todos.getAll();
    const active = list.filter(t => !t.is_done);
    document.getElementById('todo-count').textContent = active.length;
    
    // Сортировка по весам
    const weights = { urgent: 3, medium: 2, later: 1 };
    active.sort((a,b) => weights[b.period||'urgent'] - weights[a.period||'urgent']);
    
    // Фильтрация для списка (если хотим фильтровать визуально, но в сайдбаре лучше показывать всё, просто сортируя)
    // В старой версии мы фильтровали кликом. 
    // ТУТ: Показываем только выбранную категорию или всё? 
    // Давай показывать всё, но подсвечивать или группировать. Или фильтровать. 
    // В старом коде setTodoFilter перерисовывал loadTodos.
    // Давайте фильтровать:
    const filtered = active.filter(t => (t.period || 'urgent') === CURRENT_TODO_FILTER);

    document.getElementById('todo-list').innerHTML = filtered.map(t => `
        <div class="flex items-start gap-2 p-2 bg-gray-50 rounded-lg group hover:bg-white hover:shadow-sm border border-transparent hover:border-gray-200 transition">
            <input type="checkbox" class="js-check-todo mt-1" data-id="${t.id}">
            <div class="flex-1 text-sm text-gray-700 leading-snug">${t.text}</div>
            <button class="js-del-todo text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 px-1" data-id="${t.id}">×</button>
        </div>
    `).join('') || '<div class="text-center text-xs text-gray-400 py-4">Пусто</div>';
}

async function handleTodoSubmit(e) {
    e.preventDefault();
    const text = document.getElementById('todo-input').value;
    const period = document.getElementById('todo-period-select').value;
    if(!text) return;
    await API.todos.action({ action: 'add', text, period });
    document.getElementById('todo-input').value = '';
    loadTodos();
}
async function handleTodoClick(e) {
    if (e.target.classList.contains('js-check-todo')) {
        await API.todos.action({ action: 'toggle', id: e.target.dataset.id, status: 1 });
        loadTodos();
    }
    if (e.target.classList.contains('js-del-todo')) {
        if(confirm('Удалить?')) { await API.todos.action({ action: 'delete', id: e.target.dataset.id }); loadTodos(); }
    }
}

// --- STUDENTS ---
async function loadStudents() {
    const list = await API.students.getAll();
    const grid = document.getElementById('students-grid');
    grid.innerHTML = list.map(s => `
        <div class="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition cursor-pointer" onclick="openStudentEdit(${s.id})">
            <div class="flex justify-between items-start mb-2">
                <h3 class="font-bold text-lg text-gray-900">${s.name}</h3>
                <span class="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded font-bold">${s.subject}</span>
            </div>
            <div class="text-sm text-gray-500 space-y-1">
                <p>📍 ${s.address || '—'}</p>
                <p>📱 ${s.phone || '—'}</p>
            </div>
            <button onclick="event.stopPropagation(); openStudentStats(${s.id})" class="w-full mt-3 py-2 bg-gray-50 hover:bg-gray-100 text-gray-600 text-sm font-bold rounded-xl">📊 Статистика</button>
        </div>
    `).join('');
    loadDebts();
}

window.openStudentEdit = async (id) => {
    // Упрощенно: можно загрузить данные через API или найти в списке
    // Для скорости пока просто откроем пустую форму, в идеале надо fetch details
    document.getElementById('modal-student').classList.remove('hidden');
    document.getElementById('modal-student').classList.add('flex');
    const form = document.getElementById('form-student');
    form.reset();
    form.id.value = ''; // Если id передан, надо заполнить (тут нужна доработка getById)
    // Но так как у нас есть list в памяти, можно найти там, если сделать STATE.students
};

window.openStudentStats = async (id) => {
    const modal = document.getElementById('modal-student-stats');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    const res = await API.students.getStats(id);
    const data = await res.json(); // { student, transactions }
    
    document.getElementById('stats-total').textContent = formatCurrency(data.transactions.reduce((a,b)=>a+b.amount,0));
    document.getElementById('stats-count').textContent = data.transactions.length;
    // График и история... (упрощенно)
};

async function handleStudentSubmit(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    const action = data.id ? 'edit' : 'add';
    await API.students.action({ action, ...data });
    closeAllModals();
    loadStudents();
}

// --- HELPER FUNCTIONS ---
function closeAllModals() {
    document.querySelectorAll('[id^="modal-"]').forEach(m => {
        m.classList.add('hidden');
        m.classList.remove('flex');
    });
}

function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.getElementById(`tab-${tab}`).classList.remove('hidden');
    document.querySelectorAll('.js-tab-btn').forEach(b => {
        b.classList.remove('active-tab');
        if(b.dataset.tab === tab) b.classList.add('active-tab');
    });
    if(tab==='utilities') loadUtilities();
    if(tab==='calendar') initCalendar();
}

function renderBalances(balances) {
    document.getElementById('deposit-list').innerHTML = Object.entries(balances).map(([k,v]) => `
        <div class="flex justify-between p-2 bg-gray-50 rounded-xl">
            <span class="text-sm font-medium text-gray-700">${k}</span>
            <span class="text-sm font-bold text-gray-900">${formatCurrency(v)}</span>
        </div>
    `).join('');
}

function fillCategorySelects() {
    const opts = STATE.categories.map(c => `<option value="${c}">${c}</option>`).join('');
    document.getElementById('filter-category').innerHTML = '<option value="ALL">Все категории</option>' + opts;
    document.querySelector('select[name="category"]').innerHTML = opts;
}

function renderTable(data) {
    document.getElementById('table-body').innerHTML = data.slice(0, 100).map(t => `
        <tr class="border-b hover:bg-gray-50">
            <td class="p-3 text-sm whitespace-nowrap">${new Date(t.date).toLocaleDateString()}</td>
            <td class="p-3 text-sm font-bold text-gray-800">${t.category}</td>
            <td class="p-3 text-xs text-gray-500 max-w-[150px] truncate">${t.comment || ''}</td>
            <td class="p-3 text-sm font-bold text-right ${t.type==='income'?'text-green-600':(t.type==='expense'?'text-red-600':'text-gray-600')}">
                ${formatCurrency(t.amount)}
            </td>
            <td class="p-3 text-right"><button class="js-edit-tx text-blue-600 font-bold px-2" data-id="${t.id}">✎</button></td>
        </tr>
    `).join('');
}

async function handleTxSubmit(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    await API.finance[data.id ? 'editTransaction' : 'addTransaction'](data);
    closeAllModals();
    await initData();
}

function openTxModal(tx = null) {
    const modal = document.getElementById('modal-tx');
    const form = document.getElementById('form-tx');
    form.reset();
    if(tx) {
        form.id.value = tx.id;
        form.date.value = tx.date.split('T')[0];
        form.type.value = tx.type;
        form.amount.value = tx.amount;
        form.category.value = tx.category;
        form.tag.value = tx.tag || '';
        form.comment.value = tx.comment || '';
    } else {
        form.id.value = '';
        form.date.value = formatDateISO(new Date());
    }
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function resetFilters() {
    document.getElementById('filter-category').value = 'ALL';
    applyFilters();
}

async function loadDebts() {
    const debts = await API.students.getDebts();
    const list = document.getElementById('debts-list');
    const panel = document.getElementById('debts-panel');
    if(!debts.length) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    list.innerHTML = debts.map(d => `
        <div class="bg-white p-2 rounded-lg border border-red-100 flex justify-between items-center">
            <span class="text-sm font-bold text-gray-800">${d.student_name}</span>
            <span class="text-sm font-bold text-red-600">${formatCurrency(d.amount)}</span>
        </div>
    `).join('');
}

async function initCalendar() {
    const res = await API.system.getConfig();
    if(res.calendarId) {
        document.getElementById('calendar-frame').src = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(res.calendarId)}&ctz=Asia%2FAlmaty`;
    }
}

// Shopping
async function loadShopping() {
    const list = await API.shopping.getAll();
    const render = (type, elId) => {
        const items = list.filter(i => i.type === type && !i.is_bought);
        document.getElementById(elId).innerHTML = items.length ? items.map(i => `
            <div class="flex justify-between items-center p-2 bg-white border border-gray-100 rounded-xl" data-id="${i.id}">
                <div class="flex items-center gap-2">
                    <input type="checkbox" class="w-4 h-4 text-blue-600 rounded">
                    <span class="text-sm font-medium">${i.title}</span>
                </div>
                <button class="text-gray-300 hover:text-red-500 js-del-shop px-2">×</button>
            </div>
        `).join('') : '<div class="text-center text-xs text-gray-400 py-2">Пусто</div>';
    };
    render('buy', 'list-buy'); render('market', 'list-market'); render('wish', 'list-wish');
    ['count-buy', 'count-market', 'count-wish'].forEach((id, idx) => {
        const types = ['buy', 'market', 'wish'];
        document.getElementById(id).textContent = list.filter(i => i.type === types[idx] && !i.is_bought).length;
    });
}
async function handleShoppingSubmit(e) {
    e.preventDefault();
    await API.shopping.action({ action: 'add', ...Object.fromEntries(new FormData(e.target).entries()) });
    e.target.reset();
    loadShopping();
}
async function handleShoppingClick(e) {
    const div = e.target.closest('[data-id]');
    if(!div) return;
    const id = div.dataset.id;
    if(e.target.type === 'checkbox') {
        await API.shopping.action({ action: 'status', id, status: 'bought' });
        loadShopping();
    }
    if(e.target.classList.contains('js-del-shop')) {
        if(confirm('Удалить?')) { await API.shopping.action({ action: 'status', id, status: 'deleted' }); loadShopping(); }
    }
}

// Trash
async function openTrash() {
    const list = await API.trash.getAll();
    const el = document.getElementById('trash-list');
    el.innerHTML = list.map(i => `
        <div class="flex justify-between p-3 bg-gray-50 rounded-xl">
            <span class="text-sm line-through text-gray-500">${i.title}</span>
            <button class="text-green-600 text-xs font-bold js-restore" data-type="${i.type}" data-id="${i.id}">Вернуть</button>
        </div>
    `).join('');
    document.getElementById('modal-trash').classList.remove('hidden');
    document.getElementById('modal-trash').classList.add('flex');
}
async function handleTrashClick(e) {
    if(e.target.classList.contains('js-restore')) {
        await API.trash.restore(e.target.dataset.type, e.target.dataset.id);
        openTrash();
        loadTodos();
        loadShopping();
    }
}

// Snow
function initSnowToggle() {
    const btn = document.getElementById('snow-toggle-btn');
    let on = localStorage.getItem('isSnowing') !== 'false';
    const toggle = () => {
        on = !on;
        localStorage.setItem('isSnowing', on);
        document.getElementById('snow-container').style.display = on ? 'block' : 'none';
        btn.textContent = on ? '❄️ Вкл' : '❄️ Выкл';
    };
    btn.addEventListener('click', toggle);
    // Init state
    document.getElementById('snow-container').style.display = on ? 'block' : 'none';
    btn.textContent = on ? '❄️ Вкл' : '❄️ Выкл';
    
    // Animation Logic
    const style = document.createElement('style');
    style.innerHTML = `@keyframes fall { to { transform: translateY(110vh) rotate(360deg); } }`;
    document.head.appendChild(style);
    setInterval(() => {
        if(!on) return;
        const s = document.createElement('div');
        s.innerHTML = '❄';
        s.style.cssText = `position:absolute;top:-20px;left:${Math.random()*100}%;font-size:${Math.random()*10+10}px;opacity:${Math.random()*0.5+0.3};color:#dbeafe;animation:fall ${Math.random()*3+2}s linear forwards;pointer-events:none;`;
        document.getElementById('snow-container').appendChild(s);
        setTimeout(() => s.remove(), 5000);
    }, 200);
}

function applyModules(modules, role) {
    const isAll = role === 'admin' || modules.includes('all');
    ['students', 'shopping', 'utilities', 'calendar', 'admin'].forEach(mod => {
        const btn = document.getElementById(`nav-btn-${mod}`);
        if(isAll || modules.includes(mod)) btn?.classList.remove('hidden');
    });
}
