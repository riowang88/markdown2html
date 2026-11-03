import { App, Modal, Setting, TFile } from "obsidian";
import { BlogIndex, BlogPostMeta, isValidSlug, slugify } from "./blog";

export type PublishTarget = "md2html" | "blog" | "blog-folder";

export class PublishTargetModal extends Modal {
  constructor(app: App, private onChoose: (target: PublishTarget) => void) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    this.titleEl.setText("发布到哪里？");
    new Setting(contentEl)
      .setName("公众号排版")
      .setDesc("上传图片到图床，在 markdown2html 中打开排版")
      .addButton((button) => button.setButtonText("打开排版").onClick(() => this.choose("md2html")));
    new Setting(contentEl)
      .setName("博客")
      .setDesc("图片转成 WebP 后连同文章一起提交到博客仓库，约 3 分钟后上线")
      .addButton((button) => button.setButtonText("发布到博客").setCta().onClick(() => this.choose("blog")));
    new Setting(contentEl)
      .setName("整个文件夹到博客")
      .setDesc("把当前笔记所在文件夹里的文章作为一个系列，一次性发布")
      .addButton((button) => button.setButtonText("选择文章").onClick(() => this.choose("blog-folder")));
  }

  private choose(target: PublishTarget) {
    this.close();
    this.onChoose(target);
  }

  onClose() {
    this.contentEl.empty();
  }
}

export interface BlogFormOptions {
  meta: BlogPostMeta;
  index: BlogIndex;
  imageCount: number;
  firstImageName?: string;
  siteUrl: string;
}

export class BlogPublishModal extends Modal {
  private meta: BlogPostMeta;
  private useCover: boolean;
  private errorEl!: HTMLElement;
  private overwriteEl!: HTMLElement;

  constructor(app: App, private options: BlogFormOptions, private onSubmit: (meta: BlogPostMeta) => void) {
    super(app);
    this.meta = { ...options.meta, tags: [...options.meta.tags] };
    this.useCover = Boolean(options.firstImageName);
  }

  onOpen() {
    const { contentEl } = this;
    const { index } = this.options;
    this.titleEl.setText("发布到博客");

    new Setting(contentEl).setName("标题").addText((text) =>
      text.setValue(this.meta.title).onChange((value) => (this.meta.title = value.trim()))
    );

    new Setting(contentEl)
      .setName("网址")
      .setDesc("只能用小写英文、数字和连字符，例如 eldertv-v1-1-0")
      .addText((text) =>
        text
          .setPlaceholder("eldertv-v1-1-0")
          .setValue(this.meta.slug)
          .onChange((value) => {
            this.meta.slug = value.trim();
            this.refreshOverwrite();
          })
      );
    this.overwriteEl = contentEl.createDiv({ cls: "setting-item-description" });
    this.refreshOverwrite();

    new Setting(contentEl).setName("简介").addTextArea((text) => {
      text.setValue(this.meta.description).onChange((value) => (this.meta.description = value.trim()));
      text.inputEl.rows = 2;
      text.inputEl.style.width = "100%";
    });

    const NEW = "__new__";
    const categorySetting = new Setting(contentEl)
      .setName("分类")
      .setDesc("选已有分类，或选「新建分类」后填写名字；新分类推送后会自动出现在博客上");
    let newCategoryInput: HTMLInputElement | undefined;
    const isExisting = index.categories.includes(this.meta.category);
    categorySetting.addDropdown((dropdown) => {
      for (const category of index.categories) dropdown.addOption(category, category);
      dropdown.addOption(NEW, "新建分类…");
      dropdown.setValue(isExisting ? this.meta.category : NEW);
      dropdown.onChange((value) => {
        const creating = value === NEW;
        if (newCategoryInput) newCategoryInput.style.display = creating ? "" : "none";
        this.meta.category = creating ? newCategoryInput?.value.trim() ?? "" : value;
      });
    });
    categorySetting.addText((text) => {
      newCategoryInput = text.inputEl;
      text.setPlaceholder("新分类名").setValue(isExisting ? "" : this.meta.category);
      text.inputEl.style.display = isExisting ? "none" : "";
      text.onChange((value) => (this.meta.category = value.trim()));
    });

    new Setting(contentEl)
      .setName("标签")
      .setDesc("用逗号分隔")
      .addText((text) =>
        text.setValue(this.meta.tags.join(", ")).onChange((value) => {
          this.meta.tags = value
            .split(/[,，]/)
            .map((tag) => tag.trim())
            .filter(Boolean);
        })
      );

    const seriesNames = [...index.series.keys()];
    let orderInput: HTMLInputElement | undefined;
    const seriesSetting = new Setting(contentEl).setName("系列").setDesc("可选；同一系列会显示上一篇、下一篇");
    seriesSetting.addText((text) => {
      const listId = "md2html-blog-series";
      const list = contentEl.createEl("datalist", { attr: { id: listId } });
      for (const name of seriesNames) list.createEl("option", { attr: { value: name } });
      text.inputEl.setAttr("list", listId);
      text.setPlaceholder("不加入系列").setValue(this.meta.series);
      text.onChange((value) => {
        this.meta.series = value.trim();
        const last = index.series.get(this.meta.series);
        if (last !== undefined && orderInput && !orderInput.value) {
          orderInput.value = String(last + 1);
          this.meta.seriesOrder = last + 1;
        }
      });
    });
    seriesSetting.addText((text) => {
      orderInput = text.inputEl;
      text.inputEl.type = "number";
      text.inputEl.style.width = "5em";
      text.setPlaceholder("序号").setValue(this.meta.seriesOrder === undefined ? "" : String(this.meta.seriesOrder));
      text.onChange((value) => {
        const n = Number(value);
        this.meta.seriesOrder = value.trim() && Number.isFinite(n) ? n : undefined;
      });
    });

    new Setting(contentEl).setName("发布日期").addText((text) => {
      text.inputEl.type = "date";
      text.setValue(this.meta.published).onChange((value) => (this.meta.published = value));
    });

    if (this.options.firstImageName) {
      new Setting(contentEl)
        .setName("封面")
        .setDesc(`用第一张图（${this.options.firstImageName}）做列表封面`)
        .addToggle((toggle) => toggle.setValue(this.useCover).onChange((value) => (this.useCover = value)));
    }

    new Setting(contentEl)
      .setName("置顶")
      .addToggle((toggle) => toggle.setValue(this.meta.pinned).onChange((value) => (this.meta.pinned = value)));

    new Setting(contentEl)
      .setName("存为草稿")
      .setDesc("草稿会提交到仓库，但不会在博客上显示")
      .addToggle((toggle) => toggle.setValue(this.meta.draft).onChange((value) => (this.meta.draft = value)));

    this.errorEl = contentEl.createDiv({ cls: "mod-warning" });

    new Setting(contentEl)
      .setDesc(`共 ${this.options.imageCount} 张图片，会转成 WebP 后一起提交`)
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("发布").setCta().onClick(() => this.submit()));
  }

  private refreshOverwrite() {
    const existing = this.options.index.posts.get(this.meta.slug);
    this.overwriteEl.setText(
      existing ? `博客上已有这篇文章（${this.options.siteUrl}/posts/${this.meta.slug}/），发布会更新它` : ""
    );
  }

  private submit() {
    const problems: string[] = [];
    if (!this.meta.title) problems.push("请填写标题");
    if (!isValidSlug(this.meta.slug)) problems.push("网址只能用小写英文、数字和连字符");
    if (!this.meta.category) problems.push("请选择或填写分类");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(this.meta.published)) problems.push("请填写发布日期");
    if (problems.length) {
      this.errorEl.setText(problems.join("；"));
      return;
    }
    // 封面路径依赖最终网址，交给调用方按第一张图生成
    this.meta.image = this.useCover ? "first" : undefined;
    this.close();
    this.onSubmit(this.meta);
  }

  onClose() {
    this.contentEl.empty();
  }
}

export interface BatchEntry {
  file: TFile;
  body: string;
  meta: BlogPostMeta;
  order?: number;
  selected: boolean;
  /** 网址来自笔记里的 blog_slug，不跟随前缀变化 */
  customSlug: boolean;
}

export interface BatchFormOptions {
  folderName: string;
  entries: BatchEntry[];
  index: BlogIndex;
  siteUrl: string;
}

/** 文件夹批量发布：分类、系列、标签统一设置，逐篇勾选并核对网址 */
export class BlogBatchModal extends Modal {
  private category = "";
  private series: string;
  private prefix: string;
  private tags: string[] = [];
  private draft = false;
  private errorEl!: HTMLElement;
  private slugInputs = new Map<BatchEntry, HTMLInputElement>();

  constructor(app: App, private options: BatchFormOptions, private onSubmit: (entries: BatchEntry[]) => void) {
    super(app);
    const first = options.entries.find((e) => e.meta.category || e.meta.series);
    this.category = first?.meta.category ?? "";
    this.series = first?.meta.series || options.folderName;
    this.prefix = slugify(options.folderName);
    this.tags = first?.meta.tags ?? [];
  }

  onOpen() {
    const { contentEl } = this;
    const { index } = this.options;
    this.titleEl.setText(`发布文件夹到博客：${this.options.folderName}`);

    const NEW = "__new__";
    let newCategoryInput: HTMLInputElement | undefined;
    const isExisting = index.categories.includes(this.category);
    new Setting(contentEl)
      .setName("分类")
      .setDesc("所有勾选的文章都放进这个分类")
      .addDropdown((dropdown) => {
        for (const category of index.categories) dropdown.addOption(category, category);
        dropdown.addOption(NEW, "新建分类…");
        dropdown.setValue(isExisting ? this.category : NEW);
        dropdown.onChange((value) => {
          const creating = value === NEW;
          if (newCategoryInput) newCategoryInput.style.display = creating ? "" : "none";
          this.category = creating ? newCategoryInput?.value.trim() ?? "" : value;
        });
      })
      .addText((text) => {
        newCategoryInput = text.inputEl;
        text.setPlaceholder("新分类名").setValue(isExisting ? "" : this.category);
        text.inputEl.style.display = isExisting ? "none" : "";
        text.onChange((value) => (this.category = value.trim()));
      });

    new Setting(contentEl)
      .setName("系列")
      .setDesc("留空则不加入系列；序号用下方每篇的序号")
      .addText((text) => text.setValue(this.series).onChange((value) => (this.series = value.trim())));

    new Setting(contentEl)
      .setName("网址前缀")
      .setDesc("每篇网址为「前缀-序号」，只能用小写英文、数字和连字符")
      .addText((text) =>
        text
          .setPlaceholder("xiaohongshu-lawsuit")
          .setValue(this.prefix)
          .onChange((value) => {
            this.prefix = value.trim();
            this.refreshSlugs();
          })
      );

    new Setting(contentEl)
      .setName("标签")
      .setDesc("用逗号分隔，所有文章共用")
      .addText((text) =>
        text.setValue(this.tags.join(", ")).onChange((value) => {
          this.tags = value
            .split(/[,，]/)
            .map((tag) => tag.trim())
            .filter(Boolean);
        })
      );

    new Setting(contentEl)
      .setName("存为草稿")
      .addToggle((toggle) => toggle.setValue(this.draft).onChange((value) => (this.draft = value)));

    contentEl.createEl("h4", { text: "文章（取消勾选的不发布）" });
    for (const entry of this.options.entries) {
      const row = new Setting(contentEl).setName(entry.meta.title).setDesc(entry.file.basename);
      row.addToggle((toggle) => toggle.setValue(entry.selected).onChange((value) => (entry.selected = value)));
      row.addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.style.width = "4em";
        text.setPlaceholder("序号").setValue(entry.order === undefined ? "" : String(entry.order));
        text.onChange((value) => {
          const n = Number(value);
          entry.order = value.trim() && Number.isFinite(n) ? n : undefined;
          this.refreshSlugs();
        });
      });
      row.addText((text) => {
        text.inputEl.style.width = "14em";
        this.slugInputs.set(entry, text.inputEl);
        text.onChange((value) => {
          entry.meta.slug = value.trim();
          entry.customSlug = true;
        });
      });
    }
    this.refreshSlugs();

    this.errorEl = contentEl.createDiv({ cls: "mod-warning" });
    new Setting(contentEl)
      .setDesc("勾选的文章和图片会合成一个提交，只触发一次构建")
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("发布").setCta().onClick(() => this.submit()));
  }

  private refreshSlugs() {
    for (const [entry, input] of this.slugInputs) {
      if (!entry.customSlug && this.prefix && entry.order !== undefined) entry.meta.slug = `${this.prefix}-${entry.order}`;
      input.value = entry.meta.slug;
    }
  }

  private submit() {
    const chosen = this.options.entries.filter((e) => e.selected);
    const problems: string[] = [];
    if (!chosen.length) problems.push("至少勾选一篇");
    if (!this.category) problems.push("请选择或填写分类");
    const seen = new Set<string>();
    for (const entry of chosen) {
      if (!isValidSlug(entry.meta.slug)) problems.push(`「${entry.file.basename}」的网址不合法`);
      else if (seen.has(entry.meta.slug)) problems.push(`网址重复：${entry.meta.slug}`);
      seen.add(entry.meta.slug);
    }
    if (problems.length) {
      this.errorEl.setText(problems.join("；"));
      return;
    }
    for (const entry of chosen) {
      entry.meta.category = this.category;
      entry.meta.series = this.series;
      entry.meta.seriesOrder = this.series ? entry.order : undefined;
      entry.meta.tags = [...this.tags];
      entry.meta.draft = this.draft;
    }
    this.close();
    this.onSubmit(chosen);
  }

  onClose() {
    this.contentEl.empty();
  }
}
