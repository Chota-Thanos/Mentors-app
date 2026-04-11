const fs = require('fs');
let content = fs.readFileSync('supa_mobile/src/screens/LearnerHomeScreen.tsx', 'utf8');

// Add imports
if (!content.includes('useColorScheme')) {
  content = content.replace(
    /import \{ ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View \} from "react-native";/,
    'import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from "react-native";'
  );
}

if (!content.includes('darkPalette')) {
  content = content.replace(
    /import \{ elevation, fonts, palette, radii, spacing, typeScale \} from "@\/theme\/tokens";/,
    'import { darkPalette, elevation, fonts, palette, radii, spacing, typeScale } from "@/theme/tokens";'
  );
}

// Add hook
if (!content.includes('const uiPalette = colorScheme === "dark" ? darkPalette : palette;')) {
  content = content.replace(
    /export default function LearnerHomeScreen\(\) \{/,
    'export default function LearnerHomeScreen() {\n  const colorScheme = useColorScheme();\n  const uiPalette = colorScheme === "dark" ? darkPalette : palette;'
  );
}

// Update table UI references
content = content.replace(
  /<View style=\{styles.tableHeader\}>/g,
  '<View style={[styles.tableHeader, { borderBottomColor: uiPalette.line }]}>'
);
content = content.replace(
  /<Text style=\{\[styles.tableHeadText, styles.colContent\]\}>Content<\/Text>/g,
  '<Text style={[styles.tableHeadText, styles.colContent, { color: colorScheme === "dark" ? "#a5bdf8" : "#5f7aa9" }]}>Content</Text>'
);
content = content.replace(
  /<Text style=\{\[styles.tableHeadText, styles.colSmall\]\}>Q<\/Text>/g,
  '<Text style={[styles.tableHeadText, styles.colSmall, { color: colorScheme === "dark" ? "#a5bdf8" : "#5f7aa9" }]}>Q</Text>'
);
content = content.replace(
  /<Text style=\{\[styles.tableHeadText, styles.colSmall\]\}>Marks<\/Text>/g,
  '<Text style={[styles.tableHeadText, styles.colSmall, { color: colorScheme === "dark" ? "#a5bdf8" : "#5f7aa9" }]}>Marks</Text>'
);
content = content.replace(
  /<Text style=\{\[styles.tableHeadText, styles.colSmall\]\}>Got<\/Text>/g,
  '<Text style={[styles.tableHeadText, styles.colSmall, { color: colorScheme === "dark" ? "#a5bdf8" : "#5f7aa9" }]}>Got</Text>'
);

content = content.replace(
  /<View key=\{row.content_type\} style=\{styles.tableRow\}>/g,
  '<View key={row.content_type} style={[styles.tableRow, { borderBottomColor: uiPalette.line }]}>'
);
content = content.replace(
  /<Text style=\{\[styles.tableText, styles.colContent\]\}>\{row.label\}<\/Text>/g,
  '<Text style={[styles.tableText, styles.colContent, { color: uiPalette.ink }]}>{row.label}</Text>'
);
content = content.replace(
  /<Text style=\{\[styles.tableText, styles.colSmall\]\}>\{row.total_questions\}<\/Text>/g,
  '<Text style={[styles.tableText, styles.colSmall, { color: uiPalette.ink }]}>{row.total_questions}</Text>'
);
content = content.replace(
  /<Text style=\{\[styles.tableText, styles.colSmall\]\}>\{row.total_marks\}<\/Text>/g,
  '<Text style={[styles.tableText, styles.colSmall, { color: uiPalette.ink }]}>{row.total_marks}</Text>'
);
content = content.replace(
  /<Text style=\{\[styles.tableAccent, styles.colSmall\]\}>\{row.marks_obtained\}<\/Text>/g,
  '<Text style={[styles.tableAccent, styles.colSmall, { color: colorScheme === "dark" ? "#a5bdf8" : palette.cobalt }]}>{row.marks_obtained}</Text>'
);

// We need to also patch the top text headers and cards if they are overridden by static styles.
content = content.replace(
  /<Text style=\{styles.kicker\}>Learner Workspace<\/Text>/g,
  '<Text style={[styles.kicker, { color: colorScheme === "dark" ? "#a5bdf8" : "#304a92" }]}>Learner Workspace</Text>'
);
content = content.replace(
  /<Text style=\{styles.title\}>\{Welcome back, \$\{firstName\}.\}<\/Text>/g,
  '<Text style={[styles.title, { color: uiPalette.cobalt }]}>{Welcome back, \.}</Text>'
);
content = content.replace(
  /<Text style=\{styles.body\}>(\s*Track ongoing programs.*?)\s*<\/Text>/g,
  '<Text style={[styles.body, { color: uiPalette.inkSoft }]}></Text>'
);
content = content.replace(
  /<View style=\{styles.hero\}>/g,
  '<View style={[styles.hero, { backgroundColor: uiPalette.paperRaised, borderColor: uiPalette.line }]}>'
);

content = content.replace(
  /<View style=\{styles.statCard\}><Text style=\{styles.statLabel\}>Active Programs<\/Text><Text style=\{styles.statValue\}>\{activeSeries.length\}<\/Text><\/View>/g,
  '<View style={[styles.statCard, { backgroundColor: uiPalette.paperSoft, borderColor: uiPalette.line }]}><Text style={[styles.statLabel, { color: uiPalette.inkMute }]}>Active Programs</Text><Text style={[styles.statValue, { color: uiPalette.cobalt }]}>{activeSeries.length}</Text></View>'
);
content = content.replace(
  /<View style=\{styles.statCard\}><Text style=\{styles.statLabel\}>Pending Requests<\/Text><Text style=\{styles.statValue\}>\{\(workbench\?.requests \|\| \[\]\).filter\(\(row\) => row.status === "requested"\).length\}<\/Text><\/View>/g,
  '<View style={[styles.statCard, { backgroundColor: uiPalette.paperSoft, borderColor: uiPalette.line }]}><Text style={[styles.statLabel, { color: uiPalette.inkMute }]}>Pending Requests</Text><Text style={[styles.statValue, { color: uiPalette.cobalt }]}>{(workbench?.requests || []).filter((row) => row.status === "requested").length}</Text></View>'
);
content = content.replace(
  /<View style=\{styles.statCard\}><Text style=\{styles.statLabel\}>Questions This Year<\/Text><Text style=\{styles.statValue\}>\{yearlyRows.reduce\(\(sum, row\) => sum \+ row.total_questions, 0\)\}<\/Text><\/View>/g,
  '<View style={[styles.statCard, { backgroundColor: uiPalette.paperSoft, borderColor: uiPalette.line }]}><Text style={[styles.statLabel, { color: uiPalette.inkMute }]}>Questions This Year</Text><Text style={[styles.statValue, { color: uiPalette.cobalt }]}>{yearlyRows.reduce((sum, row) => sum + row.total_questions, 0)}</Text></View>'
);

// Other views and cards
content = content.replace(
  /<Pressable key=\{item\.key\} onPress=\{.*?\} style=\{styles.rowCard\}>/g,
  (match) => match.replace('style={styles.rowCard}', 'style={[styles.rowCard, { backgroundColor: uiPalette.paper, borderColor: uiPalette.line }]}')
);
content = content.replace(
  /<Text style=\{styles.rowTitle\}>/g,
  '<Text style={[styles.rowTitle, { color: uiPalette.ink }]}>'
);
content = content.replace(
  /<Text style=\{styles.rowMeta\}>/g,
  '<Text style={[styles.rowMeta, { color: uiPalette.inkSoft }]}>'
);
content = content.replace(
  /<Text style=\{styles.rowStatus\}>/g,
  '<Text style={[styles.rowStatus, { color: uiPalette.cobalt }]}>'
);

content = content.replace(
  /style=\{styles.gridCard\}/g,
  'style={[styles.gridCard, { backgroundColor: uiPalette.paperSoft, borderColor: uiPalette.line }]}'
);
content = content.replace(
  /<Text style=\{styles.gridTitle\}>/g,
  '<Text style={[styles.gridTitle, { color: uiPalette.ink }]}>'
);
content = content.replace(
  /<Text style=\{styles.gridBody\}>/g,
  '<Text style={[styles.gridBody, { color: uiPalette.inkSoft }]}>'
);


fs.writeFileSync('supa_mobile/src/screens/LearnerHomeScreen.tsx', content, 'utf8');
console.log("Patched LearnerHomeScreen");
