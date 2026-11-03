const assert = require("node:assert/strict");
const { test } = require("node:test");
const path = require("node:path");
const esbuild = require("esbuild");

class TFile {
  constructor(filePath) {
    this.path = filePath;
    this.name = path.posix.basename(filePath);
    this.basename = this.name.replace(/\.[^.]+$/, "");
    this.extension = "md";
    const parentPath = path.posix.dirname(filePath);
    this.parent = { path: parentPath === "." ? "" : parentPath };
  }
}

let requestHandler;
const notices = [];
class Notice {
  constructor(message) {
    notices.push(message);
  }
  setMessage(message) {
    notices.push(message);
  }
  hide() {}
}

// 记录弹窗里渲染出的按钮，便于模拟点击
const renderedButtons = [];
class Setting {
  constructor() {}
  setName(name) { this.name = name; return this; }
  setDesc() { return this; }
  addButton(cb) {
    const button = { setButtonText(text) { this.text = text; return this; }, setCta() { return this; }, onClick(fn) { this.click = fn; return this; } };
    cb(button);
    renderedButtons.push(button);
    return this;
  }
}
class Modal {
  constructor(app) {
    this.app = app;
    this.contentEl = { empty() {} };
    this.titleEl = { setText(text) { this.text = text; } };
  }
  open() { this.onOpen(); }
  close() { this.closed = true; }
}

const obsidian = {
  App: class {},
  Modal,
  Plugin: class {},
  PluginSettingTab: class {},
  Setting,
  Notice,
  TFile,
  requestUrl: (options) => requestHandler(options),
};

function load(entry) {
  const build = esbuild.buildSync({
    entryPoints: [path.join(__dirname, entry)],
    bundle: true,
    format: "cjs",
    platform: "node",
    external: ["obsidian"],
    write: false,
  });
  const mod = { exports: {} };
  new Function("require", "module", "exports", build.outputFiles[0].text)(
    (id) => (id === "obsidian" ? obsidian : require(id)),
    mod,
    mod.exports
  );
  return mod.exports;
}

const blog = load("blog.ts");
const Md2HtmlPlugin = load("main.ts").default;

function json(body, status = 200) {
  return { status, json: body };
}

function createPlugin(files = {}) {
  const sourceFile = new TFile("notes/文章.md");
  const plugin = Object.create(Md2HtmlPlugin.prototype);
  plugin.settings = {
    blogOwner: "owner",
    blogRepo: "blog",
    blogBranch: "main",
    blogToken: "token",
    blogPostsDir: "src/content/posts",
    blogSiteUrl: "https://blog.example.com",
    blogImageMaxSize: 2000,
    blogWebpQuality: 0.85,
  };
  plugin.app = {
    vault: {
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
  plugin.convertImage = async () => Uint8Array.from([9, 9]).buffer;
  return { plugin, sourceFile };
}

test("slugify 只保留小写英文、数字和连字符", () => {
  assert.equal(blog.slugify("ElderTV 1.1.0 Release.md"), "eldertv-1-1-0-release");
  assert.equal(blog.slugify("06-ElderTV：给老人用的电视端"), "06-eldertv");
  assert.equal(blog.slugify("全中文标题"), "");
  assert.ok(blog.isValidSlug("eldertv-v1-0-0"));
  assert.ok(!blog.isValidSlug("ElderTV"));
  assert.ok(!blog.isValidSlug("a--b"));
});

test("图片命名：可转换的改为 webp，同名去重，非 ASCII 用序号", () => {
  const names = blog.assignImageNames(
    ["shot.png", "dir/shot.png", "截图.jpg", "anim.gif", "https://x.com/a/photo.jpeg?w=1"],
    (source) => !/\.gif$/.test(source)
  );
  assert.deepEqual([...names.values()], ["shot.webp", "shot-2.webp", "img-03.webp", "anim.gif", "photo.webp"]);
});

test("元数据：引号转义、系列和草稿", () => {
  const fm = blog.buildFrontmatter({
    title: 'A "quoted" title',
    slug: "a",
    published: "2026-11-03",
    updated: "2026-11-04",
    description: "简介",
    category: "ElderTV",
    tags: ["版本说明", "TV"],
    series: "Home Spider Forge",
    seriesOrder: 7,
    draft: true,
    pinned: false,
    image: "./images/a/cover.webp",
  });
  assert.equal(
    fm,
    [
      "---",
      'title: "A \\"quoted\\" title"',
      "published: 2026-11-03",
      "updated: 2026-11-04",
      'description: "简介"',
      'image: "./images/a/cover.webp"',
      'tags: ["版本说明", "TV"]',
      'category: "ElderTV"',
      'series: "Home Spider Forge"',
      "seriesOrder: 7",
      "draft: true",
      "---",
      "",
    ].join("\n")
  );
});

test("从已有文章汇总分类、系列最大序号和发布日期", () => {
  const index = blog.buildIndex([
    { slug: "a", text: '---\ntitle: "A"\npublished: 2025-02-19\ncategory: "智能运维"\n---\n' },
    { slug: "b", text: '---\npublished: 2026-11-03\ncategory: "ElderTV"\nseries: "Home Spider Forge"\nseriesOrder: 6\n---\n' },
    { slug: "c", text: '---\ncategory: "ElderTV"\nseries: "Home Spider Forge"\nseriesOrder: 2\n---\n' },
  ]);
  assert.deepEqual([...index.categories].sort(), ["ElderTV", "智能运维"]);
  assert.equal(index.series.get("Home Spider Forge"), 6);
  assert.equal(index.posts.get("a").published, "2025-02-19");
});

test("正文处理：去掉 Obsidian 元数据和重复标题，取第一段做简介", () => {
  const body = blog.stripFrontmatter("---\ntags: [x]\n---\n# 标题\n\n![[a.png]]\n\n第一段 **正文**。\n");
  const stripped = blog.stripLeadingTitle(body, "标题");
  assert.equal(stripped, "![[a.png]]\n\n第一段 **正文**。\n");
  assert.equal(blog.firstHeading(body), "标题");
  assert.equal(blog.firstParagraph(stripped), "第一段 正文。");
});

test("准备文件：本地和外链图片转 WebP 放进文章目录，GIF 原样保留并替换引用", async () => {
  requestHandler = async () => ({ status: 200, arrayBuffer: Uint8Array.from([5]).buffer });
  const { plugin, sourceFile } = createPlugin({
    "attachments/home.png": Uint8Array.from([1]).buffer,
    "attachments/anim.gif": Uint8Array.from([2]).buffer,
  });
  const body = "![[home.png]]\n![动图](anim.gif)\n![外链](https://img.example.com/p/cover.jpg)\n![[home.png|300]]";

  const { files, markdown, coverName } = await plugin.prepareBlogFiles(sourceFile, body, "my-post");

  assert.deepEqual(
    files.map((f) => [f.path, f.base64]),
    [
      ["src/content/posts/images/my-post/home.webp", "CQk="],
      ["src/content/posts/images/my-post/anim.gif", "Ag=="],
      ["src/content/posts/images/my-post/cover.webp", "CQk="],
    ]
  );
  assert.equal(
    markdown,
    "![home](./images/my-post/home.webp)\n![动图](./images/my-post/anim.gif)\n![外链](./images/my-post/cover.webp)\n![home](./images/my-post/home.webp)"
  );
  assert.equal(coverName, "home.webp");
});

test("准备文件：找不到图片时整篇失败，不会发出缺图的文章", async () => {
  const { plugin, sourceFile } = createPlugin({});
  await assert.rejects(plugin.prepareBlogFiles(sourceFile, "![[missing.png]]", "p"), /找不到图片/);
});

test("初始元数据：优先用笔记里的 blog_ 字段，更新已有文章时保留原发布日期", () => {
  const { plugin, sourceFile } = createPlugin();
  const index = blog.buildIndex([{ slug: "eldertv-v1-0-0", text: "---\npublished: 2026-11-03\n---\n" }]);
  const meta = plugin.initialBlogMeta(
    sourceFile,
    "# 文章标题\n\n这是简介。",
    { blog_slug: "eldertv-v1-0-0", blog_category: "ElderTV", tags: ["a", "b"], blog_series_order: 6 },
    index
  );
  assert.equal(meta.title, "文章标题");
  assert.equal(meta.slug, "eldertv-v1-0-0");
  assert.equal(meta.published, "2026-11-03");
  assert.equal(meta.category, "ElderTV");
  assert.deepEqual(meta.tags, ["a", "b"]);
  assert.equal(meta.seriesOrder, 6);
  assert.equal(meta.description, "这是简介。");
});

test("提交：多个文件合成一个提交，并以非强制方式快进分支", async () => {
  const calls = [];
  requestHandler = async (options) => {
    calls.push({ method: options.method, url: options.url.replace("https://api.github.com/repos/owner/blog", ""), body: options.body && JSON.parse(options.body) });
    const last = calls[calls.length - 1];
    if (last.url === "/git/ref/heads/main") return json({ object: { sha: "parent" } });
    if (last.url === "/git/commits/parent") return json({ tree: { sha: "base-tree" } });
    if (last.url === "/git/blobs") return json({ sha: `blob${calls.length}` }, 201);
    if (last.url === "/git/trees") return json({ sha: "new-tree" }, 201);
    if (last.url === "/git/commits") return json({ sha: "new-commit" }, 201);
    return json({}, 200);
  };
  const repo = new blog.GitHubRepo({ owner: "owner", repo: "blog", branch: "main", token: "t", postsDir: "p" });

  const sha = await repo.commitFiles(
    [
      { path: "p/a.md", base64: "YQ==" },
      { path: "p/images/a/x.webp", base64: "eA==" },
    ],
    "发布文章：A"
  );

  assert.equal(sha, "new-commit");
  assert.deepEqual(
    calls.map((c) => `${c.method || "GET"} ${c.url}`),
    [
      "GET /git/ref/heads/main",
      "GET /git/commits/parent",
      "POST /git/blobs",
      "POST /git/blobs",
      "POST /git/trees",
      "POST /git/commits",
      "PATCH /git/refs/heads/main",
    ]
  );
  assert.equal(calls[4].body.base_tree, "base-tree");
  assert.deepEqual(calls[5].body.parents, ["parent"]);
  assert.deepEqual(calls[6].body, { sha: "new-commit", force: false });
});

test("提交：中途出错时不会改动分支", async () => {
  const calls = [];
  requestHandler = async (options) => {
    calls.push(options.method || "GET");
    if (options.url.endsWith("/git/ref/heads/main")) return json({ object: { sha: "parent" } });
    if (options.url.endsWith("/git/commits/parent")) return json({ tree: { sha: "t" } });
    return json({ message: "Bad credentials" }, 401);
  };
  const repo = new blog.GitHubRepo({ owner: "owner", repo: "blog", branch: "main", token: "t", postsDir: "p" });
  await assert.rejects(repo.commitFiles([{ path: "a", base64: "" }], "m"), /401: Bad credentials/);
  assert.ok(!calls.includes("PATCH"));
});

test("原「Publish to Markdown2HTML」命令 id 现在先弹出选择窗口", async () => {
  const commands = {};
  const plugin = Object.create(Md2HtmlPlugin.prototype);
  plugin.loadSettings = async () => {};
  plugin.addCommand = (command) => (commands[command.id] = command);
  plugin.addRibbonIcon = () => {};
  plugin.addSettingTab = () => {};
  await plugin.onload();

  const calls = [];
  plugin.choosePublishTarget = () => calls.push("choose");
  plugin.publishToBlog = () => calls.push("blog");
  plugin.publishToMd2Html = () => calls.push("md2html");
  commands["publish-to-md2html"].callback();
  commands["publish-to-blog"].callback();
  commands["publish-to-md2html-direct"].callback();
  assert.deepEqual(calls, ["choose", "blog", "md2html"]);
  assert.match(commands["publish-to-md2html"].name, /选择公众号排版或博客/);
});

test("选择窗口：两个按钮分别进入公众号排版和博客发布", () => {
  const plugin = Object.create(Md2HtmlPlugin.prototype);
  plugin.app = {};
  const calls = [];
  plugin.publishToBlog = () => calls.push("blog");
  plugin.publishToMd2Html = () => calls.push("md2html");

  for (const text of ["打开排版", "发布到博客"]) {
    renderedButtons.length = 0;
    plugin.choosePublishTarget();
    assert.deepEqual(renderedButtons.map((b) => b.text), ["打开排版", "发布到博客"]);
    renderedButtons.find((b) => b.text === text).click();
  }
  assert.deepEqual(calls, ["md2html", "blog"]);
});
