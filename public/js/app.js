import { API } from './api.js';
import { formatCurrency, formatDateISO } from './utils.js';

// Состояние
let STATE = {
    categories: [],
    transactions: [],
    accounts: [],
    charts: {} // Chart.js instances
};

// --- ИНИЦИАЛИЗАЦИЯ ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 App Started');
    setupEventListeners();
    await initData();
});

function setupEventListeners() {
    // 1. Табы
    document.querySelectorAll('.js-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => switchTab(e.target.dataset.tab));
    });

    // 2. Кнопка перезагрузки
    document.getElementById('btn-reload')?.addEventListener('click', () => location.reload());

    // 3. Фильтры
    document.getElementById('btn-apply-filter')?.addEventListener('click', applyFilters);
    document.getElementById('btn-reset-filter')?.addEventListener('click', resetFilters);

    // 4. Модалка Транзакции
    document.getElementById('btn-open-add-tx')?.addEventListener('click', () => openTxModal());
    document.getElementById('form-tx')?.addEventListener('submit', handleTxSubmit);
    
    // 5. Дела (Todo)
    document.getElementById('form-todo')?.addEventListener('submit', handleTodoSubmit);
    
    // 6. Покупки
    document.getElementById('form-shopping')?.addEventListener('submit', handleShoppingSubmit);

    // 7. Делегирование (Клики по динамическим спискам)
    // Мы вешаем один слушатель на контейнер списка
    
    // Список дел (чекбокс и удаление)
    document.getElementById('todo-list')?.addEventListener('click', async (e) => {
        const btnDel = e.target.closest('.js-del-todo');
        const check = e.target.closest('.js-check-todo');
        
        if (btnDel) {
            const id = btnDel.dataset.id;
            if(confirm('Удалить?')) { await API.todos.action({ action: 'delete', id }); loadTodos(); }
        }
        if (check) {
            const id = check.dataset.id;
            const status = check.checked ? 1 : 0;
            await API.todos.action({ action: 'toggle', id, status });
            loadTodos(); // Перерисовка для сортировки
        }
    });

    // Список покупок (удаление и покупка)
    ['list-buy', 'list-market', 'list-wish'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', async (e) => {
            const id = e.target.closest('[data-id]')?.dataset.id;
            if (!id) return;
            
            // Если клик по чекбоксу
            if (e.target.type === 'checkbox') {
                await API.shopping.action({ action: 'status', id, status: 'bought' });
                loadShopping();
            }
            // Если клик по кнопке удаления (класс .js-del-shop)
            if (e.target.classList.contains('js-del-shop')) {
                if(confirm('Удалить?')) {
                    await API.shopping.action({ action: 'status', id, status: 'deleted' });
                    loadShopping();
                }
            }
        });
    });

    // Транзакции (Редактирование)
    document.getElementById('table-body')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.js-edit-tx');
        if (btn) {
            // Находим данные транзакции из массива STATE.transactions
            const txId = parseInt(btn.dataset.id);
            const tx = STATE.transactions.find(t => t.id === txId);
            if (tx) openTxModal(tx);
        }
    });

    // Закрытие модалок
    document.querySelectorAll('.btn-close-modal').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[id^="modal-"]').forEach(m => m.classList.add('hidden'));
        });
    });
    
    // Корзина
    document.getElementById('btn-open-trash')?.addEventListener('click', openTrash);
    document.getElementById('trash-list')?.addEventListener('click', async (e) => {
        const btn = e.target.closest('.js-restore');
        if (btn) {
            await API.trash.restore(btn.dataset.type, btn.dataset.id);
            openTrash(); // Обновить корзину
            loadTodos(); // Обновить списки на фоне
            loadShopping();
        }
    });
}

// --- ЛОГИКА ---

async function initData() {
    try {
        // Загрузка прав доступа и скрытие вкладок
        const me = await API.system.getMe();
        applyModules(me.modules, me.role);

        // Загрузка данных
        const [cats, txs, bal] = await Promise.all([
            API.finance.getCategories(),
            API.finance.getTransactions(),
            API.finance.getBalances()
        ]);
        
        STATE.categories = cats;
        STATE.transactions = txs;
        STATE.accounts = bal.accountsList;

        // Рендер
        renderBalances(bal.balances);
        fillCategorySelects();
        
        // Установка дат фильтра
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        document.getElementById('filter-date-start').value = formatDateISO(startOfMonth);
        document.getElementById('filter-date-end').value = formatDateISO(now);

        applyFilters(); // Отрисовка графиков и таблицы
        
        // Подгрузка остальных модулей
        loadTodos();
        loadShopping();
        loadDebts();

        document.getElementById('loading').classList.add('hidden');
    } catch (e) {
        console.error(e);
        document.getElementById('loading').textContent = 'Ошибка доступа или сервера';
    }
}

function switchTab(tabName) {
    // Скрываем все контенты
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    // Убираем активность кнопок
    document.querySelectorAll('.js-tab-btn').forEach(btn => btn.classList.remove('active-tab')); // класс Tailwind
    
    // Показываем нужное
    document.getElementById(`tab-${tabName}`)?.classList.remove('hidden');
    // Красим кнопку
    document.querySelector(`button[data-tab="${tabName}"]`)?.classList.add('active-tab');
}

function applyModules(modules, role) {
    const isAll = role === 'admin' || modules.includes('all');
    const map = { 'students': 'nav-btn-students', 'shopping': 'nav-btn-shopping', 'utilities': 'nav-btn-utilities', 'admin': 'nav-btn-admin' };
    
    for (const [mod, id] of Object.entries(map)) {
        if (isAll || modules.includes(mod)) document.getElementById(id)?.classList.remove('hidden');
    }
}

// --- ФИНАНСЫ ---

function applyFilters() {
    const start = new Date(document.getElementById('filter-date-start').value);
    const end = new Date(document.getElementById('filter-date-end').value);
    const cat = document.getElementById('filter-category').value;
    
    // Фильтр
    const filtered = STATE.transactions.filter(t => {
        const d = new Date(t.date);
        return d >= start && d <= end && (cat === 'ALL' || t.category === cat);
    });
    
    renderAnalytics(filtered);
    renderTable(filtered);
}

function renderAnalytics(data) {
    // Простой подсчет
    let inc = 0, exp = 0;
    const catMap = {};
    
    data.forEach(t => {
        if (t.type === 'income') inc += t.amount;
        if (t.type === 'expense') {
            exp += t.amount;
            catMap[t.category] = (catMap[t.category] || 0) + t.amount;
        }
    });
    
    document.getElementById('stat-income').textContent = formatCurrency(inc);
    document.getElementById('stat-expense').textContent = formatCurrency(exp);
    document.getElementById('stat-balance').textContent = formatCurrency(inc - exp);
    
    // Chart.js (если есть canvas)
    const ctx = document.getElementById('chartCategories');
    if (ctx) {
        if (STATE.charts.cat) STATE.charts.cat.destroy();
        STATE.charts.cat = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: Object.keys(catMap),
                datasets: [{ data: Object.values(catMap), borderWidth: 0 }]
            }
        });
    }
}

function renderTable(data) {
    const tbody = document.getElementById('table-body');
    if (!tbody) return;
    tbody.innerHTML = data.slice(0, 50).map(t => `
        <tr class="border-b hover:bg-gray-50">
            <td class="p-3 text-sm">${new Date(t.date).toLocaleDateString()}</td>
            <td class="p-3 text-sm font-bold">${t.category}</td>
            <td class="p-3 text-xs text-gray-500 max-w-[150px] truncate">${t.comment || ''}</td>
            <td class="p-3 text-sm font-bold ${t.type === 'income' ? 'text-green-600' : 'text-red-600'} text-right">
                ${formatCurrency(t.amount)}
            </td>
            <td class="p-3 text-right">
                <button class="js-edit-tx text-blue-600 font-bold" data-id="${t.id}">✎</button>
            </td>
        </tr>
    `).join('');
}

function openTxModal(tx = null) {
    const modal = document.getElementById('modal-tx');
    const form = document.getElementById('form-tx');
    form.reset();
    
    if (tx) {
        // Заполнение (упрощенно)
        form.id.value = tx.id;
        form.amount.value = tx.amount;
        form.category.value = tx.category;
        form.type.value = tx.type;
        form.date.value = tx.date.split('T')[0];
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
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());
    
    const endpoint = data.id ? 'editTransaction' : 'addTransaction';
    await API.finance[endpoint](data);
    
    document.getElementById('modal-tx').classList.add('hidden');
    await initData(); // Полная перезагрузка данных
}

function resetFilters() {
    document.getElementById('filter-category').value = 'ALL';
    applyFilters();
}

function renderBalances(balances) {
    const el = document.getElementById('deposit-list');
    if(!el) return;
    el.innerHTML = Object.entries(balances).map(([name, val]) => `
        <div class="flex justify-between p-2 bg-gray-50 rounded-lg">
            <span class="text-sm font-medium">${name}</span>
            <span class="text-sm font-bold">${formatCurrency(val)}</span>
        </div>
    `).join('');
}

function fillCategorySelects() {
    const opts = STATE.categories.map(c => `<option value="${c}">${c}</option>`).join('');
    document.getElementById('filter-category').innerHTML = '<option value="ALL">Все</option>' + opts;
    document.querySelector('select[name="category"]').innerHTML = opts;
}

// --- TODOS ---
async function loadTodos() {
    const list = await API.todos.getAll();
    const active = list.filter(t => !t.is_done);
    document.getElementById('todo-count').textContent = active.length;
    
    // Сортировка: срочные выше
    active.sort((a,b) => (a.period === 'urgent' ? -1 : 1));

    document.getElementById('todo-list').innerHTML = active.map(t => `
        <div class="flex items-start gap-2 p-2 bg-gray-50 rounded-lg group">
            <input type="checkbox" class="js-check-todo mt-1" data-id="${t.id}">
            <div class="flex-1 text-sm ${t.period === 'urgent' ? 'font-bold text-gray-900' : 'text-gray-700'}">
                ${t.text}
            </div>
            <button class="js-del-todo text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100" data-id="${t.id}">×</button>
        </div>
    `).join('');
}

async function handleTodoSubmit(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    if(!data.text) return;
    await API.todos.action({ action: 'add', text: data.text, period: data.period });
    e.target.reset();
    loadTodos();
}

// --- SHOPPING ---
async function loadShopping() {
    const list = await API.shopping.getAll();
    const renderList = (items, containerId) => {
        const el = document.getElementById(containerId);
        if(!el) return;
        el.innerHTML = items.length ? items.map(i => `
            <div class="flex items-center justify-between p-2 bg-white border rounded-lg" data-id="${i.id}">
                <div class="flex items-center gap-2">
                    <input type="checkbox">
                    <span class="text-sm font-medium">${i.title}</span>
                </div>
                <button class="js-del-shop text-gray-300 hover:text-red-500 text-xs">✕</button>
            </div>
        `).join('') : '<div class="text-xs text-gray-400 italic text-center">Пусто</div>';
        
        // Sortable init (если нужно)
        new Sortable(el, { animation: 150, onEnd: async (evt) => {
            // Логика сортировки (массив ID)
        }});
    };

    const active = list.filter(i => !i.is_bought);
    renderList(active.filter(i => i.type === 'buy'), 'list-buy');
    renderList(active.filter(i => i.type === 'market'), 'list-market');
    renderList(active.filter(i => i.type === 'wish'), 'list-wish');
}

async function handleShoppingSubmit(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    await API.shopping.action({ action: 'add', ...data });
    e.target.reset();
    loadShopping();
}

// --- DEBTS & TRASH ---
async function loadDebts() {
    const debts = await API.students.getDebts();
    const el = document.getElementById('debts-list');
    const panel = document.getElementById('debts-panel');
    
    if (debts.length) {
        panel.classList.remove('hidden');
        el.innerHTML = debts.map(d => `
            <div class="bg-white p-2 rounded border border-red-200 text-sm">
                <b>${d.student_name}</b>: ${formatCurrency(d.amount)}
            </div>
        `).join('');
    } else {
        panel.classList.add('hidden');
    }
}

async function openTrash() {
    const list = await API.trash.getAll();
    const el = document.getElementById('trash-list');
    el.innerHTML = list.map(i => `
        <div class="flex justify-between p-2 border-b">
            <span class="text-sm line-through text-gray-500">${i.title}</span>
            <button class="js-restore text-xs font-bold text-green-600" data-type="${i.type}" data-id="${i.id}">Вернуть</button>
        </div>
    `).join('');
    document.getElementById('modal-trash').classList.remove('hidden');
    document.getElementById('modal-trash').classList.add('flex');
}
