/**
 * 计数器应用 - 主逻辑
 * 支持增/减/归零操作，带颜色变化与进度条动画
 */

(function () {
    'use strict';

    // ===== DOM 引用 =====
    const counterEl = document.getElementById('counter');
    const progressFill = document.getElementById('progressFill');
    const incrementBtn = document.getElementById('incrementBtn');
    const decrementBtn = document.getElementById('decrementBtn');
    const resetBtn = document.getElementById('resetBtn');

    // ===== 状态 =====
    const MIN = -100;
    const MAX = 100;
    let count = 0;

    // ===== 工具函数 =====
    function clamp(value, min, min2) {
        // 相当于 Math.min(Math.max(value, min), min2)
        if (value < min) return min;
        if (value > min2) return min2;
        return value;
    }

    function getProgressPercent(value) {
        // 将 [-100, 100] 映射到 [0%, 100%]
        return ((value - MIN) / (MAX - MIN)) * 100;
    }

    function updateColor(value) {
        // 移除旧的状态类
        counterEl.classList.remove('positive', 'negative', 'zero');

        if (value > 0) {
            counterEl.classList.add('positive');
        } else if (value < 0) {
            counterEl.classList.add('negative');
        } else {
            counterEl.classList.add('zero');
        }
    }

    // ===== 更新界面 =====
    function updateDisplay(newValue) {
        count = newValue;

        // 更新数字显示（带轻微动画效果）
        counterEl.textContent = count;

        // 更新颜色
        updateColor(count);

        // 更新进度条
        const percent = getProgressPercent(count);
        progressFill.style.width = `${percent}%`;

        // 根据数值调整进度条颜色
        if (count > 0) {
            progressFill.style.background = 'linear-gradient(90deg, #667eea, #10b981)';
        } else if (count < 0) {
            progressFill.style.background = 'linear-gradient(90deg, #667eea, #ef4444)';
        } else {
            progressFill.style.background = 'linear-gradient(90deg, #667eea, #764ba2)';
        }
    }

    // ===== 操作函数 =====
    function increment() {
        if (count < MAX) {
            updateDisplay(count + 1);
        } else {
            // 达到上限时轻微反馈
            counterEl.style.transform = 'scale(1.05)';
            setTimeout(() => {
                counterEl.style.transform = 'scale(1)';
            }, 150);
        }
    }

    function decrement() {
        if (count > MIN) {
            updateDisplay(count - 1);
        } else {
            // 达到下限时轻微反馈
            counterEl.style.transform = 'scale(0.95)';
            setTimeout(() => {
                counterEl.style.transform = 'scale(1)';
            }, 150);
        }
    }

    function reset() {
        updateDisplay(0);
        // 重置时的弹跳动画
        counterEl.style.transition = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
        counterEl.style.transform = 'scale(1.2)';
        setTimeout(() => {
            counterEl.style.transform = 'scale(1)';
            setTimeout(() => {
                counterEl.style.transition = 'color 0.3s ease';
            }, 300);
        }, 150);
    }

    // ===== 键盘支持 =====
    function handleKeyboard(e) {
        // 防止在输入框中触发
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        switch (e.key) {
            case '+':
            case '=':
                e.preventDefault();
                increment();
                break;
            case '-':
            case '_':
                e.preventDefault();
                decrement();
                break;
            case 'r':
            case 'R':
                e.preventDefault();
                reset();
                break;
        }
    }

    // ===== 事件绑定 =====
    incrementBtn.addEventListener('click', increment);
    decrementBtn.addEventListener('click', decrement);
    resetBtn.addEventListener('click', reset);
    document.addEventListener('keydown', handleKeyboard);

    // ===== 初始化 =====
    updateDisplay(0);

    // 控制台友好提示
    console.log('🔢 计数器已启动！');
    console.log('可用操作：+ / - / R (键盘快捷键)');
})();
