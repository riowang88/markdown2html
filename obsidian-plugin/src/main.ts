import { App, Plugin, PluginSettingTab, Setting, Notice, TFile, requestUrl } from "obsidian";
import pako from "pako";

interface Md2HtmlSettings {
  githubUsername: string;
  githubRepo: string;
  githubToken: string;
  githubBranch: string;
  useJsdelivr: boolean;
  md2htmlUrl: string;
}

const DEFAULT_SETTINGS: Md2HtmlSettings = {
  githubUsername: "",
  githubRepo: "image-hosting",
  githubToken: "",
  githubBranch: "main",
  useJsdelivr: true,
  md2htmlUrl: "https://md.riowang.win",
};

// Cache uploaded image URLs to avoid re-uploading within a session
const uploadCache: Map<string, string> = new Map();

export default class Md2HtmlPlugin extends Plugin {
  settings: Md2HtmlSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

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
    const imageRefs: Array<{ fullMatch: string; fileName: string; altText: string }> = [];

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

    // Match standard markdown local images: ![alt](path) where path is not a URL
    const mdImageRegex = /!\[([^\]]*)\]\((?!https?:\/\/)([^)]+)\)/g;
    while ((match = mdImageRegex.exec(content)) !== null) {
      imageRefs.push({
        fullMatch: match[0],
        fileName: match[2].trim(),
        altText: match[1] || match[2].trim().replace(/\.[^.]+$/, ""),
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

    for (const [fileName] of uniqueImages) {
      current++;

      // Check cache first
      if (uploadCache.has(fileName)) {
        urlMap.set(fileName, uploadCache.get(fileName)!);
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

  async uploadToGitHub(file: TFile): Promise<string> {
    const { githubUsername, githubRepo, githubToken, githubBranch, useJsdelivr } = this.settings;

    // Read file as binary
    const arrayBuffer = await this.app.vault.readBinary(file);
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64Content = btoa(binary);

    // Use timestamp + filename to avoid conflicts
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
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
        message: `upload ${file.name}`,
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
  }
}
