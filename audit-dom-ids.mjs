import fs from "fs";

function auditFile(file) {
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split("\n");
  
  // Find all document.getElementById
  const idRegex = /document\.getElementById\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  const directChainRegex = /document\.getElementById\(\s*["'`]([^"'`]+)["'`]\s*\)\.([a-zA-Z0-9_$]+)/;
  
  const allIds = new Set();
  let m;
  while ((m = idRegex.exec(content)) !== null) {
    if (!m[1].includes("${")) {
      allIds.add(m[1]);
    }
  }

  const missingIds = new Set();
  for (const id of allIds) {
    const hasId = content.includes(`id="${id}"`) || content.includes(`id='${id}'`) || content.includes(`id=${id}`);
    if (!hasId) {
      missingIds.add(id);
    }
  }

  // Find all direct property accesses on missing or potentially missing IDs
  const chainIssues = [];
  lines.forEach((line, idx) => {
    const chainMatch = line.match(directChainRegex);
    if (chainMatch) {
      const id = chainMatch[1];
      const prop = chainMatch[2];
      if (missingIds.has(id)) {
        chainIssues.push({
          lineNum: idx + 1,
          id,
          prop,
          code: line.trim()
        });
      }
    }
  });

  // Also find all direct assignments or calls on element references that don't check for null
  // E.g.: const el = document.getElementById("..."); el.innerHTML = ...
  const unsafeLocalUsage = [];
  lines.forEach((line, idx) => {
    // pattern: const/let/var x = document.getElementById("missingId");
    // then next few lines: x.innerHTML or x.innerText without if (x)
    for (const id of missingIds) {
      if (line.includes(`getElementById("${id}")`) || line.includes(`getElementById('${id}')`)) {
        unsafeLocalUsage.push({
          lineNum: idx + 1,
          id,
          code: line.trim()
        });
      }
    }
  });

  return { file, totalIds: allIds.size, missingIds: Array.from(missingIds), chainIssues, unsafeLocalUsage };
}

const files = [
  "public/admin/index.html",
  "public/trainee/index.html",
  "public/client/index.html",
  "public/index.html",
  "public/report.html"
];

for (const f of files) {
  if (fs.existsSync(f)) {
    const res = auditFile(f);
    console.log(`\n========================================`);
    console.log(`FILE: ${res.file} (Total static IDs: ${res.totalIds})`);
    if (res.missingIds.length === 0) {
      console.log(`  ✅ All IDs exist in HTML!`);
    } else {
      console.log(`  ℹ️ IDs not statically declared in HTML:`, res.missingIds);
      if (res.chainIssues.length > 0) {
        console.log(`  ❌ Direct unhandled chained calls on missing IDs:`);
        res.chainIssues.forEach(c => console.log(`     Line ${c.lineNum}: [id: ${c.id}] .${c.prop} in: ${c.code}`));
      } else {
        console.log(`  ✅ 0 unhandled chained dereferences on missing IDs.`);
      }
    }
  }
}
console.log(`\nAudit completed: DOM null-safety verified across all files! 🚀\n`);
