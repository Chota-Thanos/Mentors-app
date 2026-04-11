const fs = require('fs');
let content = fs.readFileSync('supa_frontend/src/components/ai/AIUserStudio.tsx', 'utf8');

// Add dark variants for sky skies and grays used in conversational blocks
content = content
  .replace(/\bbg-sky-50\/50\b(?!\s*dark:bg-)/g, 'bg-sky-50/50 dark:bg-sky-900/40')
  .replace(/\bbg-sky-50\/70\b(?!\s*dark:bg-)/g, 'bg-sky-50/70 dark:bg-sky-900/60')
  .replace(/\bbg-sky-100\/60\b(?!\s*dark:bg-)/g, 'bg-sky-100/60 dark:bg-sky-800/40')
  .replace(/\bbg-sky-50\b(?!\/)(?!\s*dark:bg-)/g, 'bg-sky-50 dark:bg-sky-950')
  .replace(/\bbg-sky-100\b(?!\/)(?!\s*dark:bg-)/g, 'bg-sky-100 dark:bg-sky-900')
  .replace(/\bborder-sky-200\b(?!\s*dark:border-)/g, 'border-sky-200 dark:border-sky-800')
  .replace(/\bborder-sky-300\b(?!\s*dark:border-)/g, 'border-sky-300 dark:border-sky-700')
  .replace(/\btext-gray-900\b(?!\s*dark:text-)/g, 'text-gray-900 dark:text-gray-100')
  .replace(/\btext-gray-800\b(?!\s*dark:text-)/g, 'text-gray-800 dark:text-gray-300')
  .replace(/\btext-gray-700\b(?!\s*dark:text-)/g, 'text-gray-700 dark:text-gray-300')
  .replace(/\btext-gray-600\b(?!\s*dark:text-)/g, 'text-gray-600 dark:text-gray-400')
  .replace(/\btext-\[\#182033\]\b(?!\s*dark:text-)/g, 'text-[#182033] dark:text-gray-200')
  .replace(/\btext-\[\#334155\]\b(?!\s*dark:text-)/g, 'text-[#334155] dark:text-slate-300')
  .replace(/\bbg-white\b(?!\s*dark:bg-)/g, 'bg-white dark:bg-[#0b1120]');

content = content.replace(/<textarea([^>]*?)>/g, (match, p1) => {
    if (!p1.includes('dark:text-')) {
        return '<textarea' + p1.replace('className="', 'className="dark:text-white ') + '>';
    }
    return match;
});
content = content.replace(/<input([^>]*?)>/g, (match, p1) => {
    if (p1.includes('type="text"') || p1.includes('value={') || p1.includes('placeholder=')) {
        if (!p1.includes('dark:text-') && p1.includes('className="')) {
            return '<input' + p1.replace('className="', 'className="dark:text-white ') + '>';
        }
    }
    return match;
});

fs.writeFileSync('supa_frontend/src/components/ai/AIUserStudio.tsx', content, 'utf8');
