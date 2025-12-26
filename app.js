// --- 🔐 АВТОРИЗАЦИЯ (Вставь это в самый верх файла) ---

// 1. Пытаемся достать ID пользователя
const TG = window.Telegram?.WebApp;
let CURRENT_USER_ID = null;

if (TG && TG.initDataUnsafe && TG.initDataUnsafe.user) {
    // Если открыли внутри Телеграма
    CURRENT_USER_ID = TG.initDataUnsafe.user.id;
    TG.expand(); // Разворачиваем на весь экран
    // Настраиваем цвета под тему Телеграма (по желанию)
    document.documentElement.style.setProperty('--tg-theme-bg-color', TG.backgroundColor);
} else {
    // Если открыли в браузере (для тестов): ?userId=123
    const urlParams = new URLSearchParams(window.location.search);
    const paramId = urlParams.get('userId');
    if (paramId) CURRENT_USER_ID = parseInt(paramId);
}

console.log('🔑 Current User ID:', CURRENT_USER_ID || 'Guest (Fallback to Admin)');

// 2. ПЕРЕХВАТЧИК FETCH (Магия)
// Мы подменяем стандартный fetch, чтобы он всегда добавлял наш ID
const originalFetch = window.fetch;
window.fetch = async (url, options = {}) => {
    // Создаем объект заголовков, если его нет
    const headers = options.headers || {};
    
    // Если ID определен — добавляем его в заголовок
    if (CURRENT_USER_ID) {
        if (headers instanceof Headers) {
            headers.append('X-User-Id', CURRENT_USER_ID);
        } else {
            headers['X-User-Id'] = CURRENT_USER_ID;
        }
    }

    // Возвращаем оригинальный запрос с обновленными заголовками
    return originalFetch(url, { ...options, headers });
};

const API_BASE_URL = '/budzet'; 
const API_URL_TX = API_BASE_URL + '/transactions';
const API_URL_EDIT = API_BASE_URL + '/transactions/edit';
const API_URL_CATEGORIES = API_BASE_URL + '/categories';
const API_URL_BALANCES = API_BASE_URL + '/balances';
const API_URL_STUDENTS = API_BASE_URL + '/students';
const API_URL_STUDENT_ACTION = API_BASE_URL + '/students/action';
const API_URL_SHOPPING = API_BASE_URL + '/shopping';
const API_URL_SHOPPING_ACTION = API_BASE_URL + '/shopping/action';
const API_URL_UTILITIES = API_BASE_URL + '/utilities';
const API_URL_UTILITIES_ACTION = API_BASE_URL + '/utilities/action';
const API_URL_TRASH = API_BASE_URL + '/trash';

const CURRENCY = 'T';
// const CALENDAR_EMBED_ID = process.env.GOOGLE_CALENDAR_ID; 

let ALL_CATEGORIES = [];
let RAW_DATA = [];
let chartsInstance = {}; 
let CHART_DATA_CACHE = {}; 
let ACCOUNTS_INFO = []; // Глобальная переменная для хранения списка счетов
let CURRENT_TODO_FILTER = 'urgent'; // По умолчанию срочные

function formatCurrency(amount) {
    return new Intl.NumberFormat('ru-RU').format(Math.round(amount)) + ' ' + CURRENCY;
}

function switchTab(tabName) {
    // ВАЖНО: Добавили 'utilities' в список, теперь вкладка будет скрываться корректно
    ['analytics', 'transactions', 'students', 'calendar', 'shopping', 'utilities'].forEach(t => {
        const el = document.getElementById(`tab-${t}`);
        const btn = document.getElementById(`btn-${t}`);
        if (el) el.classList.add('hidden');
        if (btn) btn.classList.remove('active');
    });

    const targetEl = document.getElementById(`tab-${tabName}`);
    const targetBtn = document.getElementById(`btn-${tabName}`);
    
    if (targetEl) targetEl.classList.remove('hidden');
    if (targetBtn) targetBtn.classList.add('active');   
    
    if (tabName === 'calendar') initCalendar();
    if (tabName === 'students') loadStudents();
    if (tabName === 'shopping') loadShoppingList();
    if (tabName === 'utilities') loadUtilities();
    if (tabName === 'admin') loadAdminUsers();
}

// Функция инициализации календаря
async function initCalendar() {
    try {
        // 1. Спрашиваем у сервера конфиг
        const res = await fetch(`${API_BASE_URL}/config`);
        const data = await res.json();
        const calendarId = data.calendarId;

        if (!calendarId) return; // Если не настроен

        // 2. Находим iframe и вставляем ID
        const iframe = document.getElementById('calendar-frame'); // Убедись, что у iframe есть этот id в index.html
        if (iframe) {
            // Вставляем ID в ссылку (URL-encode важен, если там @)
            const encodedId = encodeURIComponent(calendarId);
            iframe.src = `https://calendar.google.com/calendar/embed?src=${encodedId}&ctz=Asia%2FAlmaty`;
        }
    } catch (e) {
        console.error('Ошибка загрузки календаря:', e);
    }
}

async function loadData() {
    try {
        const [catRes, txRes, balRes] = await Promise.all([
            fetch(API_URL_CATEGORIES),
            fetch(API_URL_TX),
            fetch(API_URL_BALANCES)
        ]);

        ALL_CATEGORIES = await catRes.json();
        RAW_DATA = await txRes.json();
        
        // --- ИЗМЕНЕНИЕ ---
        const balData = await balRes.json();
        const balances = balData.balances;
        ACCOUNTS_INFO = balData.accountsList || [];
        // -----------------

        const filterSel = document.getElementById('filter-category');
        if (filterSel && filterSel.options.length <= 1) {
            filterSel.innerHTML = '<option value="ALL">Все категории</option>';
            ALL_CATEGORIES.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c; opt.textContent = c;
                filterSel.appendChild(opt);
            });
        }

        renderBalances(balances);
        return true;
    } catch (e) {
        console.error(e);
        const loadingEl = document.getElementById('loading');
        if (loadingEl) loadingEl.textContent = 'Ошибка загрузки данных';
        return false;
    }
}

async function init() {
    const success = await loadData();
    if (success) {
        const loadingEl = document.getElementById('loading');
        if (loadingEl) loadingEl.style.display = 'none';
        
        const filterPanel = document.getElementById('filter-panel');
        if (filterPanel) filterPanel.classList.remove('hidden');

        // --- НОВЫЙ КОД НАЧАЛО ---
        // Устанавливаем текущий месяц в фильтры
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        
        // Хелпер для форматирования даты в YYYY-MM-DD (с учетом часового пояса, чтобы не убежал день назад)
        const fmt = d => {
            const offset = d.getTimezoneOffset() * 60000;
            return new Date(d.getTime() - offset).toISOString().split('T')[0];
        };

        const startEl = document.getElementById('filter-date-start');
        const endEl = document.getElementById('filter-date-end');

        if (startEl) startEl.value = fmt(startOfMonth);
        if (endEl) endEl.value = fmt(now);
        
        // Применяем фильтр сразу, чтобы графики отрисовались
        applyFilters();
        loadDebts(); 
        loadKPI();  
        loadTodos();
        initSnowToggle();
        initCalendar();
        checkAdminAccess();
        switchTab('analytics'); 
    }
}

function renderBalances(balances) {
    const list = document.getElementById('deposit-list');
    if (!list) return;
    
    if (!balances || Object.keys(balances).length === 0) {
        list.innerHTML = '<div class="text-gray-400 text-sm">Нет счетов</div>';
        return;
    }
    
    // Сортировка: Основной первый, остальные по убыванию суммы
    const entries = Object.entries(balances).sort((a, b) => {
        if (a[0] === 'Основной') return -1;
        if (b[0] === 'Основной') return 1;
        return b[1] - a[1];
    });

    list.innerHTML = entries.map(([name, val]) => {
        const isDeposit = ACCOUNTS_INFO.find(a => a.name === name)?.is_deposit;
        const color = val > 0 ? 'text-gray-900' : (val < 0 ? 'text-red-500' : 'text-gray-400');
        const typeLabel = isDeposit ? 'Вклад' : 'Счет';
        
        return `
            <div class="flex items-center justify-between p-3 bg-gray-50/50 hover:bg-gray-50 rounded-xl transition border border-transparent hover:border-gray-200">
                <div class="flex flex-col min-w-0">
                    <span class="text-sm font-bold text-gray-700 truncate" title="${name}">${name}</span>
                    <span class="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">${typeLabel}</span>
                </div>
                <span class="${color} font-mono font-bold whitespace-nowrap text-lg">${formatCurrency(val)}</span>
            </div>
        `;
    }).join('');
}

function applyFilters() {
    const startEl = document.getElementById('filter-date-start');
    const endEl = document.getElementById('filter-date-end');
    const catEl = document.getElementById('filter-category');
    const typeEl = document.getElementById('filter-type');

    if (!startEl) return; 

    const startStr = startEl.value;
    const endStr = endEl.value;
    const catVal = catEl.value;
    const typeVal = typeEl.value;

    const startDate = startStr ? new Date(startStr) : null;
    const endDate = endStr ? new Date(endStr) : null;
    if (endDate) endDate.setHours(23, 59, 59);

    FILTERED_DATA = RAW_DATA.filter(t => {
        const tDate = new Date(t.date);
        if (startDate && tDate < startDate) return false;
        if (endDate && tDate > endDate) return false;
        if (catVal !== 'ALL' && t.category !== catVal) return false;
        if (typeVal !== 'ALL' && t.type !== typeVal) return false;
        return true;
    });

    renderAnalytics(FILTERED_DATA);
    renderTable(FILTERED_DATA);
}

function resetFilters() {
    document.getElementById('filter-date-start').value = '';
    document.getElementById('filter-date-end').value = '';
    document.getElementById('filter-category').value = 'ALL';
    document.getElementById('filter-type').value = 'ALL';
    applyFilters();
}

function renderAnalytics(data) {
    let totalIncome = 0;
    let totalExpense = 0;
    
    const expenseMap = {}; 
    const incomeMap = {};  
    
    const monthMap = {}; 
    const dayOfWeekMap = [0,0,0,0,0,0,0]; 
    const dayOfMonthMap = new Array(32).fill(0); 

    const catFrequency = {};
    const commentFrequency = {};

    // Читаем настройки из ДВУХ разных селектов
    const groupExpenseEl = document.getElementById('chart-group-by');
    const groupByExpense = groupExpenseEl ? groupExpenseEl.value : 'category';

    const groupIncomeEl = document.getElementById('chart-income-group-by');
    const groupByIncome = groupIncomeEl ? groupIncomeEl.value : 'category';

    data.forEach(t => {
        if (t.type === 'transfer') return;

        const amount = parseFloat(t.amount);
        const dateObj = new Date(t.date);
        const monthKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
        
        if (!monthMap[monthKey]) monthMap[monthKey] = { income: 0, expense: 0 };

        if (t.type === 'income') {
            if (t.category !== 'Депозит') {
                totalIncome += amount;
                monthMap[monthKey].income += amount;
                
                // Логика для ДОХОДОВ
                let key = 'Прочее';
                if (groupByIncome === 'tag') key = t.tag || 'Без ученика';
                else key = t.category || 'Без категории';
                
                incomeMap[key] = (incomeMap[key] || 0) + amount;
            }
        } else if (t.type === 'expense') {
            totalExpense += amount;
            monthMap[monthKey].expense += amount;
            
            // Логика для РАСХОДОВ
            let key = 'Прочее';
            if (groupByExpense === 'tag') key = t.tag || 'Без тега';
            else key = t.category || 'Без категории';
            
            expenseMap[key] = (expenseMap[key] || 0) + amount;

            const cat = t.category || 'Без категории';
            catFrequency[cat] = (catFrequency[cat] || 0) + 1;
            
            if (t.comment && t.comment.trim()) {
                const c = t.comment.trim();
                commentFrequency[c] = (commentFrequency[c] || 0) + 1;
            }

            dayOfWeekMap[dateObj.getDay()]++;
            dayOfMonthMap[dateObj.getDate()]++;
        }
    });

    CHART_DATA_CACHE = { dayOfWeekMap, dayOfMonthMap };

    if (document.getElementById('stat-income')) document.getElementById('stat-income').textContent = formatCurrency(totalIncome);
    if (document.getElementById('stat-expense')) document.getElementById('stat-expense').textContent = formatCurrency(totalExpense);
    
    const balance = totalIncome - totalExpense;
    const balEl = document.getElementById('stat-balance');
    if (balEl) {
        balEl.textContent = formatCurrency(balance);
        balEl.className = `text-xl font-bold mt-1 ${balance >= 0 ? 'text-blue-600' : 'text-red-600'}`;
    }

    renderDoughnutChart('chartCategories', expenseMap, chartsInstance, 'cat', totalExpense);
    renderDoughnutChart('chartIncome', incomeMap, chartsInstance, 'income', totalIncome);
    
    renderDayChart();
    renderDepositStats(data);
    
    // --- ДИНАМИКА ---
    const sortedMonths = Object.keys(monthMap).sort();
    const ctxMonthEl = document.getElementById('chartMonthly');
    if (ctxMonthEl) {
        const ctxMonth = ctxMonthEl.getContext('2d');
        if (chartsInstance.month) chartsInstance.month.destroy();
        chartsInstance.month = new Chart(ctxMonth, {
            type: 'bar',
            data: {
                labels: sortedMonths,
                datasets: [
                    { label: 'Доход', data: sortedMonths.map(m => monthMap[m].income), backgroundColor: '#10b981', borderRadius: 4 },
                    { label: 'Расход', data: sortedMonths.map(m => monthMap[m].expense), backgroundColor: '#ef4444', borderRadius: 4 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                onClick: (e, elements) => { if (elements.length > 0) drillDownByMonth(sortedMonths[elements[0].index]); }
            }
        });
    }

    // --- СПИСКИ ТОП (без изменений) ---
    const topExp = data.filter(t => t.type === 'expense').sort((a, b) => b.amount - a.amount).slice(0, 10);
    const topExpEl = document.getElementById('top-expenses-list');
    if (topExpEl) {
        topExpEl.innerHTML = topExp.map((t, i) => `
            <tr class="hover:bg-gray-50 transition border-b border-gray-100 last:border-0">
                <td class="px-4 py-2 text-xs text-gray-400 font-bold w-4">${i+1}.</td>
                <td class="px-2 py-2 font-medium text-gray-800">
                    ${t.category}
                    <div class="text-xs text-gray-500 font-normal sm:hidden">${t.comment || ''}</div>
                </td>
                <td class="px-2 py-2 text-xs text-gray-500 hidden sm:table-cell truncate max-w-[100px]">${t.comment || ''}</td>
                <td class="px-2 py-2 font-bold text-gray-900 text-right">${formatCurrency(t.amount)}</td>
            </tr>
        `).join('');
    }

    const sortedFreqCat = Object.entries(catFrequency).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topFreqEl = document.getElementById('top-freq-cat-list');
    if (topFreqEl) {
        topFreqEl.innerHTML = sortedFreqCat.map(([cat, count]) => `
            <tr class="hover:bg-gray-50 transition border-b border-gray-100 last:border-0">
                <td class="py-2 font-medium text-gray-800">${cat}</td>
                <td class="py-2 text-right font-semibold text-blue-600">${count}</td>
            </tr>
        `).join('');
    }

    const sortedFreqComment = Object.entries(commentFrequency).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topCommEl = document.getElementById('top-freq-comment-list');
    if (topCommEl) {
        topCommEl.innerHTML = sortedFreqComment.length === 0 
            ? '<tr><td class="text-xs text-gray-400 py-2">Нет комментариев</td></tr>'
            : sortedFreqComment.map(([comm, count]) => `
                <tr class="hover:bg-gray-50 transition border-b border-gray-100 last:border-0">
                    <td class="py-2 text-sm text-gray-700">"${comm}"</td>
                    <td class="py-2 text-right font-semibold text-gray-500 text-xs">${count}</td>
                </tr>
            `).join('');
    }
}

// Универсальная функция для рисования бубликов
function renderDoughnutChart(canvasId, dataMap, chartsRef, chartKey, totalSum) {
    const el = document.getElementById(canvasId);
    if (!el) return;

    const groupedLabels = [];
    const groupedValues = [];
    let otherSum = 0;
    
    Object.entries(dataMap).sort((a, b) => b[1] - a[1]).forEach(([name, sum]) => {
        if (Object.keys(dataMap).length > 15 && totalSum > 0 && (sum / totalSum) < 0.02) {
            otherSum += sum;
        } else { 
            groupedLabels.push(name); 
            groupedValues.push(sum); 
        }
    });
    if (otherSum > 0) { groupedLabels.push('Остальное'); groupedValues.push(otherSum); }

    const ctx = el.getContext('2d');
    if (chartsRef[chartKey]) chartsRef[chartKey].destroy();
    
    chartsRef[chartKey] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: groupedLabels,
            datasets: [{
                data: groupedValues,
                backgroundColor: ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#6366f1', '#14b8a6', '#94a3b8', '#64748b', '#71717a', '#a1a1aa'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { 
                legend: { position: 'right', labels: { boxWidth: 12 } },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let value = context.raw;
                            let percentage = totalSum > 0 ? Math.round((value / totalSum) * 100) : 0;
                            return ` ${context.label}: ${formatCurrency(value)} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}

function renderDayChart() {
    const typeEl = document.getElementById('chart-day-type');
    const ctxEl = document.getElementById('chartDays');
    if (!typeEl || !ctxEl) return;

    const type = typeEl.value;
    const ctx = ctxEl.getContext('2d');
    let labels, data;
    
    if (type === 'week') {
        const d = CHART_DATA_CACHE.dayOfWeekMap;
        data = [d[1], d[2], d[3], d[4], d[5], d[6], d[0]];
        labels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    } else {
        data = CHART_DATA_CACHE.dayOfMonthMap.slice(1);
        labels = Array.from({length: 31}, (_, i) => i + 1);
    }
    
    if (chartsInstance.days) chartsInstance.days.destroy();
    chartsInstance.days = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{ label: 'Покупок', data: data, backgroundColor: '#60a5fa', borderRadius: 2 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { beginAtZero: true } },
            plugins: { legend: { display: false } }
        }
    });
}

function renderTable(data) {
    const headerRow = document.getElementById('table-header');
    const body = document.getElementById('table-body');
    if (!headerRow || !body) return;

    headerRow.innerHTML = '';
    body.innerHTML = '';

    const keys = [
        {k: 'date', label: 'Дата'}, 
        {k: 'category', label: 'Категория'}, 
        {k: 'comment', label: 'Комментарий'},
        {k: 'tag', label: 'Тег'},           
        {k: 'type', label: 'Тип'},          
        {k: 'account', label: 'Счет'},      
        {k: 'amount', label: 'Сумма'}
    ];

    keys.forEach(col => {
        const th = document.createElement('th');
        th.textContent = col.label.toUpperCase();
        th.className = 'px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider';
        headerRow.appendChild(th);
    });
    headerRow.innerHTML += '<th class="px-6 py-3"></th>'; 

    const dataToShow = data.slice(0, 100); 

    dataToShow.forEach(item => {
        const tr = document.createElement('tr');
        const borderClass = item.type === 'income' ? 'border-l-green-500' : (item.type === 'expense' ? 'border-l-red-500' : 'border-l-gray-400');
        tr.className = `hover:bg-gray-50 transition border-b border-gray-100 border-l-4 ${borderClass}`;

        keys.forEach(col => {
            const td = document.createElement('td');
            td.className = 'px-6 py-4 text-sm text-gray-700';
            
            if (col.k === 'amount') {
                td.textContent = formatCurrency(item.amount);
                td.className += ' font-bold whitespace-nowrap';
            } else if (col.k === 'date') {
                td.textContent = new Date(item.date).toLocaleDateString('ru-RU');
                td.className += ' whitespace-nowrap';
            } else if (col.k === 'type') {
                const typeMap = {'income': 'Доход', 'expense': 'Расход', 'transfer': 'Перевод'};
                td.textContent = typeMap[item.type] || item.type;
            } else if (col.k === 'comment') {
                td.textContent = item.comment || '—';
                td.className += ' max-w-[200px] break-words leading-tight';
            } else if (col.k === 'account') {
                if (item.type === 'transfer') td.textContent = `${item.source_account} → ${item.target_account}`;
                else if (item.type === 'income') td.textContent = item.target_account || 'Основной';
                else td.textContent = item.source_account || 'Основной';
                td.className += ' text-xs text-gray-500 whitespace-nowrap';
            } else {
                td.textContent = item[col.k] || '—';
                td.className += ' whitespace-nowrap';
            }
            tr.appendChild(td);
        });

        const tdAct = document.createElement('td');
        tdAct.className = 'px-6 py-4 whitespace-nowrap text-right text-sm font-medium';
        tdAct.innerHTML = `<button onclick='openEditModal(${JSON.stringify(item)})' class="text-blue-600 hover:text-blue-900 font-bold">✎</button>`;
        tr.appendChild(tdAct);

        body.appendChild(tr);
    });
}

function drillDownByCategory(categoryName) {
    if (categoryName === 'Остальное') return alert('Используйте фильтр.');
    document.getElementById('filter-category').value = categoryName;
    document.getElementById('filter-type').value = 'expense';
    applyFilters();
    switchTab('transactions');
}

function drillDownByMonth(monthStr) {
    const [year, month] = monthStr.split('-').map(Number);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);
    const fmt = d => {
        const offset = d.getTimezoneOffset() * 60000;
        return new Date(d.getTime() - offset).toISOString().split('T')[0];
    };
    document.getElementById('filter-date-start').value = fmt(start);
    document.getElementById('filter-date-end').value = fmt(end);
    document.getElementById('filter-type').value = 'ALL';
    applyFilters();
    switchTab('transactions');
}

function openEditModal(item) {
    const modal = document.getElementById('edit-modal');
    if (!modal) return;

    // Заполняем существующие поля
    document.getElementById('edit-id').value = item.id;
    document.getElementById('edit-amount').value = item.amount;
    document.getElementById('edit-comment').value = item.comment || '';
    document.getElementById('edit-tag').value = item.tag || ''; 
    
    // --- НОВОЕ: Заполняем Тип и Дату ---
    document.getElementById('edit-type').value = item.type || 'expense'; 
    // item.date приходит как ISO строка, нам нужны первые 10 символов (YYYY-MM-DD) для input type="date"
    if (item.date) {
        document.getElementById('edit-date').value = item.date.slice(0, 10);
    }

    const select = document.getElementById('edit-category');
    select.innerHTML = '';
    const cats = new Set([...ALL_CATEGORIES, item.category]);
    cats.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c; opt.textContent = c;
        select.appendChild(opt);
    });
    select.value = item.category;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeModal() {
    const modal = document.getElementById('edit-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

const editForm = document.getElementById('edit-form');
if (editForm) {
    editForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const id = document.getElementById('edit-id').value;
        const amount = parseFloat(document.getElementById('edit-amount').value);
        const category = document.getElementById('edit-category').value;
        const comment = document.getElementById('edit-comment').value;
        const tag = document.getElementById('edit-tag').value;
        
        // НОВЫЕ ПОЛЯ
        const type = document.getElementById('edit-type').value;
        const date = document.getElementById('edit-date').value;

        // Если ID есть — это редактирование, если нет — добавление
        const isEdit = !!id; 
        const url = isEdit ? API_URL_EDIT : API_BASE_URL + '/transactions/add';

        // Собираем данные. 
        // Для добавления нужны type и date. Для редактирования type и date мы пока не меняем на сервере (в api_server.js ты их не обрабатывал в /edit), но передать не страшно.
        const payload = { 
            id, amount, category, comment, tag, 
            type, date // Добавили новые поля в отправку
        };

        try {
            await fetch(url, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });
            closeModal();
            await loadData(); 
            applyFilters();   
        } catch(e) { alert('Ошибка сети'); }
    });
}

let calendarLoaded = false;


async function loadStudents() {
    try {
        const res = await fetch(API_URL_STUDENTS);
        const students = await res.json();
        renderStudents(students);
    } catch(e) { console.error('Ошибка загрузки учеников', e); }
}

function renderStudents(students) {
    const grid = document.getElementById('students-grid');
    if (!grid) return;

    if (students.length === 0) {
        grid.innerHTML = '<div class="col-span-3 text-center text-gray-500 py-10">Список пуст</div>';
        return;
    }
    
    grid.innerHTML = students.map(s => `
        <div class="card p-5 hover:shadow-md transition cursor-pointer group border-l-4 ${s.subject === 'Математика' ? 'border-l-blue-500' : 'border-l-purple-500'}">
            <div onclick='openStudentModal(${JSON.stringify(s)})'>
                <div class="flex justify-between items-start mb-3">
                    <div>
                        <h3 class="text-lg font-bold text-gray-900 group-hover:text-blue-600 transition">${s.name}</h3>
                        <p class="text-xs text-gray-500">
                            ${s.school || 'Школа не указана'} • ${s.grade || '?'} кл.
                            ${s.lessons_per_week ? ` • <span class="font-bold text-blue-600">${s.lessons_per_week}/нед</span>` : ''}
                        </p>
                    </div>
                    <span class="text-xs font-bold px-2 py-1 rounded ${s.subject === 'Математика' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}">${s.subject}</span>
                </div>
                
                <div class="space-y-2 text-sm text-gray-600 mb-4">
                    <div class="flex items-center gap-2">
                        <span title="Телефон ученика">📱</span> <span>${s.phone || '—'}</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <span title="Родитель">👨‍👩‍👧</span> 
                        <span>${s.parents || '—'} <span class="text-gray-400 text-xs">${s.parent_phone ? '('+s.parent_phone+')' : ''}</span></span>
                    </div>
                    <div class="flex items-center gap-2">
                        <span title="Место">📍</span> <span class="truncate">${s.address || '—'}</span>
                    </div>
                </div>
            </div>
            <button onclick="openStatsModal(${s.id})" class="w-full mt-2 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition flex items-center justify-center gap-2">
                📊 Показать статистику
            </button>
        </div>
    `).join('');
}

// Отрисовка кнопок дней (1=Пн, 7=Вс)
function renderScheduleSelector(selectedDaysStr = '') {
    const container = document.getElementById('schedule-days-container');
    if (!container) return;
    const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']; 
    const selected = selectedDaysStr ? selectedDaysStr.split(',').map(Number) : [];
    
    container.innerHTML = days.map((d, i) => {
        const dayNum = i + 1; 
        const isActive = selected.includes(dayNum);
        // data-day нужен, чтобы потом считать выбор
        return `
            <div data-day="${dayNum}" onclick="this.classList.toggle('bg-blue-600'); this.classList.toggle('text-white'); this.classList.toggle('bg-gray-100');" 
                 class="w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold cursor-pointer transition select-none
                 ${isActive ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}">
                ${d}
            </div>
        `;
    }).join('');
}

function openStudentModal(s = null) {
    const modal = document.getElementById('student-modal');
    const form = document.getElementById('student-form');
    const delBtn = document.getElementById('btn-delete-student');
    if (!modal) return;

    form.reset();
    
    if (s) {
        document.getElementById('student-modal-title').textContent = 'Редактировать ученика';
        document.getElementById('student-id').value = s.id;
        document.getElementById('st-subject').value = s.subject || 'Математика';
        document.getElementById('st-name').value = s.name;
        document.getElementById('st-phone').value = s.phone || '';
        document.getElementById('st-parents').value = s.parents || '';
        document.getElementById('st-parent-phone').value = s.parent_phone || '';
        document.getElementById('st-school').value = s.school || '';
        document.getElementById('st-grade').value = s.grade || '';
        document.getElementById('st-teacher').value = s.teacher || '';
        document.getElementById('st-address').value = s.address || '';
        document.getElementById('st-notes').value = s.notes || '';
        document.getElementById('st-lessons-week').value = s.lessons_per_week || 0;
        delBtn.classList.remove('hidden');
        renderScheduleSelector(s.schedule_days || '');
    } else {
        document.getElementById('student-modal-title').textContent = 'Новый ученик';
        document.getElementById('student-id').value = '';
        document.getElementById('st-lessons-week').value = '';
        delBtn.classList.add('hidden');
        renderScheduleSelector('');
    }
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeStudentModal() {
    const modal = document.getElementById('student-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

const studentForm = document.getElementById('student-form');
if (studentForm) {
    studentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        // --- НОВЫЙ КОД СБОРА ДНЕЙ ---
        const dayEls = document.getElementById('schedule-days-container').children;
        const selectedDays = [];
        for(let i=0; i<dayEls.length; i++) {
        if(dayEls[i].classList.contains('bg-blue-600')) {
            selectedDays.push(dayEls[i].getAttribute('data-day'));
        }
    }
        const id = document.getElementById('student-id').value;
        const action = id ? 'edit' : 'add';
        
        const payload = {
            action, id,
            name: document.getElementById('st-name').value,
            subject: document.getElementById('st-subject').value,
            parents: document.getElementById('st-parents').value,
            phone: document.getElementById('st-phone').value,
            parent_phone: document.getElementById('st-parent-phone').value, 
            school: document.getElementById('st-school').value,
            grade: document.getElementById('st-grade').value,
            teacher: document.getElementById('st-teacher').value,
            address: document.getElementById('st-address').value,
            notes: document.getElementById('st-notes').value,
            lessons_per_week: document.getElementById('st-lessons-week').value,
            schedule_days: selectedDays.join(',')
        };

        try {
            await fetch(API_URL_STUDENT_ACTION, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });
            closeStudentModal();
            loadStudents(); 
        } catch(e) { alert('Ошибка'); }
    });
}

async function deleteStudent() {
    const id = document.getElementById('student-id').value;
    if (!confirm('Удалить ученика?')) return;
    try {
        await fetch(API_URL_STUDENT_ACTION, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ action: 'delete', id })
        });
        closeStudentModal();
        loadStudents();
    } catch(e) { alert('Ошибка'); }
}

const shopTypeEl = document.getElementById('shop-type');
if (shopTypeEl) {
    shopTypeEl.addEventListener('change', (e) => {
        const priceBlock = document.getElementById('shop-price-block');
        // Цена нужна для вишлиста и маркетплейса (чтобы прикинуть бюджет)
        if (e.target.value === 'wish' || e.target.value === 'market') priceBlock.classList.remove('hidden');
        else priceBlock.classList.add('hidden');
    });
}

async function loadShoppingList() {
    try {
        const res = await fetch(API_URL_SHOPPING);
        if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
        const list = await res.json();
        if (!Array.isArray(list)) return;
        renderShoppingList(list);
    } catch(e) { console.error(e); }
}

function renderShoppingList(list) {
    const buyContainer = document.getElementById('list-buy');
    const marketContainer = document.getElementById('list-market'); 
    const wishContainer = document.getElementById('list-wish');
    if (!buyContainer) return;

    buyContainer.innerHTML = '';
    if (marketContainer) marketContainer.innerHTML = '';
    wishContainer.innerHTML = '';

    // --- ИЗМЕНЕНИЕ ЗДЕСЬ: Добавили && !i.is_bought ---
    // Показываем только те, где is_bought === 0 (не куплено)
    const buyItems = list.filter(i => i.type === 'buy' && !i.is_bought);
    const marketItems = list.filter(i => i.type === 'market' && !i.is_bought);
    const wishItems = list.filter(i => i.type === 'wish' && !i.is_bought);

    // Счетчики
    if (document.getElementById('count-buy')) document.getElementById('count-buy').textContent = buyItems.length;
    if (document.getElementById('count-market')) document.getElementById('count-market').textContent = marketItems.length;
    if (document.getElementById('count-wish')) document.getElementById('count-wish').textContent = wishItems.length;

    // Дальше код отрисовки createItemHTML останется тем же, 
    // но рисовать он будет только активные товары.
    const createItemHTML = (item) => {
         // ... (здесь твой старый код createItemHTML) ...
         // (можешь скопировать его из прошлого сообщения или оставить как есть в файле)
         const isChecked = item.is_bought || item.is_done;
         return `
        <div class="bg-white rounded-xl p-3 shadow-sm border border-gray-100 flex justify-between items-center group hover:border-blue-300 transition cursor-move" data-id="${item.id}">
            <div class="flex items-center gap-3 overflow-hidden">
                <input type="checkbox" onchange="buyItem(${item.id}, this.checked)" 
                       class="w-5 h-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer flex-shrink-0">
                <div class="min-w-0">
                    <p class="font-medium text-sm truncate leading-tight text-gray-800" title="${item.title}">
                        ${item.title}
                    </p>
                    ${item.price_estimate ? `<p class="text-[10px] text-green-600 font-bold mt-0.5">~${formatCurrency(item.price_estimate)}</p>` : ''}
                </div>
            </div>
            <button onclick="deleteItem(${item.id})" class="text-gray-300 hover:text-red-500 p-1 opacity-0 group-hover:opacity-100 transition">✕</button>
        </div>
    `};

    // ... (конец функции renderShoppingList такой же) ...
    buyContainer.innerHTML = buyItems.length ? buyItems.map(createItemHTML).join('') : '<div class="text-xs text-gray-400 text-center py-4 italic">Всё куплено</div>';
    if (marketContainer) marketContainer.innerHTML = marketItems.length ? marketItems.map(createItemHTML).join('') : '<div class="text-xs text-gray-400 text-center py-4 italic">Пусто</div>';
    wishContainer.innerHTML = wishItems.length ? wishItems.map(createItemHTML).join('') : '<div class="text-xs text-gray-400 text-center py-4 italic">Пусто</div>';

    initSortable(buyContainer, 'buy');
    if (marketContainer) initSortable(marketContainer, 'market');
    initSortable(wishContainer, 'wish');
}

function initSortable(el, type) {
    if (el.sortable) el.sortable.destroy(); 
    el.sortable = new Sortable(el, {
        animation: 150,
        ghostClass: 'bg-blue-100', 
        onEnd: async function (evt) {
            const itemEls = el.querySelectorAll('[data-id]');
            const ids = Array.from(itemEls).map(div => parseInt(div.getAttribute('data-id')));
            try {
                await fetch(API_URL_SHOPPING_ACTION, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ action: 'reorder', ids: ids })
                });
            } catch(e) { console.error('Ошибка сортировки', e); }
        }
    });
}

const shopForm = document.getElementById('shopping-form');
if (shopForm) {
    shopForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('shop-item').value;
        const type = document.getElementById('shop-type').value;
        const price = document.getElementById('shop-price').value;
        try {
            await fetch(API_URL_SHOPPING_ACTION, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ action: 'add', title: name, type: type, price_estimate: price || 0 })
            });
            document.getElementById('shop-item').value = '';
            document.getElementById('shop-price').value = '';
            loadShoppingList();
        } catch(e) { alert('Ошибка'); }
    });
}

async function buyItem(id) {
    setTimeout(async () => {
        try {
            await fetch(API_URL_SHOPPING_ACTION, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ action: 'status', id: id, status: 'bought' })
            });
            loadShoppingList();
        } catch(e) { alert('Ошибка'); }
    }, 300);
}

async function deleteItem(id) {
    if(!confirm('Удалить без покупки?')) return;
    try {
        await fetch(API_URL_SHOPPING_ACTION, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ action: 'status', id: id, status: 'deleted' })
        });
        loadShoppingList();
    } catch(e) { alert('Ошибка'); }
}

let studentChart = null;
async function openStatsModal(id) {
    const modal = document.getElementById('stats-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    try {
        const res = await fetch(`${API_BASE_URL}/students/stats?id=${id}`);
        const data = await res.json();
        
        // Данные приходят в data.student и data.transactions
        const s = data.student;
        const txs = data.transactions;

        document.getElementById('stats-title').textContent = s.name;
        
        // 1. Общая статистика (За всё время)
        let total = 0;
        txs.forEach(t => total += t.amount);
        document.getElementById('stats-total').textContent = formatCurrency(total);
        document.getElementById('stats-count').textContent = txs.length;

        // 2. План/Факт (Текущий месяц)
        const now = new Date();
        const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`; // "2023-12"
        const monthName = now.toLocaleString('ru', { month: 'long', year: 'numeric' });
        document.getElementById('stats-month-name').textContent = monthName;

        // Считаем факт (транзакции за этот месяц)
        const factCount = txs.filter(t => t.date.startsWith(currentMonthKey)).length;
        
        // Считаем план (Занятий в неделю * 4)
        // Если lessons_per_week не указано, считаем план = факту (чтобы не пугать нулями)
        const weekly = s.lessons_per_week || 0;

        // --- НОВЫЙ РАСЧЕТ ПЛАНА ---
        const weeklyDays = (s.schedule_days || '').split(',').filter(Boolean).map(Number); // [1, 4]
        let planCount = 0;
        
        if (weeklyDays.length > 0) {
            // Считаем сколько конкретных дней (Пн, Чт) в этом месяце
            const y = now.getFullYear(), m = now.getMonth();
            const daysInMonth = new Date(y, m + 1, 0).getDate();
            for (let d = 1; d <= daysInMonth; d++) {
                let dayOfWeek = new Date(y, m, d).getDay(); // 0=Вс
                if (dayOfWeek === 0) dayOfWeek = 7; 
                if (weeklyDays.includes(dayOfWeek)) planCount++;
            }
        } else {
            // Если дни не выбраны - считаем по-старому (недели * 4)
            const weekly = s.lessons_per_week || 0;
            planCount = weekly > 0 ? weekly * 4 : factCount; 
        }

        const factEl = document.getElementById('stats-fact');
        const planEl = document.getElementById('stats-plan');
        const progBar = document.getElementById('stats-progress');
        const progText = document.getElementById('stats-progress-text');

        factEl.textContent = factCount;
        planEl.textContent = planCount; // Примерно 4 недели в месяце

        // Раскраска факта
        if (factCount < planCount) factEl.className = "text-xl font-bold text-red-500";
        else if (factCount > planCount) factEl.className = "text-xl font-bold text-green-500";
        else factEl.className = "text-xl font-bold text-gray-800";

        // Прогресс бар
        const percent = planCount > 0 ? Math.min(100, (factCount / planCount) * 100) : 0;
        progBar.style.width = `${percent}%`;
        // Цвет бара
        progBar.className = `h-2.5 rounded-full ${factCount >= planCount ? 'bg-green-500' : 'bg-blue-600'}`;
        
        if (weekly > 0) {
            const diff = factCount - planCount;
            progText.textContent = diff === 0 ? "Идем по плану" : (diff > 0 ? `+${diff} доп. уроков` : `${diff} от плана`);
        } else {
            progText.textContent = "График не задан";
        }

        // 3. История (Последние 10)
        const historyEl = document.getElementById('stats-history');
        historyEl.innerHTML = txs.slice(0, 10).map(t => `
            <div class="flex justify-between border-b border-gray-100 pb-1 last:border-0">
                <span>${new Date(t.date).toLocaleDateString('ru-RU')} <span class="text-xs text-gray-400">(${t.comment})</span></span>
                <span class="font-bold text-green-600">+${formatCurrency(t.amount)}</span>
            </div>
        `).join('') || '<div class="text-gray-400">Оплат пока нет</div>';

        // 4. График (По месяцам)
        const months = {};
        txs.forEach(t => {
            const date = new Date(t.date);
            // Сортировка по ключу YYYY-MM, отображение потом
            const sortKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            months[sortKey] = (months[sortKey] || 0) + t.amount;
        });

        // Сортируем месяцы хронологически
        const sortedKeys = Object.keys(months).sort();
        const labels = sortedKeys.map(k => {
            const [y, m] = k.split('-');
            return new Date(y, m - 1).toLocaleString('ru', { month: 'short' });
        });
        const values = sortedKeys.map(k => months[k]);

        const ctx = document.getElementById('studentChart').getContext('2d');
        if (studentChart) studentChart.destroy();
        studentChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Оплаты',
                    data: values,
                    backgroundColor: '#3b82f6',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { y: { beginAtZero: true } }
            }
        });

    } catch (e) { console.error(e); alert('Ошибка загрузки статистики'); }
}
function closeStatsModal() {
    const modal = document.getElementById('stats-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

window.onclick = function(event) {
    const modals = [document.getElementById('edit-modal'), document.getElementById('student-modal'), document.getElementById('stats-modal', document.getElementById('trash-modal'))];
    modals.forEach(modal => { if (event.target === modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); } });
}

// --- КОММУНАЛКА ---

// Установка текущего месяца
const utilMonth = document.getElementById('util-month');
if (utilMonth) {
    const now = new Date();
    utilMonth.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Связка Горячей воды
const coldInput = document.getElementById('val-water-cold');
const hotInput = document.getElementById('val-water-hot');
const hotHeatInput = document.getElementById('val-heat-hot');

if (hotInput && hotHeatInput) {
    hotInput.addEventListener('input', (e) => {
        hotHeatInput.value = e.target.value; // Копируем значение визуально
    });
}

// Авто-подсчет суммы
document.getElementById('utility-bulk-form').addEventListener('input', () => {
    let total = 0;
    document.querySelectorAll('.util-amount-input').forEach(inp => {
        const val = parseFloat(inp.value);
        if (!isNaN(val)) total += val;
    });
    document.getElementById('total-util-sum').textContent = formatCurrency(total);
});

async function loadUtilities() {
    try {
        const res = await fetch(API_URL_UTILITIES);
        const list = await res.json();
        renderUtilities(list);
        prefillUtilities(list); // Заполняем форму последними данными
    } catch(e) { console.error(e); }
}

function prefillUtilities(list) {
    // Находим последние значения для каждой категории
    const defaults = {};
    // Идем с конца (так как сортировка DESC), но лучше перестраховаться и найти первую попавшуюся запись для каждого сервиса
    list.forEach(item => {
        if (!defaults[item.service] && item.amount > 0) {
            defaults[item.service] = item.amount;
        }
    });

    // Заполняем поля, если они пустые
    document.querySelectorAll('.util-amount-input').forEach(inp => {
        const service = inp.dataset.service;
        if (!inp.value && defaults[service]) {
            inp.value = defaults[service];
        }
    });
    
    // Пересчитываем итог
    document.getElementById('utility-bulk-form').dispatchEvent(new Event('input'));
}

function renderUtilities(list) {
    const tbody = document.getElementById('utility-list');
    if (!tbody) return;

    // Таблица истории
    tbody.innerHTML = list.map(item => `
        <tr class="hover:bg-gray-50 border-b border-gray-100 last:border-0">
            <td class="px-4 py-3 whitespace-nowrap text-xs text-gray-500">${item.date}</td>
            <td class="px-4 py-3 font-medium text-gray-800">
                ${item.service}
                ${item.reading ? `<span class="text-xs text-gray-400 ml-2">(${item.reading})</span>` : ''}
            </td>
            <td class="px-4 py-3 text-right font-bold text-gray-900">${formatCurrency(item.amount)}</td>
            <td class="px-4 py-3 text-right">
                <button onclick="deleteUtility(${item.id})" class="text-red-300 hover:text-red-500">✕</button>
            </td>
        </tr>
    `).join('') || '<tr><td colspan="4" class="text-center py-4 text-gray-400">Нет записей</td></tr>';

    renderUtilityChart(list);
}

function renderUtilityChart(list) {
    const ctxEl = document.getElementById('chartUtilities');
    if (!ctxEl) return;
    const ctx = ctxEl.getContext('2d');

    // Группировка данных
    const dataByMonth = {};
    const services = new Set();

    list.forEach(item => {
        // item.date теперь в формате YYYY-MM
        const key = item.date; 
        if (!dataByMonth[key]) dataByMonth[key] = {};
        
        dataByMonth[key][item.service] = (dataByMonth[key][item.service] || 0) + item.amount;
        services.add(item.service);
    });

    const labels = Object.keys(dataByMonth).sort(); 
    const serviceList = Array.from(services); 
    
    // Цвета
    const colors = {
        'Кызылжар су': '#3b82f6', // Blue
        'СК РЭК': '#f59e0b', // Yellow
        'ПТС': '#ef4444', // Red
        'Казахтелеком': '#2563eb', // Dark Blue
        'ОСИ Управление': '#10b981', // Green
        'ОСИ Накопление': '#059669', // Dark Green
        'Горгаз': '#06b6d4', // Cyan
        'Мусор': '#6b7280', // Gray
        'Домофон': '#8b5cf6', // Purple
    };

    const datasets = serviceList.map(srv => ({
        label: srv,
        data: labels.map(m => dataByMonth[m][srv] || 0),
        backgroundColor: colors[srv] || '#9ca3af',
        stack: 'Stack 0',
    }));

    if (chartsInstance.util) chartsInstance.util.destroy();
    
    chartsInstance.util = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { x: { stacked: true }, y: { stacked: true } }
        }
    });
}

// Отправка формы (ПАКЕТНАЯ)
const bulkForm = document.getElementById('utility-bulk-form');
if (bulkForm) {
    bulkForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const dateVal = document.getElementById('util-month').value; // YYYY-MM
        const inputs = document.querySelectorAll('.util-amount-input');
        
        const requests = [];

        // Собираем данные
        inputs.forEach(inp => {
            const amountStr = inp.value;
            // ВАЖНО: parseFloat решает проблему "1.5 млн" (сложение строк)
            const amount = parseFloat(amountStr);
            const service = inp.dataset.service;

            if (amount > 0) {
                // Доп. данные (показания)
                let reading = 0;
                let comment = '';

                if (service === 'Кызылжар су') {
                    const cold = document.getElementById('val-water-cold').value;
                    const hot = document.getElementById('val-water-hot').value;
                    if (cold || hot) comment = `Хол: ${cold}, Гор: ${hot}`;
                }
                if (service === 'СК РЭК') {
                    reading = parseFloat(document.getElementById('val-light-read').value) || 0;
                }

                // Формируем запрос
                const p = fetch(API_URL_UTILITIES_ACTION, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        action: 'add',
                        date: dateVal,
                        service: service,
                        amount: amount, // Число!
                        reading: reading,
                        comment: comment
                    })
                });
                requests.push(p);
            }
        });

        if (requests.length === 0) return alert('Введите хотя бы одну сумму');

        try {
            await Promise.all(requests);
            alert('Сохранено!');
            // Не очищаем форму полностью, чтобы можно было исправить, если что. Или можно bulkForm.reset()
            loadUtilities();
        } catch(e) { alert('Ошибка при сохранении'); }
    });
}

async function deleteUtility(id) {
    if (!confirm('Удалить запись?')) return;
    try {
        await fetch(API_URL_UTILITIES_ACTION, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ action: 'delete', id })
        });
        loadUtilities();
    } catch(e) { alert('Ошибка'); }
}

// --- ОБНОВЛЕНИЕ loadData ---
// Добавь вызов loadDebts() и loadKPI() внутрь loadData или init

async function loadDebts() {
    try {
        const res = await fetch(`${API_BASE_URL}/debts`);
        const debts = await res.json();
        renderDebts(debts);
    } catch(e) { console.error(e); }
}

function renderDebts(debts) {
    const panel = document.getElementById('debts-panel');
    const list = document.getElementById('debts-list');
    
    if (!debts.length) {
        panel.classList.add('hidden');
        return;
    }
    panel.classList.remove('hidden');

    // Делаем сетку: на мобильном 1 колонка, на пк 2 колонки
    list.className = "grid grid-cols-1 sm:grid-cols-2 gap-3"; 

    list.innerHTML = debts.map(d => {
        // Красивая дата: "25 дек"
        const dateStr = new Date(d.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
        
        return `
        <div class="relative bg-white rounded-xl p-4 border-l-4 border-red-500 shadow-sm hover:shadow-md transition flex flex-col justify-between group">
            <div class="flex justify-between items-start mb-2">
                <div>
                    <h4 class="font-bold text-gray-800 text-lg leading-none">${d.student_name}</h4>
                    <span class="text-xs text-gray-400 font-medium uppercase tracking-wider">${d.subject}</span>
                </div>
                <div class="text-right">
                    <span class="block font-mono font-bold text-xl text-red-600">${formatCurrency(d.amount)}</span>
                    <span class="text-[10px] text-gray-400">от ${dateStr}</span>
                </div>
            </div>
            
            <button onclick="payDebt(${d.id})" 
                    class="w-full mt-2 py-2 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-sm font-bold transition flex items-center justify-center gap-2 opacity-80 hover:opacity-100">
                💰 Оплатить
            </button>
        </div>
        `;
    }).join('');
}

async function payDebt(id) {
    if (!confirm('Подтвердить оплату?')) return;
    try {
        await fetch(`${API_BASE_URL}/debts/pay`, {
            method: 'POST', body: JSON.stringify({id})
        });
        loadDebts();
        loadData(); // Обновить баланс
    } catch(e) { alert('Ошибка'); }
}

async function loadKPI() {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    try {
        const res = await fetch(`${API_BASE_URL}/stats/kpi?month=${monthKey}`);
        const data = await res.json();
        const el = document.getElementById('stat-lessons-count');
        if (el) el.textContent = data.count;
    } catch(e) {}
}

// --- ПОИСК ---
function searchTransactions(query) {
    if (!query) {
        renderTable(FILTERED_DATA); // FILTERED_DATA - это отфильтрованные по дате данные (из твоего кода)
        return;
    }
    const lower = query.toLowerCase();
    const found = FILTERED_DATA.filter(t => 
        (t.comment && t.comment.toLowerCase().includes(lower)) ||
        (t.category && t.category.toLowerCase().includes(lower)) ||
        t.amount.toString().includes(lower)
    );
    renderTable(found);
}

// --- РУЧНОЕ ДОБАВЛЕНИЕ ---
function openAddModal() {
    const modal = document.getElementById('edit-modal');
    // Сброс формы (используем ту же форму что для редактирования, но без ID)
    document.getElementById('edit-form').reset();
    document.getElementById('edit-id').value = ''; // ПУСТОЙ ID = ДОБАВЛЕНИЕ
    
    // Подстановка текущей даты
    // (надо добавить поле даты в модалку HTML, если его нет, см. ниже)
    
    // Загрузка категорий в селект (существующая логика)
    const select = document.getElementById('edit-category');
    select.innerHTML = '<option value="" disabled selected>Выберите...</option>';
    ALL_CATEGORIES.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c; opt.textContent = c;
        select.appendChild(opt);
    });

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

// --- СПИСОК ДЕЛ ---
const todoForm = document.getElementById('todo-form');
function formatPeriod(p) {
    if (p === 'urgent' || p === 'today') return 'Срочно';
    if (p === 'medium') return 'Средне';
    return 'Не к спеху';
}

// Новая функция для смены приоритета без перезагрузки страницы
async function changeTodoPeriod(id, period) {
    // Нам нужен новый эндпоинт или используем add с тем же текстом? 
    // Проще добавить update в api_server.js, но пока сделаем костыль: удалим и создадим? Нет.
    // Давай просто добавим маленький обработчик в API.
    // ЛИБО: В следующем шаге я добавлю обработку updateTodo.
    // Пока оставим кнопки, но они не будут работать без бэка.
    // Давай сделаем это правильно.
    
    // ВРЕМЕННО: просто пересоздаем задачу (это костыль, но сработает прямо сейчас без правки сервера)
    // Лучше добавим action 'update' в api_server.
    await fetch(`${API_BASE_URL}/todos/action`, {
        method: 'POST', body: JSON.stringify({ action: 'update_period', id, period })
    });
    loadTodos();
}

async function toggleTodo(id, status) {
    await fetch(`${API_BASE_URL}/todos/action`, { method: 'POST', body: JSON.stringify({ action: 'toggle', id, status }) });
    loadTodos();
}
async function deleteTodo(id) {
    if(!confirm('Удалить?')) return;
    await fetch(`${API_BASE_URL}/todos/action`, { method: 'POST', body: JSON.stringify({ action: 'delete', id }) });
    loadTodos();
}

function renderDepositStats(currentData) {
    // 1. Находим имена депозитных счетов
    const depositNames = ACCOUNTS_INFO.filter(a => a.is_deposit).map(a => a.name);
    
    if (depositNames.length === 0) return; // Если депозитов нет, нечего считать

    let saved = 0;
    let withdrawn = 0;

    currentData.forEach(t => {
        // Перевод НА депозит
        if (t.type === 'transfer' && depositNames.includes(t.target_account)) {
            saved += t.amount;
        }
        // Прямое пополнение депозита (тип income, категория Депозит) - если бот так пишет
        else if (t.type === 'income' && (t.target_account && depositNames.includes(t.target_account))) {
             // Исключаем проценты, если хотим видеть только наши вложения, 
             // но обычно "отложил" включает всё приходящее извне, кроме процентов. 
             // Если хочешь чисто свои переводы - оставь только верхний if.
             // Сейчас добавим всё входящее на депозит кроме процентов.
             if (t.category !== 'Проценты') saved += t.amount;
        }

        // Вывод С депозита
        if (t.type === 'transfer' && depositNames.includes(t.source_account)) {
            withdrawn += t.amount;
        }
    });

    // Отрисовка
    const savedEl = document.getElementById('stat-savings-in');
    const withdrawnEl = document.getElementById('stat-savings-out');
    const netEl = document.getElementById('stat-savings-net');
    
    if (savedEl) savedEl.textContent = `+${formatCurrency(saved)}`;
    if (withdrawnEl) withdrawnEl.textContent = `-${formatCurrency(withdrawn)}`;
    
    const net = saved - withdrawn;
    if (netEl) {
        netEl.textContent = (net > 0 ? '+' : '') + formatCurrency(net);
        netEl.className = `font-bold ${net > 0 ? 'text-green-600' : (net < 0 ? 'text-red-500' : 'text-gray-800')}`;
    }

    // Прогресс бары (Визуализация)
    const maxVal = Math.max(saved, withdrawn, 1); // 1 чтобы не делить на 0
    if (document.getElementById('bar-savings-in')) {
        document.getElementById('bar-savings-in').style.width = `${(saved / maxVal) * 100}%`;
    }
    if (document.getElementById('bar-savings-out')) {
        document.getElementById('bar-savings-out').style.width = `${(withdrawn / maxVal) * 100}%`;
    }
}

function setTodoFilter(filter) {
    CURRENT_TODO_FILTER = filter;    
    // Список ID кнопок
    const buttons = {
        'urgent': document.getElementById('tf-urgent'),
        'medium': document.getElementById('tf-medium'),
        'later': document.getElementById('tf-later')
    };

    // Проходим по всем кнопкам и меняем стили
    for (const [key, btn] of Object.entries(buttons)) {
        if (!btn) continue; // Защита если кнопки нет      
        if (key === filter) {
            // Активная кнопка: Белая, яркий текст, тень
            btn.className = "flex-1 py-1 text-xs font-bold rounded-lg bg-white shadow-sm text-blue-600 transition";
        } else {
            // Неактивная: Прозрачная, серый текст
            btn.className = "flex-1 py-1 text-xs font-bold text-gray-500 hover:bg-white/50 transition";
        }
    }
    
    loadTodos(); // Перерисовываем список
}

// В todoForm добавляем отправку period
if (todoForm) {
            todoForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('todo-input');
            const select = document.getElementById('todo-period-select'); 
            const text = input.value.trim();
            const period = select ? select.value : 'urgent'; 

            if(!text) return;
            try {
                await fetch(`${API_BASE_URL}/todos/action`, {
                    method: 'POST', body: JSON.stringify({ 
                        action: 'add', 
                        text, 
                        period: period // 
                    })
                });
                input.value = '';
                loadTodos();
            } catch(e) { console.error(e); }
        });
    }

// Обновленная функция загрузки
async function loadTodos() {
    try {
        const res = await fetch(`${API_BASE_URL}/todos`);
        const list = await res.json();
        
        const container = document.getElementById('todo-list');
        const countEl = document.getElementById('todo-count');
        
        // Считаем активные
        if(countEl) countEl.textContent = list.filter(t => !t.is_done).length;

        // 1. Нормализация данных
        // Создаем копию списка, где у каждой задачи гарантировано есть period
        const normalizedList = list.map(t => ({
            ...t,                          // <-- Скопировали всё (id, text, is_done)
            period: t.period || 'urgent'   // <-- Если period пустой, ставим 'urgent'
        }));

        // 2. Настройка веса для сортировки
        const priorityWeight = { 'urgent': 3, 'medium': 2, 'later': 1 };
        
        // 3. Сортировка
        normalizedList.sort((a, b) => {
            // Сначала выполненные вниз
            if (a.is_done !== b.is_done) return a.is_done - b.is_done;
            
            // Потом по весу (3 -> 2 -> 1)
            const pA = priorityWeight[a.period] || 3;
            const pB = priorityWeight[b.period] || 3;
            
            if (pA !== pB) return pB - pA; // От большего к меньшему
            
            // Если вес одинаковый, новые сверху (по ID)
            return b.id - a.id;
        });

        // 4. Генерация HTML
        container.innerHTML = normalizedList.map(t => {
            const isDone = t.is_done;
            const period = t.period; // Мы его нормализовали выше
            
            // Стили левой границы
            let borderClass = 'border-l-4 border-gray-200'; // Default
            if (period === 'urgent') borderClass = 'border-l-4 border-gray-800'; 
            if (period === 'medium') borderClass = 'border-l-4 border-gray-500'; 
            if (isDone) borderClass = 'border-l-4 border-transparent opacity-50';

            return `
            <div class="flex items-start justify-between group p-3 bg-white hover:bg-gray-50 rounded-r-xl shadow-sm transition ${borderClass} mb-2">
                <div class="flex items-start gap-3 w-full min-w-0">
                    <input type="checkbox" onchange="toggleTodo(${t.id}, ${isDone ? 0 : 1})" 
                           class="mt-1 w-5 h-5 text-gray-800 rounded border-gray-300 focus:ring-gray-500 cursor-pointer flex-shrink-0" ${isDone ? 'checked' : ''}>
                    
                    <div class="flex flex-col w-full min-w-0">
                        <span class="${isDone ? 'line-through text-gray-400' : 'text-gray-800 font-medium'} break-words whitespace-normal text-sm leading-snug">
                            ${t.text}
                        </span>
                        ${!isDone ? `<span class="mt-1 text-[10px] text-gray-400 uppercase font-bold tracking-wider">${formatPeriod(period)}</span>` : ''}
                    </div>
                </div>
                
                <div class="flex flex-col sm:flex-row opacity-0 group-hover:opacity-100 transition gap-1 ml-2">
                    ${!isDone ? `
                        <button onclick="changeTodoPeriod(${t.id}, 'urgent')" class="text-[10px] w-6 h-6 flex items-center justify-center bg-gray-800 text-white rounded font-bold" title="Срочно">!</button>
                        <button onclick="changeTodoPeriod(${t.id}, 'medium')" class="text-[10px] w-6 h-6 flex items-center justify-center bg-gray-500 text-white rounded font-bold" title="Средне">~</button>
                        <button onclick="changeTodoPeriod(${t.id}, 'later')" class="text-[10px] w-6 h-6 flex items-center justify-center bg-gray-300 text-gray-700 rounded font-bold" title="Позже">⏳</button> 
                    ` : ''}
                    <button onclick="deleteTodo(${t.id})" class="text-gray-300 hover:text-red-500 px-1 font-bold h-6">×</button>
                </div>
            </div>
            `;
        }).join('') || '<div class="text-center text-xs text-gray-400 py-10">Задач нет</div>';
        
    } catch(e) { console.error(e); }
}

// --- ЛОГИКА КОРЗИНЫ ---

async function openTrashModal() {
    const modal = document.getElementById('trash-modal');
    if (!modal) return;
    
    // Показываем окно сразу
    modal.classList.remove('hidden');
    modal.classList.add('flex'); // Используем flex для центровки
    
    // Грузим данные
    await loadTrash();
}

function closeTrashModal() {
    const modal = document.getElementById('trash-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

async function loadTrash() {
    try {
        const res = await fetch(API_URL_TRASH);
        const items = await res.json();
        renderTrash(items);
    } catch (e) {
        console.error('Ошибка загрузки корзины:', e);
        document.getElementById('trash-list').innerHTML = '<div class="text-red-500 text-center">Ошибка загрузки</div>';
    }
}

function renderTrash(items) {
    const listEl = document.getElementById('trash-list');
    const countEl = document.getElementById('trash-count');
    
    if (countEl) countEl.textContent = items.length;
    
    if (items.length === 0) {
        listEl.innerHTML = '<div class="text-center text-gray-400 py-10 italic">Корзина пуста</div>';
        return;
    }
    
    listEl.innerHTML = items.map(item => {
        // Определяем иконку и цвет типа
        const isTodo = item.type === 'todo';
        const icon = isTodo ? '📝' : '🛒';
        const typeLabel = isTodo ? 'Дело' : 'Покупка';
        
        return `
        <div class="flex items-center justify-between p-3 bg-gray-50 rounded-xl group hover:bg-white hover:shadow-sm border border-transparent hover:border-gray-200 transition">
            <div class="min-w-0">
                <div class="text-sm font-medium text-gray-600 line-through decoration-gray-400 truncate" title="${item.title}">
                    ${icon} ${item.title}
                </div>
                <div class="text-[10px] text-gray-400 mt-0.5">
                    Удалено: ${new Date(item.deleted_at).toLocaleDateString()}
                </div>
            </div>
            <button onclick="restoreItem('${item.type}', ${item.id})" 
                    class="ml-3 text-green-600 bg-green-50 hover:bg-green-100 px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1">
                ♻️ Вернуть
            </button>
        </div>
        `;
    }).join('');
}

async function restoreItem(type, id) {
    if (!confirm('Восстановить этот элемент?')) return;
    
    try {
        await fetch(API_URL_TRASH + '/restore', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ type, id })
        });
        
        // Обновляем корзину
        await loadTrash();
        
        // Обновляем основные списки "на фоне", чтобы когда закроем окно, там уже всё появилось
        loadTodos();
        loadShoppingList();
        
    } catch (e) {
        alert('Ошибка восстановления');
    }
}

// --- УПРАВЛЕНИЕ СНЕГОМ ---
function initSnowToggle() {
    const btn = document.getElementById('snow-toggle-btn');
    if (!btn) return;

    // Читаем: если записи нет, считаем true. Если есть "false" (строка), то false.
    const savedState = localStorage.getItem('isSnowing');
    const isSnowing = savedState === null ? true : savedState === 'true';
    
    updateSnowState(isSnowing);

    btn.onclick = () => {
        // Читаем текущее состояние из атрибута, чтобы не путаться
        const current = btn.dataset.state === 'on';
        const newState = !current;
        
        localStorage.setItem('isSnowing', newState);
        updateSnowState(newState);
    };
}

function updateSnowState(enabled) {
    const container = document.getElementById('snow-container');
    const btn = document.getElementById('snow-toggle-btn');
    
    // 1. Жесткое управление видимостью
    if (container) {
        // Если включено - block, выключено - none (скрывает всё внутри)
        container.style.display = enabled ? 'block' : 'none';
    }

    // 2. Кнопка (фиксированная ширина w-[140px] чтобы не прыгала)
    if (btn) {
        btn.dataset.state = enabled ? 'on' : 'off';
        btn.innerHTML = enabled ? '❄️ Снег: <span class="text-blue-600">ВКЛ</span>' : '❄️ Снег: <span class="text-gray-400">ВЫКЛ</span>';
        
        // Единый стиль, меняем только цвет рамки и фона
        btn.className = `w-[130px] h-[42px] px-3 rounded-xl text-xs font-bold transition flex items-center justify-center border ${enabled ? 'bg-blue-50 border-blue-200 text-gray-700' : 'bg-white border-gray-200 text-gray-400'}`;
    }
}

// --- ADMIN PANEL LOGIC ---

async function checkAdminAccess() {
    try {
        const res = await fetch(`${API_BASE_URL}/config`);
        const conf = await res.json();
        
        // Сравниваем текущего юзера с админом из конфига
        // CURRENT_USER_ID у нас глобальный из app.js
        if (CURRENT_USER_ID && conf.adminId && CURRENT_USER_ID.toString() === conf.adminId.toString()) {
            const btn = document.getElementById('btn-admin');
            if (btn) btn.classList.remove('hidden');
        }
    } catch (e) { console.error(e); }
}

async function loadAdminUsers() {
    try {
        const res = await fetch('/admin/users'); // Здесь путь без API_BASE_URL, так как он в корне
        if (res.status === 403) return alert('Нет доступа');
        
        const users = await res.json();
        renderAdminUsers(users);
    } catch (e) { console.error(e); }
}

function renderAdminUsers(users) {
    const tbody = document.getElementById('admin-users-list');
    if (!tbody) return;

    tbody.innerHTML = users.map(u => {
        const mods = u.modules ? u.modules.split(',') : [];
        const isAll = mods.includes('all') || u.role === 'admin';
        const check = (mod) => isAll || mods.includes(mod) ? 'checked' : '';
        const disabled = u.role === 'admin' ? 'disabled' : '';

        // Helper для чекбокса
        const cb = (mod) => `
            <input type="checkbox" 
                class="mod-check-${u.telegram_id} w-5 h-5 rounded text-blue-600 focus:ring-blue-500 cursor-pointer" 
                data-mod="${mod}"
                ${check(mod)} ${disabled} 
                onchange="toggleModule(${u.telegram_id})"
            >`;

        return `
            <tr class="hover:bg-gray-50 transition border-b border-gray-100 last:border-0">
                <td class="py-4 px-4">
                    <div class="font-bold text-gray-900">${u.first_name || 'Без имени'}</div>
                    <div class="text-xs text-gray-400">@${u.username || '-'}</div>
                </td>
                <td class="text-center py-3">${cb('finance')}</td>
                <td class="text-center py-3">${cb('sport')}</td>
                <td class="text-center py-3">${cb('students')}</td>
                <td class="text-center py-3">${cb('movies')}</td>
                <td class="text-center py-3">${cb('shopping')}</td>
            </tr>
        `;
    }).join('');
}

async function toggleModule(userId, moduleName) {
    // 1. Собираем состояние всех чекбоксов для этого юзера
    // Это немного хак, но проще чем хранить стейт в JS
    // Ищем все чекбоксы в строке этого юзера? Сложно.
    // Проще считать текущие модули с сервера? Нет, долго.
    
    // Давай так: мы просто "знаем" какие модули есть
    const allModules = ['finance', 'sport', 'students', 'movies', 'shopping'];
    const newModules = [];

    // Проходим по строке юзера (можно найти input по onclick атрибуту, но это грязно)
    // Перепишем renderAdminUsers чуть лучше, чтобы давать ID строкам
    
    // ВРЕМЕННОЕ РЕШЕНИЕ: Просто отправляем один запрос на изменение.
    // Но API ждет массив. Значит надо собрать массив.
    
    // --- ПРАВИЛЬНЫЙ СПОСОБ ---
    // Находим все чекбоксы, относящиеся к этому юзеру
    // Для этого при рендере дадим им класс `mod-check-${userId}`
    
    // (см. обновленный renderAdminUsers ниже, я добавлю класс)
    const checkboxes = document.querySelectorAll(`.mod-check-${userId}`);
    checkboxes.forEach(cb => {
        if (cb.checked) newModules.push(cb.dataset.mod);
    });

    try {
        await fetch('/admin/users/modules', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ telegramId: userId, modules: newModules })
        });
        // Можно показать тост "Сохранено"
    } catch(e) { alert('Ошибка сохранения'); }
}


// --- ГЕНЕРАТОР СНЕГА (Old School Style) ---
(function() {
    // Добавляем стиль анимации в head (один раз)
    const style = document.createElement('style');
    style.innerHTML = `@keyframes fall { to { transform: translateY(110vh) rotate(360deg); } }`;
    document.head.appendChild(style);

    function createSnowflake() {
        const container = document.getElementById('snow-container');
        
        // ГЛАВНОЕ ОТЛИЧИЕ: Если контейнера нет или он скрыт (кнопкой) — не генерируем
        if (!container || container.style.display === 'none') return;

        const snowflake = document.createElement('div');
        snowflake.innerHTML = '❄'; // Тот самый четкий символ
        snowflake.style.position = 'absolute'; // Внутри fixed контейнера лучше absolute
        snowflake.style.top = '-20px';
        snowflake.style.left = Math.random() * 100 + '%'; // По ширине экрана
        
        // Твои старые настройки рандома
        snowflake.style.fontSize = (Math.random() * 10 + 10) + 'px';
        snowflake.style.opacity = Math.random() * 0.5 + 0.3;
        snowflake.style.color = '#dbeafe'; // Приятный голубоватый оттенок
        snowflake.style.pointerEvents = 'none';
        
        // Анимация
        snowflake.style.animation = `fall ${Math.random() * 3 + 2}s linear forwards`;

        container.appendChild(snowflake);

        // Удаляем через 5 секунд, чтобы не забивать память
        setTimeout(() => { snowflake.remove(); }, 5000);
    }

    // Запускаем генерацию каждые 100мс (было 300, поставил чуть чаще для красоты, можешь вернуть 300)
    setInterval(createSnowflake, 200);
})();


init();
