import {axiosYiban, markdownParser} from "./helper";

// ============ API Functions ============

export async function fetchTemplateList(page = 1, pageSize = 20) {
  const res = await axiosYiban.get("/style_template/system/list", {
    params: {page, page_size: pageSize},
  });
  return {
    list: res.data.style_template_list || [],
    totalCount: res.data.total_count || 0,
  };
}

export async function fetchTemplateDetail(templateId) {
  const res = await axiosYiban.get("/style_template/system/one", {
    params: {style_template_id: templateId},
  });
  return res.data.style_template;
}

// ============ Markdown Section Parser ============

export function parseMarkdownSections(markdownText) {
  const lines = markdownText.split("\n");
  let title = "";
  const introLines = [];
  const sections = [];
  let currentHeading = null;
  let currentLines = [];
  let foundFirstH2 = false;

  for (const line of lines) {
    if (/^# /.test(line) && !title) {
      title = line.replace(/^# /, "").trim();
      continue;
    }

    if (/^## /.test(line)) {
      if (currentHeading !== null) {
        sections.push({heading: currentHeading, md: currentLines.join("\n")});
      }
      currentHeading = line.replace(/^## /, "").trim();
      currentLines = [];
      foundFirstH2 = true;
      continue;
    }

    if (!foundFirstH2) {
      introLines.push(line);
    } else {
      currentLines.push(line);
    }
  }

  if (currentHeading !== null) {
    sections.push({heading: currentHeading, md: currentLines.join("\n")});
  }

  const introMd = introLines.join("\n").trim();
  return {
    title: title || "",
    intro: introMd ? markdownParser.render(introMd) : "",
    sections: sections.map((s) => ({
      heading: s.heading,
      html: markdownParser.render(s.md.trim()),
    })),
  };
}

// ============ Template Section Classifier ============

function getMarkType(htmlString) {
  const match = htmlString.match(/yb-mpa-mark="([^"]+)"/);
  return match ? match[1] : null;
}

function getTextContent(htmlString) {
  return htmlString
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyTemplateSections(detailJson) {
  let sections;
  try {
    sections = typeof detailJson === "string" ? JSON.parse(detailJson) : detailJson;
  } catch (e) {
    return {header: [], main: [], end: [], decorative: []};
  }

  const header = [];
  const main = [];
  const end = [];
  const decorative = [];

  for (const section of sections) {
    const mark = getMarkType(section.content);
    if (mark === "mark-header") {
      header.push(section);
    } else if (mark === "mark-main") {
      main.push(section);
    } else if (mark === "mark-end") {
      end.push(section);
    } else {
      const text = getTextContent(section.content);
      if (text.length > 30) {
        main.push(section);
      } else {
        decorative.push(section);
      }
    }
  }

  return {header, main, end, decorative};
}

// ============ Content Injection ============

function findLargestFontElement(doc) {
  const allElements = doc.querySelectorAll("*");
  let best = null;
  let maxSize = 0;
  for (const el of allElements) {
    const style = el.getAttribute("style") || "";
    const match = style.match(/font-size:\s*(\d+)px/);
    if (match) {
      const size = parseInt(match[1], 10);
      const text = el.textContent.trim();
      if (size > maxSize && text.length > 0 && text.length < 200) {
        maxSize = size;
        best = el;
      }
    }
  }
  return best;
}

function findContentContainer(doc) {
  const candidates = doc.querySelectorAll("section, span, p");
  let best = null;
  let bestLen = 0;
  for (const el of candidates) {
    const directText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join("");
    const totalText = el.textContent.trim();

    if (totalText.length > bestLen && totalText.length > 10) {
      // Prefer elements with more direct text (leaf containers)
      if (directText.length > 5 || el.children.length === 0) {
        bestLen = totalText.length;
        best = el;
      }
    }
  }
  // Fallback: find the element with most text
  if (!best) {
    for (const el of candidates) {
      if (el.textContent.trim().length > bestLen) {
        bestLen = el.textContent.trim().length;
        best = el;
      }
    }
  }
  return best;
}

function injectIntoSection(sectionHtml, heading, contentHtml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${sectionHtml}</div>`, "text/html");
  const root = doc.body.firstChild;

  // Inject heading
  if (heading) {
    const titleEl = findLargestFontElement(root);
    if (titleEl) {
      titleEl.textContent = heading;
    }
  }

  // Inject content
  if (contentHtml) {
    const container = findContentContainer(root);
    if (container) {
      container.innerHTML = contentHtml;
    }
  }

  return root.innerHTML;
}

function injectIntoHeader(headerHtml, title, introHtml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${headerHtml}</div>`, "text/html");
  const root = doc.body.firstChild;

  // Replace title (largest font element)
  if (title) {
    const titleEl = findLargestFontElement(root);
    if (titleEl) {
      titleEl.textContent = title;
    }
  }

  // Replace intro text (second largest text block or content container)
  if (introHtml) {
    const allSections = root.querySelectorAll("section, span, p");
    let introTarget = null;
    let bestLen = 0;
    const titleEl = findLargestFontElement(root);

    for (const el of allSections) {
      if (el === titleEl || (titleEl && titleEl.contains(el))) continue;
      const text = el.textContent.trim();
      if (text.length > bestLen && text.length > 10) {
        bestLen = text.length;
        introTarget = el;
      }
    }
    if (introTarget) {
      introTarget.innerHTML = introHtml;
    }
  }

  return root.innerHTML;
}

export function injectContentIntoTemplate(parsedContent, templateDetail) {
  const classified = classifyTemplateSections(templateDetail.detail);
  const parts = [];

  // Process headers
  for (const section of classified.header) {
    const injected = injectIntoHeader(section.content, parsedContent.title, parsedContent.intro);
    parts.push(injected);
  }

  // Process main sections
  const T = classified.main.length;
  const S = parsedContent.sections.length;

  if (S === 0) {
    // No H2 sections - put all content in first main section
    if (T > 0) {
      const allContent = parsedContent.intro || "";
      const injected = injectIntoSection(classified.main[0].content, null, allContent);
      parts.push(injected);
    }
  } else if (S <= T) {
    for (let i = 0; i < S; i++) {
      const injected = injectIntoSection(
        classified.main[i].content,
        parsedContent.sections[i].heading,
        parsedContent.sections[i].html,
      );
      parts.push(injected);
    }
    // Skip excess template sections
  } else {
    // More user sections than template sections
    for (let i = 0; i < T - 1; i++) {
      const injected = injectIntoSection(
        classified.main[i].content,
        parsedContent.sections[i].heading,
        parsedContent.sections[i].html,
      );
      parts.push(injected);
    }
    // Merge remaining user sections into last template section
    const remaining = parsedContent.sections.slice(T - 1);
    const mergedHtml = remaining.map((s) => `<h2>${s.heading}</h2>${s.html}`).join("");
    const lastHeading = remaining[0].heading;
    const injected = injectIntoSection(classified.main[T - 1].content, lastHeading, mergedHtml);
    parts.push(injected);
  }

  // Add decorative sections between main if any
  for (const section of classified.decorative) {
    parts.push(section.content);
  }

  // Process end sections (keep as-is)
  for (const section of classified.end) {
    parts.push(section.content);
  }

  // Add referrerpolicy to all images
  let html = parts.join("\n");
  html = html.replace(/<img(?![^>]*referrerpolicy)/g, '<img referrerpolicy="no-referrer"');

  return html;
}

// ============ Main Render Function ============

export function renderTemplatePreview(markdownText, templateDetail) {
  const parsedContent = parseMarkdownSections(markdownText);
  return injectContentIntoTemplate(parsedContent, templateDetail);
}
