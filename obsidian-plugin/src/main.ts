import { App, Plugin, PluginSettingTab, Setting, Notice, TFile, requestUrl } from "obsidian";
import pako from "pako";
import {
  BlogImageRef,
  BlogIndex,
  BlogPostMeta,
  CommitFile,
  GitHubRepo,
  assignImageNames,
  bytesToBase64,
  buildFrontmatter,
  collectImageRefs,
  firstHeading,
  firstParagraph,
  slugify,
  stripFrontmatter,
  stripLeadingTitle,
  today,
  utf8ToBase64,
} from "./blog";
import { BlogPublishModal, PublishTargetModal } from "./modals";

interface Md2HtmlSettings {
  githubUsername: string;
  githubRepo: string;
  githubToken: string;
  githubBranch: string;
  useJsdelivr: boolean;
  md2htmlUrl: string;
  blogOwner: string;
  blogRepo: string;
  blogBranch: string;
  blogToken: string;
  blogPostsDir: string;
  blogSiteUrl: string;
  blogImageMaxSize: number;
  blogWebpQuality: number;
}

const DEFAULT_SETTINGS: Md2HtmlSettings = {
  githubUsername: "",
  githubRepo: "image-hosting",
  githubToken: "",
  githubBranch: "main",
  useJsdelivr: true,
  md2htmlUrl: "https://md.riowang.win",
  blogOwner: "riowang88",
  blogRepo: "wtblog",
  blogBranch: "main",
  blogToken: "",
  blogPostsDir: "src/content/posts",
  blogSiteUrl: "https://wtblog.wang",
  blogImageMaxSize: 2000,
  blogWebpQuality: 0.85,
};

// 这些格式会缩放并转成 WebP；GIF 保留动画、SVG 保留矢量，原样提交
const CONVERTIBLE_EXT = /\.(png|jpe?g|bmp|webp)$/i;

// Cache uploaded image URLs to avoid re-uploading within a session
const uploadCache: Map<string, string> = new Map();

export default class Md2HtmlPlugin extends Plugin {
  settings: Md2HtmlSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: "publish",
      name: "发布…（选择公众号排版或博客）",
      callback: () => this.choosePublishTarget(),
    });

    this.addCommand({
      id: "publish-to-blog",
      name: "发布到博客",
      callback: () => this.publishToBlog(),
    });

    this.addRibbonIcon("send", "发布当前笔记", () => this.choosePublishTarget());

    this.addCommand({
      id: "publish-to-md2html",
      name: "Publish to Markdown2HTML",
      callback: () => this.publishToMd2Html(),
    });

    this.addCommand({
      id: "upload-images-copy",
      name: "Upload images and copy to clipboard",
      callback: () => this.uploadAndCopy(),
    });

    this.addSettingTab(new Md2HtmlSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  choosePublishTarget() {
    new PublishTargetModal(this.app, (target) => {
      if (target === "blog") this.publishToBlog();
      else this.publishToMd2Html();
    }).open();
  }

  blogRepoClient(): GitHubRepo {
    const { blogOwner, blogRepo, blogBranch, blogToken, blogPostsDir } = this.settings;
    return new GitHubRepo({ owner: blogOwner, repo: blogRepo, branch: blogBranch, token: blogToken, postsDir: blogPostsDir });
  }

  async publishToBlog() {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      new Notice("请先打开一个 Markdown 文件");
      return;
    }
    if (!this.settings.blogToken) {
      new Notice("请先在设置的「博客」里填写 GitHub Token");
      return;
    }

    const content = await this.app.vault.read(file);
    const notice = new Notice("正在读取博客分类…", 0);
    let index: BlogIndex;
    try {
      index = await this.blogRepoClient().loadIndex();
    } catch (e) {
      notice.hide();
      new Notice(`读取博客失败: ${(e as Error).message}`);
      return;
    }
    notice.hide();

    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const body = stripFrontmatter(content);
    const meta = this.initialBlogMeta(file, body, fm, index);
    const refs = collectImageRefs(stripLeadingTitle(body, meta.title));
    const first = refs[0];

    new BlogPublishModal(
      this.app,
      {
        meta,
        index,
        imageCount: new Set(refs.map((ref) => ref.source)).size,
        firstImageName: first ? first.source.split("/").pop() : undefined,
        siteUrl: this.settings.blogSiteUrl.replace(/\/+$/, ""),
      },
      (finalMeta) => this.commitBlogPost(file, body, finalMeta, index)
    ).open();
  }

  initialBlogMeta(file: TFile, body: string, fm: Record<string, any>, index: BlogIndex): BlogPostMeta {
    const pick = (...keys: string[]) => keys.map((key) => fm[key]).find((v) => v !== undefined && v !== null && v !== "");
    const toList = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.map(String)
        : typeof value === "string"
          ? value.split(/[,，]/).map((v) => v.trim()).filter(Boolean)
          : [];
    const title = String(pick("blog_title", "title") ?? firstHeading(body) ?? file.basename);
    const slug = String(pick("blog_slug", "slug") ?? slugify(file.basename));
    const existing = index.posts.get(slug);
    const order = Number(pick("blog_series_order", "seriesOrder"));
    const published = String(existing?.published ?? pick("published") ?? today()).slice(0, 10);
    return {
      title,
      slug,
      published,
      description: String(pick("blog_description", "description") ?? firstParagraph(stripLeadingTitle(body, title))),
      category: String(pick("blog_category", "category") ?? ""),
      tags: toList(pick("blog_tags", "tags")),
      series: String(pick("blog_series", "series") ?? ""),
      seriesOrder: Number.isFinite(order) && order > 0 ? order : undefined,
      draft: false,
      pinned: Boolean(pick("pinned")),
    };
  }

  async commitBlogPost(file: TFile, body: string, meta: BlogPostMeta, index: BlogIndex) {
    const notice = new Notice("正在处理图片…", 0);
    try {
      const { files, markdown, coverName } = await this.prepareBlogFiles(file, stripLeadingTitle(body, meta.title), meta.slug);
      const updating = index.posts.has(meta.slug);
      const postMeta: BlogPostMeta = {
        ...meta,
        updated: updating && meta.published !== today() ? today() : undefined,
        image: meta.image && coverName ? `./images/${meta.slug}/${coverName}` : undefined,
      };
      const postPath = `${this.settings.blogPostsDir}/${meta.slug}.md`;
      files.push({ path: postPath, base64: utf8ToBase64(buildFrontmatter(postMeta) + markdown) });

      notice.setMessage("正在提交到博客仓库…");
      await this.blogRepoClient().commitFiles(files, `${updating ? "更新" : "发布"}文章：${meta.title}`);
      notice.hide();

      await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm.blog_slug = meta.slug;
        fm.blog_category = meta.category;
        fm.blog_tags = meta.tags;
        if (meta.series) {
          fm.blog_series = meta.series;
          if (meta.seriesOrder !== undefined) fm.blog_series_order = meta.seriesOrder;
        }
      });

      const url = `${this.settings.blogSiteUrl.replace(/\/+$/, "")}/posts/${meta.slug}/`;
      new Notice(meta.draft ? `草稿已提交：${meta.title}` : `已提交，约 3 分钟后上线：${url}`, 10000);
    } catch (e) {
      notice.hide();
      new Notice(`发布失败，博客没有任何改动: ${(e as Error).message}`, 10000);
    }
  }

  /** 读取并转换文章里的全部图片；任何一张失败都抛错，避免发出缺图的文章 */
  async prepareBlogFiles(
    sourceFile: TFile,
    body: string,
    slug: string
  ): Promise<{ files: CommitFile[]; markdown: string; coverName?: string }> {
    const refs: BlogImageRef[] = collectImageRefs(body);
    const sources = refs.map((ref) => ref.source);
    const convertible = (source: string) => {
      const path = source.split(/[?#]/)[0];
      return CONVERTIBLE_EXT.test(path) || (/^https?:\/\//i.test(source) && !/\.(gif|svg)$/i.test(path));
    };
    const names = assignImageNames(sources, convertible);
    const files: CommitFile[] = [];
    let current = 0;
    for (const [source, name] of names) {
      current++;
      const ref = refs.find((r) => r.source === source)!;
      let bytes: ArrayBuffer;
      if (ref.isRemote) {
        const response = await requestUrl({ url: source, throw: false });
        if (response.status < 200 || response.status >= 300) throw new Error(`外链图片下载失败（${response.status}）: ${source}`);
        bytes = response.arrayBuffer;
      } else {
        let localName = source;
        try {
          localName = decodeURI(source);
        } catch {
          // 路径里有不合法的 % 编码时按原样查找
        }
        const imageFile = this.resolveImageFile(localName, sourceFile);
        if (!imageFile) throw new Error(`找不到图片: ${source}`);
        bytes = await this.app.vault.readBinary(imageFile);
      }
      new Notice(`处理图片 (${current}/${names.size}): ${name}`, 2000);
      if (name.endsWith(".webp")) bytes = await this.convertImage(bytes);
      files.push({ path: `${this.settings.blogPostsDir}/images/${slug}/${name}`, base64: bytesToBase64(bytes) });
    }

    let markdown = body;
    for (const ref of refs) {
      markdown = markdown.replace(ref.fullMatch, () => `![${ref.altText}](./images/${slug}/${names.get(ref.source)})`);
    }
    return { files, markdown, coverName: refs[0] ? names.get(refs[0].source) : undefined };
  }

  /** 按最长边缩放并编码为 WebP，依赖 Obsidian 桌面端的 Canvas */
  async convertImage(bytes: ArrayBuffer): Promise<ArrayBuffer> {
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const scale = Math.min(1, this.settings.blogImageMaxSize / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", this.settings.blogWebpQuality)
    );
    if (!blob || blob.type !== "image/webp") throw new Error("图片转 WebP 失败");
    return blob.arrayBuffer();
  }

  async publishToMd2Html() {
    const processed = await this.processCurrentFile();
    if (!processed) return;

    const { markdown, imageCount } = processed;

    // Compress and encode
    const compressed = pako.gzip(new TextEncoder().encode(markdown));
    const base64 = arrayBufferToBase64(compressed);

    // Open in browser
    const url = `${this.settings.md2htmlUrl}#import/${base64}`;
    window.open(url);

    new Notice(`已上传 ${imageCount} 张图片，已在浏览器中打开`);
  }

  async uploadAndCopy() {
    const processed = await this.processCurrentFile();
    if (!processed) return;

    const { markdown, imageCount } = processed;

    await navigator.clipboard.writeText(markdown);
    new Notice(`已上传 ${imageCount} 张图片，Markdown 已复制到剪贴板`);
  }

  async processCurrentFile(): Promise<{ markdown: string; imageCount: number } | null> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("请先打开一个 Markdown 文件");
      return null;
    }

    if (!this.settings.githubToken) {
      new Notice("请先在设置中配置 GitHub Token");
      return null;
    }

    const content = await this.app.vault.read(file);
    const notice = new Notice("正在处理图片...", 0);

    try {
      const result = await this.processMarkdown(content, file);
      notice.hide();
      return result;
    } catch (e) {
      notice.hide();
      new Notice(`处理失败: ${(e as Error).message}`);
      return null;
    }
  }

  async processMarkdown(content: string, sourceFile: TFile): Promise<{ markdown: string; imageCount: number }> {
    let markdown = content;
    let imageCount = 0;

    // Collect all image references
    const imageRefs: Array<{ fullMatch: string; fileName: string; altText: string; isRemote?: boolean }> = [];

    // Match Obsidian wiki-link images: ![[filename.ext]] or ![[filename.ext|width]]
    const wikiImageRegex = /!\[\[([^\]|]+?)(?:\|[^\]]*?)?\]\]/g;
    let match;
    while ((match = wikiImageRegex.exec(content)) !== null) {
      imageRefs.push({
        fullMatch: match[0],
        fileName: match[1].trim(),
        altText: match[1].trim().replace(/\.[^.]+$/, ""),
      });
    }

    // Match standard markdown images, including third-party HTTP(S) images
    const mdImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    while ((match = mdImageRegex.exec(content)) !== null) {
      const fileName = match[2].trim();
      const isRemote = /^https?:\/\//i.test(fileName);
      if (isRemote && this.isOwnHostedUrl(fileName)) continue;

      imageRefs.push({
        fullMatch: match[0],
        fileName,
        altText: match[1] || fileName.replace(/\.[^.]+$/, ""),
        isRemote,
      });
    }

    if (imageRefs.length === 0) {
      return { markdown, imageCount: 0 };
    }

    // Deduplicate by fileName
    const uniqueImages = new Map<string, typeof imageRefs[0]>();
    for (const ref of imageRefs) {
      if (!uniqueImages.has(ref.fileName)) {
        uniqueImages.set(ref.fileName, ref);
      }
    }

    // Upload each unique image
    const urlMap = new Map<string, string>();
    const total = uniqueImages.size;
    let current = 0;

    for (const [fileName, ref] of uniqueImages) {
      current++;

      // Check cache first
      if (uploadCache.has(fileName)) {
        urlMap.set(fileName, uploadCache.get(fileName)!);
        continue;
      }

      if (ref.isRemote) {
        new Notice(`上传中 (${current}/${total}): ${fileName}`, 3000);
        try {
          const url = await this.uploadRemoteToGitHub(fileName);
          urlMap.set(fileName, url);
          uploadCache.set(fileName, url);
          imageCount++;
        } catch {
          throw new Error(`外链图片处理失败: ${fileName}`);
        }
        continue;
      }

      // Resolve file in vault
      const imageFile = this.resolveImageFile(fileName, sourceFile);
      if (!imageFile) {
        new Notice(`找不到图片: ${fileName}`);
        continue;
      }

      new Notice(`上传中 (${current}/${total}): ${fileName}`, 3000);

      try {
        const url = await this.uploadToGitHub(imageFile);
        urlMap.set(fileName, url);
        uploadCache.set(fileName, url);
        imageCount++;
      } catch (e) {
        new Notice(`上传失败: ${fileName} - ${(e as Error).message}`);
      }
    }

    // Replace all image references
    for (const ref of imageRefs) {
      const url = urlMap.get(ref.fileName);
      if (url) {
        markdown = markdown.replace(ref.fullMatch, `![${ref.altText}](${url})`);
      }
    }

    return { markdown, imageCount };
  }

  resolveImageFile(fileName: string, sourceFile: TFile): TFile | null {
    // Try Obsidian's built-in link resolution (handles vault-wide search)
    const resolved = this.app.metadataCache.getFirstLinkpathDest(fileName, sourceFile.path);
    if (resolved) return resolved;

    // Try as relative path from source file's directory
    const dir = sourceFile.parent?.path || "";
    const relativePath = dir ? `${dir}/${fileName}` : fileName;
    const file = this.app.vault.getFileByPath(relativePath);
    if (file instanceof TFile) return file;

    return null;
  }

  isOwnHostedUrl(source: string): boolean {
    try {
      const url = new URL(source);
      const parts = url.pathname.split("/").filter(Boolean);
      const owner = this.settings.githubUsername.toLowerCase();
      const repo = this.settings.githubRepo.toLowerCase();

      if (url.hostname === "cdn.jsdelivr.net") {
        return (
          parts[0] === "gh" &&
          parts[1]?.toLowerCase() === owner &&
          parts[2]?.split("@")[0].toLowerCase() === repo
        );
      }

      if (url.hostname === "raw.githubusercontent.com") {
        return parts[0]?.toLowerCase() === owner && parts[1]?.toLowerCase() === repo;
      }
    } catch {
      return false;
    }

    return false;
  }

  async uploadToGitHub(file: TFile): Promise<string> {
    const arrayBuffer = await this.app.vault.readBinary(file);
    return this.uploadBytesToGitHub(arrayBuffer, file.name);
  }

  async uploadRemoteToGitHub(remoteUrl: string): Promise<string> {
    const response = await requestUrl({ url: remoteUrl });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const lastPathPart = new URL(remoteUrl).pathname.split("/").pop();
    let fileName = lastPathPart || "remote-image.bin";
    try {
      fileName = decodeURIComponent(fileName);
    } catch {
      // Keep the encoded path segment when it is not valid URI encoding.
    }

    return this.uploadBytesToGitHub(response.arrayBuffer, fileName);
  }

  async uploadBytesToGitHub(arrayBuffer: ArrayBuffer, fileName: string): Promise<string> {
    const { githubUsername, githubRepo, githubToken, githubBranch, useJsdelivr } = this.settings;

    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64Content = btoa(binary);

    // Use timestamp + filename to avoid conflicts
    const timestamp = Date.now();
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const remotePath = `images/${timestamp}_${safeName}`;

    // PUT to GitHub API
    const response = await requestUrl({
      url: `https://api.github.com/repos/${githubUsername}/${githubRepo}/contents/${remotePath}`,
      method: "PUT",
      headers: {
        Authorization: `token ${githubToken}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github.v3+json",
      },
      body: JSON.stringify({
        message: `upload ${fileName}`,
        content: base64Content,
        branch: githubBranch,
      }),
    });

    if (response.status !== 200 && response.status !== 201) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    // Return CDN URL or raw URL
    if (useJsdelivr) {
      return `https://cdn.jsdelivr.net/gh/${githubUsername}/${githubRepo}@${githubBranch}/${remotePath}`;
    }
    return `https://raw.githubusercontent.com/${githubUsername}/${githubRepo}/${githubBranch}/${remotePath}`;
  }
}

function arrayBufferToBase64(buffer: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buffer.byteLength; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary);
}

class Md2HtmlSettingTab extends PluginSettingTab {
  plugin: Md2HtmlPlugin;

  constructor(app: App, plugin: Md2HtmlPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Markdown2HTML 设置" });

    new Setting(containerEl)
      .setName("编辑器地址")
      .setDesc("你部署的 markdown2html 地址")
      .addText((text) =>
        text
          .setPlaceholder("https://md.riowang.win")
          .setValue(this.plugin.settings.md2htmlUrl)
          .onChange(async (value) => {
            this.plugin.settings.md2htmlUrl = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "GitHub 图床" });

    new Setting(containerEl)
      .setName("GitHub 用户名")
      .addText((text) =>
        text
          .setPlaceholder("username")
          .setValue(this.plugin.settings.githubUsername)
          .onChange(async (value) => {
            this.plugin.settings.githubUsername = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("GitHub 仓库名")
      .addText((text) =>
        text
          .setPlaceholder("image-hosting")
          .setValue(this.plugin.settings.githubRepo)
          .onChange(async (value) => {
            this.plugin.settings.githubRepo = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("GitHub Token")
      .setDesc("需要 repo 权限的 Personal Access Token")
      .addText((text) => {
        text
          .setPlaceholder("ghp_...")
          .setValue(this.plugin.settings.githubToken)
          .onChange(async (value) => {
            this.plugin.settings.githubToken = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
      });

    new Setting(containerEl)
      .setName("分支")
      .addText((text) =>
        text
          .setPlaceholder("main")
          .setValue(this.plugin.settings.githubBranch)
          .onChange(async (value) => {
            this.plugin.settings.githubBranch = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("使用 jsDelivr CDN")
      .setDesc("关闭则使用 raw.githubusercontent.com")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useJsdelivr)
          .onChange(async (value) => {
            this.plugin.settings.useJsdelivr = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "博客" });

    const text = (name: string, key: "blogOwner" | "blogRepo" | "blogBranch" | "blogPostsDir" | "blogSiteUrl", desc = "") =>
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText((input) =>
          input.setValue(this.plugin.settings[key]).onChange(async (value) => {
            this.plugin.settings[key] = value.trim();
            await this.plugin.saveSettings();
          })
        );

    text("仓库所有者", "blogOwner");
    text("仓库名", "blogRepo");
    text("分支", "blogBranch", "推送到这个分支后博客自动构建上线");
    text("文章目录", "blogPostsDir");
    text("博客地址", "blogSiteUrl");

    new Setting(containerEl)
      .setName("博客 GitHub Token")
      .setDesc("建议用细粒度令牌，只授权博客仓库的 Contents 读写；与图床的 Token 分开")
      .addText((input) => {
        input
          .setPlaceholder("github_pat_...")
          .setValue(this.plugin.settings.blogToken)
          .onChange(async (value) => {
            this.plugin.settings.blogToken = value.trim();
            await this.plugin.saveSettings();
          });
        input.inputEl.type = "password";
      });

    new Setting(containerEl)
      .setName("图片最长边")
      .setDesc("超过这个像素会等比缩小，单位 px")
      .addText((input) =>
        input.setValue(String(this.plugin.settings.blogImageMaxSize)).onChange(async (value) => {
          const n = Number(value);
          if (Number.isFinite(n) && n >= 320) {
            this.plugin.settings.blogImageMaxSize = n;
            await this.plugin.saveSettings();
          }
        })
      );
  }
}
