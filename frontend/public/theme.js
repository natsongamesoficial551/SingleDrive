
      (function() {
        const saved = localStorage.getItem('singledrive:theme');
        const theme = saved === 'light' || saved === 'dark' ? saved : 'light';
        if (theme === 'dark') {
          document.documentElement.classList.add('dark');
          document.documentElement.classList.remove('light');
        } else {
          document.documentElement.classList.add('light');
          document.documentElement.classList.remove('dark');
        }
      })();
