import { requestUrl } from "obsidian";

export interface BlogRepoConfig {
  owner: string;
  repo: string;
  branch: string;
  token: string;
  postsDir: string;
}

export interface BlogPostMeta {
  title: string;
  slug: string;
  published: string;
  updated?: string;
  description: string;
  category: string;
  tags: string[];
  series: string;
  seriesOrder?: number;
  draft: boolean;
  pinned: boolean;
  image?: string;
}

export interface BlogImageRef {
  fullMatch: string;
  source: string;
  altText: string;
  isRemote: boolean;
}

export interface BlogIndex {
  categories: string[];
  series: Map<string, number>;
  posts: Map<string, { published?: string }>;
}

export interface CommitFile {
  path: string;
  base64: string;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function today(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 去掉 Obsidian 笔记开头的 YAML 元数据块 */
export function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

/** 去掉与标题重复的第一个一级标题，博客页面会单独显示标题 */
export function stripLeadingTitle(body: string, title: string): string {
  const match = body.match(/^\s*# (.+)\r?\n+/);
  if (match && match[1].trim() === title.trim()) return body.slice(match[0].length);
  return body;
}

const CN_DIGITS: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function parseChineseNumber(text: string): number | undefined {
  if (!/^[零一二两三四五六七八九十百]+$/.test(text)) return undefined;
  let total = 0;
  let digit = 0;
  for (const ch of text) {
    if (ch === "百") {
      total += (digit || 1) * 100;
      digit = 0;
    } else if (ch === "十") {
      total += (digit || 1) * 10;
      digit = 0;
    } else {
      digit = CN_DIGITS[ch];
    }
  }
  return total + digit || undefined;
}

/** 从「系列三：…」「第12篇」「03-xxx」这类文件名里取序号 */
export function seriesNumber(name: string): number | undefined {
  const cn = name.match(/(?:系列|第|篇|章|期)([零一二两三四五六七八九十百]+)|^([零一二两三四五六七八九十百]+)[、：:.\s-]/);
  if (cn) return parseChineseNumber(cn[1] ?? cn[2]);
  const digits = name.match(/(?:系列|第|^)\s*(\d+)/);
  return digits ? Number(digits[1]) : undefined;
}

export function firstHeading(body: string): string | undefined {
  return body.match(/^\s*# (.+)$/m)?.[1].trim();
}

/** 取第一段正文作为默认简介 */
export function firstParagraph(body: string, maxLength = 120): string {
  for (const block of body.split(/\r?\n\s*\r?\n/)) {
    const text = block.trim();
    if (!text || /^(#|!\[|```|\||-|\*|\d+\.)/.test(text)) continue;
    // 开头的引用块通常是导语，去掉引用符号后同样可作简介
    const plain = text.replace(/^>\s?/gm, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").replace(/\s+/g, " ");
    return plain.length > maxLength ? `${plain.slice(0, maxLength)}…` : plain;
  }
  return "";
}

export function collectImageRefs(body: string): BlogImageRef[] {
  const refs: BlogImageRef[] = [];
  const wikiImageRegex = /!\[\[([^\]|]+?)(?:\|[^\]]*?)?\]\]/g;
  let match;
  while ((match = wikiImageRegex.exec(body)) !== null) {
    const source = match[1].trim();
    refs.push({ fullMatch: match[0], source, altText: source.replace(/\.[^.]+$/, ""), isRemote: false });
  }
  const mdImageRegex = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  while ((match = mdImageRegex.exec(body)) !== null) {
    const source = match[2].trim();
    refs.push({
      fullMatch: match[0],
      source,
      altText: match[1],
      isRemote: /^https?:\/\//i.test(source),
    });
  }
  return refs;
}

/** 为每个图片源生成仓库内的文件名，同名去重，非 ASCII 名称用序号 */
export function assignImageNames(sources: string[], convertible: (source: string) => boolean): Map<string, string> {
  const names = new Map<string, string>();
  const used = new Set<string>();
  let index = 0;
  for (const source of sources) {
    if (names.has(source)) continue;
    index++;
    let pathPart = source;
    try {
      pathPart = decodeURIComponent(new URL(source).pathname.split("/").pop() || "");
    } catch {
      pathPart = source.split("/").pop() || source;
    }
    const ext = (pathPart.match(/\.([a-z0-9]+)$/i)?.[1] || "png").toLowerCase();
    let base = slugify(pathPart);
    if (!base) base = `img-${String(index).padStart(2, "0")}`;
    const finalExt = convertible(source) ? "webp" : ext;
    let name = `${base}.${finalExt}`;
    for (let n = 2; used.has(name); n++) name = `${base}-${n}.${finalExt}`;
    used.add(name);
    names.set(source, name);
  }
  return names;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

export function buildFrontmatter(meta: BlogPostMeta): string {
  const lines = [
    "---",
    `title: ${yamlString(meta.title)}`,
    `published: ${meta.published}`,
  ];
  if (meta.updated) lines.push(`updated: ${meta.updated}`);
  lines.push(`description: ${yamlString(meta.description)}`);
  if (meta.image) lines.push(`image: ${yamlString(meta.image)}`);
  lines.push(`tags: [${meta.tags.map(yamlString).join(", ")}]`);
  lines.push(`category: ${yamlString(meta.category)}`);
  if (meta.series) {
    lines.push(`series: ${yamlString(meta.series)}`);
    if (meta.seriesOrder !== undefined) lines.push(`seriesOrder: ${meta.seriesOrder}`);
  }
  if (meta.pinned) lines.push("pinned: true");
  lines.push(`draft: ${meta.draft}`);
  lines.push("---", "");
  return lines.join("\n");
}

/** 从博客文章的元数据里读出单行字段 */
export function readField(text: string, key: string): string | undefined {
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  if (!block) return undefined;
  const line = block.match(new RegExp(`^${key}:\\s*(.*)$`, "m"))?.[1].trim();
  if (!line) return undefined;
  return line.replace(/^["']|["']$/g, "");
}

export function buildIndex(posts: Array<{ slug: string; text: string }>): BlogIndex {
  const categories = new Set<string>();
  const series = new Map<string, number>();
  const index = new Map<string, { published?: string }>();
  for (const { slug, text } of posts) {
    const category = readField(text, "category");
    if (category) categories.add(category);
    const name = readField(text, "series");
    if (name) {
      const order = Number(readField(text, "seriesOrder"));
      series.set(name, Math.max(series.get(name) ?? 0, Number.isFinite(order) ? order : 0));
    }
    index.set(slug, { published: readField(text, "published") });
  }
  return {
    categories: [...categories].sort((a, b) => a.localeCompare(b, "zh")),
    series,
    posts: index,
  };
}

export function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function utf8ToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text).buffer as ArrayBuffer);
}

function decodeBase64Utf8(base64: string): string {
  const binary = atob(base64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export class GitHubRepo {
  constructor(private config: BlogRepoConfig) {}

  private async api(path: string, method = "GET", body?: unknown) {
    const { owner, repo, token } = this.config;
    const response = await requestUrl({
      url: `https://api.github.com/repos/${owner}/${repo}${path}`,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      throw: false,
    });
    if (response.status < 200 || response.status >= 300) {
      let detail = "";
      try {
        detail = response.json?.message ? `: ${response.json.message}` : "";
      } catch {
        // 响应不是 JSON
      }
      throw new Error(`GitHub ${method} ${path} 返回 ${response.status}${detail}`);
    }
    return response.json;
  }

  async loadIndex(): Promise<BlogIndex> {
    const { branch, postsDir } = this.config;
    const listing = await this.api(`/contents/${postsDir}?ref=${encodeURIComponent(branch)}`);
    const files = (listing as Array<{ name: string; path: string; type: string }>).filter(
      (item) => item.type === "file" && /\.mdx?$/.test(item.name)
    );
    const posts = await Promise.all(
      files.map(async (item) => {
        const file = await this.api(`/contents/${encodeURI(item.path)}?ref=${encodeURIComponent(branch)}`);
        return { slug: item.name.replace(/\.mdx?$/, ""), text: decodeBase64Utf8(file.content) };
      })
    );
    return buildIndex(posts);
  }

  /** 把多个文件合成一个提交推到分支上，只会快进，不会覆盖别人的新提交 */
  async commitFiles(files: CommitFile[], message: string): Promise<string> {
    const { branch } = this.config;
    const ref = await this.api(`/git/ref/heads/${encodeURIComponent(branch)}`);
    const parentSha: string = ref.object.sha;
    const parent = await this.api(`/git/commits/${parentSha}`);
    const tree = [];
    for (const file of files) {
      const blob = await this.api("/git/blobs", "POST", { content: file.base64, encoding: "base64" });
      tree.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
    }
    const newTree = await this.api("/git/trees", "POST", { base_tree: parent.tree.sha, tree });
    const commit = await this.api("/git/commits", "POST", {
      message,
      tree: newTree.sha,
      parents: [parentSha],
    });
    await this.api(`/git/refs/heads/${encodeURIComponent(branch)}`, "PATCH", { sha: commit.sha, force: false });
    return commit.sha;
  }
}
