(() => {
    const buttons = document.querySelectorAll('.theme-toggle');
    const root = document.documentElement;
    const updateLabels = () => {
        const label = root.dataset.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
        buttons.forEach(button => {
            button.setAttribute('aria-label', label);
            button.title = label;
        });
    };
    buttons.forEach(button => button.addEventListener('click', () => {
        const theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
        root.dataset.theme = theme;
        try { localStorage.setItem('pref-theme', theme); } catch (_) { /* Still toggle when storage is unavailable. */ }
        updateLabels();
    }));
    updateLabels();
})();
