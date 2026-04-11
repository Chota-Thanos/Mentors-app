const fs = require('fs');
const path = require('path');

const filesToProcess = [
  path.resolve('supa_frontend/src/app/page.tsx'),
  path.resolve('supa_frontend/src/components/ai/AIUserStudio.tsx')
];

for (const file of filesToProcess) {
  if (!fs.existsSync(file)) continue;
  let content = fs.readFileSync(file, 'utf8');

  // Step 1: Align AIUserStudio to home colors
  if (file.includes('AIUserStudio')) {
    content = content
      .replace(/\btext-slate-900\b/g, 'text-[#141b2d]')
      .replace(/\btext-slate-800\b/g, 'text-[#1c263c]')
      .replace(/\btext-slate-700\b/g, 'text-[#334155]') // Keep legible or tweak
      .replace(/\btext-slate-600\b/g, 'text-[#636b86]')
      .replace(/\btext-slate-500\b/g, 'text-[#6c7590]')
      .replace(/\btext-slate-400\b/g, 'text-[#94a3b8]')
      .replace(/\bbg-slate-50\b/g, 'bg-[#f8faff]')
      .replace(/\bbg-slate-100\b/g, 'bg-[#eef4ff]')
      .replace(/\bborder-slate-200\b/g, 'border-[#dce3fb]')
      .replace(/\bborder-slate-300\b/g, 'border-[#c9d6fb]');
  }

  // Step 2: Add dark mode variants carefully 
  const replacements = [
    { target: /\bbg-white(?! dark:bg-)/g, rep: 'bg-white dark:bg-[#0b1120] dark:border-[#1e2a4a]' },
    { target: /\btext-\[\#141b2d\](?! dark:text-)/g, rep: 'text-[#141b2d] dark:text-white' },
    { target: /\btext-\[\#1235ae\](?! dark:text-)/g, rep: 'text-[#1235ae] dark:text-[#a5bdf8]' },
    { target: /\btext-\[\#636b86\](?! dark:text-)/g, rep: 'text-[#636b86] dark:text-[#94a3b8]' },
    { target: /\btext-\[\#6c7590\](?! dark:text-)/g, rep: 'text-[#6c7590] dark:text-[#94a3b8]' },
    { target: /\btext-\[\#173aa9\](?! dark:text-)/g, rep: 'text-[#173aa9] dark:text-[#8ea9ff]' },
    { target: /\bborder-\[\#dce3fb\](?! dark:border-)/g, rep: 'border-[#dce3fb] dark:border-[#1e2a4a]' },
    { target: /\bbg-\[\#f8faff\](?! dark:bg-)/g, rep: 'bg-[#f8faff] dark:bg-[#0f172a]' },
    { target: /\bbg-\[\#eef4ff\](?! dark:bg-)/g, rep: 'bg-[#eef4ff] dark:bg-[#16213e]' },
    { target: /\bborder-\[\#cdd8f4\](?! dark:border-)/g, rep: 'border-[#cdd8f4] dark:border-[#2a3c6b]' },
    { target: /\btext-\[\#17328f\](?! dark:text-)/g, rep: 'text-[#17328f] dark:text-[#9bb5ff]' },
    { target: /\bborder-\[\#c9d6fb\](?! dark:border-)/g, rep: 'border-[#c9d6fb] dark:border-[#2a3c6b]' },
    // Gradient dark modes
    { target: /bg-\[linear-gradient\(135deg,\#ffffff_0%,\#f6f8ff_54%,\#edf8f5_100%\)\](?! dark:bg-)/g, rep: 'bg-[linear-gradient(135deg,#ffffff_0%,#f6f8ff_54%,#edf8f5_100%)] dark:bg-[linear-gradient(135deg,#0a1120_0%,#0c1426_54%,#08171f_100%)]' },
    { target: /bg-\[linear-gradient\(180deg,\#ffffff_0%,\#f8faff_100%\)\](?! dark:bg-)/g, rep: 'bg-[linear-gradient(180deg,#ffffff_0%,#f8faff_100%)] dark:bg-[linear-gradient(180deg,#0b1120_0%,#091124_100%)]' },
    { target: /bg-\[linear-gradient\(180deg,\#f3f6ff_0%,\#eef3ff_100%\)\](?! dark:bg-)/g, rep: 'bg-[linear-gradient(180deg,#f3f6ff_0%,#eef3ff_100%)] dark:bg-[linear-gradient(180deg,#121a30_0%,#0d1426_100%)]' },
    // Add dark border to rounded cards natively
    { target: /\brounded-\[30px\](?!.*dark:border)/g, rep: 'rounded-[30px] dark:border-[#1e2a4a]' },
    // Fix pure text black
    { target: /\btext-slate-900(?! dark:text-)/g, rep: 'text-slate-900 dark:text-white' }
  ];

  for (const { target, rep } of replacements) {
    content = content.replace(target, rep);
  }

  // Ensure "dark:" doesn't double apply to border-
  // Actually we rely on negative lookaheads.

  fs.writeFileSync(file, content, 'utf8');
  console.log(Processed: \);
}
