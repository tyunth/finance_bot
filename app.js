const API_BASE_URL = '/budzet'; 
const API_URL_TX = API_BASE_URL + '/transactions';
const API_URL_EDIT = API_BASE_URL + '/transactions/edit';
const API_URL_CATEGORIES = API_BASE_URL + '/categories';
const API_URL_BALANCES = API_BASE_URL + '/balances';
const API_URL_STUDENTS = API_BASE_URL + '/students';
const API_URL_STUDENT_ACTION = API_BASE_URL + '/students/action';
const API_URL_CONFIG = API_BASE_URL + '/config'; // <-- НОВОЕ
const CURRENCY = 'T';
let CALENDAR_EMBED_ID = ''; // Пусто, заполним с сервера

let ALL_CATEGORIES = [];
let RAW_DATA = [];
let FILTERED_DATA = [];
let chartsInstance = {}; 
// Данные для переключения графиков
let CHART_DATA_CACHE = {}; 

function formatCurrency(amount) {
    return new Intl.NumberFormat('ru-RU').format(Math.round(amount)) + ' ' + CURRENCY;
}
function switchTab(tabName) {
    ['analytics', 'transactions', 'students', 'calendar'].forEach(t => { // <-- Добавил students, calendar
        document.getElementById(`tab-${t}`).classList.add('hidden');
        document.getElementById(`btn-${t}`).classList.remove('active');
    });
    document.getElementById(`tab-${tabName}`).classList.remove('hidden');
    document.getElementById(`btn-${tabName}`).classList.add('active');   
    // Ленивая загрузка календаря (чтобы не тормозил старт)
    if (tabName === 'calendar') loadCalendar();
    if (tabName === 'students') loadStudents();
}

async function init() {
    try {
        const [catRes, txRes, balRes, configRes] = await Promise.all([
        fetch(API_URL_CATEGORIES),
        fetch(API_URL_TX),
        fetch(API_URL_BALANCES),
        fetch(API_URL_CONFIG) // Запрос ID календаря
        ]);

        ALL_CATEGORIES = await catRes.json();
        RAW_DATA = await txRes.json();
        const balances = await balRes.json();
        const configData = await configRes.json();
        
        // Сохраняем ID календаря
        CALENDAR_EMBED_ID = configData.calendarId;
        // Заполняем фильтр категорий
        const filterSel = document.getElementById('filter-category');
        filterSel.innerHTML = '<option value="ALL">Все категории</option>';
        ALL_CATEGORIES.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c; opt.textContent = c;
            filterSel.appendChild(opt);
        });

        // Отображаем балансы (Депозиты)
        renderBalances(balances);

        document.getElementById('loading').style.display = 'none';
        document.getElementById('filter-panel').classList.remove('hidden');

        FILTERED_DATA = [...RAW_DATA];
        applyFilters(); 
        switchTab('analytics');

    } catch (e) {
        console.error(e);
        document.getElementById('loading').textContent = 'Ошибка загрузки данных';
    }
}

// НОВОЕ: Рендер балансов счетов
function renderBalances(balances) {
    const list = document.getElementById('deposit-list');
    if (!balances || Object.keys(balances).length === 0) {
        list.innerHTML = 'Нет счетов';
        return;
    }
    list.innerHTML = Object.entries(balances)
        .map(([name, val]) => {
            const color = val > 0 ? 'text-green-600' : (val < 0 ? 'text-red-500' : 'text-gray-500');
            return `<div class="flex justify-between"><span>${name}:</span> <span class="${color} font-bold">${formatCurrency(val)}</span></div>`;
        })
        .join('');
}

function applyFilters() {
    const startStr = document.getElementById('filter-date-start').value;
    const endStr = document.getElementById('filter-date-end').value;
    const catVal = document.getElementById('filter-category').value;
    const typeVal = document.getElementById('filter-type').value;

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
    
    const categoryMap = {};
    const monthMap = {}; 
    const dayOfWeekMap = [0,0,0,0,0,0,0]; // Вс-Пн
    const dayOfMonthMap = new Array(32).fill(0); // 1-31

    const catFrequency = {};
    const commentFrequency = {};

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
            }
        } else if (t.type === 'expense') {
            totalExpense += amount;
            monthMap[monthKey].expense += amount;
            
            const cat = t.category || 'Без категории';
            categoryMap[cat] = (categoryMap[cat] || 0) + amount;
            catFrequency[cat] = (catFrequency[cat] || 0) + 1;
            
            if (t.comment && t.comment.trim()) {
                const c = t.comment.trim();
                commentFrequency[c] = (commentFrequency[c] || 0) + 1;
            }

            dayOfWeekMap[dateObj.getDay()]++;
            dayOfMonthMap[dateObj.getDate()]++;
        }
    });

    // Сохраняем данные для переключения графиков
    CHART_DATA_CACHE = { dayOfWeekMap, dayOfMonthMap };

    document.getElementById('stat-income').textContent = formatCurrency(totalIncome);
    document.getElementById('stat-expense').textContent = formatCurrency(totalExpense);
    const balance = totalIncome - totalExpense;
    // Переименовали в Итого/Остаток
    document.getElementById('stat-balance').textContent = formatCurrency(balance);
    document.getElementById('stat-balance').className = `text-xl font-bold mt-1 ${balance >= 0 ? 'text-blue-600' : 'text-red-600'}`;

    // --- ГРАФИКИ ---

    // 1. Категории
    const groupedCategories = [];
    const groupedValues = [];
    let otherSum = 0;
    Object.entries(categoryMap).sort((a, b) => b[1] - a[1]).forEach(([cat, sum]) => {
        if (totalExpense > 0 && (sum / totalExpense) < 0.04) otherSum += sum;
        else { groupedCategories.push(cat); groupedValues.push(sum); }
    });
    if (otherSum > 0) { groupedCategories.push('Остальное'); groupedValues.push(otherSum); }

    const ctxCat = document.getElementById('chartCategories').getContext('2d');
    if (chartsInstance.cat) chartsInstance.cat.destroy();
    chartsInstance.cat = new Chart(ctxCat, {
        type: 'doughnut',
        data: {
            labels: groupedCategories,
            datasets: [{
                data: groupedValues,
                backgroundColor: ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#6366f1', '#14b8a6', '#94a3b8', '#64748b'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick: (e, elements) => {
                if (elements.length > 0) drillDownByCategory(groupedCategories[elements[0].index]);
            },
            plugins: { legend: { position: 'right', labels: { boxWidth: 12 } } }
        }
    });

    // 2. Активность (Сначала рисуем дефолтный - по дням недели)
    renderDayChart();

    // 3. Динамика
    const sortedMonths = Object.keys(monthMap).sort();
    const ctxMonth = document.getElementById('chartMonthly').getContext('2d');
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

    // --- СПИСКИ ---

    // Топ-10 Крупных
    const topExp = data.filter(t => t.type === 'expense').sort((a, b) => b.amount - a.amount).slice(0, 10);
    document.getElementById('top-expenses-list').innerHTML = topExp.map((t, i) => `
        <tr class="hover:bg-gray-50 transition border-b border-gray-100 last:border-0">
            <td class="px-4 py-2 text-xs text-gray-400 font-bold w-4">${i+1}.</td>
            <td class="px-2 py-2 font-medium text-gray-800">${t.category}</td>
            <td class="px-2 py-2 text-xs text-gray-500 hidden sm:table-cell truncate max-w-[100px]">${t.comment || ''}</td>
            <td class="px-2 py-2 font-bold text-gray-900 text-right">${formatCurrency(t.amount)}</td>
        </tr>
    `).join('');

    // Топ Частых
    const sortedFreqCat = Object.entries(catFrequency).sort((a, b) => b[1] - a[1]).slice(0, 5);
    document.getElementById('top-freq-cat-list').innerHTML = sortedFreqCat.map(([cat, count]) => `
        <tr class="hover:bg-gray-50 transition border-b border-gray-100 last:border-0">
            <td class="py-2 font-medium text-gray-800">${cat}</td>
            <td class="py-2 text-right font-semibold text-blue-600">${count}</td>
        </tr>
    `).join('');

    const sortedFreqComment = Object.entries(commentFrequency).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const commentListEl = document.getElementById('top-freq-comment-list');
    commentListEl.innerHTML = sortedFreqComment.length === 0 
        ? '<tr><td class="text-xs text-gray-400 py-2">Нет комментариев</td></tr>'
        : sortedFreqComment.map(([comm, count]) => `
            <tr class="hover:bg-gray-50 transition border-b border-gray-100 last:border-0">
                <td class="py-2 text-sm text-gray-700">"${comm}"</td>
                <td class="py-2 text-right font-semibold text-gray-500 text-xs">${count}</td>
            </tr>
        `).join('');
}

// НОВОЕ: Переключение графика активности
function renderDayChart() {
    const type = document.getElementById('chart-day-type').value;
    const ctx = document.getElementById('chartDays').getContext('2d');
    
    let labels, data;
    
    if (type === 'week') {
        // [Вс, Пн, Вт...] -> Сдвиг на Пн
        const d = CHART_DATA_CACHE.dayOfWeekMap;
        data = [d[1], d[2], d[3], d[4], d[5], d[6], d[0]];
        labels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    } else {
        // По числам (1-31)
        data = CHART_DATA_CACHE.dayOfMonthMap.slice(1); // убираем 0 индекс
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
    headerRow.innerHTML = '';
    body.innerHTML = '';

    // НОВЫЙ ПОРЯДОК: Коммент на 3 месте, Тег на 4
    const keys = [
        {k: 'date', label: 'Дата'}, 
        {k: 'category', label: 'Категория'}, 
        {k: 'comment', label: 'Комментарий'}, // <-- Подвинули сюда
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
                // Узкая колонка для коммента
                td.textContent = item.comment || '—';
                td.className += ' max-w-[200px] break-words leading-tight'; // Перенос строк
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

// Drill-Down функции
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
    document.getElementById('edit-id').value = item.id;
    document.getElementById('edit-amount').value = item.amount;
    document.getElementById('edit-comment').value = item.comment || '';
    document.getElementById('edit-tag').value = item.tag || ''; 
    
    const select = document.getElementById('edit-category');
    select.innerHTML = '';
    const cats = new Set([...ALL_CATEGORIES, item.category]);
    cats.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c; opt.textContent = c;
        select.appendChild(opt);
    });
    select.value = item.category;

    document.getElementById('edit-modal').classList.remove('hidden');
    document.getElementById('edit-modal').classList.add('flex');
}

function closeModal() {
    document.getElementById('edit-modal').classList.add('hidden');
    document.getElementById('edit-modal').classList.remove('flex');
}

let calendarLoaded = false;
function loadCalendar() {
    if (calendarLoaded) return;
    const iframe = document.getElementById('google-calendar-frame');
    // Вставь сюда реальный ID вместо заглушки, если переменная выше не работает
    iframe.src = `https://calendar.google.com/calendar/embed?src=${CALENDAR_EMBED_ID}&ctz=Asia/Almaty&mode=WEEK`; 
    calendarLoaded = true;
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
    if (students.length === 0) {
        grid.innerHTML = '<div class="col-span-3 text-center text-gray-500 py-10">Список пуст</div>';
        return;
    }
    
    grid.innerHTML = students.map(s => `
        <div class="card p-5 hover:shadow-md transition cursor-pointer group" onclick='openStudentModal(${JSON.stringify(s)})'>
            <div class="flex justify-between items-start mb-2">
                <h3 class="text-lg font-bold text-gray-900 group-hover:text-blue-600 transition">${s.name}</h3>
                <span class="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">${s.subject || '—'}</span>
            </div>
            <div class="text-sm text-gray-600 space-y-1">
                <p>🏫 ${s.school || '-'} (${s.grade || '-'})</p>
                <p>📞 ${s.phone || '-'}</p>
                <p>👨‍👩‍👧 ${s.parents || '-'}</p>
            </div>
        </div>
    `).join('');
}

function openStudentModal(s = null) {
    const modal = document.getElementById('student-modal');
    const form = document.getElementById('student-form');
    const delBtn = document.getElementById('btn-delete-student');
    
    form.reset();
    
    if (s) {
        document.getElementById('student-modal-title').textContent = 'Редактировать ученика';
        document.getElementById('student-id').value = s.id;
        document.getElementById('st-name').value = s.name;
        document.getElementById('st-subject').value = s.subject || '';
        document.getElementById('st-parents').value = s.parents || '';
        document.getElementById('st-phone').value = s.phone || '';
        document.getElementById('st-school').value = s.school || '';
        document.getElementById('st-grade').value = s.grade || '';
        document.getElementById('st-teacher').value = s.teacher || '';
        document.getElementById('st-address').value = s.address || '';
        document.getElementById('st-notes').value = s.notes || '';
        delBtn.classList.remove('hidden');
    } else {
        document.getElementById('student-modal-title').textContent = 'Новый ученик';
        document.getElementById('student-id').value = '';
        delBtn.classList.add('hidden');
    }
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeStudentModal() {
    document.getElementById('student-modal').classList.add('hidden');
    document.getElementById('student-modal').classList.remove('flex');
}

document.getElementById('student-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('student-id').value;
    const action = id ? 'edit' : 'add';
    
    const payload = {
        action, id,
        name: document.getElementById('st-name').value,
        subject: document.getElementById('st-subject').value,
        parents: document.getElementById('st-parents').value,
        phone: document.getElementById('st-phone').value,
        school: document.getElementById('st-school').value,
        grade: document.getElementById('st-grade').value,
        teacher: document.getElementById('st-teacher').value,
        address: document.getElementById('st-address').value,
        notes: document.getElementById('st-notes').value,
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

document.getElementById('edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-id').value;
    const amount = parseFloat(document.getElementById('edit-amount').value);
    const category = document.getElementById('edit-category').value;
    const comment = document.getElementById('edit-comment').value;
    const tag = document.getElementById('edit-tag').value; 

    try {
        await fetch(API_URL_EDIT, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({id, amount, category, comment, tag})
        });
        closeModal();
        init();
    } catch(e) { alert('Ошибка сети'); }
});

init();
