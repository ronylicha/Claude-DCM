export function ThemeScript() {
  const themeScript = `
    (function() {
      try {
        const savedTheme = localStorage.getItem('theme');
        if (!savedTheme || savedTheme === 'dark') {
          document.documentElement.classList.add('dark');
        }
      } catch (e) {}
    })();
  `;

  return (
    <script
      dangerouslySetInnerHTML={{ __html: themeScript }}
      suppressHydrationWarning
    />
  );
}
