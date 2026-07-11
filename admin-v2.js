const adminV2 = (() => {
    const COL_SHIFTS = 'shifts';
    const COL_CLOSED = 'closedDays';
    const COL_SETTINGS = 'settings';
    const AUTH_KEY = 'shift_admin_authed';
    const STAFF_COUNT_KEY = 'shift_staff_count';
    const DEFAULT_PIN = '1234';
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];

    const state = {
        yearMonth: '',
        half: 'all',
        submissions: [],
        closedDays: [],
        assignments: {},
        holidays: {},
        loading: false
    };

    const $ = (id) => document.getElementById(id);
    const assignmentDocId = (yearMonth, half) => `assigned_${yearMonth}_${half}`;
    const getStaffCount = () => parseInt(localStorage.getItem(STAFF_COUNT_KEY) || '0', 10);
    const setStaffCount = (n) => localStorage.setItem(STAFF_COUNT_KEY, String(n));

    const isAuthed = () => sessionStorage.getItem(AUTH_KEY) === '1';
    const setAuthed = () => sessionStorage.setItem(AUTH_KEY, '1');
    const clearAuth = () => sessionStorage.removeItem(AUTH_KEY);

    const getPin = async () => {
        const snap = await db.collection(COL_SETTINGS).doc('adminPin').get();
        return snap.exists ? (snap.data().pin || DEFAULT_PIN) : DEFAULT_PIN;
    };

    const savePin = (pin) => db.collection(COL_SETTINGS).doc('adminPin').set({ pin });

    const loadHolidays = async () => {
        try {
            const res = await fetch('https://holidays-jp.github.io/api/v1/date.json');
            if (res.ok) state.holidays = await res.json();
        } catch (_) {
            state.holidays = {};
        }
    };

    const isHoliday = (year, month, day) =>
        !!state.holidays[`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`];

    const normalizeAssignments = (items) =>
        [...(items || [])]
            .filter(item => item && item.name)
            .sort((a, b) => {
                const timeCompare = String(a.startTime || '').localeCompare(String(b.startTime || ''));
                return timeCompare || String(a.name || '').localeCompare(String(b.name || ''), 'ja');
            });

    const saveAssignments = async (day, items) => {
        const cleaned = normalizeAssignments(items).map(item => ({
            name: String(item.name).trim(),
            startTime: String(item.startTime || '17:30').trim()
        }));

        await db.collection(COL_SETTINGS).doc(assignmentDocId(state.yearMonth, state.half)).set({
            targetMonth: state.yearMonth,
            targetHalf: state.half,
            [`days.${day}`]: cleaned,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    };

    const loadData = async () => {
        state.yearMonth = $('filter-month').value;
        state.half = $('filter-half').value;

        if (!state.yearMonth || state.half === 'all') {
            state.submissions = [];
            state.closedDays = [];
            state.assignments = {};
            render();
            return;
        }

        state.loading = true;
        render();

        const [shiftSnap, closedSnap, assignedSnap] = await Promise.all([
            db.collection(COL_SHIFTS)
                .where('targetMonth', '==', state.yearMonth)
                .where('targetHalf', '==', state.half)
                .get(),
            db.collection(COL_CLOSED).doc(state.yearMonth).get(),
            db.collection(COL_SETTINGS).doc(assignmentDocId(state.yearMonth, state.half)).get()
        ]);

        state.submissions = shiftSnap.docs.map(doc => doc.data());
        state.closedDays = closedSnap.exists ? (closedSnap.data().days || []) : [];
        state.assignments = assignedSnap.exists ? (assignedSnap.data().days || {}) : {};
        state.loading = false;
        render();
    };

    const getAvailableForDay = (month, day, dow, holiday) => {
        const dateLabel = `${month}/${day}`;
        const earlyDay = dow === 5 || dow === 6 || dow === 0 || holiday;

        return state.submissions
            .map(sub => {
                let available = false;
                let workTime = '17:30';

                if (sub.shiftType === 'all') {
                    available = true;
                    if (earlyDay) workTime = sub.allDaysWeekendTime || '17:30';
                } else {
                    const match = (sub.dates || []).find(item => item.dateLabel === dateLabel);
                    if (match) {
                        available = true;
                        workTime = match.time || '17:30';
                    }
                }

                return available ? { name: sub.name, workTime, submission: sub } : null;
            })
            .filter(Boolean)
            .sort((a, b) => {
                const timeCompare = String(a.workTime).localeCompare(String(b.workTime));
                return timeCompare || String(a.name).localeCompare(String(b.name), 'ja');
            });
    };

    const getAssignableTimes = (workTime, dow) => {
        if ((dow === 5 || dow === 6 || dow === 0) && workTime === '16:30') {
            return ['16:30', '17:30'];
        }
        return [workTime || '17:30'];
    };

    const staffingHint = (dow, holiday) =>
        (dow === 5 || dow === 6 || dow === 0 || holiday)
            ? '目安 16:30×1 / 17:30×1'
            : '目安 17:30×2';

    const renderStats = () => {
        const staffCount = getStaffCount();
        const canWork = state.submissions.filter(sub =>
            sub.shiftType === 'all' || (sub.dates && sub.dates.length > 0)
        ).length;
        const wantRest = state.submissions.filter(sub =>
            sub.shiftType === 'specific' && (!sub.dates || sub.dates.length === 0)
        ).length;

        $('stat-submitted').textContent = state.submissions.length;
        $('stat-not-yet').textContent = staffCount ? Math.max(0, staffCount - state.submissions.length) : '—';
        $('stat-can-work').textContent = canWork;
        $('stat-want-rest').textContent = wantRest;
        $('stat-closed').textContent = state.closedDays.length;
    };

    const renderSubmissions = () => {
        const section = $('submissions-list-section');
        const list = $('submissions-list');
        list.innerHTML = '';
        section.style.display = state.submissions.length ? 'block' : 'none';

        [...state.submissions]
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ja'))
            .forEach(sub => {
                const row = document.createElement('button');
                row.type = 'button';
                row.className = 'submission-row';
                row.dataset.action = 'detail';
                row.dataset.name = sub.name || '';
                row.innerHTML = `
                    <div class="submission-name">${sub.name || ''}</div>
                    <div class="submission-meta">
                        <span class="sub-type-badge">${sub.shiftType === 'all' ? `全日（土日祝: ${sub.allDaysWeekendTime || '17:30'}〜）` : `個別 ${(sub.dates || []).length}日`}</span>
                        ${sub.notes ? '<span class="sub-notes-badge">備考あり</span>' : ''}
                    </div>
                `;
                list.appendChild(row);
            });
    };

    const renderCalendar = () => {
        const header = $('calendar-header');
        const grid = $('calendar-grid');
        const noData = $('no-data');
        header.innerHTML = '';
        grid.innerHTML = '';

        dayNames.forEach(name => {
            const div = document.createElement('div');
            div.textContent = name;
            header.appendChild(div);
        });

        if (!state.yearMonth || state.half === 'all') {
            header.style.display = 'none';
            grid.style.display = 'none';
            noData.classList.remove('hidden');
            noData.textContent = '月と期間（前半または後半）を選択してください。';
            return;
        }

        header.style.display = '';
        grid.style.display = 'grid';
        noData.classList.add('hidden');

        const [yearStr, monthStr] = state.yearMonth.split('-');
        const year = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);
        const daysInMonth = new Date(year, month, 0).getDate();
        const firstDow = new Date(year, month - 1, 1).getDay();
        const startDay = state.half === 'first' ? 1 : 16;
        const endDay = state.half === 'first' ? 15 : daysInMonth;

        for (let blank = 0; blank < firstDow; blank++) {
            const cell = document.createElement('div');
            cell.className = 'calendar-cell out-of-range';
            grid.appendChild(cell);
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const dow = (firstDow + day - 1) % 7;
            const holiday = isHoliday(year, month, day);
            const closed = state.closedDays.includes(day);
            const outOfRange = day < startDay || day > endDay;
            const wed = dow === 3;
            const assigned = normalizeAssignments(state.assignments[day]);
            const assignedNames = new Set(assigned.map(item => item.name));
            const cell = document.createElement('div');
            cell.className = 'calendar-cell';
            if (outOfRange) cell.classList.add('out-of-range');
            if (wed) cell.classList.add('cell-teikyu');
            if (closed) cell.classList.add('cell-kyugyo');

            const date = document.createElement('div');
            date.className = 'cell-date';
            if (dow === 0 || holiday) date.classList.add('sun');
            if (dow === 6) date.classList.add('sat');
            if (wed) date.classList.add('wed');
            date.textContent = `${month}/${day}(${dayNames[dow]})`;
            cell.appendChild(date);

            if (!outOfRange && wed) {
                const tag = document.createElement('div');
                tag.className = 'day-tag-cell teikyu';
                tag.textContent = '定休日';
                cell.appendChild(tag);
            } else if (!outOfRange && closed) {
                const tag = document.createElement('button');
                tag.type = 'button';
                tag.className = 'day-tag-cell kyugyo';
                tag.dataset.action = 'open-day';
                tag.dataset.day = String(day);
                tag.textContent = '休業日 ✕';
                cell.appendChild(tag);
            } else if (!outOfRange) {
                const assignBox = document.createElement('div');
                assignBox.className = 'assignment-box';
                assignBox.innerHTML = `<div class="assignment-title">確定 <span>${staffingHint(dow, holiday)}</span></div>`;

                if (assigned.length) {
                    assigned.forEach((item, index) => {
                        const row = document.createElement('div');
                        row.className = 'assignment-row';
                        row.innerHTML = `
                            <input class="assignment-time" type="time" value="${item.startTime || '17:30'}" data-action="time" data-day="${day}" data-index="${index}">
                            <span class="assignment-name">${item.name}</span>
                            <button type="button" class="assignment-remove" data-action="remove" data-day="${day}" data-index="${index}" title="確定から外す">×</button>
                        `;
                        assignBox.appendChild(row);
                    });
                } else {
                    const empty = document.createElement('div');
                    empty.className = 'assignment-empty';
                    empty.textContent = '未確定';
                    assignBox.appendChild(empty);
                }

                const candidates = document.createElement('div');
                candidates.className = 'cell-shifts';
                getAvailableForDay(month, day, dow, holiday).forEach(item => {
                    const option = document.createElement('div');
                    option.className = 'candidate-option';
                    const times = getAssignableTimes(item.workTime, dow);
                    option.innerHTML = `<div class="candidate-name">${assignedNames.has(item.name) ? `${item.name} 採用済` : item.name}</div>`;
                    const row = document.createElement('div');
                    row.className = 'candidate-time-row';
                    times.forEach(time => {
                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.className = 'shift-badge candidate-badge';
                        btn.dataset.action = 'assign';
                        btn.dataset.day = String(day);
                        btn.dataset.name = item.name;
                        btn.dataset.time = time;
                        btn.disabled = assignedNames.has(item.name);
                        btn.textContent = assignedNames.has(item.name) ? '採用済み' : `＋${time}`;
                        row.appendChild(btn);
                    });
                    option.appendChild(row);
                    candidates.appendChild(option);
                });

                cell.appendChild(assignBox);
                cell.appendChild(candidates);

                const closeBtn = document.createElement('button');
                closeBtn.type = 'button';
                closeBtn.className = 'day-close-btn';
                closeBtn.dataset.action = 'close-day';
                closeBtn.dataset.day = String(day);
                closeBtn.textContent = '休業日にする';
                cell.appendChild(closeBtn);
            }

            grid.appendChild(cell);
        }
    };

    const render = () => {
        renderStats();
        renderSubmissions();
        renderCalendar();
    };

    const assignCandidate = async (button) => {
        const day = button.dataset.day;
        const name = button.dataset.name;
        const time = button.dataset.time;
        if (!day || !name || !time || button.disabled) return;

        const current = normalizeAssignments(state.assignments[day]);
        if (current.some(item => item.name === name)) return;

        button.disabled = true;
        button.textContent = '保存中';
        const next = [...current, { name, startTime: time }];
        state.assignments = { ...state.assignments, [day]: next };
        render();
        await saveAssignments(day, next);
        await loadData();
    };

    const removeAssignment = async (button) => {
        const day = button.dataset.day;
        const index = parseInt(button.dataset.index || '-1', 10);
        const current = normalizeAssignments(state.assignments[day]);
        if (!day || index < 0 || index >= current.length) return;
        const next = current.filter((_, i) => i !== index);
        state.assignments = { ...state.assignments, [day]: next };
        render();
        await saveAssignments(day, next);
        await loadData();
    };

    const updateTime = async (input) => {
        const day = input.dataset.day;
        const index = parseInt(input.dataset.index || '-1', 10);
        const current = normalizeAssignments(state.assignments[day]);
        if (!day || index < 0 || index >= current.length) return;
        current[index] = { ...current[index], startTime: input.value || '17:30' };
        state.assignments = { ...state.assignments, [day]: current };
        await saveAssignments(day, current);
        await loadData();
    };

    const toggleClosedDay = async (day) => {
        const dayNum = parseInt(day, 10);
        const next = [...state.closedDays];
        const index = next.indexOf(dayNum);
        if (index >= 0) next.splice(index, 1);
        else next.push(dayNum);
        next.sort((a, b) => a - b);
        state.closedDays = next;
        render();
        await db.collection(COL_CLOSED).doc(state.yearMonth).set({ days: next });
        await loadData();
    };

    const showDetail = (name) => {
        const sub = state.submissions.find(item => item.name === name);
        if (!sub) return;
        $('modal-title').textContent = sub.name;
        const dates = (sub.dates || []).map(item => `${item.dateLabel}(${item.time})`).join('　') || '全日出勤可能';
        $('modal-body').innerHTML = `
            <div class="modal-row"><span class="modal-label">提出内容</span><span class="modal-value">${sub.shiftType === 'all' ? '全日出勤可能' : dates}</span></div>
            <div class="modal-row"><span class="modal-label">備考</span><span class="modal-value">${sub.notes || 'なし'}</span></div>
        `;
        $('detail-modal').classList.remove('hidden');
    };

    const handleAction = async (event) => {
        const target = event.target.closest('[data-action]');
        if (!target) return;

        const action = target.dataset.action;
        if (action !== 'time') {
            event.preventDefault();
            event.stopPropagation();
        }

        try {
            if (action === 'assign') await assignCandidate(target);
            if (action === 'remove') await removeAssignment(target);
            if (action === 'close-day' && confirm('この日を休業日にしますか？')) await toggleClosedDay(target.dataset.day);
            if (action === 'open-day' && confirm('休業日を解除しますか？')) await toggleClosedDay(target.dataset.day);
            if (action === 'detail') showDetail(target.dataset.name);
        } catch (err) {
            alert('保存に失敗しました。\n' + err.message);
            await loadData();
        }
    };

    const exportImage = async (half) => {
        const previousHalf = $('filter-half').value;
        $('filter-half').value = half;
        await loadData();

        const [yearStr, monthStr] = state.yearMonth.split('-');
        const year = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);
        const daysInMonth = new Date(year, month, 0).getDate();
        const start = half === 'first' ? 1 : 16;
        const end = half === 'first' ? 15 : daysInMonth;
        const rows = [];

        for (let day = start; day <= end; day++) {
            const dow = new Date(year, month - 1, day).getDay();
            if (dow === 3 || state.closedDays.includes(day)) continue;
            rows.push({
                label: `${month}/${day}(${dayNames[dow]})`,
                items: normalizeAssignments(state.assignments[day])
            });
        }

        const scale = 2;
        const width = 1080;
        const rowHeight = 88;
        const height = 150 + rows.length * rowHeight + 40;
        const canvas = document.createElement('canvas');
        canvas.width = width * scale;
        canvas.height = height * scale;
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#1B5E20';
        ctx.font = 'bold 40px sans-serif';
        ctx.fillText(`${month}月 ${half === 'first' ? '前半' : '後半'} シフト表`, 40, 70);
        ctx.font = '22px sans-serif';
        ctx.fillStyle = '#607d8b';
        ctx.fillText('確定シフトのみ表示', 40, 108);

        rows.forEach((row, index) => {
            const y = 150 + index * rowHeight;
            ctx.fillStyle = index % 2 ? '#f7fff8' : '#f1f8e9';
            ctx.fillRect(30, y - 42, width - 60, rowHeight - 8);
            ctx.fillStyle = '#263238';
            ctx.font = 'bold 24px sans-serif';
            ctx.fillText(row.label, 52, y);
            ctx.font = '26px sans-serif';
            const text = row.items.length
                ? row.items.map(item => `${item.startTime} ${item.name}`).join(' / ')
                : '未確定';
            ctx.fillText(text, 240, y);
        });

        const link = document.createElement('a');
        link.download = `${state.yearMonth}_${half}_shift.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();

        $('filter-half').value = previousHalf;
        await loadData();
    };

    const setupAuth = async () => {
        const overlay = $('pin-overlay');
        const content = $('admin-content');
        const dots = [...document.querySelectorAll('#pin-dots span')];
        const error = $('pin-error');
        let pin = '';

        const unlock = async () => {
            overlay.classList.add('hidden');
            content.classList.remove('hidden');
            await loadHolidays();
            await loadData();
        };

        if (isAuthed()) {
            await unlock();
            return;
        }

        document.querySelectorAll('.key-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const value = btn.dataset.val;
                if (value === 'clear') pin = '';
                else if (value === 'del') pin = pin.slice(0, -1);
                else if (pin.length < 4) pin += value;

                dots.forEach((dot, index) => dot.classList.toggle('filled', index < pin.length));
                error.textContent = '';

                if (pin.length === 4) {
                    if (pin === await getPin()) {
                        setAuthed();
                        await unlock();
                    } else {
                        error.textContent = 'PINが違います';
                        pin = '';
                        dots.forEach(dot => dot.classList.remove('filled'));
                    }
                }
            });
        });
    };

    const init = async () => {
        const today = new Date();
        let month = today.getMonth() + 2;
        let year = today.getFullYear();
        if (month > 12) {
            month = 1;
            year++;
        }
        $('filter-month').value = `${year}-${String(month).padStart(2, '0')}`;

        document.addEventListener('click', handleAction, true);
        $('filter-month').addEventListener('change', loadData);
        $('filter-half').addEventListener('change', loadData);
        $('export-first-btn').addEventListener('click', () => exportImage('first'));
        $('export-second-btn').addEventListener('click', () => exportImage('second'));
        $('logout-btn').addEventListener('click', () => {
            clearAuth();
            location.reload();
        });
        $('set-staff-count-btn').addEventListener('click', () => {
            const value = parseInt(prompt('スタッフ総数を入力してください') || '0', 10);
            if (!Number.isNaN(value) && value >= 0) {
                setStaffCount(value);
                render();
            }
        });
        $('change-pin-btn').addEventListener('click', async () => {
            const pin = prompt('新しい4桁のPINを入力してください');
            if (!/^\d{4}$/.test(pin || '')) {
                alert('4桁の数字で入力してください。');
                return;
            }
            await savePin(pin);
            alert('PINを変更しました。');
        });
        $('modal-close').addEventListener('click', () => $('detail-modal').classList.add('hidden'));
        $('detail-modal').addEventListener('click', (event) => {
            if (event.target.id === 'detail-modal') $('detail-modal').classList.add('hidden');
        });
        document.addEventListener('change', (event) => {
            if (event.target.dataset.action === 'time') updateTime(event.target);
        });

        await setupAuth();
    };

    return { init };
})();
