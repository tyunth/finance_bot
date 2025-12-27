import { API } from './api.js';
import { formatCurrency, formatDateISO } from './utils.js';

let STATE = { categories: [], transactions: [], accounts: [], charts: {} };
let CHART_DATA = { dayOfWeekMap: [], dayOfMonthMap: [] };
let CURRENT_TODO_FILTER = 'urgent';

document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 App Started');
    setupEventListeners();
    initSnowToggle(); // Запускаем снег
    await initData();
});

function setupEventListeners() {
    // Навигация
    document.querySelectorAll('.js-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => switchTab(e.target.dataset.tab));
    });
    document.getElementById('btn-reload')?.addEventListener('click', () => location.reload());

    // Фильтры
    document.getElementById('btn-apply-filter')?.addEventListener('click', applyFilters);
    document.getElementById('btn-reset-filter')?.addEventListener('click', resetFilters);

    // Модалка Транзакции
    document.getElementById('btn-open-add-tx')?.addEventListener('click', () => openTxModal());
    document.getElementById('form-tx')?.addEventListener('submit', handleTxSubmit);
    
    // Дела
    document.getElementById('form-todo')?.addEventListener('submit', handleTodoSubmit);
    document.getElementById('todo-list')?.addEventListener('click', handleTodoClick);
    
    // Фильтры дел (Срочно/Средне/Позже)
    ['urgent', 'medium', 'later'].forEach(p => {
        document.getElementById(`tf-${p}`)?.addEventListener('click', () => setTodoFilter(p));
    });

    // Покупки
    document.getElementById('form-shopping')?.addEventListener('submit', handleShoppingSubmit);
    ['list-buy', 'list-market', 'list-wish'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', handleShoppingClick);
    });

    // Транзакции (Клик по таблице для редактирования)
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
    // Связка: Ввод гор. воды копируется в отопление
    const hotInput = document.getElementById('val-water-hot');
    if (hotInput) hotInput.addEventListener('input', (e) => { 
        const heatInput = document.getElementById('val-heat-hot');
        if(heatInput) heatInput.value = e.target.value; 
    });

    // Ученики
    document.getElementById('form-student')?.addEventListener('submit', handleStudentSubmit);
    document.getElementById('btn-delete-student')?.addEventListener('click', deleteStudent);

    // Корзина
    document.getElementById('btn-open-trash')?.addEventListener('click', openTrash);
    document.getElementById('trash-list')?.addEventListener('click', handleTrashClick);

    // Закрытие модалок
    document.querySelectorAll('.btn-close-modal').forEach(btn => btn.addEventListener('click', closeAllModals));
    window.onclick = (e) => { if(e.target.id.startsWith('modal-')) closeAllModals(); };
}

// --- INIT DATA ---
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
        
        // Даты: Текущий месяц по умолчанию
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        document.getElementById('filter-date-start').value = formatDateISO(startOfMonth);
        document.getElementById('filter-date-end').value = formatDateISO(now);

        applyFilters(); 
        
        // Подгрузка остальных вкладок
        loadTodos();
        loadShopping();
        loadDebts();
        loadStudents();
        loadUtilities();
        loadAdmin(); // Если админ
        initCalendar();

        document.getElementById('loading').classList.add('hidden');
    } catch (e) {
        console.error(e);
        document.getElementById('loading').textContent = 'Ошибка загрузки данных';
    }
}

// --- TABS & UI ---
function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.getElementById(`tab-${tab}`).classList.remove('hidden');
    document.querySelectorAll('.js-tab-btn').forEach(b => {
        b.classList.remove('active-tab');
        b.classList.remove('bg-blue-50');
        b.classList.remove('text-blue-600');
        if(b.dataset.tab === tab) {
            b.classList.add('active-tab');
        }
    });
    
    // Lazy load
    if(tab === 'utilities') loadUtilities();
    if(tab === 'admin') loadAdmin();
}

function applyModules(modules, role) {
    const isAll = role === 'admin' || modules.includes('all');
    ['students', 'shopping', 'utilities', 'calendar', 'admin'].forEach(mod => {
        const btn = document.getElementById(`nav-btn-${mod}`);
        if(isAll || modules.includes(mod)) btn?.classList.remove('hidden');
    });
}

// --- FINANCE ANALYTICS ---
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
    
    data.forEach(t => {
        if (t.type === 'transfer') return;
        const amount = t.amount;
        const d = new Date(t.date);
        const mKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        
        if (!monthMap[mKey]) monthMap[mKey] = { inc: 0, exp: 0 };

        if (t.type === 'income') {
            if(t.category !== 'Депозит') { // Исключаем возвраты депозитов из дохода
                inc += amount;
                monthMap[mKey].inc += amount;
                incMap[t.category] = (incMap[t.category] || 0) + amount;
            }
        }
        if (t.type === 'expense') {
            exp += amount;
            monthMap[mKey].exp += amount;
            catMap[t.category] = (catMap[t.category] || 0) + amount;
        }
    });

    document.getElementById('stat-income').textContent = formatCurrency(inc);
    document.getElementById('stat-expense').textContent = formatCurrency(exp);
    const bal = inc - exp;
    const balEl = document.getElementById('stat-balance');
    balEl.textContent = formatCurrency(bal);
    balEl.className = `text-2xl font-extrabold ${bal >= 0 ? 'text-gray-900' : 'text-red-500'}`;

    renderDoughnut('chartCategories', catMap, 'cat');
    renderDoughnut('chartIncome', incMap, 'inc');
    
    const sortedMonths = Object.keys(monthMap).sort();
    renderBarChart('chartMonthly', sortedMonths, 
        sortedMonths.map(m => monthMap[m].inc), 
        sortedMonths.map(m => monthMap[m].exp)
    );
}

// --- UTILITIES (КОММУНАЛКА) ---
async function loadUtilities() {
    const list = await API.utilities.getAll();
    renderUtilityTable(list);
    renderUtilityChart(list);
    
    // Предзаполнение последними данными
    const defaults = {};
    list.forEach(i => { if (!defaults[i.service]) defaults[i.service] = i.amount; });
    document.querySelectorAll('.util-amount-input').forEach(inp => {
        if(!inp.value && defaults[inp.dataset.service]) inp.value = defaults[inp.dataset.service];
    });
    calculateUtilityTotal();
    
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

function renderUtilityChart(list) {
    const ctx = document.getElementById('chartUtilities');
    if(!ctx) return;
    
    // Группировка по месяцам
    const dataByMonth = {};
    const services = new Set();
    list.forEach(i => {
        if(!dataByMonth[i.date]) dataByMonth[i.date] = {};
        dataByMonth[i.date][i.service] = (dataByMonth[i.date][i.service] || 0) + i.amount;
        services.add(i.service);
    });
    
    const labels = Object.keys(dataByMonth).sort();
    const datasets = Array.from(services).map(srv => ({
        label: srv,
        data: labels.map(m => dataByMonth[m][srv] || 0),
        borderWidth: 1
    }));

    if(STATE.charts.util) STATE.charts.util.destroy();
    STATE.charts.util = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true } } }
    });
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

// --- STUDENTS (УЧЕНИКИ) ---
async function loadStudents() {
    const list = await API.students.getAll();
    document.getElementById('students-grid').innerHTML = list.map(s => `
        <div class="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition cursor-pointer relative" onclick="openStudentEdit(${s.id})">
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
    document.getElementById('modal-student').classList.remove('hidden');
    document.getElementById('modal-student').classList.add('flex');
    const form = document.getElementById('form-student');
    form.reset();
    
    // Находим ученика в списке (он уже загружен в loadStudents, но STATE.students там не обновлялся)
    // Лучше сделаем fetch detail или найдем в DOM. 
    // Упростим: загрузим список снова и найдем.
    const list = await API.students.getAll();
    const s = list.find(x => x.id === id);
    if(s) {
        form.id.value = s.id;
        form.name.value = s.name;
        form.subject.value = s.subject;
        form.phone.value = s.phone;
        form.parents.value = s.parents;
        form.address.value = s.address;
        form.notes.value = s.notes;
        form.school.value = s.school;
        form.grade.value = s.grade;
        form.lessons_per_week.value = s.lessons_per_week;
        document.getElementById('btn-delete-student').classList.remove('hidden');
    } else {
        form.id.value = '';
        document.getElementById('btn-delete-student').classList.add('hidden');
    }
};

window.openStudentStats = async (id) => {
    const modal = document.getElementById('modal-student-stats');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    const res = await API.students.getStats(id); // { student, transactions }
    const data = await res.json();
    
    const txs = data.transactions;
    const total = txs.reduce((a,b)=>a+b.amount,0);
    
    document.getElementById('stats-total').textContent = formatCurrency(total);
    document.getElementById('stats-count').textContent = txs.length;
    
    // График платежей
    const months = {};
    txs.forEach(t => {
        const k = t.date.substr(0,7); // YYYY-MM
        months[k] = (months[k]||0) + t.amount;
    });
    const labels = Object.keys(months).sort();
    
    const ctx = document.getElementById('studentChart');
    if(STATE.charts.student) STATE.charts.student.destroy();
    STATE.charts.student = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{ label: 'Оплаты', data: Object.values(months), backgroundColor: '#3b82f6' }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
    
    // История
    document.getElementById('stats-history').innerHTML = txs.slice(0, 10).map(t => `
        <div class="flex justify-between border-b pb-1 text-xs">
            <span>${t.date.split('T')[0]}</span>
            <span class="font-bold text-green-600">+${formatCurrency(t.amount)}</span>
        </div>
    `).join('');
};

async function handleStudentSubmit(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    const action = data.id ? 'edit' : 'add';
    await API.students.action({ action, ...data });
    closeAllModals();
    loadStudents();
}
async function deleteStudent() {
    const id = document.getElementById('form-student').id.value;
    if(confirm('Удалить?')) {
        await API.students.action({ action: 'delete', id });
        closeAllModals();
        loadStudents();
    }
}

// --- SHOPPING (ПОКУПКИ) ---
async function loadShopping() {
    const list = await API.shopping.getAll();
    const render = (type, elId) => {
        const items = list.filter(i => i.type === type && !i.is_bought);
        document.getElementById(elId).innerHTML = items.length ? items.map(i => `
            <div class="flex items-center justify-between p-2 bg-white border border-gray-100 rounded-xl" data-id="${i.id}">
                <div class="flex items-center gap-2">
                    <input type="checkbox" class="w-4 h-4 text-blue-600 rounded cursor-pointer">
                    <span class="text-sm font-medium">${i.title}</span>
                    ${i.price_estimate ? `<span class="text-xs text-green-600 font-bold">~${i.price_estimate}</span>` : ''}
                </div>
                <button class="js-del-shop text-gray-300 hover:text-red-500 text-xs px-2">✕</button>
            </div>
        `).join('') : '<div class="text-center text-xs text-gray-400 py-2 italic">Пусто</div>';
        
        // Drag & Drop
        new Sortable(document.getElementById(elId), { animation: 150 });
    };
    render('buy', 'list-buy'); 
    render('market', 'list-market'); 
    render('wish', 'list-wish');
    
    // Счетчики
    document.getElementById('count-buy').textContent = list.filter(i => i.type === 'buy' && !i.is_bought).length;
    document.getElementById('count-market').textContent = list.filter(i => i.type === 'market' && !i.is_bought).length;
    document.getElementById('count-wish').textContent = list.filter(i => i.type === 'wish' && !i.is_bought).length;
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
        setTimeout(async () => {
            await API.shopping.action({ action: 'status', id, status: 'bought' });
            loadShopping();
        }, 200);
    }
    if(e.target.classList.contains('js-del-shop')) {
        if(confirm('Удалить?')) { await API.shopping.action({ action: 'status', id, status: 'deleted' }); loadShopping(); }
    }
}

// --- TODOS (ДЕЛА) ---
function setTodoFilter(filter) {
    CURRENT_TODO_FILTER = filter;
    ['urgent', 'medium', 'later'].forEach(f => {
        const btn = document.getElementById(`tf-${f}`);
        if(f === filter) btn.className = "flex-1 py-1 text-xs font-bold rounded-lg bg-white shadow-sm text-blue-600 border border-blue-100";
        else btn.className = "flex-1 py-1 text-xs font-bold text-gray-500 hover:bg-white";
    });
    loadTodos();
}

async function loadTodos() {
    const list = await API.todos.getAll();
    const active = list.filter(t => !t.is_done);
    document.getElementById('todo-count').textContent = active.length;
    
    const weights = { urgent: 3, medium: 2, later: 1 };
    active.sort((a,b) => weights[b.period||'urgent'] - weights[a.period||'urgent']);
    
    const filtered = active.filter(t => (t.period || 'urgent') === CURRENT_TODO_FILTER);

    document.getElementById('todo-list').innerHTML = filtered.map(t => `
        <div class="flex items-start gap-2 p-2 bg-gray-50 rounded-lg group hover:bg-white hover:shadow-sm border border-transparent hover:border-gray-200 transition">
            <input type="checkbox" class="js-check-todo mt-1 w-4 h-4 text-gray-800 rounded cursor-pointer" data-id="${t.id}">
            <div class="flex-1 text-sm text-gray-700 leading-snug">${t.text}</div>
            <button class="js-del-todo text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 px-1 font-bold" data-id="${t.id}">×</button>
        </div>
    `).join('') || '<div class="text-center text-xs text-gray-400 py-4">Нет задач</div>';
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

// --- TRASH & SNOW & ADMIN ---
async function openTrash() {
    const list = await API.trash.getAll();
    document.getElementById('trash-list').innerHTML = list.map(i => `
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

function initSnowToggle() {
    const btn = document.getElementById('snow-toggle-btn');
    if(!btn) return;
    let on = localStorage.getItem('isSnowing') !== 'false';
    
    const update = () => {
        document.getElementById('snow-container').style.display = on ? 'block' : 'none';
        btn.textContent = on ? '❄️ Вкл' : '❄️ Выкл';
        btn.className = `h-[42px] w-[130px] rounded-xl text-xs font-bold border transition ${on ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white border-gray-200 text-gray-400'}`;
    };
    
    update();
    btn.addEventListener('click', () => { on = !on; localStorage.setItem('isSnowing', on); update(); });

    // Animation
    if(!document.getElementById('snow-style')) {
        const style = document.createElement('style');
        style.id = 'snow-style';
        style.innerHTML = `@keyframes fall { to { transform: translateY(110vh) rotate(360deg); } }`;
        document.head.appendChild(style);
    }
    
    setInterval(() => {
        if(!on) return;
        const container = document.getElementById('snow-container');
        if(!container || container.style.display === 'none') return;
        
        const s = document.createElement('div');
        s.innerHTML = '❄';
        s.style.cssText = `position:absolute;top:-20px;left:${Math.random()*100}%;font-size:${Math.random()*10+10}px;opacity:${Math.random()*0.5+0.3};color:#dbeafe;animation:fall ${Math.random()*3+2}s linear forwards;pointer-events:none;`;
        container.appendChild(s);
        setTimeout(() => s.remove(), 5000);
    }, 200);
}

async function loadAdmin() {
    try {
        const users = await API.system.getUsers();
        document.getElementById('admin-users-list').innerHTML = `
            <h2 class="text-xl font-bold mb-4">Пользователи</h2>
            <table class="w-full text-left text-sm text-gray-600">
                <thead><tr class="border-b"><th class="py-2">User</th><th class="py-2">Modules</th></tr></thead>
                <tbody>${users.map(u => `
                    <tr class="border-b">
                        <td class="py-2 font-bold">${u.first_name} <span class="text-gray-400 font-normal">(${u.role})</span></td>
                        <td class="py-2">${u.modules || 'all'}</td>
                    </tr>
                `).join('')}</tbody>
            </table>
        `;
    } catch(e) { console.error(e); }
}

// --- COMMON HELPERS ---
function closeAllModals() {
    document.querySelectorAll('[id^="modal-"]').forEach(m => {
        m.classList.add('hidden');
        m.classList.remove('flex');
    });
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

async function handleTxSubmit(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    await API.finance[data.id ? 'editTransaction' : 'addTransaction'](data);
    closeAllModals();
    await initData();
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
                backgroundColor: ['#3b82f6','#ef4444','#10b981','#f59e0b','#8b5cf6', '#94a3b8'],
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
        // Добавляем прямые пополнения (не трансферы), но исключаем проценты
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
    document.getElementById('bar-savings-in').style.width = `${max > 0 ? (saved/max)*100 : 0}%`;
    document.getElementById('bar-savings-out').style.width = `${max > 0 ? (withdrawn/max)*100 : 0}%`;
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

function resetFilters() {
    document.getElementById('filter-category').value = 'ALL';
    applyFilters();
}
