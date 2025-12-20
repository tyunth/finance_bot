const API_BASE_URL = '/budzet'; 
const API_URL_TX = API_BASE_URL + '/transactions';
const API_URL_EDIT = API_BASE_URL + '/transactions/edit';
const API_URL_CATEGORIES = API_BASE_URL + '/categories';
const API_URL_BALANCES = API_BASE_URL + '/balances';
const API_URL_STUDENTS = API_BASE_URL + '/students';
const API_URL_STUDENT_ACTION = API_BASE_URL + '/students/action';
const API_URL_SHOPPING = API_BASE_URL + '/shopping';
const API_URL_SHOPPING_ACTION = API_BASE_URL + '/shopping/action';
// Коммуналка
const API_URL_UTILITIES = API_BASE_URL + '/utilities';
const API_URL_UTILITIES_ACTION = API_BASE_URL + '/utilities/action';

const CURRENCY = 'T';
const CALENDAR_EMBED_ID = 'polandszymon@gmail.com'; 

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
    
    if (tabName === 'calendar') loadCalendar();
    if (tabName === 'students') loadStudents();
    if (tabName === 'shopping') loadShoppingList();
    if (tabName === 'utilities') loadUtilities();
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
        loadDebts(); // Загружаем долги
        loadKPI();   // Загружаем счетчик уроков
        loadWeather();
        loadTodos();
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
function loadCalendar() {
    if (calendarLoaded) return;
    const iframe = document.getElementById('google-calendar-frame');
    if (iframe) {
        iframe.src = `https://calendar.google.com/calendar/embed?src=${CALENDAR_EMBED_ID}&ctz=Asia/Almaty&mode=WEEK`; 
        calendarLoaded = true;
    }
}

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
    const marketContainer = document.getElementById('list-market'); // НОВЫЙ
    const wishContainer = document.getElementById('list-wish');
    if (!buyContainer) return;

    buyContainer.innerHTML = '';
    if (marketContainer) marketContainer.innerHTML = '';
    wishContainer.innerHTML = '';

    const buyItems = list.filter(i => i.type === 'buy');
    const marketItems = list.filter(i => i.type === 'market'); // НОВЫЙ
    const wishItems = list.filter(i => i.type === 'wish');

    if (document.getElementById('count-buy')) document.getElementById('count-buy').textContent = buyItems.length;
    if (document.getElementById('count-market')) document.getElementById('count-market').textContent = marketItems.length;
    if (document.getElementById('count-wish')) document.getElementById('count-wish').textContent = wishItems.length;

    const createItemHTML = (item) => `
        <div class="bg-white rounded-xl p-3 shadow-sm border border-gray-100 flex justify-between items-center group hover:border-blue-300 transition cursor-move" data-id="${item.id}">
            <div class="flex items-center gap-3 overflow-hidden">
                <input type="checkbox" onchange="buyItem(${item.id})" class="w-5 h-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer flex-shrink-0">
                <div class="min-w-0">
                    <p class="font-medium text-gray-800 text-sm truncate leading-tight" title="${item.item_name}">${item.item_name}</p>
                    ${item.price_estimate ? `<p class="text-[10px] text-green-600 font-bold mt-0.5">~${formatCurrency(item.price_estimate)}</p>` : ''}
                </div>
            </div>
            <button onclick="deleteItem(${item.id})" class="text-gray-300 hover:text-red-500 p-1 opacity-0 group-hover:opacity-100 transition">✕</button>
        </div>
    `;

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
                body: JSON.stringify({ action: 'add', item_name: name, type: type, price_estimate: price || 0 })
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
    const modals = [document.getElementById('edit-modal'), document.getElementById('student-modal'), document.getElementById('stats-modal')];
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
    list.innerHTML = debts.map(d => `
        <div class="flex justify-between items-center bg-white p-2 rounded shadow-sm">
            <div>
                <span class="font-bold text-gray-800">${d.student_name}</span>
                <span class="text-sm text-gray-500">(${d.subject})</span>
                <div class="text-xs text-red-500">${new Date(d.date).toLocaleDateString('ru-RU')}</div>
            </div>
            <div class="flex items-center gap-3">
                <span class="font-bold text-gray-900">${formatCurrency(d.amount)}</span>
                <button onclick="payDebt(${d.id})" class="bg-green-100 text-green-700 px-3 py-1 rounded text-xs font-bold hover:bg-green-200">Оплатить</button>
            </div>
        </div>
    `).join('');
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

// --- ПОГОДА ---
async function loadWeather() {
    try {
        // Добавили precipitation_sum и precipitation_probability_max
        const url = 'https://api.open-meteo.com/v1/forecast?latitude=54.87&longitude=69.14&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max&timezone=auto';
        const res = await fetch(url);
        const data = await res.json();
        const today = data.daily;
        
        const tempMax = Math.round(today.temperature_2m_max[0]);
        const tempMin = Math.round(today.temperature_2m_min[0]);
        const precipSum = today.precipitation_sum[0];
        const precipProb = today.precipitation_probability_max[0];
        const code = today.weathercode[0];

        // Интерпретация кода погоды (упрощенно)
        let icon = '☁️';
        let desc = 'Облачно';
        if (code === 0) { icon = '☀️'; desc = 'Ясно'; }
        else if (code <= 3) { icon = '⛅'; desc = 'Облачно'; }
        else if (code <= 67) { icon = '🌧'; desc = 'Дождь'; }
        else if (code <= 77) { icon = '❄️'; desc = 'Снег'; }
        else { icon = '⛈'; desc = 'Гроза'; }

        document.getElementById('w-temp').textContent = `${tempMax > 0 ? '+' : ''}${tempMax}°`;
        document.getElementById('w-desc').textContent = `${desc} (${tempMin}..${tempMax})`;
        document.getElementById('w-icon').textContent = icon;

        // Логика зонта: если осадков > 0.5мм или вероятность > 40% и код дождя
        const needUmbrella = (precipSum > 0.5 || (precipProb > 40 && code > 50));
        const umbrellaEl = document.getElementById('w-umbrella');
        if (needUmbrella) {
            umbrellaEl.classList.remove('hidden');
            umbrellaEl.textContent = precipSum > 0 ? `☔ Осадки: ${precipSum}мм` : `☔ Возможен дождь (${precipProb}%)`;
        } else {
            umbrellaEl.classList.add('hidden');
        }

    } catch(e) { console.error('Ошибка погоды', e); }
}

// --- СПИСОК ДЕЛ ---
const todoForm = document.getElementById('todo-form');
if (todoForm) {
    todoForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.getElementById('todo-input');
        const text = input.value.trim();
        if(!text) return;
        try {
            await fetch(`${API_BASE_URL}/todos/action`, {
                method: 'POST', body: JSON.stringify({ action: 'add', text })
            });
            input.value = '';
            loadTodos();
        } catch(e) { alert('Ошибка'); }
    });
}

async function loadTodos() {
    try {
        const res = await fetch(`${API_BASE_URL}/todos`);
        const list = await res.json();
        const container = document.getElementById('todo-list');
        const countEl = document.getElementById('todo-count');
        if(countEl) countEl.textContent = list.filter(t => !t.is_done).length;

        container.innerHTML = list.map(t => `
            <div class="flex items-center justify-between group p-2 hover:bg-gray-100 rounded transition ${t.is_done ? 'opacity-50' : ''}">
                <div class="flex items-center gap-2 overflow-hidden">
                    <input type="checkbox" onchange="toggleTodo(${t.id}, ${t.is_done ? 0 : 1})" class="cursor-pointer" ${t.is_done ? 'checked' : ''}>
                    <span class="${t.is_done ? 'line-through text-gray-500' : 'text-gray-800'} truncate text-sm" title="${t.text}">${t.text}</span>
                </div>
                <button onclick="deleteTodo(${t.id})" class="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition px-1">✕</button>
            </div>
        `).join('') || '<div class="text-center text-xs text-gray-400 py-4">Список пуст</div>';
    } catch(e) {}
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
    ['urgent', 'medium', 'later'].forEach(f => {
        const btn = document.getElementById(`tf-${f}`);
        const labelMap = { urgent: 'Срочно', medium: 'Средне', later: 'Несрочно' }; // Для текста
        // ... (логика классов кнопок та же) ...
    });
    loadTodos();
}

// В todoForm добавляем отправку period
if (todoForm) {
    todoForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.getElementById('todo-input');
        const text = input.value.trim();
        if(!text) return;
        try {
            await fetch(`${API_BASE_URL}/todos/action`, {
                method: 'POST', body: JSON.stringify({ 
                    action: 'add', 
                    text, 
                    period: CURRENT_TODO_FILTER // Добавляем в текущую открытую вкладку
                })
            });
            input.value = '';
            loadTodos();
        } catch(e) { alert('Ошибка'); }
    });
}

// Обновленная функция загрузки
async function loadTodos() {
    try {
        const res = await fetch(`${API_BASE_URL}/todos`);
        const list = await res.json();
        const container = document.getElementById('todo-list');
        const countEl = document.getElementById('todo-count');
        
        // Фильтруем по текущей вкладке (если у задачи нет периода - считаем today)
        const filteredList = list.filter(t => (t.period || 'today') === CURRENT_TODO_FILTER);
        
        // Считаем активные ТОЛЬКО в текущей вкладке
        if(countEl) countEl.textContent = filteredList.filter(t => !t.is_done).length;

        container.innerHTML = filteredList.map(t => `
            <div class="flex items-center justify-between group p-2 hover:bg-gray-50 rounded-lg transition ${t.is_done ? 'opacity-50' : ''}">
                <div class="flex items-center gap-3 overflow-hidden">
                    <input type="checkbox" onchange="toggleTodo(${t.id}, ${t.is_done ? 0 : 1})" class="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer" ${t.is_done ? 'checked' : ''}>
                    <span class="${t.is_done ? 'line-through text-gray-400' : 'text-gray-700 font-medium'} truncate text-sm" title="${t.text}">${t.text}</span>
                </div>
                <button onclick="deleteTodo(${t.id})" class="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition px-1">✕</button>
            </div>
        `).join('') || '<div class="text-center text-xs text-gray-400 py-6">Пусто</div>';
    } catch(e) {}
}

init();
