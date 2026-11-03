const assert = require("node:assert/strict");
const { test } = require("node:test");
const path = require("node:path");
const esbuild = require("esbuild");

class TFile {
  constructor(filePath) {
    this.path = filePath;
    this.name = path.posix.basename(filePath);
    const parentPath = path.posix.dirname(filePath);
    this.parent = { path: parentPath === "." ? "" : parentPath };
  }
}

class Plugin {}
class PluginSettingTab {}
class Setting {}

let requestHandler;
let notices = [];

class Notice {
  constructor(message) {
    notices.push(message);
  }

  hide() {}
}

const build = esbuild.buildSync({
  entryPoints: [path.join(__dirname, "main.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["obsidian"],
  write: false,
});
const moduleUnderTest = { exports: {} };
const localRequire = (id) =>
  id === "obsidian"
    ? {
        App: class {},
        Modal: class {},
        Plugin,
        PluginSettingTab,
        Setting,
        Notice,
        TFile,
        requestUrl: (options) => requestHandler(options),
      }
    : require(id);
new Function("require", "module", "exports", build.outputFiles[0].text)(
  localRequire,
  moduleUnderTest,
  moduleUnderTest.exports
);
const Md2HtmlPlugin = moduleUnderTest.exports.default;

function createPlugin(content, files = {}) {
  const sourceFile = new TFile("notes/article.md");
  const plugin = Object.create(Md2HtmlPlugin.prototype);
  plugin.settings = {
    githubUsername: "own-owner",
    githubRepo: "images",
    githubToken: "token",
    githubBranch: "main",
    useJsdelivr: true,
    md2htmlUrl: "https://example.com",
  };
  plugin.app = {
    workspace: { getActiveFile: () => sourceFile },
    vault: {
      read: async () => content,
      readBinary: async (file) => files[file.path],
      getFileByPath: (filePath) => (files[filePath] ? new TFile(filePath) : null),
    },
    metadataCache: {
      getFirstLinkpathDest: (fileName) => {
        const filePath = Object.keys(files).find((candidate) => candidate.endsWith(`/${fileName}`));
        return filePath ? new TFile(filePath) : null;
      },
    },
  };
  return { plugin, sourceFile };
}

function githubSuccess() {
  return { status: 201, arrayBuffer: new ArrayBuffer(0) };
}

test("第三方 HTTPS 图片会下载、上传并替换 URL", async () => {
  notices = [];
  const calls = [];
  requestHandler = async (options) => {
    calls.push(options);
    return calls.length === 1 ? { status: 200, arrayBuffer: Uint8Array.from([1, 2, 3]).buffer } : githubSuccess();
  };
  const remoteUrl = "https://images.example.com/posts/cover.png?size=large";
  const { plugin, sourceFile } = createPlugin(`![封面](${remoteUrl})`);

  const result = await plugin.processMarkdown(`![封面](${remoteUrl})`, sourceFile);

  assert.equal(calls[0].url, remoteUrl);
  assert.match(
    calls[1].url,
    /^https:\/\/api\.github\.com\/repos\/own-owner\/images\/contents\/images\/\d+_cover\.png$/
  );
  assert.equal(JSON.parse(calls[1].body).content, "AQID");
  assert.match(result.markdown, /^!\[封面\]\(https:\/\/cdn\.jsdelivr\.net\/gh\/own-owner\/images@main\/images\//);
  assert.equal(result.imageCount, 1);
});

test("当前配置的 jsDelivr 和 raw 图床 URL 会跳过", async () => {
  notices = [];
  const calls = [];
  requestHandler = async (options) => {
    calls.push(options);
    return githubSuccess();
  };
  const markdown = [
    "![a](https://cdn.jsdelivr.net/gh/own-owner/images@main/images/a.png)",
    "![b](https://raw.githubusercontent.com/own-owner/images/main/images/b.png)",
  ].join("\n");
  const { plugin, sourceFile } = createPlugin(markdown);

  const result = await plugin.processMarkdown(markdown, sourceFile);

  assert.equal(result.markdown, markdown);
  assert.equal(result.imageCount, 0);
  assert.equal(calls.length, 0);
});

test("本地 wiki 与标准 Markdown 图片仍沿用原上传逻辑", async () => {
  notices = [];
  const calls = [];
  requestHandler = async (options) => {
    calls.push(options);
    return githubSuccess();
  };
  const files = {
    "assets/wiki.png": Uint8Array.from([1]).buffer,
    "assets/local.jpg": Uint8Array.from([2]).buffer,
  };
  const markdown = "![[wiki.png|300]]\n![本地](local.jpg)";
  const { plugin, sourceFile } = createPlugin(markdown, files);

  const result = await plugin.processMarkdown(markdown, sourceFile);

  assert.equal(calls.length, 2);
  assert.equal(result.imageCount, 2);
  assert.doesNotMatch(result.markdown, /!\[\[|!\[本地\]\(local\.jpg\)/);
});

test("同一第三方 URL 只下载并上传一次", async () => {
  notices = [];
  const calls = [];
  requestHandler = async (options) => {
    calls.push(options);
    return calls.length === 1 ? { status: 200, arrayBuffer: Uint8Array.from([7]).buffer } : githubSuccess();
  };
  const remoteUrl = "https://static.example.com/shared.png";
  const markdown = `![一](${remoteUrl})\n![二](${remoteUrl})`;
  const { plugin, sourceFile } = createPlugin(markdown);

  const result = await plugin.processMarkdown(markdown, sourceFile);

  assert.equal(calls.length, 2);
  assert.equal(result.imageCount, 1);
  assert.equal((result.markdown.match(/cdn\.jsdelivr\.net/g) || []).length, 2);
});

test("第三方图片下载失败会阻止整篇处理", async () => {
  notices = [];
  const calls = [];
  requestHandler = async (options) => {
    calls.push(options);
    throw new Error("network down");
  };
  const remoteUrl = "https://broken.example.com/image.png";
  const { plugin } = createPlugin(`![失败](${remoteUrl})`);

  const result = await plugin.processCurrentFile();

  assert.equal(result, null);
  assert.equal(calls.length, 1);
  assert.ok(notices.some((message) => String(message).startsWith("处理失败:")));
});
