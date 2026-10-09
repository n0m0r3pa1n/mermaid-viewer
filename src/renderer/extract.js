// Pulls Mermaid diagrams out of arbitrary text: markdown, chat transcripts,
// terminal output, application logs (including JSON-escaped log lines), HTML.
// Works both in the browser (window.MermaidExtract) and in Node (module.exports).
(function (root) {
  const DIAGRAM_KEYWORDS = [
    'graph', 'flowchart', 'flowchart-elk', 'sequenceDiagram', 'classDiagram', 'classDiagram-v2',
    'stateDiagram', 'stateDiagram-v2', 'erDiagram', 'journey', 'gantt', 'pie', 'quadrantChart',
    'requirementDiagram', 'requirement', 'gitGraph', 'C4Context', 'C4Container', 'C4Component',
    'C4Dynamic', 'C4Deployment', 'mindmap', 'timeline', 'zenuml', 'sankey', 'sankey-beta',
    'xychart', 'xychart-beta', 'block', 'block-beta', 'packet', 'packet-beta', 'kanban',
    'architecture', 'architecture-beta', 'radar-beta', 'treemap', 'treemap-beta',
  ];
  const KEYWORD_RE = new RegExp(
    '^(?:' + DIAGRAM_KEYWORDS.map((k) => k.replace(/[-]/g, '\\-')).join('|') + ')(?=$|[\\s;:])'
  );

  // Common prefixes that terminals, chat UIs and loggers put in front of lines.
  const LOG_PREFIX_RE = new RegExp(
    '^' +
      '(?:\\[?\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}(?:[.,]\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?\\]?\\s*)?' + // ISO timestamp
      '(?:\\[?\\d{2}:\\d{2}:\\d{2}(?:[.,]\\d+)?\\]?\\s*)?' + // time only
      '(?:\\[?(?:TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|FATAL|LOG)\\]?:?\\s+)?' + // level
      '(?:\\[[\\w.\\-/: ]{1,40}\\]:?\\s+)?' // [component]
  );

  const FRIENDLY = {
    graph: 'Flowchart', flowchart: 'Flowchart', sequenceDiagram: 'Sequence', classDiagram: 'Class',
    stateDiagram: 'State', erDiagram: 'ER', journey: 'Journey', gantt: 'Gantt', pie: 'Pie',
    quadrantChart: 'Quadrant', requirementDiagram: 'Requirement', gitGraph: 'Git graph',
    mindmap: 'Mindmap', timeline: 'Timeline', sankey: 'Sankey', xychart: 'XY chart', block: 'Block',
    packet: 'Packet', kanban: 'Kanban', architecture: 'Architecture', radar: 'Radar', treemap: 'Treemap',
  };

  function isDiagramStart(line) {
    return KEYWORD_RE.test(line.trim());
  }

  /** Remove the common leading whitespace of all non-blank lines. */
  function dedent(text) {
    const lines = text.split('\n');
    let min = Infinity;
    for (const l of lines) {
      if (!l.trim()) continue;
      const n = l.match(/^[ \t]*/)[0].length;
      if (n < min) min = n;
    }
    if (!isFinite(min) || min === 0) return text;
    return lines.map((l) => l.slice(Math.min(min, l.match(/^[ \t]*/)[0].length))).join('\n');
  }

  function trimBlankLines(text) {
    return text.replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '');
  }

  /** Strip box-drawing borders, quote markers and log prefixes when most lines carry them. */
  function stripDecorations(lines) {
    const nonBlank = lines.filter((l) => l.trim());
    if (!nonBlank.length) return lines;
    const share = (re) => nonBlank.filter((l) => re.test(l)).length / nonBlank.length;

    let out = lines;
    // Terminal boxes:  │ text │
    if (share(/^\s*[│┃|]\s?/) > 0.6) {
      out = out.map((l) => l.replace(/^\s*[│┃|]\s?/, '').replace(/\s*[│┃|]\s*$/, ''));
    }
    // Email / markdown quotes
    if (share(/^\s*>\s?/) > 0.6) out = out.map((l) => l.replace(/^\s*(?:>\s?)+/, ''));
    // Log prefixes (only if they actually match something non-empty)
    // Log prefixes (only if they actually match something non-empty). Strip the
    // shortest matched width so indentation after the prefix survives.
    const lens = nonBlank.map((l) => (l.match(LOG_PREFIX_RE) || [''])[0].length).filter((n) => n > 0);
    if (lens.length / nonBlank.length > 0.6) {
      const w = Math.min(...lens);
      out = out.map((l) => {
        const m = l.match(LOG_PREFIX_RE);
        return m && m[0].length >= w ? l.slice(w) : l;
      });
    }
    // Claude Code / chat bullets on the first line
    out = out.map((l) => l.replace(/^\s*[⏺●•]\s+/, ''));
    return out;
  }

  /**
   * Find fenced ```mermaid blocks. Handles fences that are indented, quoted (>),
   * inside terminal boxes (│) or behind log prefixes. Records offsets for clean
   * (undecorated) blocks so markdown files can be written back in place.
   */
  function findFences(text) {
    const results = [];
    const lines = text.split('\n');
    const lineOffsets = [];
    let off = 0;
    for (const l of lines) {
      lineOffsets.push(off);
      off += l.length + 1;
    }

    const openRe = /^(.*?)(`{3,}|~{3,})[ \t]*\{?[ \t]*\.?mermaid\b[^`│┃]*?\}?[ \t]*[│┃]?[ \t]*$/i;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(openRe);
      if (!m) continue;
      const prefix = m[1];
      const boxed = /[│┃]/.test(lines[i]);
      // Prefix must be "decoration" only, not real prose
      if (!/^[\s>│┃|⏺●•]*$/.test(prefix) && !LOG_PREFIX_RE.test(prefix)) continue;
      const fence = m[2];
      const closeRe = new RegExp('^\\s*' + (fence[0] === '`' ? '`' : '~') + '{' + fence.length + ',}\\s*$');

      const body = [];
      let j = i + 1;
      let closed = false;
      for (; j < lines.length; j++) {
        let stripped = stripPrefix(lines[j], prefix);
        if (boxed) stripped = stripped.replace(/\s*[│┃]\s*$/, '');
        if (closeRe.test(stripped)) {
          closed = true;
          break;
        }
        body.push(stripped);
      }
      if (!body.length) continue;

      const clean = /^[ \t]*$/.test(prefix);
      let code = trimBlankLines(dedent(stripDecorations(body).join('\n')));
      if (!code.trim()) continue;
      const entry = { code };
      if (clean && closed) {
        entry.range = {
          start: lineOffsets[i + 1],
          end: lineOffsets[j] - 1, // end of last body line (excluding its newline)
          indent: prefix,
        };

      }
      results.push(entry);
      i = j;
    }
    return results;
  }

  function stripPrefix(line, prefix) {
    if (!prefix) return line;
    if (line.startsWith(prefix)) return line.slice(prefix.length);
    const trimmedPrefix = prefix.replace(/\s+$/, '');
    if (trimmedPrefix && line.startsWith(trimmedPrefix)) return line.slice(trimmedPrefix.length);
    // Log prefixes vary per line (timestamps), so strip the pattern instead
    const m = line.match(LOG_PREFIX_RE);
    if (m && m[0]) return line.slice(Math.min(m[0].length, Math.max(prefix.length, 1)));
    if (/^\s*[>│┃|]/.test(prefix)) return line.replace(/^\s*(?:[>│┃|]\s?)+/, '');
    return line.replace(/^[ \t]+/, (ws) => ws.slice(Math.min(ws.length, prefix.length)));
  }

  /** <pre class="mermaid">…</pre> and <div class="mermaid">…</div> */
  function findHtmlBlocks(text) {
    const out = [];
    const re = /<(pre|div)[^>]*class=["'][^"']*\bmermaid\b[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi;
    let m;
    while ((m = re.exec(text))) {
      const code = trimBlankLines(dedent(decodeEntities(m[2].replace(/<code[^>]*>|<\/code>/g, ''))));
      if (code.trim()) out.push({ code });
    }
    return out;
  }

  function decodeEntities(s) {
    return s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  }

  /** Mermaid stored inside JSON string literals: "graph TD\nA-->B" or "```mermaid\n…```" */
  function findEscapedStrings(text) {
    if (!/\\n/.test(text)) return [];
    const out = [];
    const re = /"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = re.exec(text))) {
      if (!/\\n/.test(m[1])) continue;
      let s;
      try {
        s = JSON.parse('"' + m[1] + '"');
      } catch {
        continue;
      }
      if (/(`{3,}|~{3,})\s*mermaid/i.test(s)) out.push(...findFences(s).map((r) => ({ code: r.code })));
      else if (isDiagramStart(firstMeaningfulLine(s))) out.push({ code: trimBlankLines(dedent(s)) });
    }
    return out;
  }

  function firstMeaningfulLine(text) {
    const lines = text.split('\n');
    let inFrontMatter = false;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (i === 0 || (!inFrontMatter && !lines.slice(0, i).some((l) => l.trim()))) {
        if (t === '---') {
          inFrontMatter = true;
          continue;
        }
      }
      if (inFrontMatter) {
        if (t === '---') inFrontMatter = false;
        continue;
      }
      if (!t || t.startsWith('%%')) continue;
      return t;
    }
    return '';
  }

  /**
   * Raw (unfenced) diagram. In strict mode the whole text must be a diagram;
   * otherwise we look for the first line that starts a diagram and take the
   * rest, which handles a log line or two before it.
   */
  function findRaw(text, strict) {
    const lines = stripDecorations(text.split('\n'));
    const cleaned = trimBlankLines(dedent(lines.join('\n')));
    if (isDiagramStart(firstMeaningfulLine(cleaned))) return [{ code: cleaned }];
    if (strict) return [];

    const all = cleaned.split('\n');
    for (let i = 0; i < all.length; i++) {
      if (isDiagramStart(all[i])) {
        // Include an immediately preceding front-matter / init directive
        let start = i;
        while (start > 0 && /^\s*%%/.test(all[start - 1])) start--;
        const code = trimBlankLines(dedent(all.slice(start).join('\n')));
        return code ? [{ code }] : [];
      }
    }
    return [];
  }

  /**
   * @param {string} text
   * @param {{strict?: boolean}} opts strict: only accept unambiguous diagrams (used for clipboard watching)
   * @returns {{code: string, title: string, range?: {start:number,end:number,indent:string}}[]}
   */
  function extract(text, opts = {}) {
    if (!text) return [];
    text = text.replace(/\r\n?/g, '\n');

    let found = findFences(text);
    if (!found.length) found = findHtmlBlocks(text);
    if (!found.length) found = findEscapedStrings(text);
    if (!found.length) found = findRaw(text, !!opts.strict);

    const seen = new Set();
    return found
      .filter((d) => {
        const key = d.code.trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((d) => ({ ...d, title: titleFor(d.code) }));
  }

  /** A short human title: front-matter title, `title` line, or the diagram type. */
  function titleFor(code) {
    const fm = code.match(/^---\n[\s\S]*?^title:\s*(.+)$[\s\S]*?^---/m);
    if (fm) return fm[1].trim().replace(/^["']|["']$/g, '');
    const t = code.match(/^\s*title\s+(.+)$/m);
    if (t) return t[1].trim();
    const first = firstMeaningfulLine(code);
    const kw = first.split(/[\s;:]/)[0].replace(/-(beta|v2|elk)$/, '');
    return FRIENDLY[kw] || kw || 'Diagram';
  }

  /** Write edited diagram codes back into a markdown document. */
  function replaceBlocks(text, blocks, codes) {
    const order = blocks.map((b, i) => i).sort((a, b) => blocks[b].range.start - blocks[a].range.start);
    let out = text.replace(/\r\n?/g, '\n');
    for (const i of order) {
      const { start, end, indent } = blocks[i].range;
      const body = codes[i]
        .split('\n')
        .map((l) => (l ? indent + l : l))
        .join('\n');
      out = out.slice(0, start) + body + out.slice(end);
    }
    return out;
  }

  const api = { extract, titleFor, replaceBlocks, isDiagramStart, DIAGRAM_KEYWORDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MermaidExtract = api;
})(typeof window !== 'undefined' ? window : globalThis);
