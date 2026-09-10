/* PetSite UI behaviour: colour theme and the nav that hides on scroll down. */
(function () {
    'use strict';

    var THEME_KEY = 'petsite.theme';

    // ---------- theme ----------

    function apply(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        // Bootstrap 5.3 keys its own semantic colours (alerts, badges, tables) off
        // data-bs-theme; without this they stay light and vanish on a dark page.
        document.documentElement.setAttribute('data-bs-theme', theme);
        var icon = document.getElementById('ps-theme-icon');
        if (icon) {
            icon.innerHTML = theme === 'dark'
                ? '<path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"/>'
                : '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2' +
                  'M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6"/>';
        }
        var btn = document.getElementById('ps-theme');
        if (btn) {
            var next = theme === 'dark' ? 'light' : 'dark';
            btn.setAttribute('title', 'Switch to ' + next + ' mode');
            btn.setAttribute('aria-label', 'Switch to ' + next + ' mode');
        }
    }

    function stored() {
        try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
    }

    // Saved choice wins, otherwise follow the operating system.
    function initial() {
        var saved = stored();
        if (saved === 'dark' || saved === 'light') return saved;
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    apply(initial());

    document.addEventListener('DOMContentLoaded', function () {
        apply(document.documentElement.getAttribute('data-theme') || 'light');

        var toggle = document.getElementById('ps-theme');
        if (toggle) {
            toggle.addEventListener('click', function () {
                var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
                apply(next);
                try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* private mode */ }
            });
        }

        // Follow the OS while the visitor has not made an explicit choice.
        if (window.matchMedia) {
            var mq = window.matchMedia('(prefers-color-scheme: dark)');
            var onChange = function (e) { if (!stored()) apply(e.matches ? 'dark' : 'light'); };
            if (mq.addEventListener) { mq.addEventListener('change', onChange); }
            else if (mq.addListener) { mq.addListener(onChange); }
        }

        // ---------- nav hides on the way down, returns on the way up ----------
        var bar = document.getElementById('ps-topbar');
        if (!bar) return;
        var last = window.scrollY;
        var ticking = false;

        function update() {
            var y = window.scrollY;
            bar.classList.toggle('ps-stuck', y > 8);
            // ignore small jitter, and never hide near the top of the page
            if (Math.abs(y - last) > 6) {
                bar.classList.toggle('ps-hidden', y > last && y > 110);
                last = y;
            }
            ticking = false;
        }

        window.addEventListener('scroll', function () {
            if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
        }, { passive: true });
        update();
    });
})();
